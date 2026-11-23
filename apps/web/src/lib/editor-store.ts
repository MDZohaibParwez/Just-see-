"use client";

import { create } from "zustand";
import {
  CommandError,
  applyCommand,
  canRedo,
  canUndo,
  clamp,
  createHistory,
  execute,
  getSequence,
  redo as redoHistory,
  sequenceDurationUs,
  undo as undoHistory,
  type Command,
  type HistoryState,
  type Project,
} from "@just-see/schema";

export type Selection = { kind: "clip"; clipId: string } | { kind: "transition"; clipId: string } | null;

export type Panel =
  | "speed"
  | "volume"
  | "effects"
  | "transition"
  | "text"
  | "textStyle"
  | "animation"
  | "adjust"
  | "crop"
  | "canvas"
  | "export"
  | "history"
  | null;

export interface Toast {
  id: number;
  message: string;
  kind: "info" | "error";
}

interface EditorState {
  history: HistoryState | null;
  /** Transient project shown while a gesture is in progress (not in history). */
  draft: Project | null;
  playheadUs: number;
  playing: boolean;
  pxPerSecond: number;
  selection: Selection;
  panel: Panel;
  saveState: "idle" | "saving" | "saved";
  toasts: Toast[];
  /** Bumps on every committed change; used by autosave. */
  revision: number;

  load(project: Project): void;
  unload(): void;
  dispatch(command: Command): boolean;
  preview(command: Command | null): void;
  undo(): void;
  redo(): void;
  setPlayhead(us: number): void;
  setPlaying(playing: boolean): void;
  setZoom(pxPerSecond: number): void;
  select(selection: Selection): void;
  openPanel(panel: Panel): void;
  toast(message: string, kind?: Toast["kind"]): void;
  dismissToast(id: number): void;
  setSaveState(s: EditorState["saveState"]): void;
}

export const MIN_PX_PER_SECOND = 8;
export const MAX_PX_PER_SECOND = 600;
let toastId = 0;

export const useEditor = create<EditorState>((set, get) => ({
  history: null,
  draft: null,
  playheadUs: 0,
  playing: false,
  pxPerSecond: 60,
  selection: null,
  panel: null,
  saveState: "idle",
  toasts: [],
  revision: 0,

  load(project) {
    set({
      history: createHistory(project),
      draft: null,
      playheadUs: 0,
      playing: false,
      selection: null,
      panel: null,
      saveState: "saved",
      revision: 0,
    });
  },

  unload() {
    set({ history: null, draft: null, selection: null, panel: null, playing: false });
  },

  dispatch(command) {
    const h = get().history;
    if (!h) return false;
    try {
      const next = execute(h, command);
      if (next === h) {
        set({ draft: null });
        return true;
      }
      const duration = sequenceDurationUs(getSequence(next.project));
      set((s) => ({
        history: next,
        draft: null,
        revision: s.revision + 1,
        playheadUs: Math.min(s.playheadUs, duration),
      }));
      // Drop selection if the clip vanished.
      const sel = get().selection;
      if (sel && !clipExists(next.project, sel.clipId)) set({ selection: null, panel: null });
      return true;
    } catch (e) {
      set({ draft: null });
      if (e instanceof CommandError) get().toast(e.message, "error");
      else throw e;
      return false;
    }
  },

  preview(command) {
    const h = get().history;
    if (!h) return;
    if (!command) {
      set({ draft: null });
      return;
    }
    try {
      set({ draft: applyCommand(h.project, command).project });
    } catch {
      // Ignore invalid intermediate states during a drag.
    }
  },

  undo() {
    const h = get().history;
    if (!h || !canUndo(h)) return;
    const next = undoHistory(h);
    set((s) => ({ history: next, draft: null, revision: s.revision + 1 }));
    const sel = get().selection;
    if (sel && !clipExists(next.project, sel.clipId)) set({ selection: null, panel: null });
  },

  redo() {
    const h = get().history;
    if (!h || !canRedo(h)) return;
    const next = redoHistory(h);
    set((s) => ({ history: next, draft: null, revision: s.revision + 1 }));
  },

  setPlayhead(us) {
    const p = currentProject(get());
    const max = p ? sequenceDurationUs(getSequence(p)) : 0;
    set({ playheadUs: Math.round(clamp(us, 0, max)) });
  },

  setPlaying(playing) {
    set({ playing });
  },

  setZoom(pxPerSecond) {
    set({ pxPerSecond: clamp(pxPerSecond, MIN_PX_PER_SECOND, MAX_PX_PER_SECOND) });
  },

  select(selection) {
    set((s) => ({ selection, panel: selection ? (s.panel && s.selection?.clipId === selection.clipId ? s.panel : null) : null }));
  },

  openPanel(panel) {
    set({ panel });
  },

  toast(message, kind = "info") {
    const id = ++toastId;
    set((s) => ({ toasts: [...s.toasts.slice(-2), { id, message, kind }] }));
    setTimeout(() => get().dismissToast(id), kind === "error" ? 5000 : 2500);
  },

  dismissToast(id) {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },

  setSaveState(saveState) {
    set({ saveState });
  },
}));

function clipExists(p: Project, clipId: string): boolean {
  return p.sequences.some((s) => s.tracks.some((t) => t.clips.some((c) => c.id === clipId)));
}

export function currentProject(s: Pick<EditorState, "draft" | "history">): Project | null {
  return s.draft ?? s.history?.project ?? null;
}

/** Hook: the project to display (draft while dragging). */
export function useProject(): Project | null {
  return useEditor((s) => s.draft ?? s.history?.project ?? null);
}

export function useCanUndo(): boolean {
  return useEditor((s) => !!s.history && canUndo(s.history));
}

export function useCanRedo(): boolean {
  return useEditor((s) => !!s.history && canRedo(s.history));
}
