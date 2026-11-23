import { describe, expect, it } from "vitest";
import { detectBeats, detectSilence, fitToBeats, toMono } from "./index";

function clickTrack(bpm: number, seconds: number, sr: number, startSec = 0.2): Float32Array {
  const out = new Float32Array(Math.round(seconds * sr));
  let seed = 1;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  for (let i = 0; i < out.length; i++) out[i] = rand() * 0.01;
  const period = 60 / bpm;
  for (let t = startSec; t < seconds; t += period) {
    const s = Math.round(t * sr);
    for (let j = 0; j < sr * 0.03 && s + j < out.length; j++) out[s + j]! += Math.sin(j * 0.9) * Math.exp(-j / (sr * 0.006)) * 0.9;
  }
  return out;
}

describe("beat detection", () => {
  for (const bpm of [90, 120, 140]) {
    it(`finds ${bpm} BPM and beats on the clicks`, () => {
      const sr = 22050;
      const a = detectBeats(clickTrack(bpm, 12, sr), sr);
      expect(a.bpm).toBeGreaterThan(bpm * 0.97);
      expect(a.bpm).toBeLessThan(bpm * 1.03);
      const period = 60 / bpm;
      // Every detected beat is within 30 ms of a click.
      for (const b of a.beatsUs.slice(1, -1)) {
        const t = b / 1e6 - 0.2;
        const k = Math.round(t / period);
        expect(Math.abs(t - k * period)).toBeLessThan(0.03);
      }
      expect(a.beatsUs.length).toBeGreaterThan(12 / period - 3);
    });
  }

  it("mixes to mono", () => {
    expect(Array.from(toMono([new Float32Array([1, 0]), new Float32Array([0, 1])]))).toEqual([0.5, 0.5]);
  });
});

describe("silence detection", () => {
  it("finds a quiet gap in speech-like audio", () => {
    const sr = 16000;
    const pcm = new Float32Array(sr * 5);
    for (let i = 0; i < pcm.length; i++) {
      const t = i / sr;
      const loud = t < 1.5 || t > 3.0;
      pcm[i] = loud ? Math.sin(i * 0.2) * 0.3 : Math.sin(i * 0.2) * 0.0005;
    }
    const r = detectSilence(pcm, sr, { thresholdDb: -40, minDurationUs: 500_000, paddingUs: 100_000 });
    expect(r).toHaveLength(1);
    expect(r[0]!.startUs).toBeGreaterThan(1_550_000);
    expect(r[0]!.startUs).toBeLessThan(1_650_000);
    expect(r[0]!.endUs).toBeGreaterThan(2_850_000);
    expect(r[0]!.endUs).toBeLessThan(2_950_000);
  });

  it("ignores short pauses", () => {
    const sr = 16000;
    const pcm = new Float32Array(sr * 2).map((_, i) => (i > sr && i < sr * 1.2 ? 0 : Math.sin(i * 0.2) * 0.3));
    expect(detectSilence(pcm, sr)).toHaveLength(0);
  });
});

describe("fit to beats", () => {
  it("moves each cut to the nearest beat", () => {
    const beats = [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5].map((s) => s * 1e6);
    const d = fitToBeats([1.2e6, 1.7e6, 2.1e6], [5e6, 5e6, 5e6], [0, 0, 0], beats);
    expect(d).toEqual([1e6, 1.5e6, 2e6]);
  });

  it("respects source limits and overlaps", () => {
    const beats = [1, 2, 3, 4, 5].map((s) => s * 1e6);
    const d = fitToBeats([1.4e6, 2.6e6], [1.3e6, 5e6], [0, 0.5e6], beats);
    // First clip cannot reach 1 s beat? It can (1 s ≤ 1.3 s).
    expect(d[0]).toBe(1e6);
    // Second clip starts at 0.5 s (overlap) and its end snaps to 3 s.
    expect(d[1]).toBe(2.5e6);
  });
});
