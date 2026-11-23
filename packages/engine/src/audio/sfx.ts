/**
 * Built-in sound effects, synthesised in code. Because we generate them
 * ourselves there is no third-party licence: they are free for any use.
 */
import { applyBiquad, biquad } from "./dsp";

export interface SfxDef {
  id: string;
  label: string;
  category: "transition" | "impact" | "ui" | "comedy" | "ambience";
  seconds: number;
  make(sr: number): Float32Array[];
}

let seed = 12345;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
const env = (t: number, a: number, d: number) => (t < a ? t / a : Math.exp(-(t - a) / d));
const stereo = (m: Float32Array, width = 0): Float32Array[] => {
  if (!width) return [m, new Float32Array(m)];
  const r = new Float32Array(m.length);
  const d = Math.round(width);
  for (let i = 0; i < m.length; i++) r[i] = m[i - d] ?? 0;
  return [m, r];
};
const norm = (x: Float32Array, peak = 0.89) => {
  let m = 0;
  for (const v of x) m = Math.max(m, Math.abs(v));
  return m > 0 ? x.map((v) => (v / m) * peak) : x;
};
const buf = (sr: number, sec: number) => new Float32Array(Math.round(sr * sec));

/** Band-swept noise (whooshes, risers). */
function sweptNoise(sr: number, sec: number, f0: number, f1: number, shape: (t: number) => number): Float32Array {
  seed = 999;
  const out = buf(sr, sec);
  let lp = 0;
  let bp1 = 0;
  let bp2 = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / out.length;
    const f = f0 * Math.pow(f1 / f0, t);
    const c = biquad("bandpass", f, sr, 1.2);
    const n = rnd();
    const y = c.b0 * n + c.b2 * lp - c.a1 * bp1 - c.a2 * bp2;
    lp = n;
    bp2 = bp1;
    bp1 = y;
    out[i] = y * shape(t);
  }
  return norm(out);
}

function tone(sr: number, sec: number, freq: (t: number) => number, amp: (t: number) => number, wave: "sine" | "square" | "saw" = "sine"): Float32Array {
  const out = buf(sr, sec);
  let ph = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / sr;
    ph += (2 * Math.PI * freq(t)) / sr;
    const s = wave === "sine" ? Math.sin(ph) : wave === "square" ? Math.sign(Math.sin(ph)) : ((ph / Math.PI) % 2) - 1;
    out[i] = s * amp(t);
  }
  return out;
}

export const SFX: readonly SfxDef[] = [
  { id: "whoosh", label: "Whoosh", category: "transition", seconds: 0.8, make: (sr) => stereo(sweptNoise(sr, 0.8, 300, 4000, (t) => Math.sin(Math.PI * t) ** 2), 40) },
  { id: "whoosh-down", label: "Whoosh down", category: "transition", seconds: 0.8, make: (sr) => stereo(sweptNoise(sr, 0.8, 5000, 250, (t) => Math.sin(Math.PI * t) ** 2), 40) },
  { id: "swish", label: "Quick swish", category: "transition", seconds: 0.35, make: (sr) => stereo(sweptNoise(sr, 0.35, 1500, 7000, (t) => Math.sin(Math.PI * t) ** 3)) },
  { id: "riser", label: "Riser", category: "transition", seconds: 3, make: (sr) => {
      const n = sweptNoise(sr, 3, 200, 8000, (t) => t * t);
      const s = tone(sr, 3, (t) => 110 * Math.pow(2, t * 1.3), (t) => (t / 3) ** 2 * 0.5, "saw");
      return stereo(norm(n.map((v, i) => v * 0.6 + s[i]!)), 60);
    } },
  { id: "downlifter", label: "Downlifter", category: "transition", seconds: 2, make: (sr) => stereo(sweptNoise(sr, 2, 6000, 120, (t) => (1 - t) ** 2), 60) },
  { id: "boom", label: "Cinematic boom", category: "impact", seconds: 2.5, make: (sr) => {
      seed = 5;
      const b = tone(sr, 2.5, (t) => 30 + 60 * Math.exp(-t * 6), (t) => env(t, 0.005, 0.6));
      const n = buf(sr, 2.5).map((_, i) => rnd() * env(i / sr, 0.001, 0.08));
      return stereo(norm(applyBiquad(b.map((v, i) => v + n[i]! * 0.4), biquad("lowpass", 900, sr))), 30);
    } },
  { id: "hit", label: "Punch hit", category: "impact", seconds: 0.6, make: (sr) => {
      seed = 6;
      const b = tone(sr, 0.6, (t) => 60 + 140 * Math.exp(-t * 30), (t) => env(t, 0.002, 0.12));
      const n = buf(sr, 0.6).map((_, i) => rnd() * env(i / sr, 0.001, 0.02));
      return stereo(norm(b.map((v, i) => v + n[i]! * 0.6)));
    } },
  { id: "kick", label: "Kick", category: "impact", seconds: 0.5, make: (sr) => stereo(norm(tone(sr, 0.5, (t) => 45 + 120 * Math.exp(-t * 35), (t) => env(t, 0.001, 0.15)))) },
  { id: "snap", label: "Finger snap", category: "ui", seconds: 0.25, make: (sr) => { seed = 8; return stereo(norm(applyBiquad(buf(sr, 0.25).map((_, i) => rnd() * env(i / sr, 0.0005, 0.015)), biquad("bandpass", 2500, sr, 1.5)))); } },
  { id: "click", label: "UI click", category: "ui", seconds: 0.08, make: (sr) => stereo(norm(tone(sr, 0.08, () => 1800, (t) => env(t, 0.0005, 0.008)))) },
  { id: "pop", label: "Pop", category: "ui", seconds: 0.2, make: (sr) => stereo(norm(tone(sr, 0.2, (t) => 300 + 900 * Math.exp(-t * 40), (t) => env(t, 0.001, 0.04)))) },
  { id: "ding", label: "Ding", category: "ui", seconds: 1.5, make: (sr) => {
      const a = tone(sr, 1.5, () => 1318.5, (t) => env(t, 0.002, 0.5));
      const b = tone(sr, 1.5, () => 2637, (t) => env(t, 0.002, 0.25) * 0.4);
      return stereo(norm(a.map((v, i) => v + b[i]!)), 20);
    } },
  { id: "notification", label: "Notification", category: "ui", seconds: 0.6, make: (sr) => stereo(norm(tone(sr, 0.6, (t) => (t < 0.15 ? 880 : 1320), (t) => env(t % 0.15, 0.002, 0.06) * (t < 0.45 ? 1 : 0)))) },
  { id: "camera", label: "Camera shutter", category: "ui", seconds: 0.35, make: (sr) => {
      seed = 9;
      const n = buf(sr, 0.35).map((_, i) => { const t = i / sr; return rnd() * (env(t, 0.001, 0.01) + (t > 0.12 ? env(t - 0.12, 0.001, 0.015) : 0)); });
      return stereo(norm(applyBiquad(n, biquad("bandpass", 3000, sr, 0.8))));
    } },
  { id: "typing", label: "Typewriter", category: "ui", seconds: 1.6, make: (sr) => {
      seed = 10;
      const out = buf(sr, 1.6);
      for (let k = 0; k < 9; k++) {
        const s = Math.round((0.05 + k * 0.17 + rnd() * 0.02) * sr);
        for (let j = 0; j < sr * 0.03; j++) if (s + j < out.length) out[s + j]! += rnd() * env(j / sr, 0.0005, 0.006);
      }
      return stereo(norm(applyBiquad(out, biquad("bandpass", 3500, sr, 1))));
    } },
  { id: "glitch", label: "Glitch", category: "transition", seconds: 0.6, make: (sr) => {
      seed = 11;
      const out = buf(sr, 0.6);
      let hold = 0;
      for (let i = 0; i < out.length; i++) {
        if (i % Math.round(sr / (200 + 1800 * Math.abs(rnd()))) === 0) hold = rnd();
        out[i] = Math.round(hold * 4) / 4 * (Math.sin(i / 300) > -0.3 ? 1 : 0);
      }
      return stereo(norm(out), 15);
    } },
  { id: "boing", label: "Boing", category: "comedy", seconds: 0.9, make: (sr) => stereo(norm(tone(sr, 0.9, (t) => 200 + 150 * Math.sin(t * 40) * Math.exp(-t * 3), (t) => env(t, 0.005, 0.35)))) },
  { id: "slide-whistle", label: "Slide whistle", category: "comedy", seconds: 1, make: (sr) => stereo(norm(tone(sr, 1, (t) => 500 + 1200 * t, (t) => Math.sin(Math.PI * t)))) },
  { id: "fail", label: "Sad trombone", category: "comedy", seconds: 2.2, make: (sr) => {
      const notes = [392, 370, 349, 330];
      return stereo(norm(tone(sr, 2.2, (t) => notes[Math.min(3, Math.floor(t / 0.45))]! * (t > 1.35 ? 1 + 0.03 * Math.sin(t * 40) : 1), (t) => env(t % 0.45, 0.02, 0.4) * (t < 2.1 ? 1 : 0), "saw")));
    } },
  { id: "heartbeat", label: "Heartbeat", category: "ambience", seconds: 1.6, make: (sr) => {
      const beat = (t: number) => (t >= 0 ? Math.sin(2 * Math.PI * 55 * t) * env(t, 0.005, 0.07) : 0);
      const out = buf(sr, 1.6).map((_, i) => { const t = i / sr; return beat(t - 0.05) + beat(t - 0.3) * 0.7 + beat(t - 0.85) + beat(t - 1.1) * 0.7; });
      return stereo(norm(out));
    } },
  { id: "wind", label: "Wind", category: "ambience", seconds: 6, make: (sr) => stereo(sweptNoise(sr, 6, 300, 700, (t) => 0.6 + 0.4 * Math.sin(t * 9)), 200) },
  { id: "rain-amb", label: "Rain", category: "ambience", seconds: 6, make: (sr) => { seed = 13; return stereo(norm(applyBiquad(buf(sr, 6).map(() => rnd() * (Math.abs(rnd()) > 0.995 ? 3 : 0.4)), biquad("highpass", 1500, sr))), 300); } },
];

export const SFX_BY_ID: ReadonlyMap<string, SfxDef> = new Map(SFX.map((s) => [s.id, s]));
