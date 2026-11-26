/** Per-channel mean and standard deviation of an RGBA image (0..1). */
export interface ColorStats {
  mean: [number, number, number];
  std: [number, number, number];
}

export function colorStats(rgba: Uint8ClampedArray | Uint8Array, step = 4): ColorStats {
  const sum = [0, 0, 0];
  const sq = [0, 0, 0];
  let n = 0;
  for (let i = 0; i < rgba.length; i += 4 * step) {
    if ((rgba[i + 3] ?? 255) < 16) continue;
    for (let c = 0; c < 3; c++) {
      const v = (rgba[i + c] ?? 0) / 255;
      sum[c]! += v;
      sq[c]! += v * v;
    }
    n++;
  }
  n = Math.max(1, n);
  const mean = sum.map((s) => s / n) as [number, number, number];
  const std = sq.map((s, c) => Math.sqrt(Math.max(0, s / n - mean[c]! ** 2))) as [number, number, number];
  return { mean, std };
}

/**
 * Gain/offset that maps `target` statistics onto `reference`
 * (Reinhard-style transfer per RGB channel), clamped to sane ranges.
 */
export function colorMatchParams(reference: ColorStats, target: ColorStats): Record<string, number> {
  const out: Record<string, number> = { amount: 1 };
  const names = ["R", "G", "B"] as const;
  for (let c = 0; c < 3; c++) {
    const gain = Math.min(3, Math.max(0.3, reference.std[c]! / Math.max(0.01, target.std[c]!)));
    const off = Math.min(1, Math.max(-1, reference.mean[c]! - target.mean[c]! * gain));
    out[`gain${names[c]}`] = gain;
    out[`off${names[c]}`] = off;
  }
  return out;
}
