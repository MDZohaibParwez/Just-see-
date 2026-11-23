"use client";

/** Apply a reel style (from the library or the connector) to the open project. */
import { CAPTION_STYLES, MOODS, REEL_STYLE_BY_ID, captionCommands, groupCaptions, moodSession, type CaptionLanguage, type Mood } from "@just-see/engine";
import { clipEndUs, createId, getSequence, type Command, type MediaClip, type Project } from "@just-see/schema";
import { useEditor } from "./editor-store";

const S = 1_000_000;

function project(): Project {
  const p = useEditor.getState().history?.project;
  if (!p) throw new Error("Open a project first");
  return p;
}
const mainClips = () => (getSequence(project()).tracks.find((t) => t.type === "main")?.clips ?? []) as MediaClip[];
const videoEnd = () => mainClips().reduce((a, c) => Math.max(a, clipEndUs(c)), 0);

/** Background music from a built-in mood, as long as the video, lowered under speech. */
export async function addMoodMusic(mood: string, volume = 0.6, duck = true): Promise<void> {
  if (!MOODS.some((m) => m.id === mood)) return;
  const end = videoEnd();
  const session = moodSession(mood as Mood, createId);
  const barSec = (60 / session.bpm) * 4;
  session.bars = Math.min(999, Math.max(2, Math.ceil(end / S / barSec)));
  for (const tr of session.tracks) for (const pl of tr.placements) pl.repeat = Math.max(1, Math.ceil((session.bars * 16) / (session.patterns.find((x) => x.id === pl.patternId)?.steps ?? 16)));
  useEditor.getState().dispatch({ type: "session/put", payload: { session } });
  const { sendToVideo } = await import("./studio");
  await sendToVideo(session.id);
  const music = getSequence(project()).tracks.filter((t) => t.type === "audio").flatMap((t) => t.clips).at(-1) as MediaClip | undefined;
  if (music) {
    useEditor.getState().dispatch({ type: "clip/update", payload: { clipId: music.id, patch: { volume, fadeOutUs: Math.min(1_500_000, Math.round(music.durationUs / 4)) } } });
    if (end > 0 && clipEndUs(music) > end) useEditor.getState().dispatch({ type: "clip/trim", payload: { clipId: music.id, edge: "end", timeUs: end } });
  }
  if (duck) await (await import("./audio-tools")).autoDuck(12).catch(() => 0);
}

/** Speech captions with the word highlight (Whisper on the device). */
export async function addAutoCaptions(language = "auto", styleId = "clean"): Promise<number> {
  const { transcribeTimeline } = await import("./transcribe");
  const lang = (["auto", "hi", "en", "hinglish", "ur"].includes(language) ? language : "auto") as CaptionLanguage;
  const words = await transcribeTimeline(project(), lang, "base", () => undefined);
  const lines = groupCaptions(words);
  if (lines.length) {
    const cmds = captionCommands(lines, { styleId: CAPTION_STYLES.some((s) => s.id === styleId) ? styleId : "clean", trackId: createId("t_"), language: lang });
    useEditor.getState().dispatch({ type: "batch", payload: { label: "Captions", commands: cmds } });
  }
  return lines.length;
}

/** Apply a reel style's look, overlays, music and captions. Returns a short report. */
export async function applyStyle(styleId: string, fields: Record<string, string> = {}, opts: { music?: boolean; captions?: boolean } = {}): Promise<string[]> {
  const style = REEL_STYLE_BY_ID.get(styleId);
  if (!style) throw new Error(`Unknown style ${styleId}`);
  const s = useEditor.getState();
  const val = (key: string) => fields[key] ?? style.fields.find((f) => f.key === key)?.default ?? "";
  const done: string[] = [];
  const clips = mainClips();
  if (!clips.length) throw new Error("Add your clips first");

  // Look, motion and speed on every clip.
  const cmds: Command[] = [];
  clips.forEach((c, i) => {
    const have = new Set(c.effects.map((e) => e.type));
    for (const e of style.effects) if (!have.has(e.type)) cmds.push({ type: "clip/addEffect", payload: { clipId: c.id, effect: { id: createId("fx_"), type: e.type, enabled: true, params: e.params } } });
    if (style.kenBurns && c.kind === "image" && !have.has("ken-burns-in") && !have.has("ken-burns-out"))
      cmds.push({ type: "clip/addEffect", payload: { clipId: c.id, effect: { id: createId("fx_"), type: i % 2 ? "ken-burns-out" : "ken-burns-in", enabled: true, params: {} } } });
    if (style.speed !== 1 && c.kind === "video" && c.speed === 1) cmds.push({ type: "clip/setSpeed", payload: { clipId: c.id, speed: style.speed } });
  });
  if (cmds.length) s.dispatch({ type: "batch", payload: { label: `Style: ${style.label}`, commands: cmds } });
  done.push("look");
  if (style.transition) {
    const tcmds: Command[] = mainClips()
      .slice(1)
      .filter((c) => !c.transitionIn)
      .map((c) => ({ type: "clip/setTransition", payload: { clipId: c.id, transition: { type: style.transition!, durationUs: Math.round(style.transitionSec * S), ease: "ease-in-out" } } }));
    if (tcmds.length) s.dispatch({ type: "batch", payload: { label: "Transitions", commands: tcmds } });
    done.push("transitions");
  }

  // Overlays (header, notification, lyric card, end card …).
  const { createFromTemplate, addCompToVideo, setLayer } = await import("./motion");
  for (const o of style.overlays) {
    const end = videoEnd();
    const secs = o.at === "whole" ? end / S : Math.min(o.seconds ?? 3, end / S);
    const start = o.at === "whole" || o.at === "start" ? 0 : o.at === "end" ? Math.max(0, end / S - secs) : Math.min(o.at, Math.max(0, end / S - 0.5));
    const textOf = (label: string) => (o.fields[label] ? val(o.fields[label]!) : undefined);
    const comp = await createFromTemplate(o.template, null, { duration: Math.max(0.5, secs), title: textOf("Header"), subtitle: textOf("Subline") });
    if (!comp) continue;
    for (const f of comp.editable) {
      const key = o.fields[f.label];
      if (key && f.field === "text") {
        const text = val(key);
        setLayer(comp.id, f.layerId, (l) => {
          if (l.text) l.text.text = text.slice(0, 2000);
          if (!text.trim()) l.hidden = true;
        });
      }
    }
    s.setPlayhead(Math.round(start * S));
    addCompToVideo(comp.id);
    done.push(o.template);
  }

  if (style.captions === "auto" && opts.captions !== false) {
    try {
      const n = await addAutoCaptions("auto", "bold-pop");
      done.push(`captions (${n})`);
    } catch {
      done.push("captions skipped");
    }
  }
  const hasMusic = getSequence(project()).tracks.some((t) => t.type === "audio" && t.clips.length > 0);
  if (style.musicMood && opts.music !== false && !hasMusic) {
    await addMoodMusic(style.musicMood, 0.55, style.captions === "auto");
    done.push(`music (${style.musicMood})`);
  }
  s.setPlayhead(0);
  return done;
}
