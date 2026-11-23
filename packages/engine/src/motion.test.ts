import { describe, expect, it } from "vitest";
import { MotionCompSchema, type MotionLayer } from "@just-see/schema";
import {
  TEMPLATES,
  TEXT_PRESETS,
  applyTextPreset,
  applyAffine,
  evaluateLayer,
  frameLayers,
  fromLottie,
  newMotionLayer,
  polylineLength,
  randomOrder,
  revealAmount,
  sampleMotionKeyframes,
  shapeOutline,
  toLottie,
  trimPolyline,
  worldMatrix,
} from "./index";

let n = 0;
const id = (p: string) => `${p}${(n++).toString(36)}`;

describe("motion: keyframes", () => {
  it("samples with easing, holds and loops", () => {
    const kfs = [
      { t: 0, v: 0, ease: "linear" as const },
      { t: 1_000_000, v: 100, ease: "hold" as const },
      { t: 2_000_000, v: 50, ease: "linear" as const },
    ];
    expect(sampleMotionKeyframes(kfs, 500_000, 0)).toBeCloseTo(50);
    expect(sampleMotionKeyframes(kfs, 1_500_000, 0)).toBe(100);
    expect(sampleMotionKeyframes(kfs, 3_000_000, 0)).toBe(50);
    // Loop: 2.5 s → 0.5 s.
    expect(sampleMotionKeyframes(kfs, 2_500_000, 0, true)).toBeCloseTo(50);
  });

  it("bezier ease can overshoot (back ease)", () => {
    const kfs = [
      { t: 0, v: 0, ease: "bezier" as const, bezier: [0.34, 1.56, 0.64, 1] as [number, number, number, number] },
      { t: 1_000_000, v: 1, ease: "linear" as const },
    ];
    let max = 0;
    for (let t = 0; t <= 1_000_000; t += 20_000) max = Math.max(max, sampleMotionKeyframes(kfs, t, 0));
    expect(max).toBeGreaterThan(1.05);
  });

  it("evaluates nested properties and wiggle", () => {
    const l = newMotionLayer(id, 1920, 1080, "shape", {
      keyframes: { "shape.trimEnd": [{ t: 0, v: 0, ease: "linear" }, { t: 1_000_000, v: 1, ease: "linear" }] },
      wiggles: [{ prop: "x", freq: 2, amp: 30, seed: 3 }],
    });
    const e = evaluateLayer(l, 250_000);
    expect(e.shape!.trimEnd).toBeCloseTo(0.25);
    expect(Math.abs(e.transform.x - 960)).toBeLessThanOrEqual(30.01);
    expect(l.shape!.trimEnd).toBe(1); // original untouched
  });
});

describe("motion: transforms", () => {
  it("parents chain and anchors pivot", () => {
    const parent = newMotionLayer(id, 1000, 1000, "null", { transform: { x: 100, y: 100, rotation: 90 } });
    const child = newMotionLayer(id, 1000, 1000, "solid", { parentId: parent.id, transform: { x: 50, y: 0 } });
    const map = new Map([parent, child].map((l) => [l.id, l] as const));
    const [x, y] = applyAffine(worldMatrix(child.id, map), 0, 0);
    expect(x).toBeCloseTo(100);
    expect(y).toBeCloseTo(150);
    // Anchor at the left edge: scaling 0.5 keeps the left edge in place.
    const bar = newMotionLayer(id, 1000, 1000, "solid", { width: 200, transform: { x: 0, y: 0, anchorX: -100, scaleX: 0.5 } });
    const m = worldMatrix(bar.id, new Map([[bar.id, bar]]));
    expect(applyAffine(m, -100, 0)[0]).toBeCloseTo(0);
    expect(applyAffine(m, 100, 0)[0]).toBeCloseTo(100);
  });

  it("draw order is bottom first", () => {
    const a = newMotionLayer(id, 100, 100, "solid", { name: "top" });
    const b = newMotionLayer(id, 100, 100, "solid", { name: "bottom" });
    const comp = MotionCompSchema.parse({ id: "c", name: "c", width: 100, height: 100, durationUs: 1e6, layers: [a, b] });
    expect(frameLayers(comp, 0).map((x) => x.layer.name)).toEqual(["bottom", "top"]);
  });
});

describe("motion: shapes and trim paths", () => {
  it("rect outline length and trims", () => {
    const l = newMotionLayer(id, 1000, 1000, "shape", { shape: { kind: "rect", width: 100, height: 50 } });
    const o = shapeOutline(l.shape!);
    expect(polylineLength(o)).toBeCloseTo(300);
    const half = trimPolyline(o, 0, 0.5);
    expect(half).toHaveLength(1);
    expect(polylineLength(half[0]!)).toBeCloseTo(150, 0);
    const wrapped = trimPolyline(o, 0.8, 1, 0.5); // 1.3..1.5 → 0.3..0.5
    expect(polylineLength(wrapped[0]!)).toBeCloseTo(60, 0);
    const across = trimPolyline(o, 0.4, 0.8, 0.4); // 0.8..1.2 wraps
    expect(across).toHaveLength(1);
    expect(polylineLength(across[0]!)).toBeCloseTo(120, 0);
    expect(trimPolyline(o, 0.5, 0.5)).toHaveLength(0);
  });

  it("ellipse starts at the top and stars alternate radii", () => {
    const e = shapeOutline({ ...newMotionLayer(id, 10, 10, "shape").shape!, kind: "ellipse", width: 200, height: 200 });
    expect(e.pts[0]![1]).toBeCloseTo(-100);
    const s = shapeOutline({ ...newMotionLayer(id, 10, 10, "shape").shape!, kind: "star", width: 200, height: 200, points: 5, innerRatio: 0.5 });
    expect(s.pts).toHaveLength(10);
    expect(Math.hypot(...s.pts[1]!)).toBeCloseTo(50);
  });
});

describe("motion: text animators", () => {
  it("reveals units in order with a soft edge", () => {
    expect(revealAmount(0, 10, 0, 3)).toBe(0);
    expect(revealAmount(9, 10, 1, 3)).toBe(1);
    const mid = Array.from({ length: 10 }, (_, i) => revealAmount(i, 10, 0.5, 3));
    expect(mid[0]).toBe(1);
    expect(mid[9]).toBe(0);
    for (let i = 1; i < 10; i++) expect(mid[i]!).toBeLessThanOrEqual(mid[i - 1]!);
  });
  it("random order is a permutation", () => {
    const o = randomOrder(20);
    expect([...o].sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, i) => i));
  });
  it("presets set the animator and reveal keyframes", () => {
    expect(TEXT_PRESETS.length).toBeGreaterThanOrEqual(20);
    const l: MotionLayer = newMotionLayer(id, 1080, 1080, "text");
    applyTextPreset(l, TEXT_PRESETS[1]!, 0.5);
    expect(l.text!.animator!.progress).toBe(0);
    expect(evaluateLayer(l, 5_000_000).text!.animator!.progress).toBe(1);
  });
});

describe("motion: templates and Lottie", () => {
  it("every template builds a valid comp with editable fields", () => {
    for (const t of TEMPLATES) {
      const c = t.build(id, { width: 1080, height: 1920 });
      expect(() => MotionCompSchema.parse(c), t.id).not.toThrow();
      expect(c.layers.length, t.id).toBeGreaterThan(1);
      for (const e of c.editable) expect(c.layers.some((l) => l.id === e.layerId), t.id).toBe(true);
      for (const l of c.layers) if (l.parentId) expect(c.layers.some((p) => p.id === l.parentId), t.id).toBe(true);
    }
  });

  it("Lottie export → import keeps layers, shapes and animation", () => {
    const c = TEMPLATES.find((t) => t.id === "logo-reveal-line")!.build(id, { width: 1920, height: 1080 });
    const json = toLottie(c);
    expect(json.op).toBe(Math.round((c.durationUs / 1e6) * 30));
    const back = fromLottie(JSON.parse(JSON.stringify(json)), id);
    expect(back.layers.map((l) => l.type)).toEqual(c.layers.map((l) => l.type));
    const frameSrc = c.layers.find((l) => l.name === "Frame")!;
    const frameBack = back.layers.find((l) => l.name === "Frame")!;
    for (const t of [0, 400_000, 900_000, 2_000_000]) {
      expect(evaluateLayer(frameBack, t).shape!.trimEnd).toBeCloseTo(evaluateLayer(frameSrc, t).shape!.trimEnd, 1);
    }
    const fill = back.layers.find((l) => l.name === "Fill")!;
    expect(evaluateLayer(fill, 3_000_000).transform.opacity).toBeCloseTo(1, 1);
    const logo = back.layers.find((l) => l.name === "Logo")!;
    expect(logo.text!.text).toBe("BRAND");
  });
});
