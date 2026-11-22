"use client";

import { Icon } from "@just-see/ui";
import { formatTimecode, getSequence, sequenceDurationUs } from "@just-see/schema";
import { togglePlay } from "@/lib/actions";
import { useEditor, useProject } from "@/lib/editor-store";
import { useT } from "@/lib/i18n";

export function Transport({ onFullscreen }: { onFullscreen: () => void }) {
  const t = useT();
  const playing = useEditor((s) => s.playing);
  const playhead = useEditor((s) => Math.floor(s.playheadUs / 100_000));
  const project = useProject();
  const duration = project ? sequenceDurationUs(getSequence(project)) : 0;
  const zoom = useEditor((s) => s.setZoom);
  const pps = useEditor((s) => s.pxPerSecond);
  return (
    <div className="flex h-12 items-center justify-between px-3">
      <div className="w-28 font-mono text-xs tabular-nums text-muted" data-testid="timecode">
        <span className="text-fg">{formatTimecode(playhead * 100_000)}</span> / {formatTimecode(duration)}
      </div>
      <button
        type="button"
        onClick={togglePlay}
        className="flex h-11 w-11 items-center justify-center rounded-full bg-fg text-bg active:scale-95"
        aria-label={playing ? t("pause") : t("play")}
        data-testid="play"
      >
        <Icon name={playing ? "pause" : "play"} size={24} />
      </button>
      <div className="flex w-28 items-center justify-end gap-1">
        <button
          type="button"
          className="hidden h-9 w-9 items-center justify-center rounded-full text-muted hover:bg-surface-2 sm:flex"
          onClick={() => zoom(pps / 1.5)}
          aria-label="Zoom out"
        >
          <Icon name="zoomOut" size={20} />
        </button>
        <button
          type="button"
          className="hidden h-9 w-9 items-center justify-center rounded-full text-muted hover:bg-surface-2 sm:flex"
          onClick={() => zoom(pps * 1.5)}
          aria-label="Zoom in"
        >
          <Icon name="zoomIn" size={20} />
        </button>
        <button
          type="button"
          className="flex h-9 w-9 items-center justify-center rounded-full text-muted hover:bg-surface-2"
          onClick={onFullscreen}
          aria-label={t("fullscreen")}
        >
          <Icon name="fullscreen" size={20} />
        </button>
      </div>
    </div>
  );
}
