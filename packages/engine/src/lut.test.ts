import { describe, expect, it } from "vitest";
import { colorMatchParams, colorStats, parseCubeLut } from "./index";

const invert2 = `TITLE "Invert"
# comment
LUT_3D_SIZE 2
1 1 1
0 1 1
1 0 1
0 0 1
1 1 0
0 1 0
1 0 0
0 0 0
`;

describe("cube LUT parser", () => {
  it("parses a 3D LUT", () => {
    const lut = parseCubeLut(invert2);
    expect(lut.size).toBe(2);
    expect(lut.title).toBe("Invert");
    expect(Array.from(lut.data.slice(0, 6))).toEqual([255, 255, 255, 0, 255, 255]);
  });

  it("rejects bad files", () => {
    expect(() => parseCubeLut("LUT_1D_SIZE 4\n0 0 0")).toThrow(/1D/);
    expect(() => parseCubeLut("LUT_3D_SIZE 2\n0 0 0")).toThrow(/Expected 8/);
    expect(() => parseCubeLut("hello")).toThrow(/LUT_3D_SIZE/);
  });

  it("respects DOMAIN_MIN/MAX", () => {
    const lines = ["LUT_3D_SIZE 2", "DOMAIN_MIN 0 0 0", "DOMAIN_MAX 2 2 2", ...Array(8).fill("2 1 0")];
    const lut = parseCubeLut(lines.join("\n"));
    expect(Array.from(lut.data.slice(0, 3))).toEqual([255, 128, 0]);
  });
});

describe("colour match", () => {
  it("maps a dark image onto a bright reference", () => {
    const dark = new Uint8Array(400).map((_, i) => (i % 4 === 3 ? 255 : 40 + (i % 7)));
    const bright = new Uint8Array(400).map((_, i) => (i % 4 === 3 ? 255 : 180 + (i % 7)));
    const p = colorMatchParams(colorStats(bright, 1), colorStats(dark, 1));
    const out = (40 / 255) * p.gainR! + p.offR!;
    expect(out).toBeCloseTo(180 / 255, 1);
  });
});
