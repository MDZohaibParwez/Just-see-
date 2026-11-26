/**
 * Background-music mood templates. Each one builds a full, editable studio
 * session (drums, bass, chords, melody) from our own patterns, so the music
 * is original and free to use. Users can open it in the Audio Studio and
 * change anything before sending it to the video.
 */
import { chordNotes, type AudioSession, type Instrument, type Note, type Pattern, type StudioTrack } from "@just-see/schema";

export type Mood = "upbeat" | "cinematic" | "lofi" | "suspense" | "theme" | "stinger";

export interface MoodDef {
  id: Mood;
  label: string;
  hint: string;
}

export const MOODS: readonly MoodDef[] = [
  { id: "upbeat", label: "Upbeat / Energetic", hint: "Vlogs, travel, reels" },
  { id: "cinematic", label: "Cinematic / Emotional", hint: "Stories, weddings, trailers" },
  { id: "lofi", label: "Lo-fi / Chill", hint: "Study, aesthetic, calm" },
  { id: "suspense", label: "Suspense / Tension", hint: "Mystery, horror, reveals" },
  { id: "theme", label: "Theme / Intro", hint: "Channel intro, logo" },
  { id: "stinger", label: "Stinger (2 bars)", hint: "Short transition music" },
];

type IdFn = (prefix: string) => string;

const inst = (kind: Instrument["kind"], preset: string, kit = "808"): Instrument => ({ kind, preset, params: {}, assetId: null, rootNote: 60, kit });

function row(steps: number, hits: number[], vel = 0.9): number[] {
  return Array.from({ length: steps }, (_, i) => (hits.includes(i % 16) ? vel : 0));
}

/** Chord pattern: one chord per bar from scale degrees (1-based). */
function chords(keyRoot: number, scale: AudioSession["scale"], degrees: number[], octave: number, rhythm: number[], length: number, vel = 0.6): Note[] {
  const scaleSteps = { major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10], pentatonic: [0, 3, 5, 7, 10], blues: [0, 3, 5, 6, 7, 10], chromatic: [0, 2, 3, 5, 7, 8, 10] }[scale];
  const notes: Note[] = [];
  degrees.forEach((d, bar) => {
    const root = 12 * (octave + 1) + keyRoot + scaleSteps[(d - 1) % scaleSteps.length]!;
    for (const r of rhythm) for (const pitch of chordNotes(root, keyRoot, scale)) notes.push({ pitch, start: bar * 16 + r, length, velocity: vel });
  });
  return notes;
}

function bassLine(keyRoot: number, scale: AudioSession["scale"], degrees: number[], octave: number, rhythm: number[], length: number): Note[] {
  return chords(keyRoot, scale, degrees, octave, rhythm, length, 0.85).filter((_, i) => i % 3 === 0);
}

function melody(keyRoot: number, scale: AudioSession["scale"], octave: number, seq: [number, number, number][]): Note[] {
  const steps = { major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10], pentatonic: [0, 3, 5, 7, 10], blues: [0, 3, 5, 6, 7, 10], chromatic: [0, 2, 3, 5, 7, 8, 10] }[scale];
  return seq.map(([deg, start, length]) => {
    const i = deg - 1;
    const oct = Math.floor(i / steps.length);
    return { pitch: 12 * (octave + 1 + oct) + keyRoot + steps[((i % steps.length) + steps.length) % steps.length]!, start, length, velocity: 0.75 };
  });
}

function track(id: IdFn, name: string, instrument: Instrument, patternId: string, bars: number, patSteps: number, opts: Partial<StudioTrack> = {}): StudioTrack {
  return {
    id: id("st_"),
    name,
    kind: "instrument",
    volumeDb: 0,
    pan: 0,
    mute: false,
    solo: false,
    fx: [],
    reverbSend: 0,
    sidechain: 0,
    regions: [],
    instrument,
    placements: [{ id: id("pl_"), patternId, bar: 0, repeat: Math.max(1, Math.ceil((bars * 16) / patSteps)) }],
    automation: {},
    ...opts,
  };
}

/** Build an editable session for a mood. `keyRoot` 0 = C. */
export function moodSession(mood: Mood, id: IdFn, opts: { bars?: number; keyRoot?: number } = {}): AudioSession {
  const pat = (name: string, steps: number, p: Partial<Pattern>): Pattern => ({ id: id("pat_"), name, steps, drums: {}, notes: [], ...p });
  const base = (name: string, bpm: number, bars: number, keyRoot: number, scale: AudioSession["scale"]): AudioSession => ({
    id: id("as_"), name, bpm, bars, keyRoot, scale, swing: 0, tracks: [], patterns: [], masterFx: [], masterDb: 0, bouncedAssetId: null, updatedAt: Date.now(),
  });
  const add = (s: AudioSession, p: Pattern, t: StudioTrack) => {
    s.patterns.push(p);
    s.tracks.push(t);
  };

  switch (mood) {
    case "upbeat": {
      const k = opts.keyRoot ?? 7; // G major
      const bars = opts.bars ?? 16;
      const s = base("Upbeat", 122, bars, k, "major");
      const prog = [1, 5, 6, 4];
      const d = pat("Drums", 16, { drums: { kick: row(16, [0, 4, 8, 12]), clap: row(16, [4, 12], 0.8), hat: row(16, [2, 6, 10, 14], 0.7), "open-hat": row(16, [14], 0.4) } });
      add(s, d, track(id, "Drums", inst("drums", "default", "studio"), d.id, bars, 16));
      const c = pat("Chords", 64, { notes: chords(k, "major", prog, 4, [0, 3, 6, 10, 12], 2, 0.5) });
      add(s, c, track(id, "Chords", inst("subtractive", "pluck"), c.id, bars, 64, { reverbSend: 0.3, sidechain: 0.5, volumeDb: -4 }));
      const b = pat("Bass", 64, { notes: bassLine(k, "major", prog, 2, [0, 4, 8, 12], 3) });
      add(s, b, track(id, "Bass", inst("subtractive", "bass"), b.id, bars, 64, { sidechain: 0.4, volumeDb: -3 }));
      const m = pat("Lead", 64, { notes: melody(k, "major", 5, [[5, 0, 2], [6, 2, 2], [5, 4, 4], [3, 10, 2], [2, 16, 2], [3, 18, 2], [5, 20, 6], [6, 32, 2], [5, 34, 2], [3, 36, 4], [1, 42, 2], [2, 48, 4], [3, 52, 4], [2, 56, 6]]) });
      add(s, m, track(id, "Lead", inst("fm", "e-piano"), m.id, bars, 64, { reverbSend: 0.25, volumeDb: -6, pan: 0.15 }));
      return s;
    }
    case "cinematic": {
      const k = opts.keyRoot ?? 2; // D minor
      const bars = opts.bars ?? 16;
      const s = base("Cinematic", 80, bars, k, "minor");
      const prog = [1, 6, 3, 7];
      const pad = pat("Strings", 64, { notes: chords(k, "minor", prog, 3, [0], 16, 0.55) });
      add(s, pad, track(id, "Strings pad", inst("subtractive", "pad"), pad.id, bars, 64, { reverbSend: 0.6, volumeDb: -2 }));
      const piano = pat("Piano", 64, { notes: chords(k, "minor", prog, 4, [0, 4, 8, 12], 4, 0.45).filter((_, i) => i % 3 === (Math.floor(i / 3) % 3)) });
      add(s, piano, track(id, "Piano", inst("fm", "e-piano"), piano.id, bars, 64, { reverbSend: 0.5, volumeDb: -5 }));
      const b = pat("Low strings", 64, { notes: bassLine(k, "minor", prog, 2, [0], 16) });
      add(s, b, track(id, "Low", inst("subtractive", "pad"), b.id, bars, 64, { reverbSend: 0.3, volumeDb: -4 }));
      const drums = pat("Toms", 32, { drums: { kick: [...row(16, [0]), ...row(16, [0, 10], 0.7)], tom: [...row(16, [12, 14], 0.6), ...row(16, [8, 12, 14], 0.7)] } });
      add(s, drums, track(id, "Epic drums", inst("drums", "default", "studio"), drums.id, bars, 32, { reverbSend: 0.4, volumeDb: -4 }));
      return s;
    }
    case "lofi": {
      const k = opts.keyRoot ?? 5; // F major-ish jazzy
      const bars = opts.bars ?? 16;
      const s = { ...base("Lo-fi chill", 78, bars, k, "major"), swing: 0.25 };
      const prog = [2, 5, 1, 6];
      const d = pat("Drums", 16, { drums: { kick: row(16, [0, 7, 10]), snare: row(16, [4, 12], 0.7), hat: row(16, [0, 2, 4, 6, 8, 10, 12, 14], 0.45), rim: row(16, [15], 0.3) } });
      add(s, d, track(id, "Drums", inst("drums", "default", "lofi"), d.id, bars, 16, { fx: [{ id: id("fx_"), type: "lofi", enabled: true, params: {} }] }));
      const c = pat("Keys", 64, { notes: chords(k, "major", prog, 4, [0, 7], 6, 0.5) });
      add(s, c, track(id, "Keys", inst("fm", "e-piano"), c.id, bars, 64, { reverbSend: 0.35, volumeDb: -3, fx: [{ id: id("fx_"), type: "lofi", enabled: true, params: {} }] }));
      const b = pat("Bass", 64, { notes: bassLine(k, "major", prog, 2, [0, 10], 5) });
      add(s, b, track(id, "Bass", inst("subtractive", "bass"), b.id, bars, 64, { volumeDb: -5 }));
      return s;
    }
    case "suspense": {
      const k = opts.keyRoot ?? 4; // E minor
      const bars = opts.bars ?? 16;
      const s = base("Suspense", 90, bars, k, "minor");
      const drone = pat("Drone", 32, { notes: [{ pitch: 12 * 3 + k, start: 0, length: 32, velocity: 0.7 }, { pitch: 12 * 3 + k + 1, start: 16, length: 16, velocity: 0.4 }] });
      add(s, drone, track(id, "Drone", inst("subtractive", "pad"), drone.id, bars, 32, { reverbSend: 0.6 }));
      const pulse = pat("Pulse", 16, { notes: Array.from({ length: 8 }, (_, i) => ({ pitch: 12 * 2 + k, start: i * 2, length: 1, velocity: i % 4 === 0 ? 0.9 : 0.6 })) });
      add(s, pulse, track(id, "Pulse", inst("subtractive", "bass"), pulse.id, bars, 16, { volumeDb: -4 }));
      const beat = pat("Heartbeat", 16, { drums: { kick: row(16, [0, 3], 0.8), perc: row(16, [10], 0.3) } });
      add(s, beat, track(id, "Heartbeat", inst("drums", "default", "808"), beat.id, bars, 16, { volumeDb: -3 }));
      const ping = pat("Ping", 64, { notes: melody(k, "minor", 5, [[1, 0, 2], [6, 24, 2], [5, 40, 2], [2, 56, 4]]) });
      add(s, ping, track(id, "Bells", inst("fm", "bell"), ping.id, bars, 64, { reverbSend: 0.8, volumeDb: -8 }));
      return s;
    }
    case "theme": {
      const k = opts.keyRoot ?? 0; // C major
      const bars = opts.bars ?? 8;
      const s = base("Theme / intro", 110, bars, k, "major");
      const prog = [1, 4, 6, 5];
      const d = pat("Drums", 16, { drums: { kick: row(16, [0, 8, 11]), snare: row(16, [4, 12]), hat: row(16, [0, 2, 4, 6, 8, 10, 12, 14], 0.55) } });
      add(s, d, track(id, "Drums", inst("drums", "default", "studio"), d.id, bars, 16));
      const brass = pat("Brass", 64, { notes: chords(k, "major", prog, 4, [0, 6, 8], 2, 0.6) });
      add(s, brass, track(id, "Brass", inst("fm", "brass"), brass.id, bars, 64, { reverbSend: 0.3, volumeDb: -4 }));
      const m = pat("Hook", 64, { notes: melody(k, "major", 5, [[1, 0, 2], [3, 2, 2], [5, 4, 4], [8, 8, 6], [6, 16, 2], [5, 18, 2], [4, 20, 4], [6, 24, 6], [5, 32, 2], [3, 34, 2], [5, 36, 4], [8, 40, 4], [7, 48, 4], [5, 52, 4], [2, 56, 6]]) });
      add(s, m, track(id, "Hook", inst("subtractive", "lead"), m.id, bars, 64, { reverbSend: 0.25, volumeDb: -6 }));
      const b = pat("Bass", 64, { notes: bassLine(k, "major", prog, 2, [0, 6, 8], 2) });
      add(s, b, track(id, "Bass", inst("bass808", "808"), b.id, bars, 64, { volumeDb: -4 }));
      return s;
    }
    case "stinger": {
      const k = opts.keyRoot ?? 9;
      const s = base("Stinger", 120, opts.bars ?? 2, k, "minor");
      const hit = pat("Hit", 32, { notes: [...chords(k, "minor", [1], 3, [0], 20, 0.8), ...melody(k, "minor", 5, [[1, 0, 1], [3, 1, 1], [5, 2, 1], [8, 3, 14]])] });
      add(s, hit, track(id, "Brass hit", inst("fm", "brass"), hit.id, s.bars, 32, { reverbSend: 0.5 }));
      const d = pat("Drums", 32, { drums: { kick: row(32, [0]), clap: row(32, [0], 0.8), tom: [...row(16, [8, 10, 12, 14], 0.7), ...row(16, [], 0)] } });
      add(s, d, track(id, "Drums", inst("drums", "default", "studio"), d.id, s.bars, 32));
      return s;
    }
  }
}
