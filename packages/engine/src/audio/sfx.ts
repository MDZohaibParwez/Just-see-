/**
 * Built-in sound effects, synthesised in code. Because we generate them
 * ourselves there is no third-party licence: they are free for any use.
 * The set follows what editors use most today: transitions, impacts, UI,
 * foley, ambience and meme / comedy sounds.
 */
import { applyBiquad, biquad } from "./dsp";

export type SfxCategory = "transition" | "impact" | "ui" | "foley" | "ambience" | "meme";

export interface SfxDef {
  id: string;
  label: string;
  category: SfxCategory;
  seconds: number;
  /** Search words (English + Hindi/Hinglish). */
  tags?: string[];
  make(sr: number): Float32Array[];
}

let seed = 12345;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
const reseed = (s: number) => (seed = s);
const env = (t: number, a: number, d: number) => (t < 0 ? 0 : t < a ? t / a : Math.exp(-(t - a) / d));
const buf = (sr: number, sec: number) => new Float32Array(Math.round(sr * sec));
const norm = (x: Float32Array, peak = 0.89) => {
  let m = 0;
  for (const v of x) m = Math.max(m, Math.abs(v));
  return m > 0 ? x.map((v) => (v / m) * peak) : x;
};
/** Stereo copy with a small delay on the right for width. */
const stereo = (m: Float32Array, widthSamples = 0): Float32Array[] => {
  if (!widthSamples) return [m, new Float32Array(m)];
  const r = new Float32Array(m.length);
  for (let i = 0; i < m.length; i++) r[i] = m[i - widthSamples] ?? 0;
  return [m, r];
};
const lp = (x: Float32Array, f: number, sr: number, q = 0.7) => applyBiquad(x, biquad("lowpass", f, sr, q));
const hp = (x: Float32Array, f: number, sr: number, q = 0.7) => applyBiquad(x, biquad("highpass", f, sr, q));
const bp = (x: Float32Array, f: number, sr: number, q = 1) => applyBiquad(x, biquad("bandpass", f, sr, q));
const noise = (sr: number, sec: number, s: number) => {
  reseed(s);
  return buf(sr, sec).map(() => rnd());
};
const mix = (...xs: Float32Array[]) => {
  const n = Math.max(...xs.map((x) => x.length));
  const out = new Float32Array(n);
  for (const x of xs) for (let i = 0; i < x.length; i++) out[i]! += x[i]!;
  return out;
};
const at = (x: Float32Array, sr: number, sec: number, total: number) => {
  const out = buf(sr, total);
  const o = Math.round(sec * sr);
  for (let i = 0; i < x.length && o + i < out.length; i++) out[o + i] = x[i]!;
  return out;
};
const shape = (x: Float32Array, sr: number, f: (t: number) => number) => x.map((v, i) => v * f(i / sr));

/** Band-swept noise (whooshes, risers). */
function sweptNoise(sr: number, sec: number, f0: number, f1: number, amp: (t: number) => number, s = 999, q = 1.2): Float32Array {
  reseed(s);
  const out = buf(sr, sec);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  let c = biquad("bandpass", f0, sr, q);
  for (let i = 0; i < out.length; i++) {
    const t = i / out.length;
    if (i % 32 === 0) c = biquad("bandpass", f0 * Math.pow(f1 / f0, t), sr, q);
    const n = rnd();
    const y = c.b0 * n + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
    x2 = x1; x1 = n; y2 = y1; y1 = y;
    out[i] = y * amp(t);
  }
  return norm(out);
}

function tone(sr: number, sec: number, freq: (t: number) => number, amp: (t: number) => number, wave: "sine" | "square" | "saw" | "tri" = "sine"): Float32Array {
  const out = buf(sr, sec);
  let ph = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / sr;
    ph += (2 * Math.PI * freq(t)) / sr;
    const f = ph / (2 * Math.PI) - Math.floor(ph / (2 * Math.PI));
    const s = wave === "sine" ? Math.sin(ph) : wave === "square" ? (f < 0.5 ? 1 : -1) : wave === "saw" ? 2 * f - 1 : 1 - 4 * Math.abs(f - 0.5);
    out[i] = s * amp(t);
  }
  return out;
}

/** Metallic bell: inharmonic partials. */
function bell(sr: number, sec: number, f: number, decay = 0.8, ratios = [1, 2.76, 5.4, 8.93]): Float32Array {
  return norm(mix(...ratios.map((r, k) => tone(sr, sec, () => f * r, (t) => env(t, 0.001, decay / (1 + k * 0.7)) / (1 + k)))));
}

/** Short filtered noise burst (clicks, steps, knocks). */
function burst(sr: number, sec: number, s: number, f: number, q: number, decay: number): Float32Array {
  return shape(bp(noise(sr, sec, s), f, sr, q), sr, (t) => env(t, 0.0008, decay));
}

const snare = (sr: number, s: number, vel = 1) => mix(shape(hp(noise(sr, 0.3, s), 1800, sr), sr, (t) => env(t, 0.001, 0.08) * vel * 0.8), tone(sr, 0.3, () => 190, (t) => env(t, 0.001, 0.05) * vel * 0.6));
const cymbal = (sr: number, sec: number, s: number) => shape(hp(noise(sr, sec, s), 6000, sr), sr, (t) => env(t, 0.002, sec / 3) * 0.6);

export const SFX: readonly SfxDef[] = [
  // ---------- Transitions ----------
  { id: "whoosh", label: "Whoosh", category: "transition", seconds: 0.8, tags: ["swoosh", "hawa"], make: (sr) => stereo(sweptNoise(sr, 0.8, 300, 4000, (t) => Math.sin(Math.PI * t) ** 2), 40) },
  { id: "whoosh-fast", label: "Fast whoosh", category: "transition", seconds: 0.4, make: (sr) => stereo(sweptNoise(sr, 0.4, 500, 6000, (t) => Math.sin(Math.PI * t) ** 3, 31), 30) },
  { id: "whoosh-down", label: "Whoosh down", category: "transition", seconds: 0.8, make: (sr) => stereo(sweptNoise(sr, 0.8, 5000, 250, (t) => Math.sin(Math.PI * t) ** 2, 32), 40) },
  { id: "swish", label: "Swish", category: "transition", seconds: 0.35, make: (sr) => stereo(sweptNoise(sr, 0.35, 1500, 7000, (t) => Math.sin(Math.PI * t) ** 3, 33)) },
  { id: "whip", label: "Whip swish", category: "transition", seconds: 0.3, make: (sr) => stereo(norm(mix(sweptNoise(sr, 0.3, 2000, 9000, (t) => t ** 2 * (1 - t) * 6, 34, 2), burst(sr, 0.3, 35, 3000, 1, 0.01).map((v, i) => (i > sr * 0.22 ? v : 0))))) },
  { id: "riser", label: "Riser", category: "transition", seconds: 3, tags: ["build up", "suspense"], make: (sr) => {
      const n = sweptNoise(sr, 3, 200, 8000, (t) => t * t, 36);
      const s = tone(sr, 3, (t) => 110 * Math.pow(2, t * 1.3), (t) => (t / 3) ** 2 * 0.5, "saw");
      return stereo(norm(n.map((v, i) => v * 0.6 + s[i]!)), 60);
    } },
  { id: "riser-long", label: "Long riser", category: "transition", seconds: 6, make: (sr) => {
      const n = sweptNoise(sr, 6, 150, 9000, (t) => t ** 2.5, 37);
      const s = mix(tone(sr, 6, (t) => 80 * Math.pow(2, t * 0.6), (t) => (t / 6) ** 2 * 0.4, "saw"), tone(sr, 6, (t) => 82 * Math.pow(2, t * 0.6), (t) => (t / 6) ** 2 * 0.4, "saw"));
      return stereo(norm(lp(n.map((v, i) => v * 0.5 + s[i]!), 9000, sr)), 80);
    } },
  { id: "downlifter", label: "Downer", category: "transition", seconds: 2, make: (sr) => stereo(sweptNoise(sr, 2, 6000, 120, (t) => (1 - t) ** 2, 38), 60) },
  { id: "reverse-cymbal", label: "Reverse cymbal", category: "transition", seconds: 2, make: (sr) => stereo(norm(shape(hp(noise(sr, 2, 39), 5000, sr), sr, (t) => (t / 2) ** 3)), 50) },
  { id: "sweep-up", label: "Sweep up", category: "transition", seconds: 1.2, make: (sr) => stereo(norm(tone(sr, 1.2, (t) => 200 * Math.pow(30, t / 1.2), (t) => Math.sin((Math.PI * t) / 1.2), "tri"))) },
  { id: "glitch", label: "Glitch", category: "transition", seconds: 0.6, make: (sr) => {
      reseed(11);
      const out = buf(sr, 0.6);
      let hold = 0;
      for (let i = 0; i < out.length; i++) {
        if (i % Math.round(sr / (200 + 1800 * Math.abs(rnd()))) === 0) hold = rnd();
        out[i] = (Math.round(hold * 4) / 4) * (Math.sin(i / 300) > -0.3 ? 1 : 0);
      }
      return stereo(norm(out), 15);
    } },

  // ---------- Impacts ----------
  { id: "boom", label: "Cinematic boom", category: "impact", seconds: 2.5, tags: ["dhamaka", "title"], make: (sr) => {
      const b = tone(sr, 2.5, (t) => 30 + 60 * Math.exp(-t * 6), (t) => env(t, 0.005, 0.6));
      const n = shape(noise(sr, 2.5, 5), sr, (t) => env(t, 0.001, 0.08));
      return stereo(norm(lp(mix(b, n.map((v) => v * 0.4)), 900, sr)), 30);
    } },
  { id: "bass-drop", label: "Bass drop", category: "impact", seconds: 2, make: (sr) => stereo(norm(tone(sr, 2, (t) => 120 * Math.exp(-t * 2.2) + 32, (t) => env(t, 0.01, 0.9)).map((v) => Math.tanh(v * 2)))) },
  { id: "deep-boom", label: "Deep meme boom", category: "impact", seconds: 2.2, tags: ["meme"], make: (sr) => stereo(norm(lp(mix(tone(sr, 2.2, (t) => 55 + 40 * Math.exp(-t * 9), (t) => env(t, 0.003, 0.7)).map((v) => Math.tanh(v * 3)), shape(noise(sr, 2.2, 41), sr, (t) => env(t, 0.001, 0.03)).map((v) => v * 0.5)), 2500, sr))) },
  { id: "hit", label: "Punch hit", category: "impact", seconds: 0.6, make: (sr) => stereo(norm(mix(tone(sr, 0.6, (t) => 60 + 140 * Math.exp(-t * 30), (t) => env(t, 0.002, 0.12)), shape(noise(sr, 0.6, 6), sr, (t) => env(t, 0.001, 0.02)).map((v) => v * 0.6)))) },
  { id: "punch", label: "Punch", category: "impact", seconds: 0.5, tags: ["fight", "maar"], make: (sr) => stereo(norm(mix(tone(sr, 0.5, (t) => 90 * Math.exp(-t * 10) + 40, (t) => env(t, 0.001, 0.08)), lp(shape(noise(sr, 0.5, 42), sr, (t) => env(t, 0.0005, 0.03)), 3000, sr)))) },
  { id: "logo-impact", label: "Logo impact", category: "impact", seconds: 3, make: (sr) => stereo(norm(mix(tone(sr, 3, (t) => 45 + 50 * Math.exp(-t * 8), (t) => env(t, 0.003, 0.8)), bell(sr, 3, 880, 1.6).map((v) => v * 0.25), cymbal(sr, 3, 43).map((v) => v * 0.4))), 40) },
  { id: "stinger", label: "Horror stinger", category: "impact", seconds: 2, tags: ["dar", "shock"], make: (sr) => stereo(norm(mix(...[311, 330, 349, 466].map((f) => tone(sr, 2, () => f, (t) => env(t, 0.005, 0.7) * 0.5, "saw")), shape(noise(sr, 2, 44), sr, (t) => env(t, 0.001, 0.2)).map((v) => v * 0.4))), 30) },
  { id: "dun-dun", label: "Dramatic dun-dun-dun", category: "impact", seconds: 2.6, make: (sr) => {
      const note = (f: number, d: number) => mix(tone(sr, d, () => f, (t) => env(t, 0.02, d / 2), "saw"), tone(sr, d, () => f / 2, (t) => env(t, 0.02, d / 2), "saw"));
      return stereo(norm(lp(mix(at(note(196, 0.35), sr, 0, 2.6), at(note(185, 0.35), sr, 0.4, 2.6), at(note(165, 1.8), sr, 0.8, 2.6)), 2500, sr)), 20);
    } },
  { id: "thud", label: "Body thud", category: "impact", seconds: 0.4, make: (sr) => stereo(norm(lp(mix(tone(sr, 0.4, () => 70, (t) => env(t, 0.002, 0.07)), burst(sr, 0.4, 45, 400, 0.8, 0.04)), 1200, sr))) },
  { id: "kick", label: "Kick", category: "impact", seconds: 0.5, make: (sr) => stereo(norm(tone(sr, 0.5, (t) => 45 + 120 * Math.exp(-t * 35), (t) => env(t, 0.001, 0.15)))) },

  // ---------- UI & tech ----------
  { id: "click", label: "Click", category: "ui", seconds: 0.08, make: (sr) => stereo(norm(tone(sr, 0.08, () => 1800, (t) => env(t, 0.0005, 0.008)))) },
  { id: "mouse-click", label: "Mouse click", category: "ui", seconds: 0.1, make: (sr) => stereo(norm(mix(burst(sr, 0.1, 46, 4000, 3, 0.004), at(burst(sr, 0.05, 47, 3000, 3, 0.003), sr, 0.045, 0.1).map((v) => v * 0.6)))) },
  { id: "pop", label: "Pop", category: "ui", seconds: 0.2, tags: ["meme", "text"], make: (sr) => stereo(norm(tone(sr, 0.2, (t) => 300 + 900 * Math.exp(-t * 40), (t) => env(t, 0.001, 0.04)))) },
  { id: "bubble", label: "Bubble pop", category: "ui", seconds: 0.25, make: (sr) => stereo(norm(tone(sr, 0.25, (t) => 500 + 1500 * t * 4, (t) => env(t, 0.002, 0.05)))) },
  { id: "subscribe-bell", label: "Subscribe bell", category: "ui", seconds: 1.5, tags: ["bell", "ghanti", "notification"], make: (sr) => stereo(bell(sr, 1.5, 1318.5, 0.6), 20) },
  { id: "ding", label: "Ding", category: "ui", seconds: 1.5, make: (sr) => stereo(norm(mix(tone(sr, 1.5, () => 1318.5, (t) => env(t, 0.002, 0.5)), tone(sr, 1.5, () => 2637, (t) => env(t, 0.002, 0.25) * 0.4))), 20) },
  { id: "notification", label: "Notification", category: "ui", seconds: 0.6, make: (sr) => stereo(norm(tone(sr, 0.6, (t) => (t < 0.15 ? 880 : 1320), (t) => env(t % 0.15, 0.002, 0.06) * (t < 0.45 ? 1 : 0)))) },
  { id: "message", label: "Message sent", category: "ui", seconds: 0.4, make: (sr) => stereo(norm(mix(tone(sr, 0.4, (t) => 600 * Math.pow(3, t / 0.25), (t) => env(t, 0.003, 0.08)), sweptNoise(sr, 0.4, 1000, 6000, (t) => (1 - t) * 0.2, 48)))) },
  { id: "success", label: "Success chime", category: "ui", seconds: 1, make: (sr) => stereo(norm(mix(...[523.3, 659.3, 784].map((f, k) => at(tone(sr, 0.7, () => f, (t) => env(t, 0.003, 0.25)), sr, k * 0.09, 1)))), 15) },
  { id: "error", label: "Error buzzer", category: "ui", seconds: 0.6, tags: ["wrong", "galat"], make: (sr) => stereo(norm(lp(tone(sr, 0.6, () => 140, (t) => (t < 0.5 ? 1 : 0) * env(t, 0.005, 1), "square"), 2000, sr))) },
  { id: "beep", label: "Beep", category: "ui", seconds: 0.25, make: (sr) => stereo(norm(tone(sr, 0.25, () => 1000, (t) => (t < 0.2 ? 1 : 0)))) },
  { id: "censor", label: "Censor beep", category: "ui", seconds: 0.6, tags: ["bleep", "gaali"], make: (sr) => stereo(norm(tone(sr, 0.6, () => 1000, (t) => (t > 0.01 && t < 0.59 ? 1 : 0)))) },
  { id: "typing", label: "Keyboard typing", category: "ui", seconds: 1.6, make: (sr) => {
      reseed(10);
      const out = buf(sr, 1.6);
      for (let k = 0; k < 11; k++) {
        const s = Math.round((0.04 + k * 0.14 + rnd() * 0.03) * sr);
        for (let j = 0; j < sr * 0.03; j++) if (s + j < out.length) out[s + j]! += rnd() * env(j / sr, 0.0005, 0.006);
      }
      return stereo(norm(bp(out, 3500, sr, 1)));
    } },
  { id: "camera", label: "Camera shutter", category: "ui", seconds: 0.35, make: (sr) => stereo(norm(bp(shape(noise(sr, 0.35, 9), sr, (t) => env(t, 0.001, 0.01) + (t > 0.12 ? env(t - 0.12, 0.001, 0.015) : 0)), 3000, sr, 0.8))) },
  { id: "coin", label: "Coin", category: "ui", seconds: 0.8, tags: ["paisa"], make: (sr) => stereo(norm(mix(tone(sr, 0.8, () => 988, (t) => (t < 0.08 ? 1 : 0) * env(t, 0.001, 1)), tone(sr, 0.8, () => 1319, (t) => (t >= 0.08 ? env(t - 0.08, 0.001, 0.25) : 0)))), 10) },
  { id: "cash", label: "Cash register ching", category: "ui", seconds: 1.2, tags: ["paisa", "money"], make: (sr) => stereo(norm(mix(burst(sr, 1.2, 49, 2500, 1.5, 0.03), at(bell(sr, 1, 2093, 0.5), sr, 0.08, 1.2))), 15) },
  { id: "swipe", label: "Swipe", category: "ui", seconds: 0.25, make: (sr) => stereo(sweptNoise(sr, 0.25, 3000, 9000, (t) => Math.sin(Math.PI * t), 50, 2)) },

  // ---------- Foley ----------
  { id: "footsteps", label: "Footsteps", category: "foley", seconds: 2.4, tags: ["kadam", "chalna"], make: (sr) => stereo(norm(mix(...[0, 0.55, 1.1, 1.65].map((s, k) => at(mix(lp(burst(sr, 0.25, 51 + k, 200, 0.7, 0.03), 900, sr), burst(sr, 0.25, 61 + k, 2500, 0.8, 0.015).map((v) => v * 0.3)), sr, s, 2.4)))), 10) },
  { id: "cloth", label: "Cloth rustle", category: "foley", seconds: 1.2, tags: ["kapde"], make: (sr) => stereo(norm(shape(bp(noise(sr, 1.2, 52), 2500, sr, 0.5), sr, (t) => Math.abs(Math.sin(t * 9)) * Math.sin((Math.PI * t) / 1.2))), 25) },
  { id: "knock", label: "Door knock", category: "foley", seconds: 1, tags: ["darwaza"], make: (sr) => stereo(norm(mix(...[0, 0.2, 0.4].map((s, k) => at(mix(tone(sr, 0.15, () => 180, (t) => env(t, 0.001, 0.03)), burst(sr, 0.15, 53 + k, 1200, 1, 0.01)), sr, s, 1))))) },
  { id: "door-creak", label: "Door creak", category: "foley", seconds: 1.6, make: (sr) => stereo(norm(bp(tone(sr, 1.6, (t) => 300 + 120 * Math.sin(t * 7) + 40 * Math.sin(t * 53), (t) => Math.sin((Math.PI * t) / 1.6) * (0.6 + 0.4 * Math.abs(Math.sin(t * 31))), "saw"), 900, sr, 2))) },
  { id: "door-close", label: "Door close", category: "foley", seconds: 0.8, make: (sr) => stereo(norm(lp(mix(tone(sr, 0.8, () => 85, (t) => env(t, 0.002, 0.1)), burst(sr, 0.8, 54, 700, 0.6, 0.05), at(burst(sr, 0.2, 55, 3000, 2, 0.01), sr, 0.03, 0.8).map((v) => v * 0.3)), 3000, sr))) },
  { id: "paper-tear", label: "Paper tear", category: "foley", seconds: 0.9, make: (sr) => stereo(norm(shape(hp(noise(sr, 0.9, 56), 1500, sr), sr, (t) => (Math.abs(Math.sin(t * 140)) > 0.4 ? 1 : 0.3) * Math.sin((Math.PI * t) / 0.9)))) },
  { id: "glass-clink", label: "Glass clink", category: "foley", seconds: 1.2, tags: ["cheers"], make: (sr) => stereo(bell(sr, 1.2, 2350, 0.5, [1, 2.32, 4.25, 6.63]), 15) },
  { id: "cup-down", label: "Cup set down", category: "foley", seconds: 0.4, tags: ["chai"], make: (sr) => stereo(norm(mix(burst(sr, 0.4, 57, 1800, 2, 0.02), bell(sr, 0.4, 1600, 0.08).map((v) => v * 0.3)))) },
  { id: "water-drop", label: "Water drop", category: "foley", seconds: 0.4, make: (sr) => stereo(norm(tone(sr, 0.4, (t) => 900 + 1400 * Math.min(1, t * 25), (t) => env(t, 0.001, 0.05)))) },
  { id: "keys", label: "Keys jingle", category: "foley", seconds: 1, make: (sr) => { reseed(58); return stereo(norm(mix(...Array.from({ length: 14 }, (_, k) => at(bell(sr, 0.25, 3000 + Math.abs(rnd()) * 3000, 0.06), sr, Math.abs(rnd()) * 0.75, 1)))), 15); } },
  { id: "heartbeat", label: "Heartbeat", category: "foley", seconds: 1.6, make: (sr) => {
      const beat = (t: number) => (t >= 0 ? Math.sin(2 * Math.PI * 55 * t) * env(t, 0.005, 0.07) : 0);
      return stereo(norm(buf(sr, 1.6).map((_, i) => { const t = i / sr; return beat(t - 0.05) + beat(t - 0.3) * 0.7 + beat(t - 0.85) + beat(t - 1.1) * 0.7; })));
    } },

  // ---------- Ambience / room tone ----------
  { id: "wind", label: "Wind", category: "ambience", seconds: 8, tags: ["hawa"], make: (sr) => stereo(sweptNoise(sr, 8, 300, 700, (t) => 0.6 + 0.4 * Math.sin(t * 9), 59), 200) },
  { id: "rain", label: "Rain", category: "ambience", seconds: 8, tags: ["barish"], make: (sr) => { reseed(13); return stereo(norm(hp(buf(sr, 8).map(() => rnd() * (Math.abs(rnd()) > 0.995 ? 3 : 0.4)), 1500, sr)), 300); } },
  { id: "thunder", label: "Thunder", category: "ambience", seconds: 5, tags: ["bijli"], make: (sr) => stereo(norm(lp(shape(noise(sr, 5, 60), sr, (t) => env(t, 0.02, 1.2) * (0.6 + 0.4 * Math.sin(t * 13))), 400, sr)), 150) },
  { id: "birds", label: "Birds chirping", category: "ambience", seconds: 8, tags: ["chidiya", "nature"], make: (sr) => {
      reseed(61);
      const parts: Float32Array[] = [shape(lp(noise(sr, 8, 62), 300, sr), sr, () => 0.05)];
      for (let k = 0; k < 18; k++) {
        const f0 = 2500 + Math.abs(rnd()) * 2500;
        const chirp = tone(sr, 0.18, (t) => f0 + 1500 * Math.sin(t * 60), (t) => Math.sin((Math.PI * t) / 0.18), "sine");
        parts.push(at(chirp.map((v) => v * 0.4), sr, Math.abs(rnd()) * 7.7, 8));
      }
      return stereo(norm(mix(...parts), 0.7), 120);
    } },
  { id: "crickets", label: "Night crickets", category: "ambience", seconds: 6, make: (sr) => stereo(norm(tone(sr, 6, () => 4400, (t) => (Math.sin(t * 2 * Math.PI * 30) > 0 ? 1 : 0) * (Math.sin(t * 2 * Math.PI * 0.8) > 0 ? 1 : 0) * 0.5)), 90) },
  { id: "city", label: "City traffic", category: "ambience", seconds: 8, tags: ["shehar", "traffic"], make: (sr) => {
      reseed(63);
      let b = 0;
      const brown = buf(sr, 8).map(() => (b = (b + rnd() * 0.02) * 0.998));
      const horn = at(lp(tone(sr, 0.5, () => 415, (t) => (t < 0.45 ? 0.15 : 0), "square"), 1500, sr), sr, 5.2, 8);
      return stereo(norm(mix(lp(brown, 500, sr), horn), 0.7), 250);
    } },
  { id: "cafe", label: "Cafe crowd murmur", category: "ambience", seconds: 8, tags: ["bheed", "walla", "restaurant"], make: (sr) => {
      // Many soft "voices": noise through moving vowel formants.
      const voices = Array.from({ length: 10 }, (_, k) => {
        const nz = noise(sr, 8, 70 + k);
        const f1 = 400 + 300 * Math.sin(k);
        return shape(mix(bp(nz, f1, sr, 4), bp(nz, f1 * 2.6, sr, 5)), sr, (t) => Math.max(0, Math.sin(t * (2 + k * 0.37) + k)) ** 2);
      });
      return stereo(norm(mix(...voices, cymbalTick(sr)), 0.6), 180);
    } },
  { id: "room-tone", label: "Room tone", category: "ambience", seconds: 8, tags: ["sannata", "silence"], make: (sr) => stereo(lp(noise(sr, 8, 80), 900, sr).map((v) => v * 0.02), 300) },
  { id: "ocean", label: "Ocean waves", category: "ambience", seconds: 8, tags: ["samundar", "lehren"], make: (sr) => stereo(norm(lp(shape(noise(sr, 8, 81), sr, (t) => 0.25 + 0.75 * Math.sin((t / 8) * Math.PI * 2 * 1.2) ** 2), 1800, sr)), 220) },
  { id: "fire", label: "Fire crackle", category: "ambience", seconds: 6, make: (sr) => { reseed(82); return stereo(norm(mix(lp(noise(sr, 6, 83), 400, sr).map((v) => v * 0.3), hp(buf(sr, 6).map(() => (Math.abs(rnd()) > 0.9993 ? rnd() * 3 : 0)), 2000, sr))), 60); } },

  // ---------- Meme & comedy ----------
  { id: "record-scratch", label: "Record scratch", category: "meme", seconds: 0.7, tags: ["ruk", "stop"], make: (sr) => stereo(norm(bp(shape(noise(sr, 0.7, 84), sr, (t) => Math.abs(Math.sin(t * 22)) * env(t, 0.005, 0.25)), 1800, sr, 0.9).map((v, i) => v * (1 + 0.6 * Math.sin((i / sr) * 2 * Math.PI * 30))))) },
  { id: "awkward-crickets", label: "Awkward crickets", category: "meme", seconds: 3, tags: ["silence", "khamoshi"], make: (sr) => stereo(norm(tone(sr, 3, () => 4600, (t) => (Math.sin(t * 2 * Math.PI * 28) > 0 ? 1 : 0) * ((t % 1) < 0.35 ? 1 : 0) * 0.6))) },
  { id: "drum-roll", label: "Drum roll", category: "meme", seconds: 2.5, tags: ["announcement"], make: (sr) => stereo(norm(mix(...Array.from({ length: 40 }, (_, k) => at(snare(sr, 90 + k, 0.5 + (k / 40) * 0.5), sr, k * 0.055, 2.5)), at(cymbal(sr, 0.6, 140), sr, 2.25, 2.5).map((v) => v * 2))), 15) },
  { id: "ba-dum-tss", label: "Ba-dum-tss", category: "meme", seconds: 1.6, tags: ["joke", "rimshot"], make: (sr) => stereo(norm(mix(at(snare(sr, 150), sr, 0, 1.6), at(tone(sr, 0.3, () => 120, (t) => env(t, 0.001, 0.1)), sr, 0.2, 1.6), at(cymbal(sr, 1.2, 151), sr, 0.35, 1.6).map((v) => v * 1.5))), 15) },
  { id: "boing", label: "Boing", category: "meme", seconds: 0.9, make: (sr) => stereo(norm(tone(sr, 0.9, (t) => 200 + 150 * Math.sin(t * 40) * Math.exp(-t * 3), (t) => env(t, 0.005, 0.35)))) },
  { id: "slide-whistle", label: "Slide whistle", category: "meme", seconds: 1, make: (sr) => stereo(norm(tone(sr, 1, (t) => 500 + 1200 * t, (t) => Math.sin(Math.PI * t)))) },
  { id: "slide-down", label: "Falling whistle", category: "meme", seconds: 1.4, make: (sr) => stereo(norm(tone(sr, 1.4, (t) => 1800 - 1200 * (t / 1.4), (t) => Math.sin((Math.PI * t) / 1.4)))) },
  { id: "fail", label: "Sad trombone", category: "meme", seconds: 2.2, tags: ["fail"], make: (sr) => {
      const notes = [392, 370, 349, 330];
      return stereo(norm(tone(sr, 2.2, (t) => notes[Math.min(3, Math.floor(t / 0.45))]! * (t > 1.35 ? 1 + 0.03 * Math.sin(t * 40) : 1), (t) => env(t % 0.45, 0.02, 0.4) * (t < 2.1 ? 1 : 0), "saw")));
    } },
  { id: "air-horn", label: "Air horn", category: "meme", seconds: 1.4, tags: ["party", "hype"], make: (sr) => stereo(norm(lp(mix(...[440, 554, 659].map((f) => tone(sr, 1.4, () => f, (t) => ((t % 0.35) < 0.28 ? 1 : 0) * (t < 1.3 ? 1 : 0), "saw"))), 3000, sr))) },
  { id: "applause", label: "Applause", category: "meme", seconds: 4, tags: ["taali", "clap"], make: (sr) => { reseed(152); return stereo(norm(bp(shape(buf(sr, 4).map(() => (Math.abs(rnd()) > 0.97 ? rnd() : rnd() * 0.15)), sr, (t) => Math.min(1, t * 3) * Math.min(1, (4 - t) * 1.5)), 1500, sr, 0.5)), 200); } },
  { id: "xylo-up", label: "Xylophone up", category: "meme", seconds: 1, make: (sr) => stereo(norm(mix(...[523, 587, 659, 784, 880, 1047].map((f, k) => at(bell(sr, 0.4, f, 0.15, [1, 3.9]), sr, k * 0.08, 1))))) },
  { id: "xylo-down", label: "Xylophone down", category: "meme", seconds: 1, make: (sr) => stereo(norm(mix(...[1047, 880, 784, 659, 587, 523].map((f, k) => at(bell(sr, 0.4, f, 0.15, [1, 3.9]), sr, k * 0.08, 1))))) },
  { id: "magic", label: "Magic sparkle", category: "meme", seconds: 1.5, tags: ["jaadu"], make: (sr) => { reseed(153); return stereo(norm(mix(...Array.from({ length: 16 }, (_, k) => at(bell(sr, 0.4, 2000 + k * 180 + Math.abs(rnd()) * 300, 0.12), sr, k * 0.06, 1.5)))), 25); } },
];

function cymbalTick(sr: number): Float32Array {
  // Occasional cutlery clinks in the cafe.
  reseed(90);
  return mix(...Array.from({ length: 5 }, () => at(bell(sr, 0.3, 2800 + Math.abs(rnd()) * 1500, 0.05).map((v) => v * 0.15), sr, Math.abs(rnd()) * 7.5, 8)));
}

export const SFX_BY_ID: ReadonlyMap<string, SfxDef> = new Map(SFX.map((s) => [s.id, s]));
export const SFX_CATEGORIES: readonly SfxCategory[] = ["transition", "impact", "ui", "foley", "ambience", "meme"];
