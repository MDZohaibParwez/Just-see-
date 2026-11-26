"use client";

/**
 * Turns a connector recipe into a normal project using the real editor
 * actions, entirely in the browser.
 */
import { CAPTION_STYLES, MOODS, captionCommands, groupCaptions, moodSession, type CaptionLanguage, type Mood } from "@just-see/engine";
import {
  clipEndUs,
  createId,
  createMediaClip,
  createProject,
  createTextClip,
  isMediaClip,
  getSequence,
  type Command,
  type MediaClip,
  type Project,
  type Recipe,
  type RecipeOp,
} from "@just-see/schema";
import { useEditor } from "./editor-store";
import { importFile } from "./media";
import { saveProject } from "./storage/db";

export type Step = { label: string; done: number; total: number };

const S = 1_000_000;

async function fetchAsFile(url: string, name: string, kind: string): Promise<File> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load ${name} (${res.status})`);
  const blob = await res.blob();
  const ext = url.split("?")[0]!.split(".").pop() ?? "";
  const type = blob.type && blob.type !== "application/octet-stream" ? blob.type : kind === "video" ? "video/mp4" : kind === "image" ? `image/${ext === "jpg" ? "jpeg" : ext || "png"}` : "audio/mpeg";
  const fname = /\.[a-z0-9]{2,5}$/i.test(name) ? name : `${name}.${ext || (kind === "video" ? "mp4" : kind === "image" ? "png" : "mp3")}`;
  return new File([blob], fname, { type });
}

const TEXT_STYLE: Record<string, Partial<ReturnType<typeof createTextClip>["style"]>> = {
  title: { fontSize: 0.07, fontWeight: 900, color: "#ffffff", strokeWidth: 0.06, strokeColor: "#000000", shadow: true },
  subtitle: { fontSize: 0.04, fontWeight: 600, color: "#ffffff", backgroundColor: "#000000", backgroundOpacity: 0.5 },
  bold: { fontSize: 0.055, fontWeight: 800, color: "#ffffff", strokeWidth: 0.1, strokeColor: "#000000", shadow: true },
  neon: { fontSize: 0.055, fontWeight: 800, color: "#39ff14", shadow: true, strokeWidth: 0.04, strokeColor: "#003300" },
  minimal: { fontSize: 0.035, fontWeight: 400, color: "#ffffff", shadow: true },
};

function project(): Project {
  const p = useEditor.getState().history?.project;
  if (!p) throw new Error("No project");
  return p;
}

function mainClips(): MediaClip[] {
  return getSequence(project()).tracks.find((t) => t.type === "main")!.clips as MediaClip[];
}

function dispatch(cmd: Command, what: string): void {
  if (!useEditor.getState().dispatch(cmd)) throw new Error(`Could not apply: ${what}`);
}

/** Build the recipe into a new project, load it in the editor store and save it. */
export async function buildRecipe(recipe: Recipe, onStep: (s: Step) => void = () => undefined): Promise<Project> {
  const total = recipe.media.length + recipe.ops.length + 1;
  let done = 0;
  const step = (label: string) => onStep({ label, done: done++, total });

  const p = createProject({ aspect: recipe.aspect, name: recipe.name.slice(0, 200) });
  useEditor.getState().load(p);

  // Media.
  const assets = new Map<string, string>();
  for (const m of recipe.media) {
    step(`Loading ${m.name}`);
    const asset = await importFile(await fetchAsFile(m.url, m.name, m.kind));
    if (m.license) asset.license = { kind: "library", commercialUse: true, ...m.license };
    dispatch({ type: "asset/add", payload: { asset } }, "add media");
    assets.set(m.id, asset.id);
  }

  const later: RecipeOp[] = [];
  for (const op of recipe.ops) {
    switch (op.op) {
      case "clip": {
        step("Adding clip");
        const asset = project().assets.find((a) => a.id === assets.get(op.mediaId));
        if (!asset) throw new Error(`Missing media ${op.mediaId}`);
        const clip = createMediaClip(asset);
        clip.sourceInUs = Math.min(Math.round(op.trimStartSec * S), Math.max(0, asset.durationUs - 100_000));
        const avail = asset.kind === "image" ? Number.POSITIVE_INFINITY : asset.durationUs - clip.sourceInUs;
        const want = op.durationSec != null ? Math.round(op.durationSec * S) : asset.kind === "image" ? 3 * S : avail;
        clip.speed = op.speed;
        clip.durationUs = Math.max(100_000, Math.round(Math.min(want, avail) / op.speed));
        clip.volume = op.volume;
        dispatch({ type: "clip/add", payload: { clip, trackType: "main" } }, "clip");
        if (op.transition && mainClips().length > 1) {
          dispatch({ type: "clip/setTransition", payload: { clipId: clip.id, transition: { type: op.transition, durationUs: Math.round(op.transitionSec * S), ease: "ease-in-out" } } }, "transition");
        }
        break;
      }
      case "fit": {
        step("Fitting length");
        const clips = mainClips();
        const total = clips.reduce((a, c) => a + c.durationUs, 0);
        const target = Math.round(op.seconds * S);
        if (total > target && clips.length) {
          const k = target / total;
          const cmds: Command[] = clips.map((c) => ({ type: "clip/trim", payload: { clipId: c.id, edge: "end", timeUs: c.startUs + Math.max(200_000, Math.round(c.durationUs * k)) } }));
          // Trim from the last clip backwards so earlier positions stay valid.
          for (const c of cmds.reverse()) dispatch(c, "fit");
          // Rounding: make the end exact.
          const last = mainClips().at(-1);
          const end = last ? clipEndUs(last) : 0;
          if (last && end !== target) dispatch({ type: "clip/trim", payload: { clipId: last.id, edge: "end", timeUs: last.startUs + last.durationUs + (target - end) } }, "fit");
        }
        break;
      }
      default:
        later.push(op);
    }
  }

  // Overlays, audio and captions go on after the main track is final.
  for (const op of later) {
    switch (op.op) {
      case "text": {
        step("Adding text");
        const clip = createTextClip({ text: op.text, startUs: Math.round(op.startSec * S), durationUs: Math.round(op.durationSec * S) });
        clip.style = { ...clip.style, ...TEXT_STYLE[op.style] };
        clip.transform = { ...clip.transform, y: op.position === "top" ? -0.32 : op.position === "bottom" ? 0.32 : 0 };
        dispatch({ type: "clip/add", payload: { clip, trackType: "text", newTrackId: createId("t_") } }, "text");
        break;
      }
      case "effect": {
        step("Adding effect");
        const c = mainClips()[op.clipIndex];
        if (c) dispatch({ type: "clip/addEffect", payload: { clipId: c.id, effect: { id: createId("fx_"), type: op.type, enabled: true, params: {} } } }, "effect");
        break;
      }
      case "face": {
        step("Tracking the face");
        const c = mainClips()[op.clipIndex];
        if (!c || !isMediaClip(c) || c.kind !== "video") break;
        const { applyFace } = await import("./face");
        let targetId: string | undefined;
        if (op.mode === "stick") {
          targetId = createId("c_");
          const t = createTextClip({ id: targetId, text: op.sticker, startUs: c.startUs, durationUs: c.durationUs });
          t.style = { ...t.style, fontSize: 0.09 };
          dispatch({ type: "clip/add", payload: { clip: t, trackType: "text", newTrackId: createId("t_") } }, "sticker");
        }
        // A missing face must not stop the whole video.
        await applyFace(c.id, op.mode, { zoom: op.zoom, targetId }).catch((e: unknown) => console.warn("Face tracking skipped", e));
        break;
      }
      case "voice": {
        step("Studio voice");
        const targets = op.clipIndex < 0 ? mainClips() : [mainClips()[op.clipIndex]].filter((x): x is MediaClip => !!x);
        for (const c of targets.filter((x) => x.kind === "video"))
          dispatch({ type: "clip/addAudioFx", payload: { clipId: c.id, effect: { id: createId("afx_"), type: "studio-voice", enabled: true, params: { strength: 0.7, lufs: -14 } } } }, "voice");
        break;
      }
      case "sfx": {
        step("Sound effect");
        useEditor.getState().setPlayhead(Math.round(op.atSec * S));
        await (await import("./audio-tools")).addSfx(op.id);
        break;
      }
      case "motion": {
        step("Animated template");
        const { createFromTemplate, addCompToVideo, setLayer } = await import("./motion");
        const comp = await createFromTemplate(op.template);
        if (comp) {
          for (const f of comp.editable)
            if (f.field === "text" && op.fields[f.label] !== undefined) setLayer(comp.id, f.layerId, (l) => void (l.text && (l.text.text = op.fields[f.label]!.slice(0, 2000))));
          useEditor.getState().setPlayhead(Math.round(op.atSec * S));
          addCompToVideo(comp.id);
        }
        break;
      }
      case "music": {
        step("Music");
        const end = mainClips().reduce((a, c) => Math.max(a, clipEndUs(c)), 0);
        if (op.mood && MOODS.some((m) => m.id === op.mood)) {
          const bpmBars = moodSession(op.mood as Mood, createId);
          // Long enough to cover the video.
          const barSec = (60 / bpmBars.bpm) * 4;
          bpmBars.bars = Math.min(999, Math.max(2, Math.ceil(end / S / barSec)));
          for (const tr of bpmBars.tracks) for (const pl of tr.placements) pl.repeat = Math.max(1, Math.ceil((bpmBars.bars * 16) / (bpmBars.patterns.find((x) => x.id === pl.patternId)?.steps ?? 16)));
          dispatch({ type: "session/put", payload: { session: bpmBars } }, "music");
          const { sendToVideo } = await import("./studio");
          await sendToVideo(bpmBars.id);
        } else if (op.mediaId) {
          const asset = project().assets.find((a) => a.id === assets.get(op.mediaId!));
          if (asset) {
            const clip = createMediaClip(asset);
            clip.startUs = 0;
            clip.durationUs = Math.min(asset.durationUs, end || asset.durationUs);
            dispatch({ type: "clip/add", payload: { clip, trackType: "audio", newTrackId: createId("t_") } }, "music");
          }
        }
        // Set level and trim to the video length.
        const seq = getSequence(project());
        const music = seq.tracks.filter((t) => t.type === "audio").flatMap((t) => t.clips).at(-1) as MediaClip | undefined;
        if (music) {
          dispatch({ type: "clip/update", payload: { clipId: music.id, patch: { volume: op.volume, fadeOutUs: Math.min(1_500_000, Math.round(music.durationUs / 4)) } } }, "music volume");
          if (end > 0 && clipEndUs(music) > end) dispatch({ type: "clip/trim", payload: { clipId: music.id, edge: "end", timeUs: end } }, "music trim");
        }
        if (op.duck) await (await import("./audio-tools")).autoDuck(12).catch(() => 0);
        break;
      }
      case "style": {
        step(`Style: ${op.style}`);
        const { applyStyle } = await import("./styles");
        const hasCaptions = recipe.ops.some((x) => x.op === "captions");
        const hasMusic = recipe.ops.some((x) => x.op === "music");
        await applyStyle(op.style, op.fields, { music: op.music && !hasMusic, captions: !hasCaptions });
        break;
      }
      case "captions": {
        step("Captions");
        const style = op.style === "karaoke" ? "clean" : op.style === "bold" ? "bold-pop" : "subtle";
        let lines;
        if (op.mode === "manual") {
          lines = op.segments.map((s) => {
            const words = s.text.split(/\s+/).filter(Boolean);
            const a = Math.round(s.startSec * S);
            const b = Math.max(a + 200_000, Math.round(s.endSec * S));
            const per = (b - a) / Math.max(1, words.length);
            return { startUs: a, endUs: b, words: words.map((w, i) => ({ text: w, startUs: Math.round(a + i * per), endUs: Math.round(a + (i + 1) * per) })) };
          });
        } else {
          const { transcribeTimeline } = await import("./transcribe");
          const lang = (["auto", "hi", "en", "hinglish", "ur"].includes(op.language) ? op.language : "auto") as CaptionLanguage;
          const words = await transcribeTimeline(project(), lang, "base", () => undefined);
          lines = groupCaptions(words);
        }
        if (lines.length) {
          const cmds = captionCommands(lines, { styleId: CAPTION_STYLES.some((s) => s.id === style) ? style : "clean", trackId: createId("t_") });
          dispatch({ type: "batch", payload: { label: "Captions", commands: cmds } }, "captions");
        }
        break;
      }
      default:
        break;
    }
  }
  step("Saving");
  useEditor.getState().setPlayhead(0);
  const final = project();
  await saveProject(final);
  onStep({ label: "Ready", done: total, total });
  return final;
}
