"use client";

import { Icon, type IconName } from "@just-see/ui";
import { findClip, isMediaClip } from "@just-see/schema";
import { addText, deleteSelection, duplicateSelection, freezeFrame, splitAtPlayhead } from "@/lib/actions";
import { addMarker, cutToBeat, markBeats, removeSilence } from "@/lib/audio-tools";
import { useEditor, useProject, type Panel } from "@/lib/editor-store";
import { useT, type MessageKey } from "@/lib/i18n";

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

  let tools: Tool[];
  if (selection?.kind === "transition") {
    tools = [
      { id: "transition", icon: "transition", label: "transition", run: open("transition") },
      { id: "delete", icon: "trash", label: "remove", run: deleteSelection, danger: true },
    ];
  } else if (loc && loc.clip.kind === "text") {
    tools = [
      { id: "edit", icon: "text", label: "edit", run: open("text") },
      { id: "style", icon: "style", label: "style", run: open("textStyle") },
      { id: "animation", icon: "animation", label: "animation", run: open("animation") },
      { id: "effects", icon: "effects", label: "effects", run: open("effects") },
      { id: "adjust", icon: "adjust", label: "adjust", run: open("adjust") },
      { id: "split", icon: "split", label: "split", run: splitAtPlayhead },
      { id: "duplicate", icon: "duplicate", label: "duplicate", run: duplicateSelection },
      { id: "delete", icon: "trash", label: "delete", run: deleteSelection, danger: true },
    ];
  } else if (loc && isMediaClip(loc.clip)) {
    const c = loc.clip;
    tools = [{ id: "split", icon: "split", label: "split", run: splitAtPlayhead }];
    if (c.kind !== "image" && !c.holdFrame) tools.push({ id: "speed", icon: "speed", label: "speed", run: open("speed") });
    if (c.kind !== "image") tools.push({ id: "volume", icon: "volume", label: "volume", run: open("volume") });
    if (c.kind !== "audio") {
      tools.push({ id: "effects", icon: "effects", label: "effects", run: open("effects") });
      tools.push({ id: "adjust", icon: "adjust", label: "adjust", run: open("adjust") });
      tools.push({ id: "crop", icon: "crop", label: "crop", run: open("crop") });
    }
    if (c.kind === "video" && !c.holdFrame) tools.push({ id: "freeze", icon: "freeze", label: "freeze", run: freezeFrame });
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
    tools.push({ id: "duplicate", icon: "duplicate", label: "duplicate", run: duplicateSelection });
    tools.push({ id: "delete", icon: "trash", label: "delete", run: deleteSelection, danger: true });
  } else {
    tools = [
      { id: "media", icon: "media", label: "media", run: onImport },
      { id: "text", icon: "text", label: "text", run: addText },
      { id: "music", icon: "music", label: "music", run: onImportMusic },
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
      {selection && (
        <button
          type="button"
          className="flex w-14 shrink-0 flex-col items-center justify-center gap-1 text-muted"
          onClick={() => useEditor.getState().select(null)}
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
