"use client";

import { TEMPLATE_BY_ID, blankComp, fromLottie, toLottie, type TemplateOptions } from "@just-see/engine";
import {
  createId,
  createTextClip,
  findClip,
  getSequence,
  type Asset,
  type Command,
  type MotionComp,
  type MotionKeyframe,
  type MotionLayer,
} from "@just-see/schema";
import { useEditor } from "./editor-store";
import { assetBlob, importFile } from "./media";


export function project() {
  const s = useEditor.getState();
  return s.draft ?? s.history?.project ?? null;
}

export function getComp(id: string): MotionComp | undefined {
  return project()?.motionComps?.find((c) => c.id === id);
}

function putCmd(comp: MotionComp): Command {
  return { type: "motion/put", payload: { comp: { ...comp, updatedAt: Date.now() } } };
}

/** Change a composition as one undo step. */
export function updateComp(id: string, fn: (c: MotionComp) => void): boolean {
  const cur = useEditor.getState().history?.project.motionComps?.find((c) => c.id === id);
  if (!cur) return false;
  const next = structuredClone(cur);
  fn(next);
  useEditor.getState().preview(null);
  return useEditor.getState().dispatch(putCmd(next));
}

/** Show a change without recording it (while dragging). Call updateComp on release. */
export function previewComp(id: string, fn: (c: MotionComp) => void): void {
  const cur = useEditor.getState().history?.project.motionComps?.find((c) => c.id === id);
  if (!cur) return;
  const next = structuredClone(cur);
  fn(next);
  useEditor.getState().preview(putCmd(next));
}

export function sequenceSize(): { width: number; height: number } {
  const p = useEditor.getState().history?.project;
  if (!p) return { width: 1080, height: 1920 };
  const seq = getSequence(p);
  return { width: seq.width, height: seq.height };
}

export function addComp(comp: MotionComp, extraCommands: Command[] = []): void {
  useEditor.getState().dispatch(extraCommands.length ? { type: "batch", payload: { label: "New composition", commands: [...extraCommands, putCmd(comp)] } } : putCmd(comp));
}

export async function imageAssetFromFile(file: File): Promise<Asset> {
  const asset = await importFile(file);
  if (asset.kind !== "image") throw new Error("Please choose an image");
  return asset;
}

/** Build a template comp sized like the video and add it to the project. */
export async function createFromTemplate(templateId: string, logo?: File | null): Promise<MotionComp | null> {
  const t = TEMPLATE_BY_ID.get(templateId);
  if (!t) return null;
  const size = sequenceSize();
  const opts: TemplateOptions = { ...size };
  const extra: Command[] = [];
  if (logo) {
    const asset = await imageAssetFromFile(logo);
    extra.push({ type: "asset/add", payload: { asset } });
    opts.logoAssetId = asset.id;
    opts.logoAspect = asset.width / Math.max(1, asset.height);
  }
  const comp = t.build(createId, opts);
  addComp(comp, extra);
  return comp;
}

export function createBlank(): MotionComp {
  const { width, height } = sequenceSize();
  const comp = blankComp(createId, width, height);
  addComp(comp);
  return comp;
}

export async function importLottieFile(file: File): Promise<MotionComp> {
  const json: unknown = JSON.parse(await file.text());
  const comp = fromLottie(json, createId);
  addComp(comp);
  return comp;
}

export function downloadLottie(comp: MotionComp): void {
  const blob = new Blob([JSON.stringify(toLottie(comp))], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${comp.name.replace(/[^\w\- ]+/g, "").trim() || "animation"}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

/** Put the composition on the video timeline at the playhead (or select the existing clip). */
export function addCompToVideo(compId: string): string | null {
  const s = useEditor.getState();
  const p = s.history?.project;
  const comp = getComp(compId);
  if (!p || !comp) return null;
  const clipId = createId("c_");
  const clip = createTextClip({ id: clipId, text: comp.name, startUs: s.playheadUs, durationUs: comp.durationUs });
  clip.motionCompId = comp.id;
  clip.animationIn = "none";
  clip.animationOut = "none";
  const ok = s.dispatch({ type: "clip/add", payload: { clip, trackType: "text", newTrackId: createId("t_") } });
  return ok ? clipId : null;
}

/** Composition shown by a timeline clip, if any. */
export function compOfClip(clipId: string): MotionComp | undefined {
  const p = project();
  if (!p) return undefined;
  const loc = findClip(p, clipId);
  const c = loc?.clip;
  return c && c.kind === "text" && c.motionCompId ? p.motionComps.find((m) => m.id === c.motionCompId) : undefined;
}

// ---------- Layer helpers ----------

export function setLayer(compId: string, layerId: string, fn: (l: MotionLayer) => void, preview = false): void {
  (preview ? previewComp : updateComp)(compId, (c) => {
    const l = c.layers.find((x) => x.id === layerId);
    if (l) fn(l);
  });
}

/** Set a numeric property: writes a keyframe at time t if the property is animated (or `forceKey`). */
export function setProp(l: MotionLayer, prop: string, value: number, tUs: number, forceKey = false): void {
  const kfs = l.keyframes[prop];
  if (kfs?.length || forceKey) {
    const prev = [...(kfs ?? [])].reverse().find((k) => k.t <= tUs);
    const kf: MotionKeyframe = { t: Math.round(tUs), v: value, ease: prev?.ease ?? "ease-in-out", ...(prev?.bezier ? { bezier: prev.bezier } : {}) };
    const out = (kfs ?? []).filter((k) => Math.abs(k.t - tUs) > 1000);
    out.push(kf);
    out.sort((a, b) => a.t - b.t);
    l.keyframes[prop] = out;
    return;
  }
  writeBase(l, prop, value);
}

export function writeBase(l: MotionLayer, prop: string, v: number): void {
  const tf = l.transform as Record<string, number>;
  if (prop in tf) tf[prop] = prop === "opacity" ? Math.min(1, Math.max(0, v)) : v;
  else if (prop === "width") l.width = Math.max(0, v);
  else if (prop === "height") l.height = Math.max(0, v);
  else if (prop.startsWith("shape.") && l.shape) (l.shape as unknown as Record<string, number>)[prop.slice(6)] = v;
  else if (prop.startsWith("text.") && l.text) (l.text as unknown as Record<string, number>)[prop.slice(5)] = v;
  else if (prop === "anim.progress" && l.text?.animator) l.text.animator.progress = Math.min(1, Math.max(0, v));
  else if (prop.startsWith("fx.")) {
    const fx = l.effects.find((e) => e.type === prop.slice(3));
    if (fx) fx.params = { ...fx.params, amount: v };
  }
}

// ---------- Images for the editor canvas ----------

const bitmaps = new Map<string, Promise<ImageBitmap | null>>();
const ready = new Map<string, ImageBitmap>();

/** Decoded images for a comp's image layers (fills in as they load). */
export function compImages(comp: MotionComp, onLoad: () => void): Map<string, CanvasImageSource> {
  const p = project();
  for (const l of comp.layers) {
    if (l.type !== "image" || !l.assetId || bitmaps.has(l.assetId)) continue;
    const asset = p?.assets.find((a) => a.id === l.assetId);
    if (!asset) continue;
    const id = l.assetId;
    bitmaps.set(
      id,
      assetBlob(asset)
        .then((b) => createImageBitmap(b))
        .then((bmp) => {
          ready.set(id, bmp);
          onLoad();
          return bmp;
        })
        .catch(() => null),
    );
  }
  return ready;
}
