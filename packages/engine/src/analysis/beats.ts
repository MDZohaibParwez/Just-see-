/**
 * Beat and silence analysis on mono PCM. Pure JS so it runs in a worker, in
 * the browser or in tests.
 */

export interface BeatAnalysis {
  bpm: number;
  /** Beat times in µs from the start of the PCM. */
  beatsUs: number[];
  /** Detected onsets (hits) in µs. */
  onsetsUs: number[];
}

/** Mix planar channels to mono. */
export function toMono(channels: readonly Float32Array[]): Float32Array {
  const first = channels[0];
  if (!first) return new Float32Array(0);
  if (channels.length === 1) return first;
  const out = new Float32Array(first.length);
  for (const ch of channels) for (let i = 0; i < out.length; i++) out[i]! += (ch[i] ?? 0) / channels.length;
  return out;
}

/** Onset strength envelope: positive change in log energy per hop. */
export function onsetEnvelope(mono: Float32Array, sampleRate: number, hopSec = 0.01): Float32Array {
  const hop = Math.max(1, Math.round(sampleRate * hopSec));
  const win = hop * 2;
  const n = Math.max(0, Math.floor((mono.length - win) / hop));
  const env = new Float32Array(n);
  let prev = 0;
  for (let i = 0; i < n; i++) {
    let e = 0;
    let last = 0;
    const off = i * hop;
    for (let j = 0; j < win; j++) {
      // First difference = cheap high-pass, so bass rumble does not dominate.
      const x = mono[off + j]!;
      const d = x - last;
      last = x;
      e += d * d;
    }
    const le = Math.log1p(e * 1000);
    env[i] = Math.max(0, le - prev);
    prev = le;
  }
  return env;
}

function pickPeaks(env: Float32Array, hopSec: number): number[] {
  const radius = Math.max(1, Math.round(0.05 / hopSec));
  const ctx = Math.max(1, Math.round(0.5 / hopSec));
  const peaks: number[] = [];
  // Running mean for an adaptive threshold.
  const prefix = new Float64Array(env.length + 1);
  for (let i = 0; i < env.length; i++) prefix[i + 1] = prefix[i]! + env[i]!;
  for (let i = 0; i < env.length; i++) {
    const v = env[i]!;
    const a = Math.max(0, i - ctx);
    const b = Math.min(env.length, i + ctx + 1);
    const mean = (prefix[b]! - prefix[a]!) / (b - a);
    if (v <= mean * 1.5 + 0.02) continue;
    let isMax = true;
    for (let j = Math.max(0, i - radius); j <= Math.min(env.length - 1, i + radius); j++) {
      if (env[j]! > v || (env[j]! === v && j < i)) {
        isMax = false;
        break;
      }
    }
    if (isMax) peaks.push(i);
  }
  return peaks;
}

/** Find tempo and a beat grid. */
export function detectBeats(mono: Float32Array, sampleRate: number, opts: { minBpm?: number; maxBpm?: number } = {}): BeatAnalysis {
  const hopSec = 0.01;
  const env = onsetEnvelope(mono, sampleRate, hopSec);
  const onsets = pickPeaks(env, hopSec);
  // Envelope frame i covers [i·hop, i·hop + 2·hop]; an onset shows up when it
  // enters the window, so report frame times at the window's end.
  const toUs = (i: number) => Math.round((i + 2) * hopSec * 1e6);
  const minBpm = opts.minBpm ?? 60;
  const maxBpm = opts.maxBpm ?? 200;
  if (env.length < 50) return { bpm: 0, beatsUs: [], onsetsUs: onsets.map(toUs) };

  // Autocorrelation over plausible beat periods, weighted towards ~120 BPM.
  const minLag = Math.round(60 / maxBpm / hopSec);
  const maxLag = Math.round(60 / minBpm / hopSec);
  let bestLag = 0;
  let bestScore = -1;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = 0;
    for (let i = lag; i < env.length; i++) s += env[i]! * env[i - lag]!;
    s /= env.length - lag;
    const bpm = 60 / (lag * hopSec);
    const w = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 120) / 0.9, 2));
    const score = s * w;
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }
  // Refine the period with parabolic interpolation around the best lag.
  const acf = (lag: number) => {
    let s = 0;
    for (let i = lag; i < env.length; i++) s += env[i]! * env[i - lag]!;
    return s / (env.length - lag);
  };
  const y0 = acf(bestLag - 1);
  const y1 = acf(bestLag);
  const y2 = acf(bestLag + 1);
  const denom = y0 - 2 * y1 + y2;
  const lag = denom !== 0 ? bestLag + (0.5 * (y0 - y2)) / denom : bestLag;
  const bpm = 60 / (lag * hopSec);

  // Phase: offset that collects the most onset energy.
  let bestOffset = 0;
  let bestSum = -1;
  for (let off = 0; off < Math.ceil(lag); off++) {
    let s = 0;
    for (let t = off; t < env.length; t += lag) s += env[Math.round(t)] ?? 0;
    if (s > bestSum) {
      bestSum = s;
      bestOffset = off;
    }
  }
  const beats: number[] = [];
  const snap = Math.round(0.06 / hopSec);
  for (let t = bestOffset; t < env.length; t += lag) {
    const i = Math.round(t);
    // Snap to a nearby onset when there is one.
    let near = i;
    let nearDist = snap + 1;
    for (const o of onsets) {
      const d = Math.abs(o - i);
      if (d < nearDist) {
        nearDist = d;
        near = o;
      }
    }
    beats.push(toUs(nearDist <= snap ? near : i));
  }
  return {
    bpm: Math.round(bpm * 10) / 10,
    beatsUs: beats,
    onsetsUs: onsets.map(toUs),
  };
}

export interface Range {
  startUs: number;
  endUs: number;
}

/** Quiet stretches in PCM (µs from the start), shrunk by `paddingUs` each side. */
export function detectSilence(
  mono: Float32Array,
  sampleRate: number,
  opts: { thresholdDb?: number; minDurationUs?: number; paddingUs?: number } = {},
): Range[] {
  const threshold = opts.thresholdDb ?? -40;
  const minDur = opts.minDurationUs ?? 500_000;
  const pad = opts.paddingUs ?? 100_000;
  const win = Math.max(1, Math.round(sampleRate * 0.02));
  const out: Range[] = [];
  let runStart = -1;
  const total = Math.floor(mono.length / win);
  for (let w = 0; w <= total; w++) {
    let quiet = false;
    if (w < total) {
      let sum = 0;
      for (let i = w * win; i < (w + 1) * win; i++) sum += mono[i]! * mono[i]!;
      const rms = Math.sqrt(sum / win);
      const db = 20 * Math.log10(rms + 1e-9);
      quiet = db < threshold;
    }
    if (quiet && runStart < 0) runStart = w;
    if (!quiet && runStart >= 0) {
      const s = Math.round(((runStart * win) / sampleRate) * 1e6);
      const e = Math.round(((w * win) / sampleRate) * 1e6);
      const startUs = runStart === 0 ? 0 : s + pad;
      const endUs = w === total ? e : e - pad;
      if (endUs - startUs >= minDur - 2 * pad && endUs > startUs) out.push({ startUs, endUs });
      runStart = -1;
    }
  }
  return out;
}

/**
 * New durations for main-track clips so each cut lands on a beat.
 * `overlaps[i]` is the transition overlap into clip i. Clips never exceed
 * their source limit and never get shorter than `minUs`.
 */
export function fitToBeats(
  durations: readonly number[],
  maxDurations: readonly number[],
  overlaps: readonly number[],
  beatsUs: readonly number[],
  opts: { offsetUs?: number; minUs?: number } = {},
): number[] {
  const minUs = opts.minUs ?? 400_000;
  const offset = opts.offsetUs ?? 0;
  const beats = beatsUs.map((b) => b + offset).filter((b) => b > 0);
  const out: number[] = [];
  let start = 0;
  durations.forEach((d, i) => {
    const max = maxDurations[i] ?? d;
    const naturalEnd = start + d;
    let best: number | undefined;
    for (const b of beats) {
      const len = b - start;
      if (len < minUs || len > max) continue;
      if (best === undefined || Math.abs(b - naturalEnd) < Math.abs(best - naturalEnd)) best = b;
    }
    const nd = best !== undefined ? best - start : d;
    out.push(Math.round(nd));
    const nextOverlap = overlaps[i + 1] ?? 0;
    start = start + nd - nextOverlap;
  });
  return out;
}
