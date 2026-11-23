import type { Easing, Keyframe, Keyframes, SpeedCurve } from "./model";

/** Evaluate a CSS-style cubic bezier (0,0)-(x1,y1)-(x2,y2)-(1,1) at x. */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sx = (t: number) => ((ax * t + bx) * t + cx) * t;
  const dsx = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  // Newton, then bisection fallback.
  let t = x;
  for (let i = 0; i < 8; i++) {
    const err = sx(t) - x;
    if (Math.abs(err) < 1e-6) break;
    const d = dsx(t);
    if (Math.abs(d) < 1e-6) break;
    t -= err / d;
  }
  if (t < 0 || t > 1 || Math.abs(sx(t) - x) > 1e-4) {
    let lo = 0;
    let hi = 1;
    t = x;
    for (let i = 0; i < 40; i++) {
      const v = sx(t);
      if (Math.abs(v - x) < 1e-6) break;
      if (v < x) lo = t;
      else hi = t;
      t = (lo + hi) / 2;
    }
  }
  return ((ay * t + by) * t + cy) * t;
}

export function applyEasing(ease: Easing, f: number, bezier?: [number, number, number, number]): number {
  switch (ease) {
    case "linear":
      return f;
    case "hold":
      return 0;
    case "ease-in":
      return cubicBezier(0.42, 0, 1, 1, f);
    case "ease-out":
      return cubicBezier(0, 0, 0.58, 1, f);
    case "ease-in-out":
      return cubicBezier(0.42, 0, 0.58, 1, f);
    case "bezier": {
      const [a, b, c, d] = bezier ?? [0.25, 0.1, 0.25, 1];
      return cubicBezier(a, b, c, d, f);
    }
  }
}

/** Value of a keyframed property at clip-local time t. */
export function sampleKeyframes(kfs: readonly Keyframe[] | undefined, t: number, fallback: number): number {
  if (!kfs || kfs.length === 0) return fallback;
  const first = kfs[0]!;
  if (t <= first.t) return first.v;
  for (let i = 1; i < kfs.length; i++) {
    const b = kfs[i]!;
    if (t <= b.t) {
      const a = kfs[i - 1]!;
      const span = b.t - a.t;
      const f = span <= 0 ? 1 : (t - a.t) / span;
      return a.v + (b.v - a.v) * applyEasing(a.ease, f, a.bezier);
    }
  }
  return kfs[kfs.length - 1]!.v;
}

/** Insert or replace a keyframe (within `toleranceUs` of t). Returns a new sorted array. */
export function upsertKeyframe(kfs: readonly Keyframe[] | undefined, kf: Keyframe, toleranceUs = 1000): Keyframe[] {
  const out = (kfs ?? []).filter((k) => Math.abs(k.t - kf.t) > toleranceUs);
  out.push(kf);
  out.sort((a, b) => a.t - b.t);
  return out;
}

export function removeKeyframeAt(kfs: readonly Keyframe[] | undefined, t: number, toleranceUs = 1000): Keyframe[] {
  return (kfs ?? []).filter((k) => Math.abs(k.t - t) > toleranceUs);
}

/**
 * Cut every property's keyframes at clip-local time `at`: returns the part
 * before (unchanged times) and after (times shifted to start at 0). Boundary
 * keyframes are inserted so values stay continuous.
 */
export function splitKeyframes(all: Keyframes, at: number): [Keyframes, Keyframes] {
  const left: Keyframes = {};
  const right: Keyframes = {};
  for (const [key, kfs] of Object.entries(all)) {
    if (!kfs.length) continue;
    const v = sampleKeyframes(kfs, at, kfs[0]!.v);
    const ease = [...kfs].reverse().find((k) => k.t <= at)?.ease ?? "linear";
    const l = kfs.filter((k) => k.t < at);
    const r = kfs.filter((k) => k.t > at).map((k) => ({ ...k, t: k.t - at }));
    left[key] = [...l, { t: at, v, ease }];
    right[key] = [{ t: 0, v, ease }, ...r];
  }
  return [left, right];
}

/** Shift keyframes left by `delta` (e.g. after trimming the clip start). */
export function shiftKeyframes(all: Keyframes, delta: number): Keyframes {
  if (delta === 0) return all;
  if (delta > 0) return splitKeyframes(all, delta)[1];
  const out: Keyframes = {};
  for (const [key, kfs] of Object.entries(all)) out[key] = kfs.map((k) => ({ ...k, t: k.t - delta }));
  return out;
}

/** Part of a speed curve between p0 and p1, renormalised to 0..1. */
export function subCurve(curve: SpeedCurve | null, p0: number, p1: number, speedAt: (p: number) => number): SpeedCurve | null {
  if (!curve) return null;
  const span = Math.max(1e-6, p1 - p0);
  const inner = curve.points.filter((x) => x.p > p0 && x.p < p1).map((x) => ({ p: (x.p - p0) / span, s: x.s }));
  return { preset: curve.preset, points: [{ p: 0, s: speedAt(p0) }, ...inner, { p: 1, s: speedAt(p1) }] };
}

/** Speed ramp presets. Points are (position, speed multiplier). */
export const SPEED_CURVE_PRESETS: Record<string, { p: number; s: number }[]> = {
  montage: [
    { p: 0, s: 1 },
    { p: 0.25, s: 3 },
    { p: 0.5, s: 0.5 },
    { p: 0.75, s: 3 },
    { p: 1, s: 1 },
  ],
  hero: [
    { p: 0, s: 2 },
    { p: 0.4, s: 2 },
    { p: 0.5, s: 0.3 },
    { p: 0.6, s: 2 },
    { p: 1, s: 2 },
  ],
  bullet: [
    { p: 0, s: 1 },
    { p: 0.35, s: 0.2 },
    { p: 0.65, s: 0.2 },
    { p: 1, s: 1 },
  ],
  "flash-in": [
    { p: 0, s: 4 },
    { p: 0.3, s: 1 },
    { p: 1, s: 1 },
  ],
  "flash-out": [
    { p: 0, s: 1 },
    { p: 0.7, s: 1 },
    { p: 1, s: 4 },
  ],
  jump: [
    { p: 0, s: 1 },
    { p: 0.45, s: 1 },
    { p: 0.5, s: 5 },
    { p: 0.55, s: 1 },
    { p: 1, s: 1 },
  ],
};
