import type { Keyframe } from "@just-see/schema";

export interface SubjectSample {
  /** Source time in µs. */
  tUs: number;
  /** Subject centre as a fraction of source width (0..1), or null if none found. */
  cx: number | null;
}

export interface ReframePlan {
  /** Transform scale that makes the source cover the canvas. */
  scale: number;
  /** Keyframes for transform "x" (clip-local µs). */
  x: Keyframe[];
}

/**
 * Follow a subject horizontally when a wide video goes into a tall canvas.
 * `srcAspect` and `dstAspect` are width/height. Positions are smoothed and the
 * frame never shows empty space at the sides.
 */
export function reframePlan(
  samples: readonly SubjectSample[],
  srcAspect: number,
  dstAspect: number,
  opts: { sourceInUs?: number; speed?: number; smoothing?: number; maxSpeedPerSec?: number } = {},
): ReframePlan {
  // Contain-fit then scale up until the height fills (wide source into a tall canvas).
  const fitByWidth = srcAspect > dstAspect;
  const scale = fitByWidth ? srcAspect / dstAspect : 1;
  if (!fitByWidth) return { scale: 1, x: [] };
  const renderedW = scale; // in canvas widths
  const maxX = (renderedW - 1) / 2;
  const sourceIn = opts.sourceInUs ?? 0;
  const speed = opts.speed ?? 1;
  const smooth = opts.smoothing ?? 0.6;
  const maxStep = opts.maxSpeedPerSec ?? 0.35;
  // Fill gaps with the last known position (or centre).
  let last = 0.5;
  const filled = samples.map((s) => {
    if (s.cx !== null && Number.isFinite(s.cx)) last = s.cx;
    return { tUs: s.tUs, cx: last };
  });
  const out: Keyframe[] = [];
  let pos: number | null = null;
  let prevT = 0;
  for (const s of filled) {
    const target = Math.min(maxX, Math.max(-maxX, -(s.cx - 0.5) * renderedW));
    if (pos === null) pos = target;
    else {
      const dt = Math.max(1e-3, (s.tUs - prevT) / 1e6);
      const wanted = pos + (target - pos) * (1 - smooth);
      const step = Math.max(-maxStep * dt, Math.min(maxStep * dt, wanted - pos));
      pos += step;
    }
    prevT = s.tUs;
    const local = Math.max(0, Math.round((s.tUs - sourceIn) / speed));
    out.push({ t: local, v: Math.round(pos * 10000) / 10000, ease: "ease-in-out" });
  }
  return { scale, x: out };
}
