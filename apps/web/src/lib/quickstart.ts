/**
 * Quick reel: the fastest first edit. Files chosen on the home screen are
 * handed to the editor (same tab), placed on the timeline, cut to a reel
 * length, given mood music, and the export sheet opens.
 */
import { getSequence, sequenceDurationUs } from "@just-see/schema";
import { importFiles } from "./actions";
import { currentProject, useEditor } from "./editor-store";
import { track } from "./telemetry";

const committed = () => currentProject(useEditor.getState());

let pending: File[] = [];

export function setQuickFiles(files: File[]): void {
  pending = files;
}

export function takeQuickFiles(): File[] {
  const f = pending;
  pending = [];
  return f;
}

/** Longest a quick reel gets (seconds); longer timelines are trimmed at the end. */
const MAX_SEC = 30;

export async function buildQuickReel(files: File[], mood = "upbeat"): Promise<void> {
  if (!files.length) return;
  track("quick-reel");
  await importFiles(files, "media");
  const p = committed();
  if (!p) return;
  const seq = getSequence(p);
  const main = seq.tracks.find((t) => t.type === "main");
  // Keep it reel-length: shorten the clips evenly if the total is too long.
  const total = sequenceDurationUs(seq);
  if (main && total > MAX_SEC * 1e6) {
    const per = Math.floor((MAX_SEC * 1e6) / main.clips.length);
    for (const id of main.clips.map((c) => c.id)) {
      // Positions shift after each trim (magnetic track): look the clip up again.
      const now = committed();
      const c = now ? getSequence(now).tracks.find((t) => t.type === "main")?.clips.find((x) => x.id === id) : undefined;
      if (c && c.durationUs > per) useEditor.getState().dispatch({ type: "clip/trim", payload: { clipId: c.id, edge: "end", timeUs: c.startUs + per } });
    }
  }
  useEditor.getState().setPlayhead(0);
  const { addMoodMusic } = await import("./styles");
  await addMoodMusic(mood, 0.5, true);
  useEditor.getState().setPlayhead(0);
}
