import { describe, expect, it } from "vitest";
import {
  AUDIO_FX,
  applyBiquad,
  biquad,
  integratedLufs,
  limit,
  loadDsp,
  removeVocals,
  rms,
  runAudioChain,
  separateStems,
  studioVoice,
  truePeakDb,
} from "./index";

const SR = 48000;
const sine = (f: number, amp: number, sec: number, sr = SR) => new Float32Array(Math.round(sec * sr)).map((_, i) => Math.sin((2 * Math.PI * f * i) / sr) * amp);
let seed = 7;
const noise = (amp: number, n: number) => new Float32Array(n).map(() => (((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1) * amp);

/** Speech-like test signal: vowel-ish harmonics in bursts, with pauses. */
function fakeVoice(sec: number): Float32Array {
  const n = Math.round(sec * SR);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const on = Math.sin(t * Math.PI * 1.3) > 0 ? 1 : 0;
    const f0 = 140 + 20 * Math.sin(t * 3);
    let v = 0;
    for (let h = 1; h <= 12; h++) v += Math.sin(2 * Math.PI * f0 * h * t) / h;
    out[i] = v * 0.12 * on;
  }
  return out;
}

describe("loudness", () => {
  it("measures a -23 dBFS 1 kHz stereo sine as -23 LUFS (EBU Tech 3341)", () => {
    const amp = Math.pow(10, -23 / 20);
    const x = sine(1000, amp, 10);
    expect(integratedLufs([x, x], SR)).toBeCloseTo(-23, 0);
  });

  it("limits to the ceiling", () => {
    const x = sine(440, 1.6, 1);
    const y = limit([x, x], SR, -1);
    expect(truePeakDb(y)).toBeLessThanOrEqual(-0.9);
  });

  it("filters: low-pass passes bass and cuts treble", () => {
    const c = biquad("lowpass", 500, SR);
    expect(rms(applyBiquad(sine(100, 1, 0.5), c))).toBeGreaterThan(0.65);
    expect(rms(applyBiquad(sine(8000, 1, 0.5), c))).toBeLessThan(0.02);
  });
});

describe("Studio voice (Phase 3 done-when, part 1)", () => {
  it("turns a noisy, humming phone recording into clean -14 LUFS in one call", async () => {
    const dsp = await loadDsp();
    const voice = fakeVoice(8);
    const hum = sine(50, 0.03, 8);
    const hiss = noise(0.04, voice.length);
    const noisy = voice.map((v, i) => v + hum[i]! + hiss[i]!);
    const out = studioVoice([noisy, new Float32Array(noisy)], SR, dsp);
    const lufs = integratedLufs(out, SR);
    expect(lufs).toBeGreaterThan(-14.6);
    expect(lufs).toBeLessThan(-13.4);
    expect(truePeakDb(out)).toBeLessThanOrEqual(-0.9);
    // Noise in a pause (0.8–1.4 s is silent in fakeVoice) relative to speech level.
    const gapBefore = rms(noisy, Math.round(0.85 * SR), Math.round(1.4 * SR)) / rms(noisy, Math.round(0.1 * SR), Math.round(0.6 * SR));
    const gapAfter = rms(out[0]!, Math.round(0.85 * SR), Math.round(1.4 * SR)) / rms(out[0]!, Math.round(0.1 * SR), Math.round(0.6 * SR));
    expect(gapAfter).toBeLessThan(gapBefore * 0.3);
  }, 60_000);
});

describe("effects and stems", () => {
  it("runs every audio effect without NaNs", async () => {
    const dsp = await loadDsp();
    const x = fakeVoice(1).subarray(0, 24000);
    for (const def of AUDIO_FX) {
      const y = await runAudioChain([x, x], SR, [{ type: def.type, enabled: true, params: {} }], dsp);
      expect(y.length, def.type).toBe(2);
      expect(y[0]!.every((v) => Number.isFinite(v)), def.type).toBe(true);
    }
  }, 120_000);

  it("splits drums from a tone and removes centred vocals", async () => {
    const dsp = await loadDsp();
    const n = SR * 3;
    const tone = sine(440, 0.3, 3);
    const kick = new Float32Array(n);
    for (let k = 1000; k < n; k += SR / 2) for (let j = 0; j < 800; j++) kick[k + j] = Math.sin(j * 0.05) * Math.exp(-j / 150) * 0.8;
    const mix = tone.map((v, i) => v + kick[i]!);
    const s = separateStems([mix, mix], SR, dsp);
    // The hits go to drums, the centred tone to vocals, little elsewhere.
    expect(rms(s.drums[0]!)).toBeGreaterThan(rms(kick) * 0.5);
    expect(rms(s.vocals[0]!)).toBeGreaterThan(rms(tone) * 0.8);
    expect(rms(s.other[0]!)).toBeLessThan(rms(tone) * 0.1);
    expect(rms(s.bass[0]!)).toBeLessThan(rms(tone) * 0.1);
    const inst = removeVocals([tone, tone], SR, dsp);
    expect(rms(inst[0]!)).toBeLessThan(rms(tone) * 0.6);
  }, 60_000);

  it("pitch shift keeps length", async () => {
    const dsp = await loadDsp();
    const x = sine(220, 0.5, 1, 16000);
    expect(dsp.pitchShift(x, 5).length).toBe(x.length);
    expect(dsp.timeStretch(x, 1.25).length).toBe(20000);
  });
});
