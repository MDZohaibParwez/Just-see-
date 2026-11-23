import { frameToUs, getAsset, type Asset, type Project } from "@just-see/schema";
import { Compositor, type ResolvedImage, type SourceProvider } from "../gl/compositor";
import { planMediaSources, resolveAudio, resolveFrame, type MediaSource, type VisualLayer } from "../resolve";
import { decodeMp4Audio, decodeWithWebAudio, mixSegments, type Pcm } from "../media/audio";
import { Mp4Demuxer, isMp4Like } from "../media/demux";
import { VideoFrameReader } from "../media/frame-reader";
import { parseCubeLut, type Lut3D } from "../media/lut";
import { processClipPcm } from "../audio/fx";
import { loadDsp } from "../audio/wasm";

/** Computes a person mask for a decoded frame (background removal). */
export type MaskProvider = (image: TexImageSource) => Promise<ResolvedImage | null>;

export interface MediaLoader {
  /** Original file for an asset (export never uses proxies). */
  getBlob(asset: Asset): Promise<Blob>;
}

/** Fallback frame source for files WebCodecs cannot demux (WebM etc.). */
class ElementFrameSource {
  private video: HTMLVideoElement;
  private ready: Promise<void>;
  private version = 0;
  constructor(blob: Blob) {
    const v = document.createElement("video");
    v.muted = true;
    v.playsInline = true;
    v.preload = "auto";
    v.src = URL.createObjectURL(blob);
    this.video = v;
    this.ready = new Promise((resolve, reject) => {
      v.onloadeddata = () => resolve();
      v.onerror = () => reject(new Error("Could not load video"));
    });
  }
  async frameAt(us: number): Promise<ResolvedImage> {
    await this.ready;
    const v = this.video;
    const t = us / 1e6;
    if (Math.abs(v.currentTime - t) > 0.001) {
      await new Promise<void>((resolve) => {
        v.onseeked = () => resolve();
        v.currentTime = t;
      });
    }
    this.version++;
    return { image: v, rotation: 0, version: this.version };
  }
  close(): void {
    URL.revokeObjectURL(this.video.src);
    this.video.removeAttribute("src");
    this.video.load();
  }
}

type ClipSource = { kind: "decoder"; reader: VideoFrameReader } | { kind: "element"; el: ElementFrameSource };

export function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("Export cancelled", "AbortError");
}

/**
 * Everything needed to render a project frame by frame and mix its audio:
 * file access, demuxers, decoders, images and LUTs. Shared by every export
 * format so they all produce the same pixels.
 */
export class RenderSession {
  readonly canvas: HTMLCanvasElement | OffscreenCanvas;
  private compositor: Compositor;
  private blobs = new Map<string, Blob>();
  private demuxers = new Map<string, Mp4Demuxer | null>();
  private clipSources = new Map<string, ClipSource>();
  private images = new Map<string, ImageBitmap>();
  private luts = new Map<string, Lut3D>();
  private lutsLoaded = false;

  constructor(
    private project: Project,
    private loader: MediaLoader,
    readonly width: number,
    readonly height: number,
    private opts: { transparent?: boolean; maskProvider?: MaskProvider } = {},
  ) {
    this.canvas =
      typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(width, height) : Object.assign(document.createElement("canvas"), { width, height });
    this.compositor = new Compositor(this.canvas, { preserveDrawingBuffer: true, transparent: opts.transparent });
    this.compositor.resize(width, height);
  }

  async blobFor(asset: Asset): Promise<Blob> {
    let b = this.blobs.get(asset.id);
    if (!b) {
      b = await this.loader.getBlob(asset);
      this.blobs.set(asset.id, b);
    }
    return b;
  }

  async demuxerFor(asset: Asset): Promise<Mp4Demuxer | null> {
    if (this.demuxers.has(asset.id)) return this.demuxers.get(asset.id) ?? null;
    let d: Mp4Demuxer | null = null;
    if (isMp4Like(asset.mimeType, asset.name)) {
      try {
        d = await Mp4Demuxer.open(await this.blobFor(asset));
      } catch {
        d = null;
      }
    }
    this.demuxers.set(asset.id, d);
    return d;
  }

  private async loadLuts(): Promise<void> {
    if (this.lutsLoaded) return;
    this.lutsLoaded = true;
    for (const seq of this.project.sequences)
      for (const tr of seq.tracks)
        for (const c of tr.clips)
          for (const fx of c.effects) {
            if (!fx.assetId || this.luts.has(fx.assetId)) continue;
            const a = getAsset(this.project, fx.assetId);
            if (a?.kind !== "lut") continue;
            try {
              this.luts.set(a.id, parseCubeLut(await (await this.blobFor(a)).text()));
            } catch {
              // A broken LUT renders as no LUT.
            }
          }
  }

  /** Decode and mix all audio to stereo PCM at `sampleRate`. */
  async mixAudio(durationUs: number, sampleRate: number, signal?: AbortSignal, onProgress?: (p: number) => void): Promise<[Float32Array, Float32Array]> {
    const segments = resolveAudio(this.project);
    const pcm = new Map<string, Pcm>();
    const whole = new Map<string, Pcm | null>();
    for (let i = 0; i < segments.length; i++) {
      checkAbort(signal);
      const seg = segments[i]!;
      const asset = getAsset(this.project, seg.assetId);
      if (!asset) continue;
      const end = seg.sourceInUs + (seg.sourceSpanUs ?? seg.durationUs * seg.speed);
      let data: Pcm | null = null;
      const d = await this.demuxerFor(asset);
      if (d?.audio && typeof AudioDecoder !== "undefined") {
        try {
          const supported = await AudioDecoder.isConfigSupported({
            codec: d.audio.codec,
            sampleRate: d.audio.sampleRate,
            numberOfChannels: d.audio.channels,
            description: d.audio.description,
          });
          if (supported.supported) data = await decodeMp4Audio(d, seg.sourceInUs, end);
        } catch {
          data = null;
        }
      }
      if (!data) {
        if (!whole.has(asset.id)) {
          try {
            whole.set(asset.id, await decodeWithWebAudio(await this.blobFor(asset)));
          } catch {
            // Files without decodable audio are skipped.
            whole.set(asset.id, null);
          }
        }
        data = whole.get(asset.id) ?? null;
      }
      if (data && seg.audioFx?.length) {
        const dsp = await loadDsp();
        data = await processClipPcm(data, seg.sourceInUs, seg.sourceSpanUs ?? seg.durationUs * seg.speed, seg.audioFx, dsp);
      }
      if (data) pcm.set(seg.clipId, data);
      onProgress?.((i + 1) / Math.max(1, segments.length));
    }
    return mixSegments(segments, pcm, durationUs, sampleRate);
  }

  private async sourceFor(src: MediaSource, asset: Asset): Promise<ClipSource> {
    let cs = this.clipSources.get(src.clipId);
    if (cs) return cs;
    const d = await this.demuxerFor(asset);
    if (d?.video && (await VideoFrameReader.isSupported(d))) cs = { kind: "decoder", reader: new VideoFrameReader(d) };
    else cs = { kind: "element", el: new ElementFrameSource(await this.blobFor(asset)) };
    this.clipSources.set(src.clipId, cs);
    return cs;
  }

  /** Render frame `index` at `fps` into `canvas`. Returns its timestamp in µs. */
  async renderFrame(index: number, fps: number): Promise<number> {
    await this.loadLuts();
    const t = frameToUs(index, fps);
    const plan = resolveFrame(this.project, t);
    const resolved = new Map<string, ResolvedImage>();
    const active = new Set<string>();
    for (const src of planMediaSources(plan)) {
      const asset = getAsset(this.project, src.assetId);
      if (!asset) continue;
      if (src.kind === "image") {
        let bmp = this.images.get(asset.id);
        if (!bmp) {
          bmp = await createImageBitmap(await this.blobFor(asset));
          this.images.set(asset.id, bmp);
        }
        resolved.set(src.clipId, { image: bmp, rotation: 0, version: asset.id });
        continue;
      }
      active.add(src.clipId);
      const cs = await this.sourceFor(src, asset);
      if (cs.kind === "decoder") {
        const frame = await cs.reader.frameAt(src.sourceTimeUs);
        if (frame) resolved.set(src.clipId, { image: frame, rotation: cs.reader.rotation, version: `${frame.timestamp}` });
      } else {
        resolved.set(src.clipId, await cs.el.frameAt(src.sourceTimeUs));
      }
    }
    // Release decoders for clips that finished.
    for (const [clipId, cs] of this.clipSources) {
      if (!active.has(clipId)) {
        if (cs.kind === "decoder") cs.reader.close();
        else cs.el.close();
        this.clipSources.delete(clipId);
      }
    }
    // AI masks for clips that remove their background.
    const masks = new Map<string, ResolvedImage>();
    if (this.opts.maskProvider) {
      const wants = new Set<string>();
      const visit = (l: VisualLayer) => {
        if ((l.source.kind === "video" || l.source.kind === "image") && l.effects.some((e) => e.type === "bg-remove")) wants.add(l.source.clipId);
      };
      for (const l of plan.layers) {
        if (l.kind === "transition") {
          visit(l.from);
          visit(l.to);
        } else visit(l);
      }
      for (const id of wants) {
        const img = resolved.get(id);
        if (!img) continue;
        const m = await this.opts.maskProvider(img.image);
        if (m) masks.set(id, m);
      }
    }
    const provider: SourceProvider = {
      getImage: (s) => resolved.get(s.clipId) ?? null,
      getLut: (id) => this.luts.get(id) ?? null,
      getMask: (id) => masks.get(id) ?? null,
    };
    this.compositor.render(plan, provider);
    return t;
  }

  /** RGBA pixels of the last rendered frame, top row first. */
  readPixels(): Uint8Array {
    return this.compositor.readPixels();
  }

  close(): void {
    for (const cs of this.clipSources.values()) {
      if (cs.kind === "decoder") cs.reader.close();
      else cs.el.close();
    }
    this.clipSources.clear();
    for (const b of this.images.values()) b.close();
    this.images.clear();
    this.compositor.dispose();
  }
}
