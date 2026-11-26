"use client";

import { useState } from "react";
import { createId, createTextClip, findClip, isMediaClip } from "@just-see/schema";
import { useEditor, useProject } from "@/lib/editor-store";
import { useT, type MessageKey } from "@/lib/i18n";
import { Chip, Sheet } from "./controls";

const STICKERS = ["😎", "😂", "❤️", "🔥", "👑", "⭐", "😡", "🤯"];

/** Face tracking for a video clip: follow, blur, mosaic, or stick an emoji / text to the face. */
export function FacePanel() {
  const t = useT();
  const project = useProject();
  const selection = useEditor((s) => s.selection);
  const [zoom, setZoom] = useState(1);
  const [sticker, setSticker] = useState(STICKERS[0]!);
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const loc = project && selection?.kind === "clip" ? findClip(project, selection.clipId) : undefined;
  if (!loc || !isMediaClip(loc.clip) || loc.clip.kind !== "video") return null;
  const c = loc.clip;

  const run = async (mode: "follow" | "blur" | "mosaic" | "stick") => {
    if (busy) return;
    setBusy(mode);
    setProgress(0);
    try {
      const { applyFace } = await import("@/lib/face");
      let targetId: string | undefined;
      if (mode === "stick") {
        // A new emoji/text over the whole clip, on its own track, then stuck to the face.
        targetId = createId("c_");
        const clip = createTextClip({ id: targetId, text: sticker, startUs: c.startUs, durationUs: c.durationUs });
        clip.style = { ...clip.style, fontSize: 0.09 };
        useEditor.getState().dispatch({ type: "clip/add", payload: { clip, trackType: "text", newTrackId: createId("t_") } });
      }
      await applyFace(c.id, mode, { zoom, targetId, onProgress: setProgress });
    } catch (e) {
      useEditor.getState().toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setBusy(null);
    }
  };

  const btn = (mode: "follow" | "blur" | "mosaic" | "stick", label: MessageKey) => (
    <button
      type="button"
      data-testid={`face-${mode}`}
      disabled={!!busy}
      onClick={() => void run(mode)}
      className="flex h-12 items-center justify-center rounded-xl border border-line bg-surface-2 px-3 text-sm font-medium disabled:opacity-60"
    >
      {busy === mode ? `${Math.round(progress * 100)}%` : t(label)}
    </button>
  );

  return (
    <Sheet title={t("faceTool")}>
      <div className="grid grid-cols-2 gap-2">
        {btn("follow", "faceFollow")}
        {btn("blur", "faceBlur")}
        {btn("mosaic", "faceMosaic")}
        {btn("stick", "faceStick")}
      </div>
      <label className="mt-3 block text-sm">
        {t("faceZoom")} {zoom.toFixed(1)}×
        <input type="range" min={0.6} max={2} step={0.1} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} className="w-full" data-testid="face-zoom" />
      </label>
      <div className="mt-2 flex flex-wrap gap-1" role="radiogroup" aria-label={t("faceStick")}>
        {STICKERS.map((s) => (
          <Chip key={s} active={s === sticker} onClick={() => setSticker(s)} testId={`face-sticker-${s}`}>
            {s}
          </Chip>
        ))}
      </div>
    </Sheet>
  );
}
