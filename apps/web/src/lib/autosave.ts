"use client";

import type { Project } from "@just-see/schema";
import { addVersion, kvSet, saveProject } from "./storage/db";
import { useEditor } from "./editor-store";

/** Auto-snapshot into version history at most this often while editing. */
const VERSION_EVERY_MS = 3 * 60 * 1000;
const DEBOUNCE_MS = 350;

/**
 * Saves the project on every committed change (debounced) and flushes when the
 * tab is hidden, so a crash or closed tab loses at most a fraction of a second.
 */
export function startAutosave(): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: Project | null = null;
  let lastVersionAt = Date.now();
  let saving: Promise<void> = Promise.resolve();

  const flush = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    const p = pending;
    if (!p) return saving;
    pending = null;
    useEditor.getState().setSaveState("saving");
    saving = saving
      .then(async () => {
        await saveProject(p);
        await kvSet("lastProjectId", p.id);
        if (Date.now() - lastVersionAt > VERSION_EVERY_MS) {
          lastVersionAt = Date.now();
          await addVersion(p, "Autosave");
        }
        if (!pending) useEditor.getState().setSaveState("saved");
      })
      .catch((e: unknown) => {
        console.error("Autosave failed", e);
        useEditor.getState().toast("Could not save. Check free storage.", "error");
      });
    return saving;
  };

  const unsub = useEditor.subscribe((s, prev) => {
    if (s.revision === prev.revision || !s.history) return;
    pending = s.history.project;
    useEditor.getState().setSaveState("saving");
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, DEBOUNCE_MS);
  });

  const onHide = () => {
    if (document.visibilityState === "hidden") void flush();
  };
  const onPageHide = () => void flush();
  document.addEventListener("visibilitychange", onHide);
  window.addEventListener("pagehide", onPageHide);

  return () => {
    void flush();
    unsub();
    document.removeEventListener("visibilitychange", onHide);
    window.removeEventListener("pagehide", onPageHide);
  };
}
