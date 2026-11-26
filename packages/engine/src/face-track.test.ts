import { describe, expect, it } from "vitest";
import { faceOnCanvas, followKeys, pickFace, thinKeys, trackFaces, type FaceSample } from "./analysis/face-track";

const box = (cx: number, cy = 0.4, w = 0.1, h = 0.18) => ({ cx, cy, w, h });

describe("face tracking", () => {
  it("follows a moving face closely, fills short gaps and holds on long ones", () => {
    const samples: FaceSample[] = [];
    for (let i = 0; i < 40; i++) {
      // Face moves left → right; frames 10–13 lost (short gap), 25–39 lost (long, end).
      const seen = !(i >= 10 && i <= 13) && i < 25;
      samples.push({ tUs: i * 100_000, face: seen ? box(0.2 + i * 0.015) : null });
    }
    const t = trackFaces(samples, { smooth: 1, maxGap: 8 });
    expect(t).toHaveLength(40);
    // Follows within a hair of the real position where seen.
    expect(Math.abs(t[5]!.cx - (0.2 + 5 * 0.015))).toBeLessThan(0.003);
    // Gap glides through the middle, no jump.
    expect(t[11]!.seen).toBe(false);
    expect(Math.abs(t[11]!.cx - (0.2 + 11 * 0.015))).toBeLessThan(0.005);
    // After the face leaves for good, the last position is held.
    expect(t[39]!.cx).toBeCloseTo(t[30]!.cx, 6);
    // No step bigger than the face's own movement.
    for (let i = 1; i < 40; i++) expect(Math.abs(t[i]!.cx - t[i - 1]!.cx)).toBeLessThan(0.02);
  });

  it("returns nothing when no face is ever seen", () => {
    expect(trackFaces([{ tUs: 0, face: null }, { tUs: 1, face: null }])).toEqual([]);
  });

  it("keeps the same person when several faces are in frame", () => {
    expect(pickFace([box(0.8, 0.4, 0.3, 0.4), box(0.31)], box(0.3))).toEqual(box(0.31));
    expect(pickFace([box(0.2, 0.4, 0.05, 0.05), box(0.7, 0.4, 0.2, 0.3)], null)!.cx).toBe(0.7);
  });

  it("follow-zoom puts the face at the target point and never shows past the edges", () => {
    // 16:9 source in a 9:16 canvas, face right of centre.
    const track = trackFaces([{ tUs: 1_000_000, face: box(0.7, 0.4, 0.06, 0.12) }]);
    const [k] = followKeys(track, 16 / 9, 9 / 16, { sourceInUs: 0, speed: 1 });
    expect(k!.tUs).toBe(1_000_000);
    const where = faceOnCanvas(box(0.7, 0.4, 0.06, 0.12), 16 / 9, 9 / 16, k!);
    expect(where.cx).toBeCloseTo(0.5, 2);
    expect(where.cy).toBeCloseTo(0.42, 2);
    // Edge face: clamped so the picture still covers the frame.
    const [e] = followKeys(trackFaces([{ tUs: 0, face: box(0.99, 0.5, 0.06, 0.12) }]), 16 / 9, 9 / 16, { sourceInUs: 0, speed: 1 });
    // A wide source in a tall canvas is fitted by width (fitW = 1), so its shown width is the scale.
    const dw = e!.scale;
    expect(Math.abs(e!.x)).toBeLessThanOrEqual((dw - 1) / 2 + 1e-9);
  });

  it("thins straight runs of keyframes", () => {
    const keys = Array.from({ length: 10 }, (_, i) => ({ tUs: i, x: i * 0.1, y: 0, scale: 1 }));
    expect(thinKeys(keys, ["x", "y", "scale"])).toHaveLength(2);
  });
});
