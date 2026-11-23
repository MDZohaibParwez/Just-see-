import { z } from "zod";
import { EffectInstanceSchema, IdSchema, MicrosSchema } from "./base";

/**
 * Audio studio session: multitrack audio editing (Edit mode) and beat making
 * (Produce mode) share one document. Rendered offline by the engine, then
 * bounced into the video timeline.
 */

export const AudioRegionSchema = z.object({
  id: IdSchema,
  assetId: IdSchema,
  startUs: MicrosSchema,
  durationUs: MicrosSchema,
  sourceInUs: MicrosSchema,
  gainDb: z.number().min(-60).max(24).default(0),
  fadeInUs: MicrosSchema.default(0),
  fadeOutUs: MicrosSchema.default(0),
  /** Semitones (formant not preserved), applied when rendering. */
  pitch: z.number().min(-24).max(24).default(0),
});
export type AudioRegion = z.infer<typeof AudioRegionSchema>;

export const NoteSchema = z.object({
  /** MIDI note number. */
  pitch: z.number().int().min(0).max(127),
  /** In 16th-note steps from the pattern start (fractions allowed). */
  start: z.number().min(0).max(1024),
  length: z.number().min(0.05).max(1024),
  velocity: z.number().min(0).max(1).default(0.8),
});
export type Note = z.infer<typeof NoteSchema>;

export const DRUM_PADS = ["kick", "snare", "clap", "hat", "open-hat", "tom", "rim", "perc"] as const;
export type DrumPad = (typeof DRUM_PADS)[number];

export const PatternSchema = z.object({
  id: IdSchema,
  name: z.string().max(100),
  /** Length in 16th steps (16 = one bar of 4/4). */
  steps: z.number().int().min(1).max(256).default(16),
  /** Drum steps: pad → velocity per step (0 = off). */
  drums: z.record(z.string(), z.array(z.number().min(0).max(1)).max(256)).default({}),
  notes: z.array(NoteSchema).max(4096).default([]),
});
export type Pattern = z.infer<typeof PatternSchema>;

export const InstrumentSchema = z.object({
  kind: z.enum(["drums", "subtractive", "fm", "sampler", "bass808"]),
  preset: z.string().max(60).default("default"),
  /** Free-form numeric settings for the instrument (cutoff, attack …). */
  params: z.record(z.string(), z.number()).default({}),
  /** Sampler source. */
  assetId: IdSchema.nullable().default(null),
  /** Sampler root note. */
  rootNote: z.number().int().min(0).max(127).default(60),
  /** Drum kit name for kind "drums". */
  kit: z.string().max(40).default("808"),
});
export type Instrument = z.infer<typeof InstrumentSchema>;

/** A pattern placed on a track at a bar. */
export const PatternPlacementSchema = z.object({
  id: IdSchema,
  patternId: IdSchema,
  bar: z.number().int().min(0).max(999),
  /** How many times it repeats back to back. */
  repeat: z.number().int().min(1).max(256).default(1),
});
export type PatternPlacement = z.infer<typeof PatternPlacementSchema>;

export const AutomationPointSchema = z.object({ bar: z.number().min(0), value: z.number() });

export const StudioTrackSchema = z.object({
  id: IdSchema,
  name: z.string().max(100),
  kind: z.enum(["audio", "instrument"]),
  volumeDb: z.number().min(-60).max(12).default(0),
  pan: z.number().min(-1).max(1).default(0),
  mute: z.boolean().default(false),
  solo: z.boolean().default(false),
  fx: z.array(EffectInstanceSchema).max(16).default([]),
  /** Send amount (0..1) to the reverb bus. */
  reverbSend: z.number().min(0).max(1).default(0),
  /** Duck this track when the kick plays (classic sidechain pump). */
  sidechain: z.number().min(0).max(1).default(0),
  regions: z.array(AudioRegionSchema).max(2000).default([]),
  instrument: InstrumentSchema.nullable().default(null),
  placements: z.array(PatternPlacementSchema).max(2000).default([]),
  /** Automation lanes: "volume" (dB) and "pan" by bar. */
  automation: z.record(z.string(), z.array(AutomationPointSchema).max(500)).default({}),
});
export type StudioTrack = z.infer<typeof StudioTrackSchema>;

export const AudioSessionSchema = z.object({
  id: IdSchema,
  name: z.string().max(200),
  bpm: z.number().min(40).max(240).default(120),
  /** Song length in bars for Produce mode (Edit mode uses region ends). */
  bars: z.number().int().min(1).max(999).default(8),
  /** Musical key root (0 = C) and scale for the piano roll helper. */
  keyRoot: z.number().int().min(0).max(11).default(0),
  scale: z.enum(["major", "minor", "pentatonic", "blues", "chromatic"]).default("minor"),
  swing: z.number().min(0).max(0.6).default(0),
  tracks: z.array(StudioTrackSchema).max(64),
  patterns: z.array(PatternSchema).max(256).default([]),
  masterFx: z.array(EffectInstanceSchema).max(16).default([]),
  masterDb: z.number().min(-60).max(12).default(0),
  /** Asset created by the last "send to video", so it can be updated. */
  bouncedAssetId: IdSchema.nullable().default(null),
  updatedAt: z.number().int().default(0),
});
export type AudioSession = z.infer<typeof AudioSessionSchema>;

/** Seconds per 16th step. */
export function stepSeconds(bpm: number): number {
  return 60 / bpm / 4;
}

export function barSeconds(bpm: number): number {
  return (60 / bpm) * 4;
}

export const SCALES: Record<AudioSession["scale"], number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  pentatonic: [0, 3, 5, 7, 10],
  blues: [0, 3, 5, 6, 7, 10],
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
};

export function inScale(pitch: number, root: number, scale: AudioSession["scale"]): boolean {
  return SCALES[scale].includes((((pitch - root) % 12) + 12) % 12);
}

/** Triad on a scale degree: root, third and fifth from the scale. */
export function chordNotes(rootPitch: number, keyRoot: number, scale: AudioSession["scale"]): number[] {
  const deg = SCALES[scale];
  const rel = (((rootPitch - keyRoot) % 12) + 12) % 12;
  const i = deg.indexOf(rel);
  if (i < 0 || deg.length < 5) return [rootPitch, rootPitch + 4, rootPitch + 7];
  const at = (k: number) => {
    const oct = Math.floor((i + k) / deg.length);
    return rootPitch - rel + deg[(i + k) % deg.length]! + 12 * oct;
  };
  return [at(0), at(2), at(4)];
}
