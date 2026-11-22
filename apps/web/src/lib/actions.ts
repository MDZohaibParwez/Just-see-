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
export async function importFiles(files: FileList | File[], mode: "media" | "music" = "media"): Promise<void> {
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
      } else {
        // Insert after the clip under the playhead (or at the end).
        const under = clipAt(main, t);
        const index = under ? main.clips.indexOf(under) + 1 : main.clips.length;
        commands.push({ type: "clip/add", payload: { clip, trackId: main.id, index } });
      }
      useEditor.getState().dispatch({ type: "batch", payload: { label: "Import media", commands } });
      if (kind !== "audio") {
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
