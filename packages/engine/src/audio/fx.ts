import * as D from "./dsp";
import type { Channels } from "./dsp";
import type { DspModule } from "./wasm";

/**
 * Clip audio effects. Each effect is offline: it turns input PCM into output
 * PCM. The web app renders a clip's chain once and caches the result, so
 * preview and export play the same processed audio.
 */

export interface AudioParamDef {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  default: number;
}

export type AudioFxCategory = "repair" | "voice" | "dynamics" | "space" | "creative";

export interface AudioFxDef {
  type: string;
  label: string;
  category: AudioFxCategory;
  params: AudioParamDef[];
  run(ch: Channels, sr: number, p: Record<string, number>, dsp: DspModule): Channels | Promise<Channels>;
}

const p = (key: string, label: string, min: number, max: number, def: number, step = 0.01): AudioParamDef => ({ key, label, min, max, step, default: def });
const mono = (ch: Channels) => (ch.length > 1 ? D.stereoWidth(ch, 0)[0]! : ch[0]!);
const perChannel = (ch: Channels, f: (x: Float32Array) => Float32Array) => ch.map(f);

/** One-tap voice clean-up: rumble cut, hum, noise, clicks, EQ, de-ess, compression, -14 LUFS. */
export function studioVoice(ch: Channels, sr: number, dsp: DspModule, opts: { strength?: number; targetLufs?: number } = {}): Channels {
  const s = opts.strength ?? 0.7;
  let x = D.filter(ch, sr, "highpass", 80, 0.7);
  x = D.deHum(x, sr, D.detectMains(mono(x), sr), 6);
  x = D.deClick(x, 0.5);
  x = perChannel(x, (c) => dsp.denoise(c, null, s));
  x = D.eq(x, sr, [
    { type: "peaking", freq: 250, q: 1.0, gainDb: -2 },
    { type: "peaking", freq: 3200, q: 0.9, gainDb: 2.5 },
    { type: "highshelf", freq: 10000, q: 0.7, gainDb: 1.5 },
  ]);
  x = D.deEss(x, sr, 0.5);
  x = D.compress(x, sr, { thresholdDb: -24, ratio: 3, attackMs: 8, releaseMs: 120, makeupDb: 4 });
  return D.normalizeLoudness(x, sr, opts.targetLufs ?? -14, -1);
}

export const AUDIO_FX: readonly AudioFxDef[] = [
  // Repair
  { type: "studio-voice", label: "Studio voice", category: "repair", params: [p("strength", "Strength", 0, 1, 0.7), p("lufs", "Target LUFS", -24, -9, -14, 1)], run: (ch, sr, q, dsp) => studioVoice(ch, sr, dsp, { strength: q.strength, targetLufs: q.lufs }) },
  { type: "denoise", label: "Noise reduction", category: "repair", params: [p("strength", "Strength", 0, 1, 0.6)], run: (ch, _sr, q, dsp) => perChannel(ch, (c) => dsp.denoise(c, null, q.strength ?? 0.6)) },
  { type: "dehum", label: "Hum removal", category: "repair", params: [p("mains", "Mains (0 auto, 50, 60)", 0, 60, 0, 10)], run: (ch, sr, q) => D.deHum(ch, sr, q.mains === 60 ? 60 : q.mains === 50 ? 50 : D.detectMains(mono(ch), sr)) },
  { type: "declick", label: "Click removal", category: "repair", params: [p("sensitivity", "Sensitivity", 0, 1, 0.5)], run: (ch, _sr, q) => D.deClick(ch, q.sensitivity) },
  { type: "deess", label: "De-esser", category: "repair", params: [p("amount", "Amount", 0, 1, 0.5)], run: (ch, sr, q) => D.deEss(ch, sr, q.amount) },
  { type: "dereverb", label: "Room reverb removal", category: "repair", params: [p("amount", "Amount", 0, 1, 0.5)], run: (ch, sr, q) => D.deReverb(ch, sr, q.amount) },
  { type: "breath", label: "Breath & mouth-click removal", category: "repair", params: [p("threshold", "Threshold dB", -60, -20, -42, 1)], run: (ch, sr, q) => D.gate(D.deClick(ch, 0.7), sr, { thresholdDb: q.threshold ?? -42, floorDb: -30, releaseMs: 150 }) },
  // Dynamics
  { type: "normalize", label: "Loudness normalise", category: "dynamics", params: [p("lufs", "Target LUFS", -24, -9, -14, 1)], run: (ch, sr, q) => D.normalizeLoudness(ch, sr, q.lufs ?? -14) },
  { type: "compressor", label: "Compressor", category: "dynamics", params: [p("threshold", "Threshold dB", -50, 0, -20, 1), p("ratio", "Ratio", 1, 20, 4, 0.5), p("attack", "Attack ms", 0.1, 100, 10, 0.1), p("release", "Release ms", 10, 1000, 150, 5), p("makeup", "Make-up dB", 0, 24, 3, 0.5)], run: (ch, sr, q) => D.compress(ch, sr, { thresholdDb: q.threshold!, ratio: q.ratio!, attackMs: q.attack!, releaseMs: q.release!, makeupDb: q.makeup }) },
  { type: "limiter", label: "Limiter", category: "dynamics", params: [p("ceiling", "Ceiling dBTP", -6, 0, -1, 0.1)], run: (ch, sr, q) => D.limit(ch, sr, q.ceiling) },
  { type: "gate", label: "Noise gate", category: "dynamics", params: [p("threshold", "Threshold dB", -80, -10, -45, 1)], run: (ch, sr, q) => D.gate(ch, sr, { thresholdDb: q.threshold! }) },
  // EQ / tone
  { type: "eq", label: "Equaliser", category: "voice", params: [p("low", "Bass dB", -12, 12, 0, 0.5), p("mid", "Mid dB", -12, 12, 0, 0.5), p("midFreq", "Mid Hz", 200, 5000, 1000, 10), p("high", "Treble dB", -12, 12, 0, 0.5), p("hpf", "Low cut Hz", 20, 400, 20, 5)], run: (ch, sr, q) => D.eq(ch, sr, [{ type: "highpass", freq: q.hpf!, q: 0.7, gainDb: 0 }, { type: "lowshelf", freq: 120, q: 0.7, gainDb: q.low! }, { type: "peaking", freq: q.midFreq!, q: 1, gainDb: q.mid! }, { type: "highshelf", freq: 8000, q: 0.7, gainDb: q.high! }]) },
  { type: "bass-boost", label: "Bass boost", category: "voice", params: [p("amount", "Amount dB", 0, 15, 6, 0.5)], run: (ch, sr, q) => D.limit(D.filter(ch, sr, "lowshelf", 110, 0.7, q.amount), sr, -1) },
  { type: "pitch", label: "Pitch shift", category: "voice", params: [p("semitones", "Semitones", -12, 12, 3, 1)], run: (ch, _sr, q, dsp) => perChannel(ch, (c) => dsp.pitchShift(c, q.semitones ?? 0)) },
  { type: "chipmunk", label: "Chipmunk voice", category: "voice", params: [], run: (ch, _sr, _q, dsp) => perChannel(ch, (c) => dsp.pitchShift(c, 7)) },
  { type: "deep-voice", label: "Deep voice", category: "voice", params: [], run: (ch, sr, _q, dsp) => D.filter(perChannel(ch, (c) => dsp.pitchShift(c, -5)), sr, "lowshelf", 150, 0.7, 3) },
  { type: "robot", label: "Robot voice", category: "voice", params: [p("freq", "Tone Hz", 20, 200, 60, 1)], run: (ch, sr, q) => ch.map((x) => x.map((v, i) => v * Math.sin((2 * Math.PI * (q.freq ?? 60) * i) / sr) * 1.6)) },
  { type: "telephone", label: "Telephone", category: "voice", params: [], run: (ch, sr) => D.telephone(ch, sr) },
  { type: "megaphone", label: "Megaphone", category: "voice", params: [], run: (ch, sr) => D.saturate(D.filter(D.filter(ch, sr, "highpass", 600, 1.2), sr, "peaking", 1800, 1, 8), 0.7) },
  { type: "muffled", label: "Muffled (next room)", category: "voice", params: [p("cutoff", "Cut-off Hz", 200, 2000, 500, 10)], run: (ch, sr, q) => D.reverb(D.filter(D.filter(ch, sr, "lowpass", q.cutoff ?? 500, 0.8), sr, "lowpass", q.cutoff ?? 500, 0.8), sr, 0.3, 0.7, 0.15) },
  { type: "walkie-talkie", label: "Walkie-talkie", category: "voice", params: [], run: (ch, sr) => D.saturate(D.bitcrush(D.filter(D.filter(ch, sr, "highpass", 900, 1), sr, "lowpass", 2600, 1), 8, 1), 0.8) },
  { type: "cave-echo", label: "Cave echo", category: "space", params: [p("mix", "Mix", 0, 1, 0.4)], run: (ch, sr, q) => D.reverb(D.delay(ch, sr, 450, 0.5, q.mix ?? 0.4), sr, 0.85, 0.5, 0.3) },
  { type: "radio", label: "Old radio", category: "voice", params: [], run: (ch, sr) => D.bitcrush(D.telephone(ch, sr), 10, 2) },
  // Space
  { type: "reverb", label: "Reverb", category: "space", params: [p("size", "Room size", 0, 1, 0.5), p("damping", "Damping", 0, 1, 0.4), p("mix", "Mix", 0, 1, 0.25)], run: (ch, sr, q) => D.reverb(ch, sr, q.size, q.damping, q.mix) },
  { type: "hall", label: "Concert hall", category: "space", params: [p("mix", "Mix", 0, 1, 0.35)], run: (ch, sr, q) => D.reverb(ch, sr, 0.9, 0.3, q.mix) },
  { type: "delay", label: "Echo / delay", category: "space", params: [p("time", "Time ms", 20, 1500, 320, 5), p("feedback", "Feedback", 0, 0.95, 0.35), p("mix", "Mix", 0, 1, 0.3)], run: (ch, sr, q) => D.delay(ch, sr, q.time, q.feedback, q.mix) },
  { type: "underwater", label: "Underwater", category: "space", params: [], run: (ch, sr) => D.chorus(D.filter(ch, sr, "lowpass", 600, 0.9), sr, 0.4, 6, 12, 0.5) },
  { type: "width", label: "Stereo width", category: "space", params: [p("width", "Width", 0, 2, 1.5)], run: (ch, _sr, q) => D.stereoWidth(ch, q.width) },
  { type: "auto-pan", label: "8D auto-pan", category: "space", params: [p("rate", "Turns per second", 0.02, 1, 0.12)], run: (ch, sr, q) => {
      const L = ch[0]!;
      const R = ch[1] ?? L;
      const ol = new Float32Array(L.length);
      const or = new Float32Array(L.length);
      for (let i = 0; i < L.length; i++) {
        const a = (Math.sin((2 * Math.PI * (q.rate ?? 0.12) * i) / sr) + 1) / 2;
        const m = (L[i]! + R[i]!) / 2;
        ol[i] = m * Math.cos((a * Math.PI) / 2) * 1.2;
        or[i] = m * Math.sin((a * Math.PI) / 2) * 1.2;
      }
      return D.reverb([ol, or], sr, 0.5, 0.5, 0.15);
    } },
  // Creative
  { type: "chorus", label: "Chorus", category: "creative", params: [p("rate", "Rate Hz", 0.1, 5, 0.8), p("depth", "Depth ms", 0.5, 10, 3), p("mix", "Mix", 0, 1, 0.4)], run: (ch, sr, q) => D.chorus(ch, sr, q.rate, q.depth, 15, q.mix) },
  { type: "flanger", label: "Flanger", category: "creative", params: [p("rate", "Rate Hz", 0.05, 3, 0.3), p("feedback", "Feedback", 0, 0.9, 0.6)], run: (ch, sr, q) => D.chorus(ch, sr, q.rate, 2, 1.5, 0.5, q.feedback) },
  { type: "phaser", label: "Phaser", category: "creative", params: [p("rate", "Rate Hz", 0.05, 4, 0.5), p("depth", "Depth", 0, 1, 0.7)], run: (ch, sr, q) => D.phaser(ch, sr, q.rate, q.depth) },
  { type: "saturation", label: "Saturation", category: "creative", params: [p("drive", "Drive", 0, 1, 0.4)], run: (ch, _sr, q) => D.saturate(ch, q.drive) },
  { type: "bitcrusher", label: "Bitcrusher", category: "creative", params: [p("bits", "Bits", 2, 16, 8, 1), p("downsample", "Downsample", 1, 32, 4, 1)], run: (ch, _sr, q) => D.bitcrush(ch, q.bits, q.downsample) },
  { type: "lofi", label: "Lo-fi", category: "creative", params: [], run: (ch, sr) => D.saturate(D.bitcrush(D.filter(D.filter(ch, sr, "lowpass", 5000, 0.7), sr, "highpass", 120, 0.7), 12, 2), 0.2) },
  { type: "time-stretch", label: "Tempo (keep pitch)", category: "creative", params: [p("ratio", "Length ×", 0.5, 2, 1, 0.01)], run: (ch, _sr, q, dsp) => perChannel(ch, (c) => dsp.timeStretch(c, q.ratio ?? 1)) },
];

export const AUDIO_FX_BY_TYPE: ReadonlyMap<string, AudioFxDef> = new Map(AUDIO_FX.map((f) => [f.type, f]));

export function defaultAudioParams(def: AudioFxDef): Record<string, number> {
  return Object.fromEntries(def.params.map((x) => [x.key, x.default]));
}

/** Run an effect chain. Unknown or disabled effects are skipped. */
export async function runAudioChain(
  ch: Channels,
  sr: number,
  chain: readonly { type: string; enabled: boolean; params: Record<string, number> }[],
  dsp: DspModule,
): Promise<Channels> {
  let x = ch.length === 1 ? [ch[0]!, new Float32Array(ch[0]!)] : ch;
  for (const fx of chain) {
    if (!fx.enabled) continue;
    const def = AUDIO_FX_BY_TYPE.get(fx.type);
    if (!def) continue;
    const params = { ...defaultAudioParams(def), ...fx.params };
    x = await def.run(x, sr, params, dsp);
  }
  return x;
}

// ---------- Stem separation (no AI, runs anywhere) ----------

export interface Stems {
  vocals: Channels;
  drums: Channels;
  bass: Channels;
  other: Channels;
}

/**
 * Free stem split: percussive part → drums, low harmonic → bass, centre
 * mid-band harmonic → vocals, the rest → other. Lower quality than AI models
 * but needs no server.
 */
export function separateStems(ch: Channels, sr: number, dsp: DspModule): Stems {
  const L = ch[0]!;
  const R = ch[1] ?? L;
  const mid = new Float32Array(L.length);
  const side = new Float32Array(L.length);
  for (let i = 0; i < L.length; i++) {
    mid[i] = (L[i]! + R[i]!) / 2;
    side[i] = (L[i]! - R[i]!) / 2;
  }
  const m = dsp.hpss(mid);
  const sd = dsp.hpss(side);
  const toLR = (mi: Float32Array, si: Float32Array): Channels => [mi.map((v, i) => v + si[i]!), mi.map((v, i) => v - si[i]!)];
  const drums = toLR(m.percussive, sd.percussive);
  const bassMid = applyChain(m.harmonic, sr, [["lowpass", 160]]);
  const bass = toLR(bassMid, new Float32Array(L.length));
  // Vocals sit in the centre, 150 Hz – 7 kHz.
  const vocalMid = applyChain(m.harmonic, sr, [["highpass", 160], ["lowpass", 7000]]);
  const vocals = toLR(vocalMid, new Float32Array(L.length));
  // Other = side harmonic (panned instruments) + centre harmonic above the vocal band.
  // (Filters shift phase, so subtracting bands would leak the vocal back in.)
  const otherMid = applyChain(m.harmonic, sr, [["highpass", 7000]]);
  const other = toLR(otherMid, sd.harmonic);
  return { vocals, drums, bass, other };
}

function applyChain(x: Float32Array, sr: number, f: [D.BiquadType, number][]): Float32Array {
  let y = x;
  for (const [t, hz] of f) y = D.applyBiquad(D.applyBiquad(y, D.biquad(t, hz, sr, 0.707)), D.biquad(t, hz, sr, 0.707));
  return y;
}

/** Karaoke / instrumental: remove the centre vocal band. */
export function removeVocals(ch: Channels, sr: number, dsp: DspModule): Channels {
  const s = separateStems(ch, sr, dsp);
  const len = ch[0]!.length;
  return [0, 1].map((c) => {
    const out = new Float32Array(len);
    for (let i = 0; i < len; i++) out[i] = s.drums[c]![i]! + s.bass[c]![i]! + s.other[c]![i]!;
    return out;
  });
}

/** Stable key for caching processed clip audio. */
export function audioChainKey(chain: readonly { type: string; enabled: boolean; params: Record<string, number> }[]): string {
  return JSON.stringify(chain.filter((e) => e.enabled).map((e) => [e.type, e.params]));
}

/**
 * Process the source range a clip plays. Preview and export both call this
 * with the same range, so they hear the same result.
 */
export async function processClipPcm(
  pcm: { sampleRate: number; channels: Float32Array[]; startUs: number },
  sourceInUs: number,
  spanUs: number,
  chain: readonly { type: string; enabled: boolean; params: Record<string, number> }[],
  dsp: DspModule,
): Promise<{ sampleRate: number; channels: Float32Array[]; startUs: number }> {
  const sr = pcm.sampleRate;
  const a = Math.max(0, Math.round(((sourceInUs - pcm.startUs) / 1e6) * sr));
  const b = Math.min(pcm.channels[0]?.length ?? 0, a + Math.round((spanUs / 1e6) * sr));
  const slice = pcm.channels.map((c) => c.slice(a, b));
  const out = await runAudioChain(slice, sr, chain, dsp);
  return { sampleRate: sr, channels: out, startUs: pcm.startUs + Math.round((a / sr) * 1e6) };
}
