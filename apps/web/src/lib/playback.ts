"use client";

import {
  Compositor,
  Mp4Demuxer,
  VideoFrameReader,
  isMp4Like,
  planMediaSources,
  resolveAudio,
  resolveFrame,
  segmentGainAt,
  type AudioSegment,
  type FramePlan,
  type ResolvedImage,
  type SourceProvider,
} from "@just-see/engine";
import {
  clipEndUs,
  getAsset,
  getSequence,
  isMediaClip,
  playbackRateAt,
  sequenceDurationUs,
  sourceOffsetAt,
  type Asset,
  type MediaClip,
  type Project,
} from "@just-see/schema";
import { assetBlob, assetUrl } from "./media";
import { getLutSync, setLutLoadedListener } from "./luts";
import { onSegmenterReady, personMask, segmenterSync } from "./segment";
import { processedAudioUrl, setProcessedListener } from "./clip-audio";

interface VideoSlot {
  el: HTMLVideoElement;
  clipId: string;
  assetId: string;
  version: number;
  ready: boolean;
  lastUsed: number;
}

interface AudioSlot {
  el: HTMLAudioElement;
  clipId: string;
  lastUsed: number;
}

const LOOKAHEAD_US = 1_500_000;
/** Resync a playing element when it drifts more than this. */
const DRIFT_S = 0.12;

type VideoWithRvfc = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: () => void) => number;
};

/**
 * Real-time preview. Uses <video>/<audio> elements as sources (fast seeking,
 * hardware decode) and the shared compositor to draw, so effects, text and
 * transitions look exactly like the export.
 */
export class PreviewPlayer {
  private compositor: Compositor;
  private project: Project | null = null;
  private video = new Map<string, VideoSlot>();
  private audio = new Map<string, AudioSlot>();
  private images = new Map<string, ImageBitmap | "loading">();
  private raf = 0;
  private playing = false;
  private playStartWall = 0;
  private playStartUs = 0;
  private timeUs = 0;
  private dirty = true;
  private destroyed = false;
  private segments: AudioSegment[] = [];
  private onTime: (us: number) => void;
  private onEnded: () => void;
  private frameCounter = 0;
  lastPlan: FramePlan | null = null;
  private unsubSeg: () => void = () => undefined;

  constructor(canvas: HTMLCanvasElement, cb: { onTime: (us: number) => void; onEnded: () => void }) {
    // preserveDrawingBuffer lets capture() read the canvas after rendering.
    this.compositor = new Compositor(canvas, { preserveDrawingBuffer: true });
    this.onTime = cb.onTime;
    this.onEnded = cb.onEnded;
    this.loop = this.loop.bind(this);
    setLutLoadedListener(() => (this.dirty = true));
    this.unsubSeg = onSegmenterReady(() => (this.dirty = true));
    setProcessedListener(() => (this.dirty = true));
    this.raf = requestAnimationFrame(this.loop);
  }

  get canvas(): HTMLCanvasElement {
    return this.compositor.canvas as HTMLCanvasElement;
  }

  resize(w: number, h: number): void {
    this.compositor.resize(w, h);
    this.dirty = true;
  }

  setProject(p: Project): void {
    this.project = p;
    this.segments = resolveAudio(p);
    this.dirty = true;
  }

  /** Jump to a time (used while paused / scrubbing). */
  seek(us: number): void {
    this.timeUs = us;
    if (this.playing) {
      this.playStartUs = us;
      this.playStartWall = performance.now();
    }
    this.dirty = true;
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  play(): void {
    if (!this.project) return;
    window.clearTimeout(this.exactTimer);
    const dur = sequenceDurationUs(getSequence(this.project));
    if (this.timeUs >= dur - 10_000) this.timeUs = 0;
    this.playing = true;
    this.playStartUs = this.timeUs;
    this.playStartWall = performance.now();
    // Start elements now, inside the user gesture, so mobile browsers allow sound.
    this.sync(this.timeUs, true);
  }

  pause(): void {
    this.playing = false;
    for (const s of this.video.values()) s.el.pause();
    for (const s of this.audio.values()) s.el.pause();
    this.dirty = true;
  }

  private loop(): void {
    if (this.destroyed) return;
    this.raf = requestAnimationFrame(this.loop);
    if (!this.project) return;
    if (this.playing) {
      const dur = sequenceDurationUs(getSequence(this.project));
      let t = this.playStartUs + (performance.now() - this.playStartWall) * 1000;
      if (t >= dur) {
        t = dur;
        this.timeUs = t;
        this.pause();
        this.onTime(t);
        this.onEnded();
        return;
      }
      this.timeUs = t;
      this.onTime(t);
      this.sync(t, true);
      this.render(t);
      return;
    }
    if (this.dirty) {
      this.dirty = false;
      this.sync(this.timeUs, false);
      this.render(this.timeUs);
      if (this.exactRender) this.exactRender = false;
      else this.scheduleExact();
    }
  }

  private render(t: number): void {
    if (!this.project) return;
    const plan = resolveFrame(this.project, t);
    this.lastPlan = plan;
    const project = this.project;
    const provider: SourceProvider = {
      getImage: (src) => this.imageFor(src.kind, src.clipId, src.assetId),
      getLut: (assetId) => getLutSync(getAsset(project, assetId)),
      getMask: (clipId) => this.maskFor(clipId),
    };
    try {
      this.compositor.render(plan, provider);
    } catch (e) {
      console.error("Render failed", e);
    }
  }

  private masks = new Map<string, { key: number | string; mask: ResolvedImage }>();

  // ---------- Frame-exact frames while paused ----------
  // When paused, the frame on screen comes from the same WebCodecs decoder the
  // export uses, so a paused preview is pixel-identical to the exported frame.
  private demuxers = new Map<string, Promise<Mp4Demuxer | null>>();
  private readers = new Map<string, { reader: VideoFrameReader; busy: boolean }>();
  private exact = new Map<string, { us: number; frame: VideoFrame }>();
  private exactTimer = 0;

  private demuxerFor(asset: Asset): Promise<Mp4Demuxer | null> {
    let d = this.demuxers.get(asset.id);
    if (!d) {
      d = isMp4Like(asset.mimeType, asset.name)
        ? assetBlob(asset)
            .then((b) => Mp4Demuxer.open(b))
            .then(async (dm) => (dm.video && (await VideoFrameReader.isSupported(dm)) ? dm : null))
            .catch(() => null)
        : Promise.resolve(null);
      this.demuxers.set(asset.id, d);
    }
    return d;
  }

  private clearExact(): void {
    for (const e of this.exact.values()) e.frame.close();
    this.exact.clear();
  }

  /** Decode exact frames for what is on screen (paused only). */
  private scheduleExact(): void {
    window.clearTimeout(this.exactTimer);
    this.exactTimer = window.setTimeout(() => void this.loadExact(), 120);
  }

  async loadExact(): Promise<boolean> {
    const project = this.project;
    if (!project || this.playing) return false;
    const t = this.timeUs;
    const plan = resolveFrame(project, t);
    let changed = false;
    const visible = new Set(planMediaSources(plan).filter((x) => x.kind === "video").map((x) => x.clipId));
    for (const [id, r] of this.readers) {
      if (!visible.has(id) && !r.busy) {
        r.reader.close();
        this.readers.delete(id);
      }
    }
    for (const [id, e] of this.exact) {
      if (!visible.has(id)) {
        e.frame.close();
        this.exact.delete(id);
      }
    }
    for (const src of planMediaSources(plan)) {
      if (src.kind !== "video") continue;
      const have = this.exact.get(src.clipId);
      if (have && have.us === src.sourceTimeUs) continue;
      const asset = getAsset(project, src.assetId);
      if (!asset) continue;
      const dm = await this.demuxerFor(asset);
      if (!dm || this.playing || this.timeUs !== t) return false;
      let r = this.readers.get(src.clipId);
      if (!r) {
        r = { reader: new VideoFrameReader(dm), busy: false };
        this.readers.set(src.clipId, r);
      }
      if (r.busy) continue;
      r.busy = true;
      try {
        const frame = await r.reader.frameAt(src.sourceTimeUs);
        if (frame && !this.playing && this.timeUs === t) {
          this.exact.get(src.clipId)?.frame.close();
          // Copy: the reader may close its frame on the next call.
          this.exact.set(src.clipId, { us: src.sourceTimeUs, frame: frame.clone() });
          changed = true;
        }
      } catch {
        // Keep showing the element frame.
      } finally {
        r.busy = false;
      }
    }
    if (changed) {
      this.dirty = true;
      this.exactRender = true;
    }
    return changed;
  }

  private exactRender = false;

  private maskFor(clipId: string): ResolvedImage | null {
    const seg = segmenterSync();
    if (!seg) return null;
    const slot = this.video.get(clipId);
    let image: TexImageSource | null = null;
    let key: number | string = 0;
    if (slot && slot.el.readyState >= 2) {
      image = slot.el;
      key = this.playing ? this.frameCounter : slot.version;
    } else {
      // Photos: look the asset up through the last plan.
      const layer = this.lastPlan?.layers.find((l) => l.kind === "visual" && l.clipId === clipId);
      if (layer?.kind === "visual" && layer.source.kind === "image") {
        const b = this.images.get(layer.source.assetId);
        if (b && b !== "loading") {
          image = b;
          key = layer.source.assetId;
        }
      }
    }
    if (!image) return null;
    const hit = this.masks.get(clipId);
    if (hit && hit.key === key) return hit.mask;
    const mask = personMask(seg, image);
    if (mask) this.masks.set(clipId, { key, mask });
    return mask;
  }

  private rotationOf(assetId: string): number {
    return this.project ? (getAsset(this.project, assetId)?.rotation ?? 0) : 0;
  }

  private imageFor(kind: "video" | "image", clipId: string, assetId: string): ResolvedImage | null {
    if (kind === "image") {
      const b = this.images.get(assetId);
      return b && b !== "loading" ? { image: b, rotation: 0, version: assetId } : null;
    }
    if (!this.playing) {
      const ex = this.exact.get(clipId);
      const layer = this.lastPlan?.layers.flatMap((l) => (l.kind === "transition" ? [l.from, l.to] : [l])).find((l) => l.source.kind === "video" && l.source.clipId === clipId);
      const want = layer && layer.source.kind === "video" ? layer.source.sourceTimeUs : -1;
      if (ex && ex.us === want) return { image: ex.frame, rotation: this.rotationOf(assetId), version: `x${ex.us}` };
    }
    const slot = this.video.get(clipId);
    if (!slot || slot.el.readyState < 2) return null;
    // While playing, upload every frame; paused, only after a seek finished.
    return { image: slot.el, rotation: 0, version: this.playing && !slot.el.paused ? ++this.frameCounter : slot.version };
  }

  /** Make media elements match the timeline at time t. */
  private sync(t: number, playing: boolean): void {
    const project = this.project;
    if (!project) return;
    const now = performance.now();
    const seq = getSequence(project);
    if (seq.background.kind === "image" && seq.background.assetId) {
      const bgAsset = getAsset(project, seq.background.assetId);
      if (bgAsset && !this.images.has(bgAsset.id)) this.loadImage(bgAsset);
    }
    const wantedVideo = new Set<string>();
    const wantedAudio = new Set<string>();

    for (const track of seq.tracks) {
      for (const clip of track.clips) {
        if (!isMediaClip(clip)) continue;
        const asset = getAsset(project, clip.assetId);
        if (!asset) continue;
        const end = clipEndUs(clip);
        const active = clip.startUs <= t && t < end;
        const upcoming = !active && clip.startUs > t && clip.startUs - t < LOOKAHEAD_US;
        if (!active && !upcoming) continue;
        if (clip.kind === "image") {
          if (!this.images.has(asset.id)) this.loadImage(asset);
          continue;
        }
        const local = active ? t - clip.startUs : 0;
        const srcTime = (clip.sourceInUs + sourceOffsetAt(clip, local)) / 1e6;
        const rate = playbackRateAt(clip, local);
        const muted = track.muted || clip.muted || (clip.kind === "video" && !asset.hasAudio);
        const seg = this.segments.find((s) => s.clipId === clip.id);
        const gain = active && seg && !muted ? Math.min(1, segmentGainAt(seg, t)) : 0;
        // Clips with audio effects play pre-processed audio (same as export).
        const fxUrl = clip.audioFx?.some((e) => e.enabled) ? processedAudioUrl(clip, asset) : null;
        if (clip.kind === "video") {
          wantedVideo.add(clip.id);
          const slot = this.videoSlot(clip, asset, now);
          this.drive(slot.el, srcTime, clip, rate, active && playing, fxUrl ? 0 : gain, active || !playing, () => {
            slot.version++;
            this.dirty = true;
          });
        }
        if (clip.kind === "audio" || fxUrl) {
          const key = fxUrl ? `fx:${clip.id}` : clip.id;
          wantedAudio.add(key);
          const slot = this.audioSlot(key, fxUrl ? Promise.resolve(fxUrl) : assetUrl(asset), now);
          // Processed audio starts at the clip's in-point.
          const t0 = fxUrl ? (srcTime * 1e6 - clip.sourceInUs) / 1e6 : srcTime;
          this.drive(slot.el, t0, clip, rate, active && playing, gain, active, () => {});
        }
      }
    }
    for (const [id, slot] of this.video) {
      if (!wantedVideo.has(id)) {
        slot.el.pause();
        if (now - slot.lastUsed > 4000) this.dropVideo(id);
      }
    }
    for (const [id, slot] of this.audio) {
      if (!wantedAudio.has(id)) {
        slot.el.pause();
        if (now - slot.lastUsed > 4000) {
          slot.el.removeAttribute("src");
          slot.el.load();
          this.audio.delete(id);
        }
      }
    }
  }

  private drive(
    el: HTMLMediaElement,
    srcTime: number,
    clip: MediaClip,
    rate: number,
    shouldPlay: boolean,
    gain: number,
    shouldSeek: boolean,
    onSeeked: () => void,
  ): void {
    // Elements cannot play backwards or hold a frame: drive those by seeking.
    if (shouldPlay && (clip.reverse || clip.holdFrame)) {
      if (!el.paused) el.pause();
      el.muted = true;
      if (Math.abs(el.currentTime - srcTime) > 1 / 60 && !el.seeking) {
        el.onseeked = onSeeked;
        el.currentTime = srcTime;
      }
      return;
    }
    const r = Math.min(16, Math.max(0.0625, rate || 1));
    if (Math.abs(el.playbackRate - r) > 0.01) el.playbackRate = r;
    (el as HTMLMediaElement & { preservesPitch?: boolean }).preservesPitch = false;
    el.volume = Math.max(0, Math.min(1, gain));
    el.muted = gain <= 0;
    if (shouldPlay) {
      if (Math.abs(el.currentTime - srcTime) > DRIFT_S * Math.max(1, r)) el.currentTime = srcTime;
      if (el.paused) {
        el.play().catch(() => {
          // Autoplay with sound blocked: play muted instead.
          el.muted = true;
          void el.play().catch(() => {});
        });
      }
      return;
    }
    if (!el.paused) el.pause();
    if (shouldSeek && Math.abs(el.currentTime - srcTime) > 0.5 / 60) {
      el.onseeked = onSeeked;
      el.currentTime = srcTime;
    }
  }

  private videoSlot(clip: MediaClip, asset: Asset, now: number): VideoSlot {
    let slot = this.video.get(clip.id);
    if (!slot) {
      const el = document.createElement("video") as VideoWithRvfc;
      el.muted = true;
      el.playsInline = true;
      el.preload = "auto";
      el.crossOrigin = "anonymous";
      el.setAttribute("playsinline", "");
      const s: VideoSlot = { el, clipId: clip.id, assetId: asset.id, version: 0, ready: false, lastUsed: now };
      el.onloadeddata = () => {
        s.ready = true;
        s.version++;
        this.dirty = true;
      };
      void assetUrl(asset).then((url) => {
        if (!this.destroyed) el.src = url;
      });
      this.video.set(clip.id, s);
      slot = s;
    }
    slot.lastUsed = now;
    return slot;
  }

  private audioSlot(key: string, url: Promise<string>, now: number): AudioSlot {
    let slot = this.audio.get(key);
    if (!slot) {
      const el = document.createElement("audio");
      el.preload = "auto";
      void url.then((u) => {
        if (!this.destroyed) el.src = u;
      });
      slot = { el, clipId: key, lastUsed: now };
      this.audio.set(key, slot);
    }
    slot.lastUsed = now;
    return slot;
  }

  private dropVideo(id: string): void {
    const slot = this.video.get(id);
    if (!slot) return;
    slot.el.pause();
    slot.el.removeAttribute("src");
    slot.el.load();
    this.video.delete(id);
  }

  private loadImage(asset: Asset): void {
    this.images.set(asset.id, "loading");
    void assetBlob(asset)
      .then((b) => createImageBitmap(b))
      .then((bmp) => {
        if (this.destroyed) {
          bmp.close();
          return;
        }
        this.images.set(asset.id, bmp);
        this.dirty = true;
      })
      .catch(() => this.images.delete(asset.id));
  }

  /**
   * Render the preview at an exact time and size and return a PNG. Used to
   * prove preview and export match pixel for pixel.
   */
  async capture(us: number, width: number, height: number): Promise<Blob> {
    const canvas = this.canvas;
    const prevW = canvas.width;
    const prevH = canvas.height;
    this.pause();
    this.compositor.resize(width, height);
    this.seek(us);
    // Seek every element and wait until all visible frames are ready.
    const deadline = performance.now() + 15000;
    for (;;) {
      this.sync(us, false);
      const plan = this.project ? resolveFrame(this.project, us) : null;
      const pending = plan
        ? planMediaSources(plan).some((src) => {
            if (src.kind === "image") {
              const b = this.images.get(src.assetId);
              return !b || b === "loading";
            }
            const slot = this.video.get(src.clipId);
            return !slot || slot.el.readyState < 2 || slot.el.seeking || Math.abs(slot.el.currentTime - src.sourceTimeUs / 1e6) > 0.02;
          })
        : false;
      if (!pending || performance.now() > deadline) break;
      await new Promise((r) => setTimeout(r, 30));
    }
    this.render(us);
    // Wait until every visible video shows its exact decoded frame.
    for (let tries = 0; tries < 100; tries++) {
      await this.loadExact();
      const plan = this.project ? resolveFrame(this.project, us) : null;
      const missing = plan
        ? planMediaSources(plan).some((src) => src.kind === "video" && this.exact.get(src.clipId)?.us !== src.sourceTimeUs)
        : false;
      if (!missing) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    this.render(us);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("capture failed"))), "image/png"),
    );
    this.compositor.resize(prevW, prevH);
    this.dirty = true;
    return blob;
  }

  /** Media sources visible right now (for tests / debugging). */
  visibleSources(): number {
    return this.lastPlan ? planMediaSources(this.lastPlan).length : 0;
  }

  destroy(): void {
    this.destroyed = true;
    window.clearTimeout(this.exactTimer);
    this.clearExact();
    for (const r of this.readers.values()) r.reader.close();
    this.readers.clear();
    this.unsubSeg();
    cancelAnimationFrame(this.raf);
    for (const id of [...this.video.keys()]) this.dropVideo(id);
    for (const s of this.audio.values()) {
      s.el.pause();
      s.el.removeAttribute("src");
    }
    for (const b of this.images.values()) if (b !== "loading") b.close();
    this.compositor.dispose();
  }
}
