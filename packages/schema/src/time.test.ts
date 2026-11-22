import { describe, expect, it } from "vitest";
import {
  collectSnapPoints,
  createProject,
  formatTimecode,
  frameToUs,
  getSequence,
  quantizeToFrame,
  snapTime,
  usToFrame,
} from "./index";

describe("frame math", () => {
  it("converts frames and microseconds at common rates", () => {
    expect(frameToUs(30, 30)).toBe(1_000_000);
    expect(usToFrame(1_000_000, 30)).toBe(30);
    expect(usToFrame(999_999, 30)).toBe(29);
    for (const fps of [24, 25, 29.97, 30, 60]) {
      for (let f = 0; f < 500; f += 7) expect(usToFrame(frameToUs(f, fps), fps)).toBe(f);
    }
  });

  it("quantizes to the nearest frame", () => {
    expect(quantizeToFrame(1_010_000, 30)).toBe(1_000_000);
    expect(quantizeToFrame(1_020_000, 30)).toBe(1_033_333);
  });

  it("formats timecodes", () => {
    expect(formatTimecode(0)).toBe("0:00.0");
    expect(formatTimecode(65_500_000)).toBe("1:05.5");
    expect(formatTimecode(3_725_000_000, false)).toBe("1:02:05");
  });
});

describe("snapping", () => {
  it("snaps within the threshold only", () => {
    expect(snapTime(1_040_000, [0, 1_000_000, 2_000_000], 50_000)).toEqual({
      timeUs: 1_000_000,
      snapped: true,
      target: 1_000_000,
    });
    expect(snapTime(1_100_000, [0, 1_000_000], 50_000).snapped).toBe(false);
  });

  it("collects zero and playhead", () => {
    const seq = getSequence(createProject({}));
    expect(collectSnapPoints(seq, { playheadUs: 500 })).toEqual([0, 500]);
  });
});
