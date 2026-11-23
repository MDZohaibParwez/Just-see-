import { ArrayBufferTarget, Muxer } from "mp4-muxer";
import {
  frameToUs,
  getAsset,
  getSequence,
  sequenceDurationUs,
  type Asset,
  type Project,
} from "@just-see/schema";
import { Compositor, type ResolvedImage, type SourceProvider } from "../gl/compositor";
import { planMediaSources, resolveAudio, resolveFrame, type MediaSource } from "../resolve";
import { decodeMp4Audio, decodeWithWebAudio, mixSegments, type Pcm } from "../media/audio";
import { Mp4Demuxer, isMp4Like } from "../media/demux";
import { VideoFrameReader } from "../media/frame-reader";
import { parseCubeLut, type Lut3D } from "../media/lut";
import { defaultVideoBitrate, pickAudioCodec, pickVideoCodec } from "./codecs";

export interface MediaLoader {
  /** Original file for an asset (export never uses proxies). */
  getBlob(asset: Asset): Promise<Blob>;
}

export interface ExportOptions {
  width: number;
  height: number;
  fps: number;
  videoBitrate?: number;
  audioBitrate?: number;
  signal?: AbortSignal;
  onProgress?: (p: { phase: "prepare" | "audio" | "video" | "finalize"; progress: number }) => void;
}

export interface ExportResult {
  blob: Blob;
  mimeType: string;
  videoCodec: string;
  audioCodec: string | null;
  frames: number;
  durationUs: number;
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

function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("Export cancelled", "AbortError");
}

/**
 * Render a sequence to an MP4 file entirely in the browser with WebCodecs.
 * Runs on the main thread in Phase 1; moves to a worker later.
 */
export async function exportMp4(project: Project, loader: MediaLoader, opts: ExportOptions): Promise<ExportResult> {
  const seq = getSequence(project);
  const durationUs = sequenceDurationUs(seq);
  if (durationUs <= 0) throw new Error("The timeline is empty");
  const fps = opts.fps;
  const width = opts.width - (opts.width % 2);
  const height = opts.height - (opts.height % 2);
  const totalFrames = Math.max(1, Math.round((durationUs * fps) / 1e6));
  const progress = opts.onProgress ?? (() => {});
  progress({ phase: "prepare", progress: 0 });

  const video = await pickVideoCodec(width, height, fps, opts.videoBitrate ?? defaultVideoBitrate(width, height, fps));
  const sampleRate = 48000;
  const audio = await pickAudioCodec(sampleRate, 2, opts.audioBitrate ?? 160_000);

  const blobs = new Map<string, Blob>();
  const demuxers = new Map<string, Mp4Demuxer | null>();
  const blobFor = async (asset: Asset) => {
    let b = blobs.get(asset.id);
    if (!b) {
      b = await loader.getBlob(asset);
      blobs.set(asset.id, b);
    }
    return b;
  };
  const demuxerFor = async (asset: Asset): Promise<Mp4Demuxer | null> => {
    if (demuxers.has(asset.id)) return demuxers.get(asset.id) ?? null;
    let d: Mp4Demuxer | null = null;
    if (isMp4Like(asset.mimeType, asset.name)) {
      try {
        d = await Mp4Demuxer.open(await blobFor(asset));
      } catch {
        d = null;
      }
    }
    demuxers.set(asset.id, d);
    return d;
  };

  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    video: { codec: video.mux, width, height, frameRate: fps },
    audio: audio ? { codec: audio.mux, sampleRate, numberOfChannels: 2 } : undefined,
    fastStart: "in-memory",
    firstTimestampBehavior: "offset",
  });

  // ---------- Audio ----------
  if (audio) {
    progress({ phase: "audio", progress: 0 });
    const segments = resolveAudio(project);
    const pcm = new Map<string, Pcm>();
    const whole = new Map<string, Pcm>();
    for (let i = 0; i < segments.length; i++) {
      checkAbort(opts.signal);
      const seg = segments[i]!;
      const asset = getAsset(project, seg.assetId);
      if (!asset) continue;
      const end = seg.sourceInUs + (seg.sourceSpanUs ?? seg.durationUs * seg.speed);
      let data: Pcm | null = null;
      const d = await demuxerFor(asset);
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
        let w = whole.get(asset.id);
        if (!w) {
          w = await decodeWithWebAudio(await blobFor(asset));
          whole.set(asset.id, w);
        }
        data = w;
      }
      pcm.set(seg.clipId, data);
      progress({ phase: "audio", progress: (i + 1) / Math.max(1, segments.length) / 2 });
    }
    const [left, right] = mixSegments(segments, pcm, durationUs, sampleRate);
    let audioErr: Error | null = null;
    const encoder = new AudioEncoder({
      output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
      error: (e) => {
        audioErr = e instanceof Error ? e : new Error(String(e));
      },
    });
    encoder.configure(audio.config);
    const block = 4800; // 100 ms
    for (let s = 0; s < left.length; s += block) {
      checkAbort(opts.signal);
      const n = Math.min(block, left.length - s);
      const planar = new Float32Array(n * 2);
      planar.set(left.subarray(s, s + n), 0);
      planar.set(right.subarray(s, s + n), n);
      const data = new AudioData({
        format: "f32-planar",
        sampleRate,
        numberOfFrames: n,
        numberOfChannels: 2,
        timestamp: Math.round((s / sampleRate) * 1e6),
        data: planar,
      });
      encoder.encode(data);
      data.close();
      if (audioErr) throw audioErr;
    }
    await encoder.flush();
    encoder.close();
    if (audioErr) throw audioErr;
    progress({ phase: "audio", progress: 1 });
  }

  // ---------- Video ----------
  const canvas: HTMLCanvasElement | OffscreenCanvas =
    typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(width, height) : Object.assign(document.createElement("canvas"), { width, height });
  const compositor = new Compositor(canvas, { preserveDrawingBuffer: true });
  compositor.resize(width, height);

  // LUT files used by effects, parsed once.
  const luts = new Map<string, Lut3D>();
  for (const seqItem of project.sequences)
    for (const tr of seqItem.tracks)
      for (const c of tr.clips)
        for (const fx of c.effects) {
          if (!fx.assetId || luts.has(fx.assetId)) continue;
          const a = getAsset(project, fx.assetId);
          if (a?.kind !== "lut") continue;
          try {
            luts.set(a.id, parseCubeLut(await (await blobFor(a)).text()));
          } catch {
            // A broken LUT renders as no LUT.
          }
        }
  const clipSources = new Map<string, ClipSource>();
  const images = new Map<string, ImageBitmap>();
  let videoErr: Error | null = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => {
      videoErr = e instanceof Error ? e : new Error(String(e));
    },
  });
  encoder.configure(video.config);

  const sourceFor = async (src: MediaSource, asset: Asset): Promise<ClipSource> => {
    let cs = clipSources.get(src.clipId);
    if (cs) return cs;
    const d = await demuxerFor(asset);
    if (d?.video && (await VideoFrameReader.isSupported(d))) cs = { kind: "decoder", reader: new VideoFrameReader(d) };
    else cs = { kind: "element", el: new ElementFrameSource(await blobFor(asset)) };
    clipSources.set(src.clipId, cs);
    return cs;
  };

  try {
    for (let i = 0; i < totalFrames; i++) {
      checkAbort(opts.signal);
      if (videoErr) throw videoErr;
      const t = frameToUs(i, fps);
      const plan = resolveFrame(project, t);
      const resolved = new Map<string, ResolvedImage>();
      const active = new Set<string>();
      for (const src of planMediaSources(plan)) {
        const asset = getAsset(project, src.assetId);
        if (!asset) continue;
        if (src.kind === "image") {
          let bmp = images.get(asset.id);
          if (!bmp) {
            bmp = await createImageBitmap(await blobFor(asset));
            images.set(asset.id, bmp);
          }
          resolved.set(src.clipId, { image: bmp, rotation: 0, version: asset.id });
          continue;
        }
        active.add(src.clipId);
        const cs = await sourceFor(src, asset);
        if (cs.kind === "decoder") {
          const frame = await cs.reader.frameAt(src.sourceTimeUs);
          if (frame) resolved.set(src.clipId, { image: frame, rotation: cs.reader.rotation, version: `${frame.timestamp}` });
        } else {
          resolved.set(src.clipId, await cs.el.frameAt(src.sourceTimeUs));
        }
      }
      // Release decoders for clips that finished.
      for (const [clipId, cs] of clipSources) {
        if (!active.has(clipId)) {
          if (cs.kind === "decoder") cs.reader.close();
          else cs.el.close();
          clipSources.delete(clipId);
        }
      }
      const provider: SourceProvider = { getImage: (s) => resolved.get(s.clipId) ?? null, getLut: (id) => luts.get(id) ?? null };
      compositor.render(plan, provider);
      const frame = new VideoFrame(canvas, { timestamp: t, duration: Math.round(1e6 / fps) });
      encoder.encode(frame, { keyFrame: i % Math.max(1, Math.round(fps * 2)) === 0 });
      frame.close();
      while (encoder.encodeQueueSize > 4) {
        await new Promise<void>((r) => encoder.addEventListener("dequeue", () => r(), { once: true }));
      }
      if (i % 5 === 0) progress({ phase: "video", progress: i / totalFrames });
    }
    await encoder.flush();
    if (videoErr) throw videoErr;
  } finally {
    if (encoder.state !== "closed") encoder.close();
    for (const cs of clipSources.values()) {
      if (cs.kind === "decoder") cs.reader.close();
      else cs.el.close();
    }
    for (const b of images.values()) b.close();
    compositor.dispose();
  }

  progress({ phase: "finalize", progress: 0 });
  muxer.finalize();
  const blob = new Blob([target.buffer], { type: "video/mp4" });
  progress({ phase: "finalize", progress: 1 });
  return {
    blob,
    mimeType: "video/mp4",
    videoCodec: video.label,
    audioCodec: audio?.label ?? null,
    frames: totalFrames,
    durationUs,
  };
}

/** Export sizes offered in the UI for a sequence. */
export function exportSizes(seqW: number, seqH: number): { label: string; width: number; height: number }[] {
  const short = Math.min(seqW, seqH);
  const sizes = [
    { label: "720p", short: 720 },
    { label: "1080p", short: 1080 },
    { label: "2K", short: 1440 },
    { label: "4K", short: 2160 },
  ];
  return sizes.map((s) => {
    const k = s.short / short;
    const even = (v: number) => Math.round(v / 2) * 2;
    return { label: s.label, width: even(seqW * k), height: even(seqH * k) };
  });
}

export { getSequence };
