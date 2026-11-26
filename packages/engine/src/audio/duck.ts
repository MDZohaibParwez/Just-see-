import type { Keyframe } from "@just-see/schema";

export interface ActiveRange {
  startUs: number;
  endUs: number;
}

/**
 * Volume keyframes for a music clip so it dips while someone speaks
 * (sidechain-style ducking done once, editable afterwards).
 * Times in `voice` are timeline µs; keyframes are clip-local.
 */
export function duckKeyframes(
  clip: { startUs: number; durationUs: number; volume: number },
  voice: readonly ActiveRange[],
  opts: { depthDb?: number; attackUs?: number; releaseUs?: number; mergeGapUs?: number } = {},
): Keyframe[] {
  const depth = Math.pow(10, -(opts.depthDb ?? 12) / 20);
  const attack = opts.attackUs ?? 150_000;
  const release = opts.releaseUs ?? 400_000;
  const gap = opts.mergeGapUs ?? 600_000;
  const base = clip.volume;
  const low = base * depth;
  // Merge close speech ranges so the music does not pump.
  const merged: ActiveRange[] = [];
  for (const r of [...voice].sort((a, b) => a.startUs - b.startUs)) {
    const last = merged[merged.length - 1];
    if (last && r.startUs - last.endUs < gap) last.endUs = Math.max(last.endUs, r.endUs);
    else merged.push({ ...r });
  }
  const kfs: Keyframe[] = [{ t: 0, v: base, ease: "linear" }];
  for (const r of merged) {
    const s = r.startUs - clip.startUs;
    const e = r.endUs - clip.startUs;
    if (e <= 0 || s >= clip.durationUs) continue;
    const a0 = Math.max(0, s - attack);
    const a1 = Math.max(0, s);
    const r1 = Math.min(clip.durationUs, e + release);
    if (a0 > (kfs[kfs.length - 1]?.t ?? 0)) kfs.push({ t: Math.round(a0), v: base, ease: "ease-in-out" });
    kfs.push({ t: Math.round(a1), v: low, ease: "linear" });
    kfs.push({ t: Math.round(Math.min(clip.durationUs, e)), v: low, ease: "ease-in-out" });
    kfs.push({ t: Math.round(r1), v: base, ease: "linear" });
  }
  // Keep times strictly increasing.
  const out: Keyframe[] = [];
  for (const k of kfs) {
    const last = out[out.length - 1];
    if (last && k.t <= last.t) last.v = Math.min(last.v, k.v);
    else out.push(k);
  }
  return out;
}
