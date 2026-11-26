/**
 * Offline audio DSP in TypeScript: filters, dynamics, loudness, repair and
 * creative effects. All functions take planar Float32 channels and return new
 * arrays (inputs are never modified). Heavy spectral work lives in Rust/WASM
 * (see wasm.ts).
 */

export type Channels = Float32Array[];

const clone = (ch: Channels): Channels => ch.map((c) => new Float32Array(c));

// ---------- Biquad filters (RBJ cookbook formulas) ----------

export type BiquadType = "lowpass" | "highpass" | "bandpass" | "notch" | "peaking" | "lowshelf" | "highshelf";

export interface BiquadCoefs {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

export function biquad(type: BiquadType, freq: number, sampleRate: number, q = 0.707, gainDb = 0): BiquadCoefs {
  const w = (2 * Math.PI * Math.min(freq, sampleRate * 0.49)) / sampleRate;
  const cos = Math.cos(w);
  const sin = Math.sin(w);
  const alpha = sin / (2 * q);
  const A = Math.pow(10, gainDb / 40);
  let b0 = 1, b1 = 0, b2 = 0, a0 = 1, a1 = 0, a2 = 0;
  switch (type) {
    case "lowpass":
      b0 = (1 - cos) / 2; b1 = 1 - cos; b2 = (1 - cos) / 2; a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha;
      break;
    case "highpass":
      b0 = (1 + cos) / 2; b1 = -(1 + cos); b2 = (1 + cos) / 2; a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha;
      break;
    case "bandpass":
      b0 = alpha; b1 = 0; b2 = -alpha; a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha;
      break;
    case "notch":
      b0 = 1; b1 = -2 * cos; b2 = 1; a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha;
      break;
    case "peaking":
      b0 = 1 + alpha * A; b1 = -2 * cos; b2 = 1 - alpha * A; a0 = 1 + alpha / A; a1 = -2 * cos; a2 = 1 - alpha / A;
      break;
    case "lowshelf": {
      const s = 2 * Math.sqrt(A) * alpha;
      b0 = A * (A + 1 - (A - 1) * cos + s); b1 = 2 * A * (A - 1 - (A + 1) * cos); b2 = A * (A + 1 - (A - 1) * cos - s);
      a0 = A + 1 + (A - 1) * cos + s; a1 = -2 * (A - 1 + (A + 1) * cos); a2 = A + 1 + (A - 1) * cos - s;
      break;
    }
    case "highshelf": {
      const s = 2 * Math.sqrt(A) * alpha;
      b0 = A * (A + 1 + (A - 1) * cos + s); b1 = -2 * A * (A - 1 + (A + 1) * cos); b2 = A * (A + 1 + (A - 1) * cos - s);
      a0 = A + 1 - (A - 1) * cos + s; a1 = 2 * (A - 1 - (A + 1) * cos); a2 = A + 1 - (A - 1) * cos - s;
      break;
    }
  }
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

export function applyBiquad(x: Float32Array, c: BiquadCoefs): Float32Array {
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = x[i]!;
    const o = c.b0 * v + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
    x2 = x1; x1 = v; y2 = y1; y1 = o;
    y[i] = o;
  }
  return y;
}

export function filter(ch: Channels, sampleRate: number, type: BiquadType, freq: number, q = 0.707, gainDb = 0): Channels {
  const c = biquad(type, freq, sampleRate, q, gainDb);
  return ch.map((x) => applyBiquad(x, c));
}

export interface EqBand {
  type: BiquadType;
  freq: number;
  q: number;
  gainDb: number;
}

export function eq(ch: Channels, sampleRate: number, bands: readonly EqBand[]): Channels {
  let out = ch;
  for (const b of bands) out = filter(out, sampleRate, b.type, b.freq, b.q, b.gainDb);
  return out;
}

// ---------- Loudness (ITU-R BS.1770-4 / EBU R128) ----------

/** Integrated loudness in LUFS with absolute (-70) and relative (-10 LU) gating. */
export function integratedLufs(ch: Channels, sampleRate: number): number {
  // K-weighting: high shelf +4 dB @ ~1.68 kHz, then high-pass @ ~38 Hz.
  const shelf = biquad("highshelf", 1681.97, sampleRate, 0.7071, 4.0);
  const hp = biquad("highpass", 38.135, sampleRate, 0.5);
  const weighted = ch.slice(0, 2).map((x) => applyBiquad(applyBiquad(x, shelf), hp));
  const block = Math.round(sampleRate * 0.4);
  const step = Math.round(sampleRate * 0.1);
  const len = weighted[0]?.length ?? 0;
  const powers: number[] = [];
  for (let s = 0; s + block <= len; s += step) {
    let sum = 0;
    for (const w of weighted) {
      let acc = 0;
      for (let i = s; i < s + block; i++) acc += w[i]! * w[i]!;
      sum += acc / block;
    }
    powers.push(sum);
  }
  if (!powers.length) return -Infinity;
  const lufs = (p: number) => -0.691 + 10 * Math.log10(p + 1e-20);
  const abs = powers.filter((p) => lufs(p) > -70);
  if (!abs.length) return -Infinity;
  const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
  const rel = lufs(mean(abs)) - 10;
  const gated = abs.filter((p) => lufs(p) > rel);
  return gated.length ? lufs(mean(gated)) : -Infinity;
}

/** True peak in dBTP using 4× oversampling (linear interpolation of a windowed sinc). */
export function truePeakDb(ch: Channels): number {
  let peak = 0;
  for (const x of ch) {
    for (let i = 0; i < x.length; i++) {
      const v = Math.abs(x[i]!);
      if (v > peak) peak = v;
      // Inter-sample estimate between neighbours (cheap 4× check).
      const n = x[i + 1];
      if (n !== undefined) {
        for (let k = 1; k < 4; k++) {
          const t = k / 4;
          const p0 = x[i - 1] ?? x[i]!;
          const p3 = x[i + 2] ?? n;
          // Catmull-Rom.
          const a = -0.5 * p0 + 1.5 * x[i]! - 1.5 * n + 0.5 * p3;
          const b = p0 - 2.5 * x[i]! + 2 * n - 0.5 * p3;
          const c = -0.5 * p0 + 0.5 * n;
          const s = Math.abs(((a * t + b) * t + c) * t + x[i]!);
          if (s > peak) peak = s;
        }
      }
    }
  }
  return 20 * Math.log10(peak + 1e-12);
}

export function gainDb(ch: Channels, db: number): Channels {
  const g = Math.pow(10, db / 20);
  return ch.map((x) => x.map((v) => v * g));
}

// ---------- Dynamics ----------

export interface CompressorOpts {
  thresholdDb: number;
  ratio: number;
  attackMs: number;
  releaseMs: number;
  kneeDb?: number;
  makeupDb?: number;
}

/** Feed-forward RMS-ish compressor, stereo-linked. */
export function compress(ch: Channels, sampleRate: number, o: CompressorOpts): Channels {
  const out = clone(ch);
  const len = ch[0]?.length ?? 0;
  const att = Math.exp(-1 / ((o.attackMs / 1000) * sampleRate));
  const rel = Math.exp(-1 / ((o.releaseMs / 1000) * sampleRate));
  const knee = o.kneeDb ?? 6;
  const makeup = Math.pow(10, (o.makeupDb ?? 0) / 20);
  let env = 0;
  for (let i = 0; i < len; i++) {
    let lvl = 0;
    for (const x of ch) lvl = Math.max(lvl, Math.abs(x[i]!));
    env = lvl > env ? att * env + (1 - att) * lvl : rel * env + (1 - rel) * lvl;
    const db = 20 * Math.log10(env + 1e-9);
    const over = db - o.thresholdDb;
    let red = 0;
    if (over > knee / 2) red = over - over / o.ratio;
    else if (over > -knee / 2) red = ((1 / o.ratio - 1) * Math.pow(over + knee / 2, 2)) / (2 * knee) * -1;
    const g = Math.pow(10, -red / 20) * makeup;
    for (const y of out) y[i]! *= g;
  }
  return out;
}

/** Look-ahead brick-wall limiter at `ceilingDb` (true-peak safe with margin). */
/** 4x oversampling taps (windowed sinc, 8 taps) for phases 1/4, 2/4, 3/4. */
const TP_TAPS: Float32Array[] = [0.25, 0.5, 0.75].map((f) => {
  const t = new Float32Array(8);
  for (let k = 0; k < 8; k++) {
    const x = k - 3 - f;
    const w = 0.5 + 0.5 * Math.cos((Math.PI * x) / 4.5);
    t[k] = (x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x)) * w;
  }
  return t;
});

/** Largest reconstructed value between sample i and i+1 (true-peak estimate). */
function interSamplePeak(x: Float32Array, i: number): number {
  let m = 0;
  for (const taps of TP_TAPS) {
    let v = 0;
    for (let k = 0; k < 8; k++) v += (x[i - 3 + k] ?? 0) * taps[k]!;
    if (Math.abs(v) > m) m = Math.abs(v);
  }
  return m;
}

export function limit(ch: Channels, sampleRate: number, ceilingDb = -1, releaseMs = 80): Channels {
  const ceiling = Math.pow(10, (ceilingDb - 0.3) / 20);
  const len = ch[0]?.length ?? 0;
  const look = Math.max(1, Math.round(sampleRate * 0.005));
  const rel = Math.exp(-1 / ((releaseMs / 1000) * sampleRate));
  // Required gain per sample, then min over the look-ahead window.
  const need = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    let p = 0;
    for (const x of ch) p = Math.max(p, Math.abs(x[i]!), interSamplePeak(x, i));
    need[i] = p > ceiling ? ceiling / p : 1;
  }
  const out = ch.map(() => new Float32Array(len));
  let g = 1;
  for (let i = 0; i < len; i++) {
    // Smallest gain needed in the look-ahead window (includes this sample).
    let m = 1;
    const end = Math.min(len, i + look);
    for (let k = i; k < end; k++) if (need[k]! < m) m = need[k]!;
    g = m < g ? m : rel * g + (1 - rel) * m;
    for (let c = 0; c < ch.length; c++) out[c]![i] = ch[c]![i]! * g;
  }
  return out;
}

export interface GateOpts {
  thresholdDb: number;
  attackMs?: number;
  releaseMs?: number;
  floorDb?: number;
}

export function gate(ch: Channels, sampleRate: number, o: GateOpts): Channels {
  const len = ch[0]?.length ?? 0;
  const thr = Math.pow(10, o.thresholdDb / 20);
  const floor = Math.pow(10, (o.floorDb ?? -40) / 20);
  const att = Math.exp(-1 / (((o.attackMs ?? 2) / 1000) * sampleRate));
  const rel = Math.exp(-1 / (((o.releaseMs ?? 120) / 1000) * sampleRate));
  const out = clone(ch);
  let env = 0;
  let g = floor;
  for (let i = 0; i < len; i++) {
    let lvl = 0;
    for (const x of ch) lvl = Math.max(lvl, Math.abs(x[i]!));
    env = Math.max(lvl, env * 0.9995);
    const target = env > thr ? 1 : floor;
    g = target > g ? att * g + (1 - att) * target : rel * g + (1 - rel) * target;
    for (const y of out) y[i]! *= g;
  }
  return out;
}

/** Normalise integrated loudness to `targetLufs`, then true-peak limit. */
export function normalizeLoudness(ch: Channels, sampleRate: number, targetLufs = -14, ceilingDb = -1): Channels {
  const now = integratedLufs(ch, sampleRate);
  if (!Number.isFinite(now)) return clone(ch);
  // Limiting removes a little level; iterate twice to land on target.
  let out = limit(gainDb(ch, targetLufs - now), sampleRate, ceilingDb);
  const after = integratedLufs(out, sampleRate);
  if (Number.isFinite(after) && Math.abs(after - targetLufs) > 0.2) out = limit(gainDb(out, targetLufs - after), sampleRate, ceilingDb);
  return out;
}

// ---------- Repair ----------

/** Remove mains hum: notches at the fundamental and harmonics. */
export function deHum(ch: Channels, sampleRate: number, mains: 50 | 60 = 50, harmonics = 8): Channels {
  let out = ch;
  for (let h = 1; h <= harmonics; h++) {
    const f = mains * h;
    if (f > sampleRate / 2.2) break;
    out = filter(out, sampleRate, "notch", f, 30);
  }
  return out;
}

/** Detect the hum frequency (50 or 60 Hz) by comparing narrow-band energy. */
export function detectMains(mono: Float32Array, sampleRate: number): 50 | 60 {
  const energy = (f: number) => {
    const y = applyBiquad(mono, biquad("bandpass", f, sampleRate, 30));
    let s = 0;
    for (const v of y) s += v * v;
    return s;
  };
  return energy(60) + energy(120) > energy(50) + energy(100) ? 60 : 50;
}

/** Find clicks (sudden spikes) and repair them by cubic interpolation. */
export function deClick(ch: Channels, sensitivity = 0.5): Channels {
  const out = clone(ch);
  const k = 8 - sensitivity * 5;
  for (const x of out) {
    const n = x.length;
    // Second difference highlights impulses.
    const d = new Float32Array(n);
    for (let i = 1; i < n - 1; i++) d[i] = Math.abs(x[i - 1]! - 2 * x[i]! + x[i + 1]!);
    const win = 1024;
    for (let s = 0; s < n; s += win) {
      const e = Math.min(n, s + win);
      let mean = 0;
      for (let i = s; i < e; i++) mean += d[i]!;
      mean /= e - s;
      for (let i = s + 2; i < e - 2; i++) {
        if (d[i]! > mean * k && d[i]! > 0.05) {
          // Repair a short span with a smooth curve between good neighbours.
          const a = Math.max(1, i - 3);
          const b = Math.min(n - 2, i + 3);
          const x0 = x[a - 1]!, x1 = x[b + 1]!;
          for (let j = a; j <= b; j++) {
            const t = (j - a + 1) / (b - a + 2);
            const tt = t * t * (3 - 2 * t);
            x[j] = x0 + (x1 - x0) * tt;
          }
          i = b;
        }
      }
    }
  }
  return out;
}

/** De-esser: compress only the sibilance band (5–9 kHz). */
export function deEss(ch: Channels, sampleRate: number, amount = 0.5): Channels {
  const band = filter(filter(ch, sampleRate, "highpass", 5000, 0.7), sampleRate, "lowpass", 9500, 0.7);
  const len = ch[0]?.length ?? 0;
  const out = clone(ch);
  const thr = Math.pow(10, (-30 + (1 - amount) * 12) / 20);
  const att = Math.exp(-1 / (0.001 * sampleRate));
  const rel = Math.exp(-1 / (0.06 * sampleRate));
  let env = 0;
  for (let i = 0; i < len; i++) {
    let lvl = 0;
    for (const b of band) lvl = Math.max(lvl, Math.abs(b[i]!));
    env = lvl > env ? att * env + (1 - att) * lvl : rel * env + (1 - rel) * lvl;
    const over = env / thr;
    const red = over > 1 ? 1 - Math.min(0.85, (1 - 1 / over) * (0.5 + amount)) : 1;
    // Subtract part of the sibilant band rather than ducking everything.
    for (let c = 0; c < out.length; c++) out[c]![i] = out[c]![i]! - band[c]![i]! * (1 - red);
  }
  return out;
}

/** Light de-reverb: expand quiet tails after transients (envelope expander). */
export function deReverb(ch: Channels, sampleRate: number, amount = 0.5): Channels {
  const len = ch[0]?.length ?? 0;
  const out = clone(ch);
  const fast = Math.exp(-1 / (0.005 * sampleRate));
  const slow = Math.exp(-1 / (0.25 * sampleRate));
  let ef = 0;
  let es = 0;
  for (let i = 0; i < len; i++) {
    let lvl = 0;
    for (const x of ch) lvl = Math.max(lvl, Math.abs(x[i]!));
    ef = fast * ef + (1 - fast) * lvl;
    es = Math.max(ef, slow * es + (1 - slow) * lvl);
    // Where the fast envelope sits well below the slow one we are in a tail.
    const ratio = es > 1e-6 ? ef / es : 1;
    const g = Math.pow(Math.min(1, ratio * 1.6), amount * 1.5);
    for (const y of out) y[i]! *= g;
  }
  return out;
}

// ---------- Creative effects ----------

/** Feedback delay with optional ping-pong. */
export function delay(ch: Channels, sampleRate: number, timeMs = 300, feedback = 0.35, mix = 0.3, pingPong = true): Channels {
  const d = Math.max(1, Math.round((timeMs / 1000) * sampleRate));
  const len = ch[0]?.length ?? 0;
  const L = ch[0]!;
  const R = ch[1] ?? L;
  const bl = new Float32Array(d);
  const br = new Float32Array(d);
  const ol = new Float32Array(len);
  const or = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    const k = i % d;
    const dl = bl[k]!;
    const dr = br[k]!;
    ol[i] = L[i]! * (1 - mix) + dl * mix;
    or[i] = R[i]! * (1 - mix) + dr * mix;
    if (pingPong) {
      bl[k] = R[i]! * 0.5 + dr * feedback;
      br[k] = L[i]! * 0.5 + dl * feedback;
    } else {
      bl[k] = L[i]! + dl * feedback;
      br[k] = R[i]! + dr * feedback;
    }
  }
  return [ol, or];
}

/** Algorithmic reverb: 8 parallel combs + 4 allpasses per channel (Schroeder/Moorer style). */
export function reverb(ch: Channels, sampleRate: number, size = 0.6, damping = 0.4, mix = 0.25): Channels {
  const scale = sampleRate / 44100;
  const combs = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
  const alls = [556, 441, 341, 225];
  const fb = 0.7 + size * 0.28;
  const len = ch[0]?.length ?? 0;
  const tail = Math.round(sampleRate * (0.5 + size * 2));
  const inputs = [ch[0]!, ch[1] ?? ch[0]!];
  return inputs.map((x, c) => {
    const spread = c * 23;
    const out = new Float32Array(len);
    const cb = combs.map((n) => ({ buf: new Float32Array(Math.round((n + spread) * scale)), i: 0, f: 0 }));
    const ab = alls.map((n) => ({ buf: new Float32Array(Math.round((n + spread) * scale)), i: 0 }));
    for (let n = 0; n < len + tail && n < len; n++) {
      const inp = (x[n] ?? 0) * 0.015;
      let wet = 0;
      for (const cmb of cb) {
        const y = cmb.buf[cmb.i]!;
        cmb.f = y * (1 - damping) + cmb.f * damping;
        cmb.buf[cmb.i] = inp + cmb.f * fb;
        cmb.i = (cmb.i + 1) % cmb.buf.length;
        wet += y;
      }
      for (const ap of ab) {
        const b = ap.buf[ap.i]!;
        const o = -wet + b;
        ap.buf[ap.i] = wet + b * 0.5;
        ap.i = (ap.i + 1) % ap.buf.length;
        wet = o;
      }
      out[n] = (x[n] ?? 0) * (1 - mix) + wet * mix * 3;
    }
    return out;
  });
}

/** Chorus / flanger: modulated short delay. */
export function chorus(ch: Channels, sampleRate: number, rateHz = 0.8, depthMs = 3, baseMs = 15, mix = 0.4, feedback = 0): Channels {
  const len = ch[0]?.length ?? 0;
  const maxD = Math.ceil(((baseMs + depthMs) / 1000) * sampleRate) + 2;
  return ch.map((x, c) => {
    const buf = new Float32Array(maxD);
    const out = new Float32Array(len);
    const phase = c * Math.PI * 0.5;
    for (let i = 0; i < len; i++) {
      const d = ((baseMs + depthMs * (0.5 + 0.5 * Math.sin((2 * Math.PI * rateHz * i) / sampleRate + phase))) / 1000) * sampleRate;
      const w = i % maxD;
      const rp = (w - d + maxD * 2) % maxD;
      const a = Math.floor(rp);
      const f = rp - a;
      const y = buf[a % maxD]! * (1 - f) + buf[(a + 1) % maxD]! * f;
      buf[w] = x[i]! + y * feedback;
      out[i] = x[i]! * (1 - mix) + y * mix;
    }
    return out;
  });
}

/** Phaser: 6 modulated first-order allpasses. */
export function phaser(ch: Channels, sampleRate: number, rateHz = 0.5, depth = 0.7, mix = 0.5): Channels {
  const len = ch[0]?.length ?? 0;
  return ch.map((x) => {
    const out = new Float32Array(len);
    const z = new Float32Array(6);
    let fbk = 0;
    for (let i = 0; i < len; i++) {
      const lfo = 0.5 + 0.5 * Math.sin((2 * Math.PI * rateHz * i) / sampleRate);
      const f = 300 + lfo * depth * 3000;
      const a = (1 - Math.tan((Math.PI * f) / sampleRate)) / (1 + Math.tan((Math.PI * f) / sampleRate));
      let v = x[i]! + fbk * 0.5;
      for (let k = 0; k < 6; k++) {
        const y = -a * v + z[k]!;
        z[k] = v + a * y;
        v = y;
      }
      fbk = v;
      out[i] = x[i]! * (1 - mix) + v * mix;
    }
    return out;
  });
}

export function saturate(ch: Channels, drive = 0.5, mix = 1): Channels {
  const k = 1 + drive * 10;
  const norm = Math.tanh(k);
  return ch.map((x) => x.map((v) => v * (1 - mix) + (Math.tanh(v * k) / norm) * mix));
}

export function bitcrush(ch: Channels, bits = 8, downsample = 4): Channels {
  const levels = Math.pow(2, bits - 1);
  return ch.map((x) => {
    const out = new Float32Array(x.length);
    let hold = 0;
    for (let i = 0; i < x.length; i++) {
      if (i % Math.max(1, Math.round(downsample)) === 0) hold = Math.round(x[i]! * levels) / levels;
      out[i] = hold;
    }
    return out;
  });
}

/** Stereo width via mid/side. 0 = mono, 1 = unchanged, 2 = wide. */
export function stereoWidth(ch: Channels, width = 1.5): Channels {
  const L = ch[0]!;
  const R = ch[1] ?? L;
  const ol = new Float32Array(L.length);
  const or = new Float32Array(L.length);
  for (let i = 0; i < L.length; i++) {
    const m = (L[i]! + R[i]!) / 2;
    const s = ((L[i]! - R[i]!) / 2) * width;
    ol[i] = m + s;
    or[i] = m - s;
  }
  return [ol, or];
}

/** Telephone / radio voice. */
export function telephone(ch: Channels, sampleRate: number): Channels {
  return saturate(filter(filter(ch, sampleRate, "highpass", 400, 0.9), sampleRate, "lowpass", 3200, 0.9), 0.3);
}

export function rms(x: Float32Array, from = 0, to = x.length): number {
  let s = 0;
  for (let i = from; i < to; i++) s += x[i]! * x[i]!;
  return Math.sqrt(s / Math.max(1, to - from));
}
