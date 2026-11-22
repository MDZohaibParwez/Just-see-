"use client";

import {
  Compositor,
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
  sequenceDurationUs,
  type Asset,
  type MediaClip,
  type Project,
} from "@just-see/schema";
import { assetBlob, assetUrl } from "./media";

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

  constructor(canvas: HTMLCanvasElement, cb: { onTime: (us: number) => void; onEnded: () => void }) {
    this.compositor = new Compositor(canvas);
    this.onTime = cb.onTime;
    this.onEnded = cb.onEnded;
    this.loop = this.loop.bind(this);
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
    }
  }

  private render(t: number): void {
    if (!this.project) return;
    const plan = resolveFrame(this.project, t);
    this.lastPlan = plan;
    const provider: SourceProvider = { getImage: (src) => this.imageFor(src.kind, src.clipId, src.assetId) };
    try {
      this.compositor.render(plan, provider);
    } catch (e) {
      console.error("Render failed", e);
    }
  }

  private imageFor(kind: "video" | "image", clipId: string, assetId: string): ResolvedImage | null {
    if (kind === "image") {
      const b = this.images.get(assetId);
      return b && b !== "loading" ? { image: b, rotation: 0, version: assetId } : null;
    }
    const slot = this.video.get(clipId);
    if (!slot || slot.el.readyState < 2) return null;
    // While playing, upload every frame; paused, only after a seek finished.
    return { image: slot.el, rotation: 0, version: this.playing ? ++this.frameCounter : slot.version };
  }

  /** Make media elements match the timeline at time t. */
  private sync(t: number, playing: boolean): void {
    const project = this.project;
    if (!project) return;
    const now = performance.now();
    const seq = getSequence(project);
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
        const srcTime = (clip.sourceInUs + local * clip.speed) / 1e6;
        const muted = track.muted || clip.muted || (clip.kind === "video" && !asset.hasAudio);
        const seg = this.segments.find((s) => s.clipId === clip.id);
        const gain = active && seg && !muted ? Math.min(1, segmentGainAt(seg, t)) : 0;
        if (clip.kind === "video") {
          wantedVideo.add(clip.id);
          const slot = this.videoSlot(clip, asset, now);
          this.drive(slot.el, srcTime, clip, active && playing, gain, active || !playing, () => {
            slot.version++;
            this.dirty = true;
          });
        } else {
          wantedAudio.add(clip.id);
          const slot = this.audioSlot(clip, asset, now);
          this.drive(slot.el, srcTime, clip, active && playing, gain, active, () => {});
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
    shouldPlay: boolean,
    gain: number,
    shouldSeek: boolean,
    onSeeked: () => void,
  ): void {
    if (el.playbackRate !== clip.speed) el.playbackRate = clip.speed;
    (el as HTMLMediaElement & { preservesPitch?: boolean }).preservesPitch = false;
    el.volume = Math.max(0, Math.min(1, gain));
    el.muted = gain <= 0;
    if (shouldPlay) {
      if (Math.abs(el.currentTime - srcTime) > DRIFT_S * clip.speed) el.currentTime = srcTime;
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

  private audioSlot(clip: MediaClip, asset: Asset, now: number): AudioSlot {
    let slot = this.audio.get(clip.id);
    if (!slot) {
      const el = document.createElement("audio");
      el.preload = "auto";
      void assetUrl(asset).then((url) => {
        if (!this.destroyed) el.src = url;
      });
      slot = { el, clipId: clip.id, lastUsed: now };
      this.audio.set(clip.id, slot);
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

  /** Media sources visible right now (for tests / debugging). */
  visibleSources(): number {
    return this.lastPlan ? planMediaSources(this.lastPlan).length : 0;
  }

  destroy(): void {
    this.destroyed = true;
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
