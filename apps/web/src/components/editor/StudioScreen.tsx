"use client";

import { useEffect, useMemo, useState } from "react";
import { create } from "zustand";
import { AUDIO_FX, DRUM_KITS, MOODS, SYNTH_PRESETS, moodSession, type Mood } from "@just-see/engine";
import { DRUM_PADS, SCALES, chordNotes, createId, inScale, type AudioSession, type Instrument, type StudioTrack } from "@just-see/schema";
import { Icon } from "@just-see/ui";
import { useEditor } from "@/lib/editor-store";
import { useT, type MessageKey } from "@/lib/i18n";
import {
  addAudioFile,
  connectMidi,
  isPlaying,
  newSession,
  newTrack,
  play,
  playheadSec,
  previewNote,
  recordMic,
  sendToVideo,
  sessionLoudness,
  sessionWav,
  splitStems,
  stop,
  updateSession,
} from "@/lib/studio";
import { Chip } from "./controls";

/** Which studio session is open ("home" = session picker). */
export const useStudioUi = create<{ openId: string | null; open(id: string | null): void }>((set) => ({
  openId: null,
  open: (openId) => set({ openId }),
}));

const NO_ASSETS: never[] = [];
const NO_SESSIONS: AudioSession[] = [];
const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const noteName = (p: number) => `${NOTE_NAMES[p % 12]}${Math.floor(p / 12) - 1}`;

type Tab = "beat" | "piano" | "mixer" | "audio";

export function StudioScreen() {
  const openId = useStudioUi((s) => s.openId);
  const sessions = useEditor((s) => s.history?.project.audioSessions ?? NO_SESSIONS);
  useEffect(() => () => stop(), []);
  if (!openId) return null;
  const session = sessions.find((s) => s.id === openId);
  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-bg" role="dialog" aria-label="Audio studio" data-testid="studio">
      {session ? <SessionView session={session} /> : <StudioHome sessions={sessions} />}
    </div>
  );
}

function StudioHome({ sessions }: { sessions: AudioSession[] }) {
  const t = useT();
  const createSession = (s: AudioSession) => {
    useEditor.getState().dispatch({ type: "session/put", payload: { session: s } });
    useStudioUi.getState().open(s.id);
  };
  return (
    <>
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-3">
        <button type="button" className="flex h-9 w-9 items-center justify-center rounded-full bg-surface-2" aria-label={t("studioBack")} onClick={() => useStudioUi.getState().open(null)} data-testid="studio-close">
          <Icon name="back" size={18} />
        </button>
        <h1 className="text-base font-semibold">{t("studio")}</h1>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <button type="button" data-testid="studio-new" className="mb-3 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-accent text-accent-contrast" onClick={() => createSession(newSession())}>
          <Icon name="plus" size={18} />
          {t("studioNew")}
        </button>
        <h2 className="mb-2 text-sm font-semibold">{t("studioMoods")}</h2>
        <div className="mb-4 grid grid-cols-2 gap-2">
          {MOODS.map((m) => (
            <button
              key={m.id}
              type="button"
              data-testid={`mood-${m.id}`}
              className="rounded-xl border border-line bg-surface-2 p-3 text-left active:scale-95"
              onClick={() => createSession(moodSession(m.id as Mood, createId))}
            >
              <div className="text-sm font-medium">{m.label}</div>
              <div className="text-xs text-muted">{m.hint}</div>
            </button>
          ))}
        </div>
        {sessions.length > 0 && (
          <>
            <h2 className="mb-2 text-sm font-semibold">{t("studioYours")}</h2>
            <ul className="flex flex-col gap-2">
              {sessions.map((s) => (
                <li key={s.id}>
                  <button type="button" className="flex w-full items-center justify-between rounded-xl border border-line bg-surface-2 px-3 py-3 text-sm" onClick={() => useStudioUi.getState().open(s.id)}>
                    <span>{s.name}</span>
                    <span className="text-xs text-muted">
                      {s.bpm} BPM · {s.bars} {t("studioBars")}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
        <p className="mt-4 text-center text-[11px] text-muted">{t("studioOwnMusic")}</p>
      </div>
    </>
  );
}

function SessionView({ session }: { session: AudioSession }) {
  const t = useT();
  const [tab, setTab] = useState<Tab>("beat");
  const [trackId, setTrackId] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [lufs, setLufs] = useState<number | null>(null);
  const [head, setHead] = useState(0);
  const toast = useEditor((s) => s.toast);
  const up = (fn: (s: AudioSession) => void) => updateSession(session.id, fn);
  const track = session.tracks.find((x) => x.id === trackId) ?? session.tracks[0] ?? null;
  const stepSec = 60 / session.bpm / 4;

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      setHead(playheadSec(9999));
      if (!isPlaying()) setPlaying(false);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  // Restart playback when the music changes so the user hears edits.
  useEffect(() => {
    setLufs(null);
    if (!isPlaying()) return;
    const at = playheadSec(9999);
    void play(session, at, true);
  }, [session]);

  const togglePlay = async () => {
    if (playing) {
      stop();
      setPlaying(false);
      return;
    }
    setBusy("render");
    try {
      await play(session, 0, true);
      setPlaying(true);
    } finally {
      setBusy(null);
    }
  };

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try {
      await fn();
    } catch (e) {
      console.error(e);
      toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setBusy(null);
    }
  };

  const exportWav = () =>
    run("wav", async () => {
      const wav = await sessionWav(session);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([wav], { type: "audio/wav" }));
      a.download = `${session.name}.wav`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    });

  return (
    <>
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-2">
        <button type="button" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-2" aria-label={t("studioBack")} onClick={() => { stop(); useStudioUi.getState().open("home"); }} data-testid="studio-back">
          <Icon name="back" size={18} />
        </button>
        <input
          className="min-w-0 flex-1 bg-transparent text-sm font-semibold outline-none"
          value={session.name}
          aria-label={t("studioName")}
          onChange={(e) => up((s) => void (s.name = e.target.value.slice(0, 200)))}
        />
        <button type="button" data-testid="studio-play" onClick={() => void togglePlay()} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-accent-contrast" aria-label={playing ? t("studioStop") : t("studioPlay")}>
          {busy === "render" ? <span className="text-xs">…</span> : <Icon name={playing ? "pause" : "play"} size={18} />}
        </button>
        <button type="button" data-testid="studio-send" disabled={!!busy} onClick={() => void run("send", async () => { await sendToVideo(session.id); toast(t("studioSent")); })} className="h-9 shrink-0 rounded-full bg-surface-2 px-3 text-xs">
          {busy === "send" ? "…" : t("studioSendToVideo")}
        </button>
      </header>

      <div className="no-scrollbar flex shrink-0 items-center gap-2 overflow-x-auto border-b border-line px-2 py-2 text-xs">
        <label className="flex items-center gap-1">
          BPM
          <input data-testid="studio-bpm" type="number" min={40} max={240} value={session.bpm} className="w-14 rounded-lg bg-surface-2 px-1 py-1" onChange={(e) => { const v = Number(e.target.value); if (v >= 40 && v <= 240) up((s) => void (s.bpm = v)); }} />
        </label>
        <label className="flex items-center gap-1">
          {t("studioBars")}
          <select data-testid="studio-bars" value={session.bars} className="rounded-lg bg-surface-2 px-1 py-1" onChange={(e) => up((s) => void (s.bars = Number(e.target.value)))}>
            {[1, 2, 4, 8, 12, 16, 24, 32, 64].map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-1">
          {t("studioKey")}
          <select value={session.keyRoot} className="rounded-lg bg-surface-2 px-1 py-1" onChange={(e) => up((s) => void (s.keyRoot = Number(e.target.value)))}>
            {NOTE_NAMES.map((n, i) => <option key={n} value={i}>{n}</option>)}
          </select>
          <select value={session.scale} className="rounded-lg bg-surface-2 px-1 py-1" onChange={(e) => up((s) => void (s.scale = e.target.value as AudioSession["scale"]))}>
            {Object.keys(SCALES).map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-1">
          Swing
          <input type="range" min={0} max={0.6} step={0.05} value={session.swing} onChange={(e) => up((s) => void (s.swing = Number(e.target.value)))} className="w-16" />
        </label>
        <button type="button" data-testid="studio-lufs" className="rounded-lg bg-surface-2 px-2 py-1" onClick={() => void run("lufs", async () => setLufs(await sessionLoudness(session)))}>
          {lufs === null ? t("studioLoudness") : `${lufs.toFixed(1)} LUFS`}
        </button>
        <button type="button" data-testid="studio-wav" className="rounded-lg bg-surface-2 px-2 py-1" onClick={() => void exportWav()}>
          {busy === "wav" ? "…" : t("studioExportWav")}
        </button>
      </div>

      <div className="flex shrink-0 gap-2 px-2 py-2">
        {(["beat", "piano", "mixer", "audio"] as const).map((k) => (
          <Chip key={k} active={tab === k} onClick={() => setTab(k)} testId={`studio-tab-${k}`}>
            {t(`studio_${k}` as MessageKey)}
          </Chip>
        ))}
      </div>

      <TrackBar session={session} selected={track} onSelect={setTrackId} />

      <div className="min-h-0 flex-1 overflow-auto px-2 pb-4">
        {tab === "beat" && <StepSequencer session={session} track={track} headStep={playing ? Math.floor(head / stepSec) : -1} />}
        {tab === "piano" && <PianoRoll session={session} track={track} headStep={playing ? Math.floor(head / stepSec) : -1} />}
        {tab === "mixer" && <Mixer session={session} />}
        {tab === "audio" && <AudioEdit session={session} busy={busy} run={run} />}
      </div>
    </>
  );
}

function TrackBar({ session, selected, onSelect }: { session: AudioSession; selected: StudioTrack | null; onSelect: (id: string) => void }) {
  const t = useT();
  const [adding, setAdding] = useState(false);
  const addInstrument = (name: string, instrument: Instrument, steps: number) => {
    const pid = createId("pat_");
    let newId = "";
    updateSession(session.id, (s) => {
      s.patterns.push({ id: pid, name, steps, drums: {}, notes: [] });
      const tr = newTrack(name, instrument, pid, s.bars);
      newId = tr.id;
      s.tracks.push(tr);
    });
    onSelect(newId);
    setAdding(false);
  };
  const inst = (kind: Instrument["kind"], preset: string): Instrument => ({ kind, preset, params: {}, assetId: null, rootNote: 60, kit: "808" });
  return (
    <div className="shrink-0 px-2 pb-2">
      <div className="no-scrollbar flex gap-2 overflow-x-auto">
        {session.tracks.map((tr) => (
          <Chip key={tr.id} active={selected?.id === tr.id} onClick={() => onSelect(tr.id)} testId={`studio-track-${tr.name}`}>
            {tr.name}
          </Chip>
        ))}
        <Chip onClick={() => setAdding((v) => !v)} testId="studio-add-track">
          + {t("studioAddTrack")}
        </Chip>
      </div>
      {adding && (
        <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
          <button type="button" data-testid="add-track-drums" className="rounded-xl bg-surface-2 p-2" onClick={() => addInstrument("Drums 2", inst("drums", "default"), 16)}>{t("studioDrums")}</button>
          <button type="button" data-testid="add-track-808" className="rounded-xl bg-surface-2 p-2" onClick={() => addInstrument("808", inst("bass808", "808"), 64)}>808</button>
          {SYNTH_PRESETS.filter((p) => p.kind !== "bass808").map((p) => (
            <button key={p.id} type="button" data-testid={`add-track-${p.id}`} className="rounded-xl bg-surface-2 p-2" onClick={() => addInstrument(p.label, inst(p.kind, p.id), 64)}>
              {p.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function patternOf(session: AudioSession, track: StudioTrack | null) {
  const pid = track?.placements[0]?.patternId;
  return pid ? session.patterns.find((p) => p.id === pid) : undefined;
}

function StepSequencer({ session, track, headStep }: { session: AudioSession; track: StudioTrack | null; headStep: number }) {
  const t = useT();
  const pattern = patternOf(session, track);
  if (!track || track.instrument?.kind !== "drums" || !pattern) return <p className="p-4 text-center text-sm text-muted">{t("studioPickDrums")}</p>;
  const toggle = (pad: string, i: number) =>
    updateSession(session.id, (s) => {
      const p = s.patterns.find((x) => x.id === pattern.id);
      if (!p) return;
      const r = p.drums[pad] ?? Array.from({ length: p.steps }, () => 0);
      while (r.length < p.steps) r.push(0);
      r[i] = r[i] ? 0 : i % 4 === 0 ? 0.95 : 0.75;
      p.drums[pad] = r;
    });
  const hs = headStep >= 0 ? headStep % pattern.steps : -1;
  return (
    <div>
      <div className="mb-2 flex items-center gap-2 text-xs">
        <span className="text-muted">Kit</span>
        {DRUM_KITS.map((k) => (
          <Chip key={k} active={track.instrument?.kit === k} onClick={() => updateSession(session.id, (s) => { const tr = s.tracks.find((x) => x.id === track.id); if (tr?.instrument) tr.instrument.kit = k; })}>
            {k}
          </Chip>
        ))}
        <PatternLength session={session} patternId={pattern.id} steps={pattern.steps} />
      </div>
      <div className="inline-flex flex-col gap-1">
        {DRUM_PADS.map((pad) => (
          <div key={pad} className="flex items-center gap-[3px]">
            <span className="w-16 shrink-0 text-[11px] text-muted">{pad}</span>
            {Array.from({ length: pattern.steps }, (_, i) => {
              const on = (pattern.drums[pad]?.[i] ?? 0) > 0;
              return (
                <button
                  key={i}
                  type="button"
                  data-testid={`step-${pad}-${i}`}
                  aria-pressed={on}
                  aria-label={`${pad} step ${i + 1}`}
                  onClick={() => toggle(pad, i)}
                  className={`h-8 w-7 shrink-0 rounded-md ${on ? "bg-accent" : i % 4 === 0 ? "bg-surface-3" : "bg-surface-2"} ${hs === i ? "ring-2 ring-fg" : ""} ${i % 16 === 15 ? "mr-2" : ""}`}
                />
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function PatternLength({ session, patternId, steps }: { session: AudioSession; patternId: string; steps: number }) {
  const t = useT();
  return (
    <label className="ml-auto flex items-center gap-1">
      {t("studioPatternLen")}
      <select
        value={steps}
        className="rounded-lg bg-surface-2 px-1 py-1"
        onChange={(e) =>
          updateSession(session.id, (s) => {
            const p = s.patterns.find((x) => x.id === patternId);
            if (!p) return;
            p.steps = Number(e.target.value);
            for (const k of Object.keys(p.drums)) {
              const r = p.drums[k]!;
              p.drums[k] = Array.from({ length: p.steps }, (_, i) => r[i] ?? r[i % Math.max(1, r.length)] ?? 0);
            }
            p.notes = p.notes.filter((n) => n.start < p.steps);
          })
        }
      >
        {[16, 32, 64, 128].map((n) => <option key={n} value={n}>{n / 16} bar{n > 16 ? "s" : ""}</option>)}
      </select>
    </label>
  );
}

function PianoRoll({ session, track, headStep }: { session: AudioSession; track: StudioTrack | null; headStep: number }) {
  const t = useT();
  const [chordMode, setChordMode] = useState(false);
  const [len, setLen] = useState(2);
  const [scaleOnly, setScaleOnly] = useState(true);
  const pattern = patternOf(session, track);
  const isBass = track?.instrument?.kind === "bass808" || track?.instrument?.preset === "bass";
  const low = (isBass ? 36 : 48) + session.keyRoot;
  const rows = useMemo(() => {
    const out: number[] = [];
    for (let p = low + 24; p >= low; p--) if (!scaleOnly || inScale(p, session.keyRoot, session.scale)) out.push(p);
    return out;
  }, [low, scaleOnly, session.keyRoot, session.scale]);
  if (!track || !track.instrument || track.instrument.kind === "drums" || !pattern) return <p className="p-4 text-center text-sm text-muted">{t("studioPickSynth")}</p>;
  const toggle = (pitch: number, step: number) => {
    const pitches = chordMode ? chordNotes(pitch, session.keyRoot, session.scale) : [pitch];
    const exists = pattern.notes.some((n) => n.pitch === pitch && step >= n.start && step < n.start + n.length);
    if (!exists) previewNote(pitch);
    updateSession(session.id, (s) => {
      const p = s.patterns.find((x) => x.id === pattern.id);
      if (!p) return;
      if (exists) p.notes = p.notes.filter((n) => !(pitches.includes(n.pitch) && step >= n.start && step < n.start + n.length));
      else for (const pc of pitches) p.notes.push({ pitch: pc, start: step, length: Math.min(len, p.steps - step), velocity: 0.8 });
    });
  };
  const hs = headStep >= 0 ? headStep % pattern.steps : -1;
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
        <select
          aria-label="Sound"
          value={track.instrument.preset}
          className="rounded-lg bg-surface-2 px-1 py-1"
          onChange={(e) => {
            const pr = SYNTH_PRESETS.find((x) => x.id === e.target.value);
            if (pr) updateSession(session.id, (s) => { const tr = s.tracks.find((x) => x.id === track.id); if (tr?.instrument) { tr.instrument.kind = pr.kind; tr.instrument.preset = pr.id; } });
          }}
        >
          {SYNTH_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
        <Chip active={chordMode} onClick={() => setChordMode((v) => !v)} testId="pr-chord">{t("studioChordMode")}</Chip>
        <Chip active={scaleOnly} onClick={() => setScaleOnly((v) => !v)}>{t("studioScaleOnly")}</Chip>
        <label className="flex items-center gap-1">
          {t("studioNoteLen")}
          <select value={len} className="rounded-lg bg-surface-2 px-1 py-1" onChange={(e) => setLen(Number(e.target.value))}>
            {[1, 2, 4, 8, 16].map((n) => <option key={n} value={n}>{n}/16</option>)}
          </select>
        </label>
        <PatternLength session={session} patternId={pattern.id} steps={pattern.steps} />
      </div>
      <div className="inline-flex flex-col gap-[2px]">
        {rows.map((pitch) => (
          <div key={pitch} className="flex items-center gap-[2px]">
            <span className={`w-10 shrink-0 text-[10px] ${pitch % 12 === session.keyRoot ? "font-semibold text-fg" : "text-muted"}`}>{noteName(pitch)}</span>
            {Array.from({ length: pattern.steps }, (_, i) => {
              const n = pattern.notes.find((x) => x.pitch === pitch && i >= x.start && i < x.start + x.length);
              const head = n && Math.floor(n.start) === i;
              return (
                <button
                  key={i}
                  type="button"
                  data-testid={`pr-${pitch}-${i}`}
                  aria-pressed={!!n}
                  aria-label={`${noteName(pitch)} step ${i + 1}`}
                  onClick={() => toggle(pitch, i)}
                  className={`h-6 w-6 shrink-0 ${n ? (head ? "rounded-l-md bg-accent" : "bg-accent/70") : i % 4 === 0 ? "bg-surface-3" : "bg-surface-2"} ${hs === i ? "outline outline-1 outline-fg" : ""} ${i % 16 === 15 ? "mr-1" : ""}`}
                />
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

const MIX_FX = AUDIO_FX.filter((f) => f.type !== "time-stretch");

function Mixer({ session }: { session: AudioSession }) {
  const t = useT();
  const set = (id: string, fn: (tr: StudioTrack) => void) => updateSession(session.id, (s) => { const tr = s.tracks.find((x) => x.id === id); if (tr) fn(tr); });
  return (
    <div className="flex flex-col gap-2">
      {session.tracks.map((tr) => (
        <div key={tr.id} className="rounded-xl border border-line bg-surface-2 p-2 text-xs" data-testid={`mixer-${tr.name}`}>
          <div className="mb-1 flex items-center gap-2">
            <span className="flex-1 truncate text-sm font-medium">{tr.name}</span>
            <button type="button" data-testid={`mute-${tr.name}`} aria-pressed={tr.mute} className={`h-7 w-7 rounded-md ${tr.mute ? "bg-danger text-white" : "bg-surface-3"}`} onClick={() => set(tr.id, (x) => void (x.mute = !x.mute))}>M</button>
            <button type="button" data-testid={`solo-${tr.name}`} aria-pressed={tr.solo} className={`h-7 w-7 rounded-md ${tr.solo ? "bg-accent text-accent-contrast" : "bg-surface-3"}`} onClick={() => set(tr.id, (x) => void (x.solo = !x.solo))}>S</button>
            <button type="button" aria-label={t("delete")} className="h-7 w-7 rounded-md bg-surface-3" onClick={() => updateSession(session.id, (s) => { s.tracks = s.tracks.filter((x) => x.id !== tr.id); })}>
              <Icon name="trash" size={14} />
            </button>
          </div>
          <MixRow label={t("studioVolume")} min={-40} max={12} step={0.5} value={tr.volumeDb} fmt={(v) => `${v.toFixed(1)} dB`} testId={`vol-${tr.name}`} onChange={(v) => set(tr.id, (x) => void (x.volumeDb = v))} />
          <MixRow label={t("studioPan")} min={-1} max={1} step={0.05} value={tr.pan} fmt={(v) => (v === 0 ? "C" : v < 0 ? `L${Math.round(-v * 100)}` : `R${Math.round(v * 100)}`)} onChange={(v) => set(tr.id, (x) => void (x.pan = v))} />
          <MixRow label={t("studioReverb")} min={0} max={1} step={0.05} value={tr.reverbSend} fmt={(v) => `${Math.round(v * 100)}%`} testId={`rev-${tr.name}`} onChange={(v) => set(tr.id, (x) => void (x.reverbSend = v))} />
          {tr.instrument?.kind !== "drums" && (
            <MixRow label={t("studioSidechain")} min={0} max={1} step={0.05} value={tr.sidechain} fmt={(v) => `${Math.round(v * 100)}%`} onChange={(v) => set(tr.id, (x) => void (x.sidechain = v))} />
          )}
          <div className="mt-1 flex flex-wrap items-center gap-1">
            {tr.fx.map((f) => (
              <button key={f.id} type="button" className="rounded-full bg-surface-3 px-2 py-1" title={t("delete")} onClick={() => set(tr.id, (x) => void (x.fx = x.fx.filter((y) => y.id !== f.id)))}>
                {AUDIO_FX.find((d) => d.type === f.type)?.label ?? f.type} ✕
              </button>
            ))}
            <select
              aria-label={t("studioAddFx")}
              value=""
              className="rounded-lg bg-surface-3 px-1 py-1"
              onChange={(e) => {
                const def = MIX_FX.find((d) => d.type === e.target.value);
                if (def) set(tr.id, (x) => void x.fx.push({ id: createId("fx_"), type: def.type, enabled: true, params: Object.fromEntries(def.params.map((p) => [p.key, p.default])) }));
              }}
            >
              <option value="">+ {t("studioAddFx")}</option>
              {MIX_FX.map((d) => <option key={d.type} value={d.type}>{d.label}</option>)}
            </select>
          </div>
        </div>
      ))}
      <div className="rounded-xl border border-line bg-surface-2 p-2 text-xs">
        <div className="mb-1 text-sm font-medium">Master</div>
        <MixRow label={t("studioVolume")} min={-24} max={12} step={0.5} value={session.masterDb} fmt={(v) => `${v.toFixed(1)} dB`} onChange={(v) => updateSession(session.id, (s) => void (s.masterDb = v))} />
      </div>
    </div>
  );
}

function MixRow({ label, value, min, max, step, fmt, onChange, testId }: { label: string; value: number; min: number; max: number; step: number; fmt: (v: number) => string; onChange: (v: number) => void; testId?: string }) {
  const [local, setLocal] = useState(value);
  useEffect(() => setLocal(value), [value]);
  return (
    <label className="flex items-center gap-2 py-[2px]">
      <span className="w-20 shrink-0 text-muted">{label}</span>
      <input
        type="range"
        data-testid={testId}
        min={min}
        max={max}
        step={step}
        value={local}
        className="flex-1"
        onChange={(e) => setLocal(Number(e.target.value))}
        onPointerUp={() => local !== value && onChange(local)}
        onKeyUp={() => local !== value && onChange(local)}
        onBlur={() => local !== value && onChange(local)}
      />
      <span className="w-14 text-right tabular-nums">{fmt(local)}</span>
    </label>
  );
}

function AudioEdit({ session, busy, run }: { session: AudioSession; busy: string | null; run: (k: string, fn: () => Promise<void>) => Promise<void> }) {
  const t = useT();
  const assets = useEditor((s) => s.history?.project.assets ?? NO_ASSETS);
  const [recSec, setRecSec] = useState(10);
  const [level, setLevel] = useState(0);
  const [midi, setMidi] = useState<string | null>(null);
  const setRegion = (trId: string, rgId: string, fn: (r: StudioTrack["regions"][number]) => void) =>
    updateSession(session.id, (s) => { const r = s.tracks.find((x) => x.id === trId)?.regions.find((x) => x.id === rgId); if (r) fn(r); });
  const audioTracks = session.tracks.filter((x) => x.kind === "audio");
  return (
    <div className="flex flex-col gap-2 text-xs">
      <div className="flex flex-wrap gap-2">
        <label className="flex h-10 cursor-pointer items-center gap-1 rounded-xl bg-accent px-3 text-sm text-accent-contrast">
          <Icon name="music" size={16} />
          {t("studioImportAudio")}
          <input
            type="file"
            accept="audio/*,video/*"
            className="hidden"
            data-testid="studio-import"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void run("import", () => addAudioFile(session.id, f));
            }}
          />
        </label>
        <div className="flex items-center gap-1 rounded-xl bg-surface-2 px-2">
          <button type="button" disabled={!!busy} className="h-10 text-sm" onClick={() => void run("rec", () => recordMic(session.id, recSec, setLevel))}>
            ● {busy === "rec" ? `${Math.round(level * 100)}%` : t("studioRecord")}
          </button>
          <select value={recSec} className="rounded-lg bg-surface-3 px-1 py-1" onChange={(e) => setRecSec(Number(e.target.value))}>
            {[5, 10, 30, 60, 120].map((n) => <option key={n} value={n}>{n}s</option>)}
          </select>
        </div>
        <button type="button" className="h-10 rounded-xl bg-surface-2 px-3" onClick={() => void connectMidi((p) => previewNote(p)).then((ok) => setMidi(ok ? "MIDI ✓" : t("studioNoMidi")))}>
          {midi ?? "MIDI"}
        </button>
      </div>
      {audioTracks.length === 0 && <p className="p-4 text-center text-sm text-muted">{t("studioNoAudio")}</p>}
      {audioTracks.map((tr) => (
        <div key={tr.id} className="rounded-xl border border-line bg-surface-2 p-2">
          <div className="mb-1 flex items-center gap-2">
            <span className="flex-1 truncate text-sm font-medium">{tr.name}</span>
            <button
              type="button"
              className="rounded-full bg-accent px-2 py-1 text-accent-contrast"
              onClick={() => updateSession(session.id, (s) => { const x = s.tracks.find((y) => y.id === tr.id); if (x && !x.fx.some((f) => f.type === "studio-voice")) x.fx.unshift({ id: createId("fx_"), type: "studio-voice", enabled: true, params: { strength: 0.7, lufs: -14 } }); })}
            >
              {t("studioVoiceOneTap")}
            </button>
          </div>
          {tr.regions.map((rg) => {
            const a = assets.find((x) => x.id === rg.assetId);
            const maxSec = (a?.durationUs ?? rg.durationUs) / 1e6;
            return (
              <div key={rg.id} className="mb-1 rounded-lg bg-surface-3 p-2">
                <div className="mb-1 truncate text-muted">{a?.name ?? "audio"}</div>
                <MixRow label={t("studioStart")} min={0} max={Math.max(60, session.bars * (240 / session.bpm))} step={0.05} value={rg.startUs / 1e6} fmt={(v) => `${v.toFixed(2)}s`} onChange={(v) => setRegion(tr.id, rg.id, (r) => void (r.startUs = Math.round(v * 1e6)))} />
                <MixRow label={t("studioTrimStart")} min={0} max={Math.max(0.1, maxSec - 0.1)} step={0.05} value={rg.sourceInUs / 1e6} fmt={(v) => `${v.toFixed(2)}s`} onChange={(v) => setRegion(tr.id, rg.id, (r) => { const end = r.sourceInUs + r.durationUs; r.sourceInUs = Math.round(v * 1e6); r.durationUs = Math.max(100_000, end - r.sourceInUs); })} />
                <MixRow label={t("studioLength")} min={0.1} max={Math.max(0.2, maxSec - rg.sourceInUs / 1e6)} step={0.05} value={rg.durationUs / 1e6} fmt={(v) => `${v.toFixed(2)}s`} onChange={(v) => setRegion(tr.id, rg.id, (r) => void (r.durationUs = Math.round(v * 1e6)))} />
                <MixRow label={t("studioGain")} min={-30} max={12} step={0.5} value={rg.gainDb} fmt={(v) => `${v.toFixed(1)} dB`} onChange={(v) => setRegion(tr.id, rg.id, (r) => void (r.gainDb = v))} />
                <MixRow label={t("fadeIn")} min={0} max={5} step={0.05} value={rg.fadeInUs / 1e6} fmt={(v) => `${v.toFixed(2)}s`} onChange={(v) => setRegion(tr.id, rg.id, (r) => void (r.fadeInUs = Math.round(v * 1e6)))} />
                <MixRow label={t("fadeOut")} min={0} max={5} step={0.05} value={rg.fadeOutUs / 1e6} fmt={(v) => `${v.toFixed(2)}s`} onChange={(v) => setRegion(tr.id, rg.id, (r) => void (r.fadeOutUs = Math.round(v * 1e6)))} />
                <MixRow label={t("studioPitch")} min={-12} max={12} step={1} value={rg.pitch} fmt={(v) => `${v > 0 ? "+" : ""}${v} st`} onChange={(v) => setRegion(tr.id, rg.id, (r) => void (r.pitch = v))} />
                <div className="mt-1 flex gap-2">
                  <button type="button" disabled={!!busy} className="rounded-full bg-surface-2 px-2 py-1" onClick={() => void run("stems", () => splitStems(session.id, tr.id, rg.id))}>
                    {busy === "stems" ? "…" : t("studioStems")}
                  </button>
                  <button type="button" disabled={!!busy} className="rounded-full bg-surface-2 px-2 py-1" onClick={() => void run("stems", () => splitStems(session.id, tr.id, rg.id, true))}>
                    {t("studioKaraoke")}
                  </button>
                  <button type="button" className="ml-auto rounded-full bg-surface-2 px-2 py-1" onClick={() => updateSession(session.id, (s) => { const x = s.tracks.find((y) => y.id === tr.id); if (x) x.regions = x.regions.filter((r) => r.id !== rg.id); })}>
                    <Icon name="trash" size={14} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
