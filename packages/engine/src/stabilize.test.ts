import { describe, expect, it } from "vitest";
import { estimateShift, smoothSeries, stabilizePlan, type GrayFrame } from "./index";

/** A textured test image; shifted copies simulate camera shake. */
function scene(w: number, h: number, ox: number, oy: number): GrayFrame {
  const data = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const X = x - ox;
      const Y = y - oy;
      const v = 128 + 60 * Math.sin(X * 0.21) * Math.cos(Y * 0.17) + 50 * Math.sin((X + Y) * 0.05) + 20 * Math.sin(X * Y * 0.002);
      data[y * w + x] = Math.max(0, Math.min(255, Math.round(v)));
    }
  return { data, width: w, height: h };
}

describe("stabilisation", () => {
  it("measures frame shifts to within a pixel", () => {
    const a = scene(160, 90, 0, 0);
    for (const [dx, dy] of [[3, -2], [-7, 5], [0, 0], [10, 1], [-4, -9]] as const) {
      const r = estimateShift(a, scene(160, 90, dx, dy), 12);
      expect(Math.abs(r.dx - dx), `dx ${dx}`).toBeLessThan(0.75);
      expect(Math.abs(r.dy - dy), `dy ${dy}`).toBeLessThan(0.75);
    }
  });

  it("smooths a shaky path and keeps a slow pan", () => {
    const n = 60;
    // Slow pan to the right (1 px/sample) plus ±4 px shake.
    let seed = 3;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
    const pos = Array.from({ length: n }, (_, i) => i + rnd() * 4);
    const shifts = pos.slice(1).map((p, i) => ({ dx: p - pos[i]!, dy: rnd() * 3 }));
    const times = Array.from({ length: n }, (_, i) => i * 100_000);
    const plan = stabilizePlan(times, shifts, 160, 90, { smoothSec: 1, sampleFps: 10 });
    // Stabilised positions: raw + correction (in source fractions, display 1).
    const fit = plan.x.map((k, i) => (pos[i]! - pos[0]!) / 160 + k.v / plan.scale);
    const jitterBefore = pos.slice(1).reduce((a, p, i) => a + Math.abs(p - pos[i]! - 1), 0) / (n - 1);
    const jitterAfter = fit.slice(1).reduce((a, p, i) => a + Math.abs((p - fit[i]!) * 160 - 1), 0) / (n - 1);
    expect(jitterAfter).toBeLessThan(jitterBefore * 0.4);
    expect(plan.scale).toBeGreaterThan(1);
    expect(plan.scale).toBeLessThanOrEqual(1.25);
    // The pan itself is kept (the corrections do not grow with time).
    expect(Math.abs(plan.x[n - 1]!.v)).toBeLessThan(0.08);
  });

  it("smoothSeries keeps constants and averages noise", () => {
    for (const v of smoothSeries([5, 5, 5, 5], 2)) expect(v).toBeCloseTo(5, 9);
    const s = smoothSeries([0, 10, 0, 10, 0, 10, 0], 2);
    expect(Math.max(...s) - Math.min(...s)).toBeLessThan(4);
  });
});
