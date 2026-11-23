"use client";

import {
  encodeWav,
  integratedLufs,
  loadDsp,
  removeVocals,
  renderStudio,
  separateStems,
  starterDrums,
  type Pcm,
  type StudioRender,
} from "@just-see/engine";
import {
  createId,
  createMediaClip,
  getSequence,
  type Asset,
  type AudioSession,
  type Command,
  type Instrument,
  type StudioTrack,
} from "@just-see/schema";
import { useEditor } from "./editor-store";
import { assetPcm, invalidatePcm } from "./audio-tools";
import { importFile, invalidateAsset } from "./media";
import { db } from "./storage/db";

async function savePeaksReset(assetId: string): Promise<void> {
  const d = await db();
  await d.delete("peaks", assetId);
  await d.delete("thumbs", assetId);
}
import { putMedia } from "./storage/media-store";

export function newSession(name = "My beat"): AudioSession {
  const drums = createId("pat_");
  return {
    id: createId("as_"),
    name,
    bpm: 100,
    bars: 8,
    keyRoot: 9,
    scale: "minor",
    swing: 0,
    masterFx: [],
    masterDb: 0,
    bouncedAssetId: null,
    updatedAt: Date.now(),
    patterns: [{ id: drums, name: "Drums", steps: 16, drums: starterDrums(), notes: [] }],
    tracks: [newTrack("Drums", { kind: "drums", preset: "default", params: {}, assetId: null, rootNote: 60, kit: "808" }, drums, 8)],
  };
}

export function newTrack(name: string, instrument: Instrument | null, patternId?: string, bars = 8): StudioTrack {
  return {
    id: createId("st_"),
    name,
    kind: instrument ? "instrument" : "audio",
    volumeDb: 0,
    pan: 0,
    mute: false,
    solo: false,
    fx: [],
    reverbSend: 0,
    sidechain: 0,
    regions: [],
    instrument,
    placements: patternId ? [{ id: createId("pl_"), patternId, bar: 0, repeat: bars }] : [],
    automation: {},
  };
}

export function getSession(id: string): AudioSession | undefined {
  return useEditor.getState().history?.project.audioSessions?.find((s) => s.id === id);
}

/** Apply a change to a session as one undoable command. */
export function updateSession(id: string, fn: (s: AudioSession) => void, label?: string): boolean {
  const cur = getSession(id);
  if (!cur) return false;
  const next = structuredClone(cur);
  fn(next);
  next.updatedAt = Date.now();
  // Patterns on the song repeat to fill the song length.
  for (const t of next.tracks) for (const pl of t.placements) if (pl.bar === 0) pl.repeat = Math.max(1, Math.ceil((next.bars * 16) / (next.patterns.find((p) => p.id === pl.patternId)?.steps ?? 16)));
  void label;
  return useEditor.getState().dispatch({ type: "session/put", payload: { session: next } });
}

async function sourcesFor(session: AudioSession): Promise<Map<string, Pcm>> {
  const project = useEditor.getState().history?.project;
  const ids = new Set<string>();
  for (const t of session.tracks) {
    for (const r of t.regions) ids.add(r.assetId);
    if (t.instrument?.assetId) ids.add(t.instrument.assetId);
  }
  const out = new Map<string, Pcm>();
  for (const id of ids) {
    const a = project?.assets.find((x) => x.id === id);
    if (a) out.set(id, await assetPcm(a));
  }
  return out;
}

let renderJob: { key: string; result: Promise<StudioRender> } | null = null;

/** Render (cached for the current session state). */
export function renderSession(session: AudioSession, sampleRate = 44100): Promise<StudioRender> {
  const key = JSON.stringify([session, sampleRate]);
  if (renderJob?.key === key) return renderJob.result;
  const result = (async () => renderStudio(session, await sourcesFor(session), await loadDsp(), sampleRate))();
  renderJob = { key, result };
  return result;
}

let ctx: AudioContext | null = null;
let current: AudioBufferSourceNode | null = null;
let startedAt = 0;
let offset = 0;

export function audioContext(): AudioContext {
  ctx ??= new AudioContext({ latencyHint: "interactive" });
  return ctx;
}

export async function play(session: AudioSession, fromSec = 0, loop = false): Promise<StudioRender> {
  stop();
  const c = audioContext();
  if (c.state === "suspended") await c.resume();
  const r = await renderSession(session, c.sampleRate);
  const buf = c.createBuffer(2, r.channels[0].length, r.sampleRate);
  buf.copyToChannel(r.channels[0] as Float32Array<ArrayBuffer>, 0);
  buf.copyToChannel(r.channels[1] as Float32Array<ArrayBuffer>, 1);
  const src = c.createBufferSource();
  src.buffer = buf;
  src.loop = loop;
  src.connect(c.destination);
  src.start(0, Math.min(fromSec, r.durationSec - 0.01));
  current = src;
  startedAt = c.currentTime;
  offset = fromSec;
  return r;
}

export function stop(): void {
  try {
    current?.stop();
  } catch {
    // already stopped
  }
  current = null;
}

export function playheadSec(durationSec: number): number {
  if (!current || !ctx) return offset;
  const t = offset + ctx.currentTime - startedAt;
  return current.loop ? t % durationSec : Math.min(t, durationSec);
}

export function isPlaying(): boolean {
  return current !== null;
}

/** Quick audition of a note while editing (Web Audio oscillator). */
export function previewNote(pitch: number, durSec = 0.3): void {
  const c = audioContext();
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = "triangle";
  o.frequency.value = 440 * Math.pow(2, (pitch - 69) / 12);
  g.gain.setValueAtTime(0.25, c.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + durSec);
  o.connect(g).connect(c.destination);
  o.start();
  o.stop(c.currentTime + durSec);
}

export async function sessionLoudness(session: AudioSession): Promise<number> {
  const r = await renderSession(session, 44100);
  return integratedLufs(r.channels, r.sampleRate);
}

/** Render to WAV bytes. */
export async function sessionWav(session: AudioSession): Promise<Uint8Array<ArrayBuffer>> {
  const r = await renderSession(session, 48000);
  return encodeWav(r.channels, r.sampleRate);
}

/** Bounce the session into the project and put it on the video timeline (or update the earlier bounce). */
export async function sendToVideo(sessionId: string): Promise<void> {
  const s = useEditor.getState();
  const session = getSession(sessionId);
  const project = s.history?.project;
  if (!session || !project) return;
  const wav = await sessionWav(session);
  const file = new File([wav], `${session.name}.wav`, { type: "audio/wav" });
  const existing = session.bouncedAssetId ? project.assets.find((a) => a.id === session.bouncedAssetId) : undefined;
  if (existing) {
    const key = `media/${existing.id}_${Date.now()}`;
    await putMedia(key, file);
    const r = await renderSession(session, 48000);
    invalidateAsset(existing.id);
    invalidatePcm(existing.id);
    await savePeaksReset(existing.id);
    s.dispatch({ type: "asset/update", payload: { assetId: existing.id, patch: { storageKey: key, durationUs: Math.round(r.durationSec * 1e6), sizeBytes: file.size } } });
    return;
  }
  const asset: Asset = await importFile(file);
  asset.license = { kind: "user-upload", name: "Made in Just See audio studio", commercialUse: true };
  const clip = createMediaClip(asset);
  clip.startUs = 0;
  const next = structuredClone(session);
  next.bouncedAssetId = asset.id;
  const commands: Command[] = [
    { type: "asset/add", payload: { asset } },
    { type: "clip/add", payload: { sequenceId: getSequence(project).id, clip, trackType: "audio", newTrackId: createId("t_") } },
    { type: "session/put", payload: { session: next } },
  ];
  s.dispatch({ type: "batch", payload: { label: "Send to video", commands } });
}

/** Import an audio file as a region on a new or given track. */
export async function addAudioFile(sessionId: string, file: File, trackId?: string, atSec = 0): Promise<void> {
  const asset = await importFile(file);
  const s = useEditor.getState();
  s.dispatch({ type: "asset/add", payload: { asset } });
  updateSession(sessionId, (ses) => {
    let tr = trackId ? ses.tracks.find((t) => t.id === trackId) : undefined;
    if (!tr) {
      tr = newTrack(asset.name.replace(/\.[^.]+$/, "").slice(0, 40), null);
      ses.tracks.push(tr);
    }
    tr.regions.push({ id: createId("rg_"), assetId: asset.id, startUs: Math.round(atSec * 1e6), durationUs: asset.durationUs, sourceInUs: 0, gainDb: 0, fadeInUs: 0, fadeOutUs: 0, pitch: 0 });
    // Make sure the song is long enough to hold it.
    const barSec = (60 / ses.bpm) * 4;
    ses.bars = Math.max(ses.bars, Math.ceil((atSec + asset.durationUs / 1e6) / barSec));
  });
}

/** Split a region's audio into four stem tracks (free, non-AI method). */
export async function splitStems(sessionId: string, trackId: string, regionId: string, karaokeOnly = false): Promise<void> {
  const session = getSession(sessionId);
  const project = useEditor.getState().history?.project;
  const tr = session?.tracks.find((t) => t.id === trackId);
  const rg = tr?.regions.find((r) => r.id === regionId);
  const asset = rg && project?.assets.find((a) => a.id === rg.assetId);
  if (!session || !tr || !rg || !asset) return;
  const pcm = await assetPcm(asset);
  const dsp = await loadDsp();
  const a = Math.round(((rg.sourceInUs - pcm.startUs) / 1e6) * pcm.sampleRate);
  const b = a + Math.round((rg.durationUs / 1e6) * pcm.sampleRate);
  const ch = [pcm.channels[0]!.slice(a, b), (pcm.channels[1] ?? pcm.channels[0]!).slice(a, b)];
  const parts: [string, Float32Array[]][] = karaokeOnly
    ? [["Instrumental", removeVocals(ch, pcm.sampleRate, dsp)]]
    : Object.entries(separateStems(ch, pcm.sampleRate, dsp));
  const assets: Asset[] = [];
  for (const [name, data] of parts) {
    const f = new File([encodeWav(data, pcm.sampleRate)], `${asset.name} - ${name}.wav`, { type: "audio/wav" });
    assets.push(await importFile(f));
  }
  const s = useEditor.getState();
  s.dispatch({ type: "batch", payload: { label: "Stems", commands: assets.map((x) => ({ type: "asset/add", payload: { asset: x } }) as Command) } });
  updateSession(sessionId, (ses) => {
    const orig = ses.tracks.find((t) => t.id === trackId);
    if (orig) orig.mute = true;
    parts.forEach(([name], i) => {
      const t = newTrack(name[0]!.toUpperCase() + name.slice(1), null);
      t.regions.push({ id: createId("rg_"), assetId: assets[i]!.id, startUs: rg.startUs, durationUs: rg.durationUs, sourceInUs: 0, gainDb: 0, fadeInUs: 0, fadeOutUs: 0, pitch: 0 });
      ses.tracks.push(t);
    });
  });
}

/** Record from the microphone into a new audio track. */
export async function recordMic(sessionId: string, seconds: number, onLevel?: (v: number) => void): Promise<void> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
  const rec = new MediaRecorder(stream);
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => chunks.push(e.data);
  const c = audioContext();
  const an = c.createAnalyser();
  c.createMediaStreamSource(stream).connect(an);
  const data = new Float32Array(an.fftSize);
  const timer = window.setInterval(() => {
    an.getFloatTimeDomainData(data);
    let m = 0;
    for (const v of data) m = Math.max(m, Math.abs(v));
    onLevel?.(m);
  }, 60);
  const startSec = isPlaying() ? playheadSec(9999) : 0;
  rec.start();
  await new Promise((r) => setTimeout(r, seconds * 1000));
  await new Promise<void>((r) => {
    rec.onstop = () => r();
    rec.stop();
  });
  window.clearInterval(timer);
  stream.getTracks().forEach((t) => t.stop());
  const blob = new Blob(chunks, { type: rec.mimeType || "audio/webm" });
  const ext = blob.type.includes("mp4") ? "m4a" : "webm";
  await addAudioFile(sessionId, new File([blob], `Recording ${new Date().toLocaleTimeString()}.${ext}`, { type: blob.type }), undefined, startSec);
}

/** Listen to a MIDI keyboard; calls back with note-on events. */
export async function connectMidi(onNote: (pitch: number, velocity: number) => void): Promise<boolean> {
  const nav = navigator as Navigator & { requestMIDIAccess?: () => Promise<{ inputs: Map<string, { onmidimessage: ((e: { data: Uint8Array }) => void) | null }> }> };
  if (!nav.requestMIDIAccess) return false;
  try {
    const access = await nav.requestMIDIAccess();
    for (const input of access.inputs.values()) {
      input.onmidimessage = (e) => {
        const [st, note, vel] = e.data ?? [];
        if (st !== undefined && (st & 0xf0) === 0x90 && (vel ?? 0) > 0) onNote(note ?? 60, (vel ?? 100) / 127);
      };
    }
    return access.inputs.size > 0;
  } catch {
    return false;
  }
}
