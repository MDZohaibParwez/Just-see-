"use client";

import {
  clipAt,
  clipEndUs,
  createId,
  createMediaClip,
  createTextClip,
  findClip,
  getMainTrack,
  getSequence,
  isMediaClip,
  sampleKeyframes,
  type Command,
} from "@just-see/schema";
import { DEFAULT_TRANSITION_US, EFFECTS_BY_TYPE, defaultParams } from "@just-see/engine";
import { currentProject, useEditor } from "./editor-store";
import { importFile, kindOf } from "./media";
import { haptic } from "./theme";
import { translate, useLocale } from "./i18n";

const tr = (k: Parameters<typeof translate>[1]) => translate(useLocale.getState().locale, k);

function committed() {
  return useEditor.getState().history?.project ?? null;
}

/** Import files: video/images go on the main track after the playhead clip, audio onto an audio track. */
export async function importFiles(files: FileList | File[], mode: "media" | "music" | "overlay" = "media"): Promise<void> {
  const store = useEditor.getState();
  const list = Array.from(files);
  if (!list.length) return;
  store.toast(tr("importing"));
  for (const file of list) {
    const kind = kindOf(file);
    if (!kind || (mode === "music" && kind !== "audio")) {
      store.toast(`${tr("importFailed")}: ${file.name}`, "error");
      continue;
    }
    try {
      const asset = await importFile(file);
      const p = committed();
      if (!p) return;
      const seq = getSequence(p);
      const main = getMainTrack(seq);
      const t = useEditor.getState().playheadUs;
      const clip = createMediaClip(asset);
      const commands: Command[] = [{ type: "asset/add", payload: { asset } }];
      if (kind === "audio") {
        clip.startUs = t;
        commands.push({ type: "clip/add", payload: { clip, trackType: "audio", newTrackId: createId("t_") } });
      } else if (mode === "overlay") {
        // Picture-in-picture: a new layer above the video at the playhead, half size.
        clip.startUs = t;
        clip.transform = { ...clip.transform, scale: 0.5 };
        commands.push({ type: "clip/add", payload: { clip, trackType: "video", newTrackId: createId("t_") } });
      } else {
        // Insert after the clip under the playhead (or at the end).
        const under = clipAt(main, t);
        const index = under ? main.clips.indexOf(under) + 1 : main.clips.length;
        commands.push({ type: "clip/add", payload: { clip, trackId: main.id, index } });
      }
      useEditor.getState().dispatch({ type: "batch", payload: { label: "Import media", commands } });
      if (kind !== "audio" && mode !== "overlay") {
        const after = committed();
        const placed = after ? findClip(after, clip.id) : undefined;
        if (placed) useEditor.getState().setPlayhead(placed.clip.startUs);
      }
    } catch (e) {
      console.error(e);
      store.toast(`${tr("importFailed")}: ${file.name}`, "error");
    }
  }
}

export function addText(): void {
  const s = useEditor.getState();
  const id = createId("c_");
  const ok = s.dispatch({
    type: "clip/add",
    payload: { clip: createTextClip({ id, text: tr("typeHere"), startUs: s.playheadUs }), trackType: "text", newTrackId: createId("t_") },
  });
  if (ok) {
    useEditor.getState().select({ kind: "clip", clipId: id });
    useEditor.getState().openPanel("text");
  }
}

/** Split the selected clip, or every clip under the playhead on the main track. */
export function splitAtPlayhead(): void {
  const s = useEditor.getState();
  const p = currentProject(s);
  if (!p) return;
  const t = s.playheadUs;
  let target: string | undefined;
  if (s.selection?.kind === "clip") target = s.selection.clipId;
  else {
    const under = clipAt(getMainTrack(getSequence(p)), t);
    target = under?.id;
  }
  const loc = target ? findClip(p, target) : undefined;
  if (!loc || t <= loc.clip.startUs || t >= clipEndUs(loc.clip)) {
    s.toast(tr("clipTooShort"));
    return;
  }
  const newId = createId("c_");
  if (s.dispatch({ type: "clip/split", payload: { clipId: loc.clip.id, atUs: t, newClipId: newId } })) {
    haptic(12);
    useEditor.getState().select({ kind: "clip", clipId: newId });
  }
}

export function deleteSelection(): void {
  const s = useEditor.getState();
  const sel = s.selection;
  if (!sel) return;
  if (sel.kind === "transition") {
    s.dispatch({ type: "clip/setTransition", payload: { clipId: sel.clipId, transition: null } });
  } else {
    s.dispatch({ type: "clip/delete", payload: { clipId: sel.clipId } });
  }
  useEditor.getState().select(null);
}

export function duplicateSelection(): void {
  const s = useEditor.getState();
  if (s.selection?.kind !== "clip") return;
  const newId = createId("c_");
  if (s.dispatch({ type: "clip/duplicate", payload: { clipId: s.selection.clipId, newClipId: newId, newTrackId: createId("t_") } })) {
    useEditor.getState().select({ kind: "clip", clipId: newId });
  }
}

export function addEffect(clipId: string, type: string): string | null {
  const def = EFFECTS_BY_TYPE.get(type);
  if (!def) return null;
  const id = createId("e_");
  const ok = useEditor.getState().dispatch({
    type: "clip/addEffect",
    payload: { clipId, effect: { id, type, enabled: true, params: defaultParams(def) } },
  });
  return ok ? id : null;
}

export function setTransition(clipId: string, type: string | null, durationUs = DEFAULT_TRANSITION_US): void {
  useEditor.getState().dispatch({
    type: "clip/setTransition",
    payload: { clipId, transition: type ? { type, durationUs } : null },
  });
}

/** Put the same transition between every pair of main-track clips. */
export function setTransitionEverywhere(type: string, durationUs: number): void {
  const p = committed();
  if (!p) return;
  const main = getMainTrack(getSequence(p));
  const commands: Command[] = main.clips
    .slice(1)
    .filter(isMediaClip)
    .map((c) => ({ type: "clip/setTransition", payload: { clipId: c.id, transition: { type, durationUs } } }) as Command);
  if (commands.length) useEditor.getState().dispatch({ type: "batch", payload: { label: "Transitions", commands } });
}

export function togglePlay(): void {
  const s = useEditor.getState();
  s.setPlaying(!s.playing);
}

export function stepFrame(dir: 1 | -1): void {
  const s = useEditor.getState();
  const p = currentProject(s);
  if (!p) return;
  const fps = getSequence(p).fps;
  s.setPlaying(false);
  s.setPlayhead(s.playheadUs + (dir * 1e6) / fps);
}

/** Clip-local playhead time, clamped inside the clip. */
export function localPlayhead(clipId: string): number | null {
  const s = useEditor.getState();
  const p = currentProject(s);
  const loc = p ? findClip(p, clipId) : undefined;
  if (!loc) return null;
  return Math.round(Math.min(Math.max(0, s.playheadUs - loc.clip.startUs), loc.clip.durationUs));
}

export const KEYFRAME_PROPS = ["x", "y", "scale", "rotation", "opacity"] as const;

/**
 * Command to change an animatable property: if the property already has
 * keyframes, set one at the playhead; otherwise change the static value.
 */
export function animatableCommand(clipId: string, prop: string, value: number): Command | null {
  const p = committed();
  const loc = p ? findClip(p, clipId) : undefined;
  if (!loc) return null;
  const t = localPlayhead(clipId) ?? 0;
  if (loc.clip.keyframes[prop]?.length) return { type: "clip/setKeyframe", payload: { clipId, prop, t, v: value } };
  if (prop === "volume") return { type: "clip/update", payload: { clipId, patch: { volume: value } } };
  if (prop.startsWith("crop.")) return { type: "clip/update", payload: { clipId, patch: { crop: { [prop.slice(5)]: value } } } };
  return { type: "clip/update", payload: { clipId, patch: { transform: { [prop]: value } } } };
}

/** Toggle a keyframe for all transform properties at the playhead. */
export function toggleTransformKeyframe(clipId: string): void {
  const p = committed();
  const loc = p ? findClip(p, clipId) : undefined;
  const t = localPlayhead(clipId);
  if (!loc || t === null) return;
  const has = KEYFRAME_PROPS.some((k) => loc.clip.keyframes[k]?.some((kf) => Math.abs(kf.t - t) <= 1000));
  const commands: Command[] = KEYFRAME_PROPS.map((prop) =>
    has
      ? ({ type: "clip/removeKeyframe", payload: { clipId, prop, t } } as Command)
      : ({ type: "clip/setKeyframe", payload: { clipId, prop, t, v: currentValue(loc.clip, prop, t) } } as Command),
  );
  useEditor.getState().dispatch({ type: "batch", payload: { label: has ? "Remove keyframe" : "Keyframe", commands } });
  haptic(10);
}

function currentValue(clip: { keyframes: Record<string, { t: number; v: number; ease: "linear" | "ease-in" | "ease-out" | "ease-in-out" | "hold" | "bezier" }[]>; transform: Record<string, unknown> }, prop: string, t: number): number {
  const base = Number(clip.transform[prop] ?? 0);
  return sampleKeyframes(clip.keyframes[prop], t, base);
}

/** Freeze the frame under the playhead for 3 s. */
export function freezeFrame(): void {
  const s = useEditor.getState();
  if (s.selection?.kind !== "clip") return;
  const id = createId("c_");
  if (
    s.dispatch({
      type: "clip/freeze",
      payload: { clipId: s.selection.clipId, atUs: s.playheadUs, newClipId: id, tailClipId: createId("c_"), durationUs: 3_000_000 },
    })
  ) {
    useEditor.getState().select({ kind: "clip", clipId: id });
  }
}

/** Import a .cube file and add it as a LUT effect on the clip. */
export async function addLutEffect(clipId: string, file: File): Promise<void> {
  const s = useEditor.getState();
  try {
    const { importLut } = await import("./luts");
    const asset = await importLut(file);
    const effect = { id: createId("e_"), type: "lut", enabled: true, params: { amount: 1 }, assetId: asset.id };
    useEditor.getState().dispatch({
      type: "batch",
      payload: { label: "LUT", commands: [{ type: "asset/add", payload: { asset } }, { type: "clip/addEffect", payload: { clipId, effect } }] },
    });
  } catch (e) {
    s.toast(`${tr("importFailed")}: ${(e as Error).message}`, "error");
  }
}

/** Match a clip's colours to another clip using thumbnail statistics. */
export async function matchColors(clipId: string, referenceClipId: string): Promise<void> {
  const p = committed();
  if (!p) return;
  const a = findClip(p, clipId)?.clip;
  const b = findClip(p, referenceClipId)?.clip;
  if (!a || !b || !isMediaClip(a) || !isMediaClip(b)) return;
  const { colorStats, colorMatchParams } = await import("@just-see/engine");
  const { getThumbnails } = await import("./media");
  const statsOf = async (assetId: string) => {
    const asset = p.assets.find((x) => x.id === assetId);
    if (!asset) return null;
    const thumbs = await getThumbnails(asset);
    const th = thumbs[Math.floor(thumbs.length / 2)];
    if (!th) return null;
    const img = new Image();
    img.src = th.url;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const ctx = c.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0);
    return colorStats(ctx.getImageData(0, 0, c.width, c.height).data);
  };
  const [ref, target] = await Promise.all([statsOf(b.assetId), statsOf(a.assetId)]);
  if (!ref || !target) return;
  const params = colorMatchParams(ref, target);
  const existing = a.effects.find((e) => e.type === "color-match");
  if (existing) useEditor.getState().dispatch({ type: "clip/updateEffect", payload: { clipId, effectId: existing.id, params } });
  else useEditor.getState().dispatch({ type: "clip/addEffect", payload: { clipId, effect: { id: createId("e_"), type: "color-match", enabled: true, params } } });
  useEditor.getState().toast(tr("colorMatched"));
}

/** Add (or toggle) AI background removal on a clip and start loading the model. */
export async function addBgRemoval(clipId: string): Promise<void> {
  const p = committed();
  const loc = p ? findClip(p, clipId) : undefined;
  if (!loc) return;
  const existing = loc.clip.effects.find((e) => e.type === "bg-remove");
  if (existing) {
    useEditor.getState().dispatch({ type: "clip/updateEffect", payload: { clipId, effectId: existing.id, enabled: !existing.enabled } });
    return;
  }
  addEffect(clipId, "bg-remove");
  const { loadSegmenter } = await import("./segment");
  const seg = await loadSegmenter();
  if (!seg) useEditor.getState().toast(tr("importFailed"), "error");
}

/** Follow the main subject when a wide clip sits in a tall canvas. */
export async function autoReframe(clipId: string): Promise<void> {
  const p = committed();
  const loc = p ? findClip(p, clipId) : undefined;
  if (!p || !loc || !isMediaClip(loc.clip) || loc.clip.kind !== "video") return;
  const clip = loc.clip;
  const asset = p.assets.find((a) => a.id === clip.assetId);
  if (!asset) return;
  useEditor.getState().toast(tr("reframing"));
  const [{ reframePlan }, { findSubjects }] = await Promise.all([import("@just-see/engine"), import("./detect")]);
  const span = clip.durationUs * clip.speed;
  const samples = await findSubjects(asset, clip.sourceInUs, clip.sourceInUs + span, 500_000);
  const seq = getSequence(p);
  const plan = reframePlan(samples, asset.width / asset.height, seq.width / seq.height, { sourceInUs: clip.sourceInUs, speed: clip.speed });
  const commands: Command[] = [
    { type: "clip/clearKeyframes", payload: { clipId, prop: "x" } },
    { type: "clip/update", payload: { clipId, patch: { transform: { scale: plan.scale, x: 0 } } } },
    ...plan.x
      .filter((k) => k.t <= clip.durationUs)
      .map((k) => ({ type: "clip/setKeyframe", payload: { clipId, prop: "x", t: k.t, v: k.v, ease: k.ease } }) as Command),
  ];
  if (useEditor.getState().dispatch({ type: "batch", payload: { label: "Auto reframe", commands } })) useEditor.getState().toast(tr("reframed"));
}
