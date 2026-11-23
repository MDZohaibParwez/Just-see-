"use client";

import { useStudioUi } from "./StudioScreen";
import { useMotionUi } from "./MotionScreen";
import { useLibraryUi } from "./LibraryScreen";
import { Icon, type IconName } from "@just-see/ui";
import { createId, findClip, getAsset, getSequence, isMediaClip, type Project } from "@just-see/schema";
import { addBgRemoval, autoReframe, addText, deleteSelection, duplicateSelection, freezeFrame, splitAtPlayhead } from "@/lib/actions";
import { addMarker, autoDuck, cutToBeat, markBeats, removeSilence } from "@/lib/audio-tools";
import { useEditor, useProject, type Panel } from "@/lib/editor-store";
import { useT, type MessageKey } from "@/lib/i18n";

function isWideIntoTall(p: Project, assetId: string): boolean {
  const a = getAsset(p, assetId);
  const seq = getSequence(p);
  return !!a && a.width / Math.max(1, a.height) > seq.width / seq.height + 0.05;
}

interface Tool {
  id: string;
  icon: IconName;
  label: MessageKey;
  run: () => void;
  danger?: boolean;
}

export function Toolbar({ onImport, onImportMusic }: { onImport: () => void; onImportMusic: () => void }) {
  const t = useT();
  const project = useProject();
  const selection = useEditor((s) => s.selection);
  const open = (p: Panel) => () => useEditor.getState().openPanel(p);
  const loc = project && selection ? findClip(project, selection.clipId) : undefined;

  const multiMode = useEditor((s) => s.multiMode);
  const multi = useEditor((s) => s.multi);
  let tools: Tool[];
  if (multiMode) {
    const st = useEditor.getState;
    const groupOf = project ? multi.map((id) => findClip(project, id)?.clip.groupId).find((g) => g) : undefined;
    tools = [
      { id: "multi-delete", icon: "trash", label: "delete", danger: true, run: () => {
        if (multi.length) st().dispatch({ type: "clip/deleteMany", payload: { clipIds: multi } });
        st().setMultiMode(false);
        st().select(null);
      } },
      { id: "group", icon: "duplicate", label: "group", run: () => {
        if (multi.length >= 2) st().dispatch({ type: "clip/group", payload: { clipIds: multi, groupId: createId("g_") } });
        st().setMultiMode(false);
      } },
    ];
    if (groupOf) tools.push({ id: "ungroup", icon: "close", label: "ungroup", run: () => {
      st().dispatch({ type: "clip/ungroup", payload: { groupId: groupOf } });
      st().setMultiMode(false);
    } });
    tools.push({ id: "multi-done", icon: "check", label: "done", run: () => st().setMultiMode(false) });
  } else if (selection?.kind === "transition") {
    tools = [
      { id: "transition", icon: "transition", label: "transition", run: open("transition") },
      { id: "delete", icon: "trash", label: "remove", run: deleteSelection, danger: true },
    ];
  } else if (loc && loc.clip.kind === "text" && loc.clip.motionCompId) {
    const compId = loc.clip.motionCompId;
    tools = [
      { id: "edit-motion", icon: "animation", label: "motionEdit", run: () => useMotionUi.getState().open(compId) },
      { id: "effects", icon: "effects", label: "effects", run: open("effects") },
      { id: "adjust", icon: "adjust", label: "adjust", run: open("adjust") },
      { id: "split", icon: "split", label: "split", run: splitAtPlayhead },
      { id: "duplicate", icon: "duplicate", label: "duplicate", run: duplicateSelection },
      { id: "delete", icon: "trash", label: "delete", run: deleteSelection, danger: true },
    ];
  } else if (loc && loc.clip.kind === "text") {
    tools = [
      { id: "edit", icon: "text", label: "edit", run: open("text") },
      { id: "style", icon: "style", label: "style", run: open("textStyle") },
      { id: "animation", icon: "animation", label: "animation", run: open("animation") },
      { id: "effects", icon: "effects", label: "effects", run: open("effects") },
      { id: "adjust", icon: "adjust", label: "adjust", run: open("adjust") },
      { id: "split", icon: "split", label: "split", run: splitAtPlayhead },
      { id: "select-more", icon: "dots", label: "selectMore", run: () => useEditor.getState().setMultiMode(true) },
      { id: "duplicate", icon: "duplicate", label: "duplicate", run: duplicateSelection },
      { id: "delete", icon: "trash", label: "delete", run: deleteSelection, danger: true },
    ];
  } else if (loc && isMediaClip(loc.clip)) {
    const c = loc.clip;
    tools = [{ id: "split", icon: "split", label: "split", run: splitAtPlayhead }];
    if (c.kind !== "image" && !c.holdFrame) tools.push({ id: "speed", icon: "speed", label: "speed", run: open("speed") });
    if (c.kind !== "image") tools.push({ id: "volume", icon: "volume", label: "volume", run: open("volume") });
    if (c.kind !== "image" && !c.holdFrame) tools.push({ id: "audio-fx", icon: "music", label: "audioFx", run: open("audioFx") });
    if (c.kind !== "audio") {
      tools.push({ id: "remove-bg", icon: "eyeOff", label: "removeBg", run: () => void addBgRemoval(c.id) });
      tools.push({ id: "effects", icon: "effects", label: "effects", run: open("effects") });
      tools.push({ id: "adjust", icon: "adjust", label: "adjust", run: open("adjust") });
      tools.push({ id: "crop", icon: "crop", label: "crop", run: open("crop") });
    }
    if (c.kind === "video" && !c.holdFrame) tools.push({ id: "freeze", icon: "freeze", label: "freeze", run: freezeFrame });
    if (c.kind === "video") tools.push({ id: "stabilize", icon: "crop", label: "stabilize", run: () => void runAi("stabilize", c.id) });
    if (c.kind === "image") tools.push({ id: "upscale", icon: "fullscreen", label: "aiUpscale", run: () => void runAi("upscale", c.id) });
    if (c.kind !== "audio") tools.push({ id: "enhance", icon: "sun", label: "hdEnhance", run: () => void runAi("enhance", c.id) });
    if (c.kind === "audio") tools.push({ id: "beats", icon: "keyframe", label: "beats", run: () => void markBeats(c.id) });
    if (c.kind !== "image" && !c.holdFrame) tools.push({ id: "silence", icon: "mute", label: "removeSilence", run: () => void removeSilence(c.id) });
    if (loc.track.type === "main" && loc.index > 0) {
      tools.push({
        id: "transition",
        icon: "transition",
        label: "transition",
        run: () => {
          useEditor.getState().select({ kind: "transition", clipId: c.id });
          useEditor.getState().openPanel("transition");
        },
      });
    }
    if (c.kind === "video" && project && isWideIntoTall(project, c.assetId)) {
      tools.push({ id: "reframe", icon: "canvas", label: "autoReframe", run: () => void autoReframe(c.id) });
    }
    tools.push({ id: "select-more", icon: "dots", label: "selectMore", run: () => useEditor.getState().setMultiMode(true) });
    tools.push({ id: "duplicate", icon: "duplicate", label: "duplicate", run: duplicateSelection });
    tools.push({ id: "delete", icon: "trash", label: "delete", run: deleteSelection, danger: true });
  } else {
    tools = [
      { id: "media", icon: "media", label: "media", run: onImport },
      { id: "library", icon: "folder", label: "library", run: () => useLibraryUi.getState().show() },
      { id: "text", icon: "text", label: "text", run: addText },
      { id: "captions", icon: "style", label: "captions", run: open("captions") },
      { id: "music", icon: "music", label: "music", run: onImportMusic },
      { id: "sfx", icon: "volume", label: "soundEffects", run: open("sfx") },
      { id: "auto-duck", icon: "fade", label: "autoDuck", run: () => void autoDuck() },
      { id: "ai-voice", icon: "music", label: "aiVoice", run: open("aiVoice") },
      { id: "studio", icon: "music", label: "studio", run: () => useStudioUi.getState().open("home") },
      { id: "motion", icon: "animation", label: "motion", run: () => useMotionUi.getState().open("home") },
      { id: "split", icon: "split", label: "split", run: splitAtPlayhead },
      { id: "canvas", icon: "canvas", label: "canvas", run: open("canvas") },
      { id: "marker", icon: "keyframe", label: "marker", run: addMarker },
    ];
    if (project && project.sequences.some((sq) => sq.markers.some((m) => m.kind === "beat"))) {
      tools.push({ id: "cut-to-beat", icon: "music", label: "cutToBeat", run: () => void cutToBeat() });
    }
  }

  return (
    <nav
      className="no-scrollbar flex h-[72px] shrink-0 items-stretch gap-1 overflow-x-auto border-t border-line bg-surface px-2 pb-[env(safe-area-inset-bottom)]"
      aria-label="Tools"
    >
      {(selection || multiMode) && (
        <button
          type="button"
          className="flex w-14 shrink-0 flex-col items-center justify-center gap-1 text-muted"
          onClick={() => {
            useEditor.getState().setMultiMode(false);
            useEditor.getState().select(null);
          }}
          aria-label={t("back")}
          data-testid="tool-back"
        >
          <Icon name="back" />
          <span className="text-[11px]">{t("back")}</span>
        </button>
      )}
      {tools.map((tool) => (
        <button
          key={tool.id}
          type="button"
          onClick={tool.run}
          data-testid={`tool-${tool.id}`}
          className={`flex min-w-16 shrink-0 flex-col items-center justify-center gap-1 rounded-xl px-2 active:bg-surface-2 ${
            tool.danger ? "text-danger" : "text-fg"
          }`}
        >
          <Icon name={tool.icon} />
          <span className="whitespace-nowrap text-[11px]">{t(tool.label)}</span>
        </button>
      ))}
    </nav>
  );
}

/** Run a device-side AI/heavy tool with progress toasts. */
async function runAi(kind: "stabilize" | "upscale" | "enhance", clipId: string): Promise<void> {
  const s = useEditor.getState();
  const { translate, useLocale } = await import("@/lib/i18n");
  const tr = (k: Parameters<typeof translate>[1]) => translate(useLocale.getState().locale, k);
  const m = await import("@/lib/ai-tools");
  try {
    if (kind === "enhance") {
      m.enhanceClip(clipId);
      s.toast(tr("hdEnhanceDone"));
      return;
    }
    s.toast(tr(kind === "stabilize" ? "stabilizing" : "upscaling"));
    if (kind === "stabilize") {
      const shake = await m.stabilizeClip(clipId);
      s.toast(`${tr("stabilized")} (${shake.toFixed(1)}%)`);
    } else {
      const r = await m.upscaleImageClip(clipId);
      s.toast(`${tr("upscaled")} ${r.width}×${r.height}`);
    }
  } catch (e) {
    s.toast(e instanceof Error ? e.message : String(e), "error");
  }
}
