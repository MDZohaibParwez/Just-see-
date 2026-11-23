import { describe, expect, it } from "vitest";
import { barSeconds, chordNotes, inScale, type AudioSession } from "@just-see/schema";
import { loadDsp, renderStudio, rms, starterDrums, SYNTH_PRESETS, DRUM_KITS, decodeWav, encodeWav } from "./index";

function beatSession(): AudioSession {
  return {
    id: "s",
    name: "Beat",
    bpm: 120,
    bars: 16,
    keyRoot: 9,
    scale: "minor",
    swing: 0,
    masterFx: [],
    masterDb: 0,
    bouncedAssetId: null,
    updatedAt: 0,
    patterns: [
      { id: "d", name: "Drums", steps: 16, drums: starterDrums(), notes: [] },
      { id: "m", name: "Chords", steps: 64, drums: {}, notes: [57, 60, 64].flatMap((p) => [{ pitch: p, start: 0, length: 16, velocity: 0.7 }, { pitch: p - 2, start: 32, length: 16, velocity: 0.7 }]) },
      { id: "b", name: "Bass", steps: 16, drums: {}, notes: [{ pitch: 33, start: 0, length: 4, velocity: 0.9 }, { pitch: 33, start: 8, length: 4, velocity: 0.9 }] },
    ],
    tracks: [
      { id: "t1", name: "Drums", kind: "instrument", volumeDb: 0, pan: 0, mute: false, solo: false, fx: [], reverbSend: 0, sidechain: 0, regions: [], instrument: { kind: "drums", preset: "default", params: {}, assetId: null, rootNote: 60, kit: "808" }, placements: [{ id: "p1", patternId: "d", bar: 0, repeat: 16 }], automation: {} },
      { id: "t2", name: "Pad", kind: "instrument", volumeDb: -6, pan: -0.3, mute: false, solo: false, fx: [], reverbSend: 0.4, sidechain: 0.8, regions: [], instrument: { kind: "subtractive", preset: "pad", params: {}, assetId: null, rootNote: 60, kit: "808" }, placements: [{ id: "p2", patternId: "m", bar: 0, repeat: 4 }], automation: {} },
      { id: "t3", name: "808", kind: "instrument", volumeDb: -3, pan: 0, mute: false, solo: false, fx: [], reverbSend: 0, sidechain: 0, regions: [], instrument: { kind: "bass808", preset: "808", params: {}, assetId: null, rootNote: 60, kit: "808" }, placements: [{ id: "p3", patternId: "b", bar: 0, repeat: 16 }], automation: { volume: [{ bar: 0, value: -30 }, { bar: 4, value: -3 }] } },
    ],
  };
}

describe("studio render (Phase 3 done-when, part 2)", () => {
  it("renders a 16-bar beat with drums, synth, 808, sidechain and reverb", async () => {
    const dsp = await loadDsp();
    const s = beatSession();
    const r = await renderStudio(s, new Map(), dsp, 22050);
    expect(r.durationSec).toBeCloseTo(16 * barSeconds(120));
    expect(r.durationSec).toBeCloseTo(32);
    // 3 kicks per bar for 16 bars.
    expect(r.kicks).toHaveLength(48);
    const L = r.channels[0];
    expect(L.every((v) => Number.isFinite(v))).toBe(true);
    expect(rms(L)).toBeGreaterThan(0.05);
    // Every bar has sound.
    const bar = Math.round(barSeconds(120) * 22050);
    for (let b = 0; b < 16; b++) expect(rms(L, b * bar, (b + 1) * bar), `bar ${b}`).toBeGreaterThan(0.01);
  }, 60_000);

  it("mute, solo and automation change the mix", async () => {
    const dsp = await loadDsp();
    const s = beatSession();
    s.bars = 2;
    s.tracks[0]!.placements[0]!.repeat = 2;
    s.tracks[2]!.placements[0]!.repeat = 2;
    const solo808 = { ...s, tracks: s.tracks.map((t) => ({ ...t, solo: t.id === "t3" })) };
    const r = await renderStudio(solo808, new Map(), dsp, 22050);
    expect(r.kicks).toHaveLength(6); // kicks still counted for sidechain
    // Volume automation: bar 0 is much quieter than bar 1.
    const bar = Math.round(barSeconds(120) * 22050);
    expect(rms(r.channels[0], 0, bar)).toBeLessThan(rms(r.channels[0], bar, 2 * bar) * 0.6);
    const muted = { ...s, tracks: s.tracks.map((t) => ({ ...t, mute: true })) };
    const m = await renderStudio(muted, new Map(), dsp, 22050);
    expect(rms(m.channels[0])).toBe(0);
  }, 60_000);

  it("plays audio regions with gain and the sampler", async () => {
    const dsp = await loadDsp();
    const sr = 22050;
    const tone = new Float32Array(sr).map((_, i) => Math.sin((2 * Math.PI * 440 * i) / sr) * 0.5);
    const s = beatSession();
    s.bars = 1;
    s.tracks = [
      { ...s.tracks[0]!, id: "a", kind: "audio", instrument: null, placements: [], regions: [{ id: "r", assetId: "x", startUs: 500_000, durationUs: 500_000, sourceInUs: 0, gainDb: -6, fadeInUs: 0, fadeOutUs: 0, pitch: 0 }] },
    ];
    const r = await renderStudio(s, new Map([["x", { sampleRate: sr, channels: [tone], startUs: 0 }]]), dsp, sr);
    expect(rms(r.channels[0], 0, sr / 2 - 100)).toBe(0);
    expect(rms(r.channels[0], sr / 2 + 100, sr - 100)).toBeGreaterThan(0.15);
  });

  it("covers presets, kits, scales and chords", () => {
    expect(SYNTH_PRESETS.length).toBeGreaterThanOrEqual(8);
    expect(DRUM_KITS).toEqual(expect.arrayContaining(["808", "studio", "lofi"]));
    expect(inScale(57, 9, "minor")).toBe(true);
    expect(inScale(58, 9, "minor")).toBe(false);
    expect(chordNotes(57, 9, "minor")).toEqual([57, 60, 64]); // A minor
  });

  it("round-trips WAV", () => {
    const x = new Float32Array([0, 0.5, -0.5, 1]);
    const w = decodeWav(encodeWav([x, x], 8000));
    expect(w.sampleRate).toBe(8000);
    expect(w.channels[0]![1]).toBeCloseTo(0.5, 3);
  });
});
