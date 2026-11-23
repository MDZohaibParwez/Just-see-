"use client";

import { FONT_CATALOG, MOODS, SFX, TEMPLATES, moodSession, searchItems, type Mood } from "@just-see/engine";
import { createId, createMediaClip, findClip, isTextClip, type Asset, type MotionComp } from "@just-see/schema";
import { useEditor } from "./editor-store";
import { addSfx } from "./audio-tools";
import { kvGet, kvSet } from "./storage/db";
import { loadWebFont, projectFontFor } from "./fonts";
import { addComp, addCompToVideo, createFromTemplate } from "./motion";
import { downloadOnline, type OnlineItem } from "./openverse";
import { importFile } from "./media";

export type LibKind = "font" | "music" | "sound" | "template" | "mine";

export interface LibItem {
  id: string;
  kind: LibKind;
  label: string;
  hint: string;
  tags: string[];
  /** Licence shown on the card. */
  licenseName: string;
}

const MY_TEMPLATES = "myMotionTemplates";

export interface MyTemplate {
  id: string;
  name: string;
  comp: MotionComp;
  savedAt: number;
}

export async function listMyTemplates(): Promise<MyTemplate[]> {
  return (await kvGet<MyTemplate[]>(MY_TEMPLATES).catch(() => undefined)) ?? [];
}

/** Save a composition as a personal template, usable in every project on this device. */
export async function saveMyTemplate(comp: MotionComp): Promise<void> {
  const list = await listMyTemplates();
  list.unshift({ id: createId("tpl_"), name: comp.name, comp: structuredClone(comp), savedAt: Date.now() });
  await kvSet(MY_TEMPLATES, list.slice(0, 100));
}

export async function deleteMyTemplate(id: string): Promise<void> {
  await kvSet(MY_TEMPLATES, (await listMyTemplates()).filter((t) => t.id !== id));
}

/** Everything that is built in or saved on this device, as one searchable list. */
export function localItems(mine: MyTemplate[] = []): LibItem[] {
  const items: LibItem[] = [];
  for (const f of FONT_CATALOG) items.push({ id: `font:${f.family}`, kind: "font", label: f.family, hint: f.category, tags: [...f.tags, f.category, "font", "text"], licenseName: "OFL 1.1" });
  for (const m of MOODS) items.push({ id: `music:${m.id}`, kind: "music", label: m.label, hint: m.hint, tags: ["music", "bgm", "background", "gaana", m.id, ...m.hint.split(/[ ,]+/)], licenseName: "Built-in" });
  for (const s of SFX) items.push({ id: `sound:${s.id}`, kind: "sound", label: s.label, hint: `${s.category} · ${s.seconds}s`, tags: [...(s.tags ?? []), s.category, "sfx", "sound", "effect", "awaaz"], licenseName: "Built-in" });
  for (const t of TEMPLATES) items.push({ id: `template:${t.id}`, kind: "template", label: t.label, hint: t.category, tags: [t.category, "motion", "animation", "template"], licenseName: "Built-in" });
  for (const t of mine) items.push({ id: `mine:${t.id}`, kind: "mine", label: t.name, hint: "My template", tags: ["my", "template", "motion"], licenseName: "Yours" });
  return items;
}

export function searchLocal(q: string, items: LibItem[], kind: LibKind | "all"): LibItem[] {
  const pool = kind === "all" ? items : items.filter((i) => i.kind === kind || (kind === "template" && i.kind === "mine"));
  return searchItems(q, pool);
}

/** Use a library item in the open project. Returns a message for the user. */
export async function applyItem(item: LibItem, mine: MyTemplate[] = []): Promise<string> {
  const s = useEditor.getState();
  const [prefix, ...rest] = item.id.split(":");
  const key = rest.join(":");
  switch (prefix) {
    case "font": {
      const f = FONT_CATALOG.find((x) => x.family === key);
      if (!f) return "";
      await loadWebFont(f.family, f.weights);
      const pf = projectFontFor(f);
      const cmds: Parameters<typeof s.dispatch>[0][] = [{ type: "font/add", payload: { font: pf } }];
      const sel = s.selection?.kind === "clip" && s.history ? findClip(s.history.project, s.selection.clipId) : undefined;
      const applied = !!(sel && isTextClip(sel.clip) && !sel.clip.motionCompId);
      if (applied && sel) cmds.push({ type: "clip/update", payload: { clipId: sel.clip.id, patch: { style: { fontFamily: pf.css } } } });
      s.dispatch({ type: "batch", payload: { label: "Font", commands: cmds } });
      return applied ? "fontApplied" : "fontAdded";
    }
    case "sound":
      await addSfx(key);
      return "addedToVideo";
    case "music": {
      const { sendToVideo } = await import("./studio");
      const session = moodSession(key as Mood, createId);
      s.dispatch({ type: "session/put", payload: { session } });
      await sendToVideo(session.id);
      return "addedToVideo";
    }
    case "template": {
      const comp = await createFromTemplate(key);
      if (comp) addCompToVideo(comp.id);
      return "addedToVideo";
    }
    case "mine": {
      const t = mine.find((x) => x.id === key);
      if (!t) return "";
      const comp: MotionComp = { ...structuredClone(t.comp), id: createId("mc_"), updatedAt: Date.now() };
      addComp(comp);
      addCompToVideo(comp.id);
      return "addedToVideo";
    }
  }
  return "";
}

/** Download an online item, store it with its licence and put it at the playhead. */
export async function addOnline(item: OnlineItem): Promise<Asset> {
  const file = await downloadOnline(item);
  const asset = await importFile(file);
  asset.name = item.title.slice(0, 500);
  asset.license = item.license;
  const s = useEditor.getState();
  const clip = createMediaClip(asset);
  clip.startUs = s.playheadUs;
  if (asset.kind === "image") clip.transform = { ...clip.transform, scale: 0.6 };
  s.dispatch({
    type: "batch",
    payload: {
      label: "Add from library",
      commands: [
        { type: "asset/add", payload: { asset } },
        { type: "clip/add", payload: { clip, trackType: asset.kind === "audio" ? "audio" : "video", newTrackId: createId("t_") } },
      ],
    },
  });
  return asset;
}
