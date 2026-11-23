import { barSeconds, stepSeconds, type AudioSession, type Instrument, type Note, type Pattern, type StudioTrack } from "@just-see/schema";
import { applyBiquad, biquad, limit, reverb as reverbFx, type Channels } from "./dsp";
import { runAudioChain } from "./fx";
import type { DspModule } from "./wasm";
import type { Pcm } from "../media/audio";

/**
 * Offline renderer for audio studio sessions: drum machine, synths, sampler,
 * audio regions, mixer (volume/pan automation, sends, sidechain) and master.
 * Pure TypeScript, so preview, export and tests all hear the same thing.
 */

const midiHz = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

// ---------- Drum kits ----------

type DrumVoice = (sr: number, vel: number) => Float32Array;

function noiseBuf(n: number, seed: number): Float32Array {
  let s = seed;
  return new Float32Array(n).map(() => ((s = (s * 16807) % 2147483647) / 2147483647) * 2 - 1);
}

function kickVoice(f0: number, f1: number, decay: number, click: number): DrumVoice {
  return (sr, vel) => {
    const n = Math.round(sr * (decay * 4 + 0.05));
    const out = new Float32Array(n);
    let ph = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      ph += (2 * Math.PI * (f1 + (f0 - f1) * Math.exp(-t * 28))) / sr;
      out[i] = (Math.sin(ph) * Math.exp(-t / decay) + (t < 0.004 ? click * (1 - t / 0.004) : 0)) * vel;
    }
    return out;
  };
}

function snareVoice(tone: number, decay: number, seed: number): DrumVoice {
  return (sr, vel) => {
    const n = Math.round(sr * (decay * 5 + 0.05));
    const nz = applyBiquad(noiseBuf(n, seed), biquad("highpass", 1500, sr, 0.7));
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      out[i] = (Math.sin(2 * Math.PI * tone * t) * Math.exp(-t / 0.05) * 0.6 + nz[i]! * Math.exp(-t / decay) * 0.8) * vel;
    }
    return out;
  };
}

function hatVoice(decay: number, seed: number, freq = 7000): DrumVoice {
  return (sr, vel) => {
    const n = Math.round(sr * (decay * 5 + 0.02));
    const nz = applyBiquad(applyBiquad(noiseBuf(n, seed), biquad("highpass", freq, sr, 0.7)), biquad("peaking", 10000, sr, 1, 6));
    return nz.map((v, i) => v * Math.exp(-i / sr / decay) * 0.5 * vel);
  };
}

function clapVoice(seed: number): DrumVoice {
  return (sr, vel) => {
    const n = Math.round(sr * 0.35);
    const nz = applyBiquad(noiseBuf(n, seed), biquad("bandpass", 1200, sr, 0.8));
    return nz.map((v, i) => {
      const t = i / sr;
      const bursts = [0, 0.011, 0.023].reduce((a, b) => a + (t >= b ? Math.exp(-(t - b) / 0.006) : 0), 0);
      return v * (bursts * 0.4 + Math.exp(-t / 0.12) * 0.5) * vel;
    });
  };
}

function tomVoice(f: number): DrumVoice {
  return (sr, vel) => {
    const n = Math.round(sr * 0.5);
    let ph = 0;
    return new Float32Array(n).map((_, i) => {
      const t = i / sr;
      ph += (2 * Math.PI * f * (1 + 0.6 * Math.exp(-t * 20))) / sr;
      return Math.sin(ph) * Math.exp(-t / 0.15) * vel;
    });
  };
}

const KITS: Record<string, Record<string, DrumVoice>> = {
  "808": {
    kick: kickVoice(160, 48, 0.32, 0.3),
    snare: snareVoice(190, 0.12, 3),
    clap: clapVoice(4),
    hat: hatVoice(0.04, 5),
    "open-hat": hatVoice(0.28, 6),
    tom: tomVoice(120),
    rim: (sr, vel) => new Float32Array(Math.round(sr * 0.05)).map((_, i) => Math.sin(2 * Math.PI * 1700 * (i / sr)) * Math.exp(-i / sr / 0.008) * vel),
    perc: (sr, vel) => new Float32Array(Math.round(sr * 0.2)).map((_, i) => Math.sin(2 * Math.PI * 800 * (i / sr)) * Math.sin(2 * Math.PI * 1100 * (i / sr)) * Math.exp(-i / sr / 0.05) * vel),
  },
  studio: {
    kick: kickVoice(110, 55, 0.16, 0.6),
    snare: snareVoice(220, 0.18, 7),
    clap: clapVoice(8),
    hat: hatVoice(0.05, 9, 6000),
    "open-hat": hatVoice(0.35, 10, 6000),
    tom: tomVoice(140),
    rim: (sr, vel) => applyBiquad(noiseBuf(Math.round(sr * 0.04), 11), biquad("bandpass", 2500, sr, 3)).map((v, i) => v * Math.exp(-i / sr / 0.006) * vel),
    perc: (sr, vel) => new Float32Array(Math.round(sr * 0.25)).map((_, i) => Math.sin(2 * Math.PI * 520 * (i / sr)) * Math.exp(-i / sr / 0.07) * vel),
  },
  lofi: {
    kick: kickVoice(90, 50, 0.22, 0.2),
    snare: snareVoice(170, 0.1, 12),
    clap: clapVoice(13),
    hat: hatVoice(0.03, 14, 4000),
    "open-hat": hatVoice(0.18, 15, 4000),
    tom: tomVoice(100),
    rim: (sr, vel) => new Float32Array(Math.round(sr * 0.05)).map((_, i) => Math.sin(2 * Math.PI * 1200 * (i / sr)) * Math.exp(-i / sr / 0.01) * vel),
    perc: (sr, vel) => applyBiquad(noiseBuf(Math.round(sr * 0.1), 16), biquad("bandpass", 900, sr, 2)).map((v, i) => v * Math.exp(-i / sr / 0.03) * vel),
  },
};

export const DRUM_KITS = Object.keys(KITS);

// ---------- Synths ----------

export interface SynthPreset {
  id: string;
  label: string;
  kind: Instrument["kind"];
  params: Record<string, number>;
}

/** attack/decay/sustain/release in seconds (sustain 0..1), cutoff Hz, resonance Q. */
export const SYNTH_PRESETS: readonly SynthPreset[] = [
  { id: "pluck", label: "Pluck", kind: "subtractive", params: { wave: 1, attack: 0.002, decay: 0.25, sustain: 0.1, release: 0.15, cutoff: 2400, res: 2, envAmt: 3000, detune: 6, gain: 0.5 } },
  { id: "pad", label: "Warm pad", kind: "subtractive", params: { wave: 1, attack: 0.6, decay: 0.8, sustain: 0.7, release: 1.2, cutoff: 1400, res: 0.9, envAmt: 600, detune: 14, gain: 0.35 } },
  { id: "lead", label: "Lead", kind: "subtractive", params: { wave: 2, attack: 0.01, decay: 0.2, sustain: 0.6, release: 0.2, cutoff: 3500, res: 3, envAmt: 2000, detune: 8, gain: 0.4 } },
  { id: "keys", label: "Keys", kind: "subtractive", params: { wave: 3, attack: 0.005, decay: 0.6, sustain: 0.3, release: 0.4, cutoff: 3000, res: 0.8, envAmt: 1500, detune: 2, gain: 0.5 } },
  { id: "bass", label: "Synth bass", kind: "subtractive", params: { wave: 2, attack: 0.003, decay: 0.2, sustain: 0.5, release: 0.1, cutoff: 700, res: 4, envAmt: 1200, detune: 3, gain: 0.6 } },
  { id: "bell", label: "Bell (FM)", kind: "fm", params: { ratio: 3.5, index: 4, attack: 0.002, decay: 1.4, sustain: 0, release: 0.8, gain: 0.4 } },
  { id: "e-piano", label: "E-piano (FM)", kind: "fm", params: { ratio: 1, index: 1.8, attack: 0.002, decay: 0.9, sustain: 0.2, release: 0.5, gain: 0.5 } },
  { id: "brass", label: "Brass (FM)", kind: "fm", params: { ratio: 1, index: 3, attack: 0.05, decay: 0.3, sustain: 0.7, release: 0.2, gain: 0.35 } },
  { id: "808", label: "808 bass", kind: "bass808", params: { glide: 0.06, decay: 0.9, drive: 0.4, gain: 0.8 } },
];

function adsr(t: number, dur: number, a: number, d: number, s: number, r: number): number {
  if (t < 0) return 0;
  let v: number;
  if (t < a) v = t / a;
  else if (t < a + d) v = 1 - (1 - s) * ((t - a) / d);
  else v = s;
  if (t > dur) {
    const atRelease = dur < a ? dur / a : dur < a + d ? 1 - (1 - s) * ((dur - a) / d) : s;
    v = atRelease * Math.max(0, 1 - (t - dur) / r);
  }
  return v;
}

function osc(wave: number, ph: number): number {
  const x = ph / (2 * Math.PI);
  const f = x - Math.floor(x);
  switch (Math.round(wave)) {
    case 0:
      return Math.sin(ph);
    case 1:
      return 2 * f - 1; // saw
    case 2:
      return f < 0.5 ? 1 : -1; // square
    default:
      return 1 - 4 * Math.abs(f - 0.5); // triangle
  }
}

function renderNote(inst: Instrument, note: Note, durSec: number, sr: number, sample: Pcm | null): Float32Array {
  const preset = SYNTH_PRESETS.find((p) => p.id === inst.preset && p.kind === inst.kind) ?? SYNTH_PRESETS.find((p) => p.kind === inst.kind) ?? SYNTH_PRESETS[0]!;
  const q = { ...preset.params, ...inst.params };
  const freq = midiHz(note.pitch);
  const rel = q.release ?? 0.2;
  const n = Math.round(sr * (durSec + rel + 0.01));
  const out = new Float32Array(n);
  const vel = note.velocity;
  if (inst.kind === "sampler" && sample) {
    const src = sample.channels[0]!;
    const rate = (Math.pow(2, (note.pitch - inst.rootNote) / 12) * sample.sampleRate) / sr;
    for (let i = 0; i < n; i++) {
      const pos = i * rate;
      const a = Math.floor(pos);
      if (a + 1 >= src.length) break;
      const t = i / sr;
      const env = t > durSec ? Math.max(0, 1 - (t - durSec) / rel) : 1;
      out[i] = (src[a]! + (src[a + 1]! - src[a]!) * (pos - a)) * env * vel;
    }
    return out;
  }
  if (inst.kind === "bass808") {
    let ph = 0;
    const drive = 1 + (q.drive ?? 0.4) * 6;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const f = freq * (1 + 0.5 * Math.exp(-t / (q.glide ?? 0.06)));
      ph += (2 * Math.PI * f) / sr;
      const env = Math.exp(-t / (q.decay ?? 0.9)) * (t > durSec ? Math.max(0, 1 - (t - durSec) / 0.05) : 1);
      out[i] = (Math.tanh(Math.sin(ph) * drive) / Math.tanh(drive)) * env * vel * (q.gain ?? 0.8);
    }
    return out;
  }
  if (inst.kind === "fm") {
    let pc = 0;
    let pm = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const env = adsr(t, durSec, q.attack ?? 0.002, q.decay ?? 1, q.sustain ?? 0, rel);
      pm += (2 * Math.PI * freq * (q.ratio ?? 2)) / sr;
      pc += (2 * Math.PI * freq) / sr;
      out[i] = Math.sin(pc + (q.index ?? 3) * env * Math.sin(pm)) * env * vel * (q.gain ?? 0.4);
    }
    return out;
  }
  // Subtractive: two detuned oscillators → resonant low-pass with envelope.
  let p1 = 0;
  let p2 = 0;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  const det = Math.pow(2, (q.detune ?? 6) / 1200);
  let c = biquad("lowpass", q.cutoff ?? 2000, sr, q.res ?? 1);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const env = adsr(t, durSec, q.attack ?? 0.01, q.decay ?? 0.2, q.sustain ?? 0.5, rel);
    p1 += (2 * Math.PI * freq) / sr;
    p2 += (2 * Math.PI * freq * det) / sr;
    const s = (osc(q.wave ?? 1, p1) + osc(q.wave ?? 1, p2)) * 0.5;
    // Update the filter every 32 samples (the envelope moves slowly).
    if (i % 32 === 0) c = biquad("lowpass", Math.max(60, (q.cutoff ?? 2000) + (q.envAmt ?? 1000) * env), sr, q.res ?? 1);
    const y = c.b0 * s + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
    x2 = x1; x1 = s; y2 = y1; y1 = y;
    out[i] = y * env * vel * (q.gain ?? 0.5);
  }
  return out;
}

// ---------- Session rendering ----------

export interface StudioRender {
  sampleRate: number;
  channels: [Float32Array, Float32Array];
  durationSec: number;
  /** Kick hit times (s), for sidechain and tests. */
  kicks: number[];
}

function mixInto(dst: Float32Array, src: Float32Array, at: number, gain = 1): void {
  for (let i = 0; i < src.length; i++) {
    const k = at + i;
    if (k >= 0 && k < dst.length) dst[k]! += src[i]! * gain;
  }
}

function patternEvents(session: AudioSession, track: StudioTrack, patterns: Map<string, Pattern>) {
  const step = stepSeconds(session.bpm);
  const bar = barSeconds(session.bpm);
  const drums: { pad: string; t: number; vel: number }[] = [];
  const notes: { note: Note; t: number; dur: number }[] = [];
  for (const pl of track.placements) {
    const pat = patterns.get(pl.patternId);
    if (!pat) continue;
    const patSec = pat.steps * step;
    for (let r = 0; r < pl.repeat; r++) {
      const base = pl.bar * bar + r * patSec;
      for (const [pad, steps] of Object.entries(pat.drums)) {
        steps.forEach((vel, i) => {
          if (vel <= 0 || i >= pat.steps) return;
          const swing = i % 2 === 1 ? session.swing * step : 0;
          drums.push({ pad, t: base + i * step + swing, vel });
        });
      }
      for (const note of pat.notes) {
        if (note.start >= pat.steps) continue;
        notes.push({ note, t: base + note.start * step, dur: note.length * step });
      }
    }
  }
  return { drums, notes };
}

/** Linear automation by bar. */
function autoAt(points: { bar: number; value: number }[] | undefined, barPos: number, fallback: number): number {
  if (!points?.length) return fallback;
  const pts = [...points].sort((a, b) => a.bar - b.bar);
  if (barPos <= pts[0]!.bar) return pts[0]!.value;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    if (barPos <= b.bar) return a.value + ((b.value - a.value) * (barPos - a.bar)) / Math.max(1e-6, b.bar - a.bar);
  }
  return pts[pts.length - 1]!.value;
}

export function sessionDurationSec(session: AudioSession): number {
  let end = session.bars * barSeconds(session.bpm);
  for (const t of session.tracks) for (const r of t.regions) end = Math.max(end, (r.startUs + r.durationUs) / 1e6);
  return end;
}

/** Render a whole session to stereo PCM. `sources` holds decoded PCM per asset id. */
export async function renderStudio(
  session: AudioSession,
  sources: ReadonlyMap<string, Pcm>,
  dsp: DspModule,
  sampleRate = 48000,
  opts: { tail?: number } = {},
): Promise<StudioRender> {
  const sr = sampleRate;
  const dur = sessionDurationSec(session) + (opts.tail ?? 0);
  const n = Math.max(1, Math.ceil(dur * sr));
  const patterns = new Map(session.patterns.map((p) => [p.id, p]));
  const anySolo = session.tracks.some((t) => t.solo);
  const master: [Float32Array, Float32Array] = [new Float32Array(n), new Float32Array(n)];
  const bus: [Float32Array, Float32Array] = [new Float32Array(n), new Float32Array(n)];
  const kicks: number[] = [];
  // Kick times from every drum track (for the sidechain).
  for (const tr of session.tracks) {
    if (tr.instrument?.kind !== "drums" || tr.mute) continue;
    for (const e of patternEvents(session, tr, patterns).drums) if (e.pad === "kick") kicks.push(e.t);
  }
  kicks.sort((a, b) => a - b);
  const drumCache = new Map<string, Float32Array>();
  const bar = barSeconds(session.bpm);

  for (const tr of session.tracks) {
    if (tr.mute || (anySolo && !tr.solo)) continue;
    const buf = new Float32Array(n);
    // Audio regions.
    for (const r of tr.regions) {
      const pcm = sources.get(r.assetId);
      if (!pcm) continue;
      let src = pcm.channels.length > 1 ? pcm.channels[0]!.map((v, i) => (v + pcm.channels[1]![i]!) / 2) : pcm.channels[0]!;
      const a = Math.max(0, Math.round(((r.sourceInUs - pcm.startUs) / 1e6) * pcm.sampleRate));
      const len = Math.round((r.durationUs / 1e6) * pcm.sampleRate);
      src = src.slice(a, a + len);
      if (r.pitch) src = dsp.pitchShift(src, r.pitch);
      const ratio = pcm.sampleRate / sr;
      const g = Math.pow(10, r.gainDb / 20);
      const at = Math.round((r.startUs / 1e6) * sr);
      const outLen = Math.round(src.length / ratio);
      const fi = (r.fadeInUs / 1e6) * sr;
      const fo = (r.fadeOutUs / 1e6) * sr;
      for (let i = 0; i < outLen; i++) {
        const p = i * ratio;
        const k = Math.floor(p);
        const v = (src[k] ?? 0) + ((src[k + 1] ?? 0) - (src[k] ?? 0)) * (p - k);
        let f = 1;
        if (fi > 0) f *= Math.min(1, i / fi);
        if (fo > 0) f *= Math.min(1, (outLen - i) / fo);
        const idx = at + i;
        if (idx < n) buf[idx]! += v * g * f;
      }
    }
    // Instruments.
    const inst = tr.instrument;
    if (inst) {
      const ev = patternEvents(session, tr, patterns);
      if (inst.kind === "drums") {
        const kit = KITS[inst.kit] ?? KITS["808"]!;
        for (const e of ev.drums) {
          const voice = kit[e.pad];
          if (!voice) continue;
          const key = `${inst.kit}:${e.pad}`;
          let one = drumCache.get(key);
          if (!one) {
            one = voice(sr, 1);
            drumCache.set(key, one);
          }
          mixInto(buf, one, Math.round(e.t * sr), e.vel);
        }
      } else {
        const sample = inst.kind === "sampler" && inst.assetId ? (sources.get(inst.assetId) ?? null) : null;
        for (const e of ev.notes) mixInto(buf, renderNote(inst, e.note, e.dur, sr, sample), Math.round(e.t * sr));
      }
    }
    // Track effects.
    let st: Channels = [buf, new Float32Array(buf)];
    if (tr.fx.some((f) => f.enabled)) st = await runAudioChain(st, sr, tr.fx, dsp);
    // Volume/pan automation, sidechain, sends.
    const L = st[0]!;
    const R = st[1] ?? L;
    let ki = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const bp = t / bar;
      const vol = Math.pow(10, autoAt(tr.automation.volume, bp, tr.volumeDb) / 20);
      const pan = Math.max(-1, Math.min(1, autoAt(tr.automation.pan, bp, tr.pan)));
      let duck = 1;
      if (tr.sidechain > 0 && kicks.length) {
        while (ki + 1 < kicks.length && kicks[ki + 1]! <= t) ki++;
        const last = kicks[ki]!;
        if (last <= t) duck = 1 - tr.sidechain * 0.85 * Math.exp(-(t - last) / 0.12);
      }
      const g = vol * duck;
      const gl = Math.cos(((pan + 1) * Math.PI) / 4) * Math.SQRT2;
      const gr = Math.sin(((pan + 1) * Math.PI) / 4) * Math.SQRT2;
      const l = (L[i] ?? 0) * g * gl;
      const r = (R[i] ?? 0) * g * gr;
      master[0][i]! += l;
      master[1][i]! += r;
      if (tr.reverbSend > 0) {
        bus[0][i]! += l * tr.reverbSend;
        bus[1][i]! += r * tr.reverbSend;
      }
    }
  }
  // Reverb bus (fully wet).
  if (bus[0].some((v) => v !== 0)) {
    const wet = reverbFx(bus, sr, 0.7, 0.4, 1);
    for (let i = 0; i < n; i++) {
      master[0][i]! += wet[0]![i]! * 0.6;
      master[1][i]! += (wet[1] ?? wet[0])![i]! * 0.6;
    }
  }
  let out: Channels = master;
  if (session.masterFx.some((f) => f.enabled)) out = await runAudioChain(out, sr, session.masterFx, dsp);
  const mg = Math.pow(10, session.masterDb / 20);
  // Gentle soft clip, then a limiter so the true peak stays under -1 dBTP.
  const [L, R] = limit([out[0]!.map((v) => 0.98 * Math.tanh((v * mg) / 0.98)), (out[1] ?? out[0]!).map((v) => 0.98 * Math.tanh((v * mg) / 0.98))], sr, -1) as [Float32Array, Float32Array];
  return { sampleRate: sr, channels: [L, R], durationSec: dur, kicks };
}

// ---------- Helpers for new sessions ----------

export function emptyPattern(id: string, name: string, steps = 16): Pattern {
  return { id, name, steps, drums: {}, notes: [] };
}

/** A starter beat so the studio never opens empty. */
export function starterDrums(steps = 16): Pattern["drums"] {
  const row = (hits: number[], vel = 0.9) => Array.from({ length: steps }, (_, i) => (hits.includes(i % 16) ? vel : 0));
  return {
    kick: row([0, 6, 10]),
    snare: row([4, 12]),
    hat: row([0, 2, 4, 6, 8, 10, 12, 14], 0.6),
    clap: row([12], 0.5),
  };
}
