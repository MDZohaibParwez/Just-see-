import { describe, expect, it } from "vitest";
import { reframePlan } from "./index";

describe("auto reframe", () => {
  it("covers a 9:16 canvas with 16:9 video and follows the subject", () => {
    const samples = [0, 1, 2, 3, 4, 5, 6].map((s) => ({ tUs: s * 1e6, cx: s < 3 ? 0.2 : 0.8 }));
    const plan = reframePlan(samples, 16 / 9, 9 / 16, { smoothing: 0, maxSpeedPerSec: 10 });
    expect(plan.scale).toBeCloseTo((16 / 9) / (9 / 16));
    const maxX = (plan.scale - 1) / 2;
    // Subject on the left → move the picture right (positive x).
    expect(plan.x[0]!.v).toBeGreaterThan(0);
    expect(plan.x[6]!.v).toBeLessThan(0);
    for (const k of plan.x) expect(Math.abs(k.v)).toBeLessThanOrEqual(maxX + 1e-9);
  });

  it("limits how fast the frame pans and keeps the last position when the subject is lost", () => {
    const samples = [{ tUs: 0, cx: 0.5 }, { tUs: 1e6, cx: 0.9 }, { tUs: 2e6, cx: null }];
    const plan = reframePlan(samples, 16 / 9, 9 / 16, { smoothing: 0, maxSpeedPerSec: 0.2 });
    expect(plan.x[1]!.v).toBeCloseTo(-0.2);
    expect(plan.x[2]!.v).toBeCloseTo(-0.4);
  });

  it("does nothing for tall sources", () => {
    expect(reframePlan([{ tUs: 0, cx: 0.1 }], 9 / 16, 9 / 16)).toEqual({ scale: 1, x: [] });
  });
});
