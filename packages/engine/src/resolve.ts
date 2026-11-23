import {
  NO_CROP,
  applyEasing,
  clipEndUs,
  getAsset,
  sampleKeyframes,
  getSequence,
  isMediaClip,
  sequenceDurationUs,
  sourceOffsetAt,
  sourceSpanUs,
  sourceTimeAt,
  type BlendMode,
  type Crop,
  type EffectInstance,
  type Keyframe,
  type Keyframes,
  type MediaClip,
  type Project,
  type Sequence,
  type TextAnimation,
  type TextClip,
  type Transform,
} from "@just-see/schema";

/**
 * Pure description of what to draw at one instant. The compositor turns this
 * into pixels; keeping it pure lets us unit-test the timeline logic.
 */

export interface MediaSource {
  kind: "video" | "image";
  clipId: string;
  assetId: string;
  /** Source time to show (video only). */
  sourceTimeUs: number;
  /** Display size after container rotation. */
  width: number;
  height: number;
  rotation: number;
}

export interface TextAnimState {
  opacity: number;
  /** Offsets as fractions of canvas width / height. */
  dx: number;
  dy: number;
  scale: number;
  /** 0..1 share of characters shown (typewriter). */
  visible: number;
  /** Blur radius as a fraction of canvas height. */
  blur: number;
}

export interface TextSource {
  kind: "text";
  clipId: string;
  clip: TextClip;
  anim: TextAnimState;
  /** Clip-local time, for karaoke word highlighting. */
  localUs: number;
}

export interface VisualLayer {
  kind: "visual";
  clipId: string;
  trackId: string;
  source: MediaSource | TextSource;
  transform: Transform;
  crop: Crop;
  blendMode: BlendMode;
  /** Final opacity including fades and animations. */
  opacity: number;
  effects: EffectInstance[];
  /** Seconds since the clip started; drives time-based effects. */
  localTime: number;
}

export interface TransitionLayer {
  kind: "transition";
  type: string;
  /** 0 → only `from` visible, 1 → only `to`. */
  progress: number;
  from: VisualLayer;
  to: VisualLayer;
}

export type PlanLayer = VisualLayer | TransitionLayer;

export interface FramePlan {
  timeUs: number;
  width: number;
  height: number;
  background: string;
  layers: PlanLayer[];
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

/** Apply one animation at progress p (0 = hidden, 1 = settled). */
function applyAnim(state: TextAnimState, anim: TextAnimation, p: number): void {
  if (anim === "none" || p >= 1) return;
  const e = easeOutCubic(p);
  switch (anim) {
    case "fade":
      state.opacity *= e;
      break;
    case "pop":
      state.scale *= 0.4 + 0.6 * easeOutBack(p);
      state.opacity *= clamp01(p * 3);
      break;
    case "slide-up":
      state.dy += (1 - e) * 0.08;
      state.opacity *= e;
      break;
    case "slide-down":
      state.dy -= (1 - e) * 0.08;
      state.opacity *= e;
      break;
    case "slide-left":
      state.dx += (1 - e) * 0.15;
      state.opacity *= e;
      break;
    case "slide-right":
      state.dx -= (1 - e) * 0.15;
      state.opacity *= e;
      break;
    case "zoom":
      state.scale *= 1.6 - 0.6 * e;
      state.opacity *= e;
      break;
    case "typewriter":
      state.visible = Math.min(state.visible, p);
      break;
    case "blur":
      state.blur = Math.max(state.blur, (1 - e) * 0.02);
      state.opacity *= e;
      break;
  }
}

export function textAnimState(clip: TextClip, localUs: number): TextAnimState {
  const state: TextAnimState = { opacity: 1, dx: 0, dy: 0, scale: 1, visible: 1, blur: 0 };
  const d = Math.min(clip.animationDurationUs, clip.durationUs / 2);
  if (d <= 0) return state;
  applyAnim(state, clip.animationIn, clamp01(localUs / d));
  applyAnim(state, clip.animationOut, clamp01((clip.durationUs - localUs) / d));
  return state;
}

const TRANSFORM_KEYS = ["x", "y", "scale", "rotation", "opacity"] as const;

/** Transform with keyframes applied at clip-local time. */
export function animatedTransform(base: Transform, kf: Keyframes, local: number): Transform {
  const out = { ...base };
  for (const k of TRANSFORM_KEYS) if (kf[k]) out[k] = sampleKeyframes(kf[k], local, base[k]);
  out.scale = Math.max(0.01, out.scale);
  out.opacity = Math.min(1, Math.max(0, out.opacity));
  return out;
}

export function animatedCrop(base: Crop, kf: Keyframes, local: number): Crop {
  const c = { ...base };
  for (const k of ["left", "top", "right", "bottom"] as const) {
    const key = `crop.${k}`;
    if (kf[key]) c[k] = Math.min(0.95, Math.max(0, sampleKeyframes(kf[key], local, base[k])));
  }
  return c;
}

/** Enabled effects with keyframed params applied. */
export function animatedEffects(effects: readonly EffectInstance[], kf: Keyframes, local: number): EffectInstance[] {
  return effects
    .filter((e) => e.enabled)
    .map((e) => {
      const prefix = `fx.${e.id}.`;
      const keys = Object.keys(kf).filter((k) => k.startsWith(prefix));
      if (!keys.length) return e;
      const params = { ...e.params };
      for (const k of keys) params[k.slice(prefix.length)] = sampleKeyframes(kf[k], local, params[k.slice(prefix.length)] ?? 0);
      return { ...e, params };
    });
}

function fadeFactor(clip: MediaClip, localUs: number): number {
  let f = 1;
  if (clip.fadeInUs > 0) f *= clamp01(localUs / clip.fadeInUs);
  if (clip.fadeOutUs > 0) f *= clamp01((clip.durationUs - localUs) / clip.fadeOutUs);
  return f;
}

function mediaLayer(project: Project, clip: MediaClip, trackId: string, t: number): VisualLayer | undefined {
  if (clip.kind === "audio") return undefined;
  const asset = getAsset(project, clip.assetId);
  if (!asset) return undefined;
  const local = t - clip.startUs;
  const sourceTimeUs =
    clip.kind === "video" ? Math.min(Math.max(0, sourceTimeAt(clip, t)), Math.max(0, asset.durationUs - 1)) : 0;
  const transform = animatedTransform(clip.transform, clip.keyframes, local);
  return {
    kind: "visual",
    clipId: clip.id,
    trackId,
    source: {
      kind: clip.kind,
      clipId: clip.id,
      assetId: asset.id,
      sourceTimeUs,
      width: asset.width,
      height: asset.height,
      rotation: asset.rotation,
    },
    transform,
    crop: animatedCrop(clip.crop ?? NO_CROP, clip.keyframes, local),
    blendMode: clip.blendMode ?? "normal",
    opacity: transform.opacity * fadeFactor(clip, local),
    effects: animatedEffects(clip.effects, clip.keyframes, local),
    localTime: local / 1e6,
  };
}

function textLayer(clip: TextClip, trackId: string, t: number): VisualLayer {
  const local = t - clip.startUs;
  const anim = textAnimState(clip, local);
  const transform = animatedTransform(clip.transform, clip.keyframes, local);
  const animated = transform === clip.transform ? clip : { ...clip, transform };
  return {
    kind: "visual",
    clipId: clip.id,
    trackId,
    source: { kind: "text", clipId: clip.id, clip: animated, anim, localUs: local },
    transform,
    crop: NO_CROP,
    blendMode: clip.blendMode ?? "normal",
    opacity: transform.opacity * anim.opacity,
    effects: animatedEffects(clip.effects, clip.keyframes, local),
    localTime: local / 1e6,
  };
}

/** A full-bleed (cover) background layer, optionally blurred. */
function backgroundLayer(source: MediaSource, seq: Sequence, blur: number, shareClipId?: string): VisualLayer {
  const fit = Math.min(seq.width / Math.max(1, source.width), seq.height / Math.max(1, source.height));
  const cover = Math.max(seq.width / Math.max(1, source.width), seq.height / Math.max(1, source.height));
  return {
    kind: "visual",
    clipId: source.clipId,
    trackId: "background",
    // Reuse the clip's decoder/element for the blurred copy.
    source: shareClipId ? { ...source, clipId: shareClipId } : source,
    transform: { x: 0, y: 0, scale: (cover / fit) * (blur > 0 ? 1.08 : 1), rotation: 0, opacity: 1, flipH: false, flipV: false },
    crop: NO_CROP,
    blendMode: "normal",
    opacity: 1,
    effects:
      blur > 0
        ? [
            { id: "bg-blur", type: "blur", enabled: true, params: { radius: Math.min(1, 0.4 + blur * 0.6) } },
            { id: "bg-blur2", type: "blur", enabled: true, params: { radius: Math.min(1, 0.4 + blur * 0.6) } },
            { id: "bg-dim", type: "brightness", enabled: true, params: { amount: -0.15 } },
          ]
        : [],
    localTime: 0,
  };
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/** What should be on screen at time `t` (µs). */
export function resolveFrame(project: Project, t: number, sequenceId?: string): FramePlan {
  const seq: Sequence = getSequence(project, sequenceId);
  const layers: PlanLayer[] = [];
  const bg = seq.background;
  if (bg.kind === "image" && bg.assetId) {
    const a = getAsset(project, bg.assetId);
    if (a && a.kind === "image") {
      layers.push(backgroundLayer({ kind: "image", clipId: `bg:${a.id}`, assetId: a.id, sourceTimeUs: 0, width: a.width, height: a.height, rotation: 0 }, seq, 0));
    }
  } else if (bg.kind === "blur") {
    // Blurred, zoomed copy of whatever is on the main track right now.
    const main = seq.tracks.find((tr) => tr.type === "main");
    const active = main?.clips.filter((c) => c.startUs <= t && t < clipEndUs(c)) ?? [];
    const top = active[active.length - 1];
    if (top && isMediaClip(top)) {
      const l = mediaLayer(project, top, main!.id, t);
      if (l && l.source.kind !== "text") {
        layers.push(backgroundLayer({ ...l.source, clipId: `bg:${top.id}` }, seq, bg.blur, l.source.clipId));
      }
    }
  }
  for (const track of seq.tracks) {
    if (track.hidden || track.type === "audio") continue;
    if (track.type === "main") {
      // At most two clips overlap on the main track (during a transition).
      const active = track.clips.filter((c) => c.startUs <= t && t < clipEndUs(c));
      const incoming = active.length === 2 ? active[1] : undefined;
      const outgoing = active.length === 2 ? active[0] : undefined;
      if (incoming && outgoing && isMediaClip(incoming) && isMediaClip(outgoing) && incoming.transitionIn) {
        const from = mediaLayer(project, outgoing, track.id, t);
        const to = mediaLayer(project, incoming, track.id, t);
        if (from && to) {
          const raw = (t - incoming.startUs) / incoming.transitionIn.durationUs;
          const ease = incoming.transitionIn.ease ?? "ease-in-out";
          const progress = ease === "ease-in-out" ? smooth(clamp01(raw)) : applyEasing(ease, clamp01(raw));
          layers.push({ kind: "transition", type: incoming.transitionIn.type, progress, from, to });
          continue;
        }
      }
      const clip = active[active.length - 1];
      if (clip && isMediaClip(clip)) {
        const l = mediaLayer(project, clip, track.id, t);
        if (l) layers.push(l);
      }
      continue;
    }
    for (const clip of track.clips) {
      if (clip.startUs > t || t >= clipEndUs(clip)) continue;
      if (clip.kind === "text") layers.push(textLayer(clip, track.id, t));
      else {
        const l = mediaLayer(project, clip, track.id, t);
        if (l) layers.push(l);
      }
    }
  }
  return { timeUs: t, width: seq.width, height: seq.height, background: seq.background.color, layers };
}

export interface AudioSegment {
  clipId: string;
  assetId: string;
  timelineStartUs: number;
  durationUs: number;
  sourceInUs: number;
  speed: number;
  gain: number;
  fadeInUs: number;
  fadeOutUs: number;
  /** Clip-local volume keyframes; they replace `gain` when present. */
  volumeKeyframes?: Keyframe[];
  reverse?: boolean;
  /** Total source span the segment consumes. */
  sourceSpanUs?: number;
  /** Source offset (from sourceInUs) at a clip-local time; handles curves/reverse. */
  sourceOffsetAt?: (localUs: number) => number;
}

/** Every piece of sound in the sequence, ready to schedule or mix. */
export function resolveAudio(project: Project, sequenceId?: string): AudioSegment[] {
  const seq = getSequence(project, sequenceId);
  const out: AudioSegment[] = [];
  for (const track of seq.tracks) {
    if (track.muted) continue;
    track.clips.forEach((clip, i) => {
      if (!isMediaClip(clip) || clip.kind === "image" || clip.muted || clip.holdFrame) return;
      if (clip.volume <= 0 && !clip.keyframes.volume) return;
      const asset = getAsset(project, clip.assetId);
      if (!asset || (clip.kind === "video" && !asset.hasAudio)) return;
      let fadeIn = clip.fadeInUs;
      let fadeOut = clip.fadeOutUs;
      if (track.type === "main") {
        if (clip.transitionIn) fadeIn = Math.max(fadeIn, clip.transitionIn.durationUs);
        const next = track.clips[i + 1];
        if (next && isMediaClip(next) && next.transitionIn) fadeOut = Math.max(fadeOut, next.transitionIn.durationUs);
      }
      out.push({
        clipId: clip.id,
        assetId: asset.id,
        timelineStartUs: clip.startUs,
        durationUs: clip.durationUs,
        sourceInUs: clip.sourceInUs,
        speed: clip.speed,
        gain: clip.volume,
        fadeInUs: fadeIn,
        fadeOutUs: fadeOut,
        volumeKeyframes: clip.keyframes.volume,
        reverse: clip.reverse,
        sourceSpanUs: sourceSpanUs(clip),
        sourceOffsetAt: clip.speedCurve || clip.reverse ? (u: number) => sourceOffsetAt(clip, u) : undefined,
      });
    });
  }
  return out;
}

/** Gain of a segment at timeline time t, including fades. */
export function segmentGainAt(seg: AudioSegment, t: number): number {
  const local = t - seg.timelineStartUs;
  if (local < 0 || local > seg.durationUs) return 0;
  let g = seg.volumeKeyframes ? sampleKeyframes(seg.volumeKeyframes, local, seg.gain) : seg.gain;
  if (seg.fadeInUs > 0) g *= clamp01(local / seg.fadeInUs);
  if (seg.fadeOutUs > 0) g *= clamp01((seg.durationUs - local) / seg.fadeOutUs);
  return g;
}

export { sequenceDurationUs };

/** Asset ids needed to draw a plan (for prefetching). */
export function planMediaSources(plan: FramePlan): MediaSource[] {
  const out: MediaSource[] = [];
  const visit = (l: VisualLayer) => {
    if (l.source.kind !== "text") out.push(l.source);
  };
  for (const l of plan.layers) {
    if (l.kind === "transition") {
      visit(l.from);
      visit(l.to);
    } else visit(l);
  }
  return out;
}
