"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@just-see/ui";
import { exportMp4, exportSizes } from "@just-see/engine";
import { formatTimecode, getSequence, sequenceDurationUs } from "@just-see/schema";
import { useEditor, useProject } from "@/lib/editor-store";
import { mediaLoader } from "@/lib/media";
import { useT, type MessageKey } from "@/lib/i18n";
import { Chip, Sheet } from "./controls";

type State =
  | { kind: "idle" }
  | { kind: "running"; phase: string; progress: number }
  | { kind: "done"; url: string; blob: Blob; name: string; info: string }
  | { kind: "error"; message: string };

const PHASE: Record<string, MessageKey> = {
  prepare: "preparing",
  audio: "mixingAudio",
  video: "renderingVideo",
  finalize: "finishing",
};

export function ExportPanel() {
  const t = useT();
  const project = useProject();
  const seq = project ? getSequence(project) : null;
  const sizes = seq ? exportSizes(seq.width, seq.height) : [];
  const [size, setSize] = useState("1080p");
  const [fps, setFps] = useState(seq?.fps ?? 30);
  const [quality, setQuality] = useState<"standard" | "high">("standard");
  const [state, setState] = useState<State>({ kind: "idle" });
  const abort = useRef<AbortController | null>(null);

  useEffect(() => () => abort.current?.abort(), []);
  useEffect(
    () => () => {
      if (state.kind === "done") URL.revokeObjectURL(state.url);
    },
    [state],
  );

  if (!project || !seq) return null;
  const duration = sequenceDurationUs(seq);

  const start = async () => {
    const chosen = sizes.find((s) => s.label === size) ?? sizes[1]!;
    const ctrl = new AbortController();
    abort.current = ctrl;
    setState({ kind: "running", phase: "prepare", progress: 0 });
    const started = performance.now();
    try {
      const base = chosen.width * chosen.height >= 3840 * 2160 ? 40e6 : chosen.width * chosen.height >= 1920 * 1080 ? 12e6 : 6e6;
      const res = await exportMp4(project, mediaLoader, {
        width: chosen.width,
        height: chosen.height,
        fps,
        videoBitrate: Math.round(base * (quality === "high" ? 1.8 : 1) * (fps > 30 ? 1.5 : 1)),
        signal: ctrl.signal,
        onProgress: (p) => setState({ kind: "running", phase: p.phase, progress: p.progress }),
      });
      const url = URL.createObjectURL(res.blob);
      const safe = project.name.replace(/[^\p{L}\p{N} _-]/gu, "").trim() || "video";
      const secs = ((performance.now() - started) / 1000).toFixed(1);
      setState({
        kind: "done",
        url,
        blob: res.blob,
        name: `${safe}.mp4`,
        info: `${chosen.width}×${chosen.height} · ${fps} fps · ${res.videoCodec}${res.audioCodec ? ` + ${res.audioCodec}` : ""} · ${(res.blob.size / 1e6).toFixed(1)} MB · ${secs}s`,
      });
    } catch (e) {
      if ((e as Error).name === "AbortError") setState({ kind: "idle" });
      else setState({ kind: "error", message: (e as Error).message });
    }
  };

  const share = async () => {
    if (state.kind !== "done") return;
    const file = new File([state.blob], state.name, { type: "video/mp4" });
    try {
      if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: project.name });
    } catch {
      // user cancelled
    }
  };

  return (
    <Sheet
      title={t("export")}
      onClose={() => {
        abort.current?.abort();
        useEditor.getState().openPanel(null);
      }}
    >
      {state.kind === "idle" || state.kind === "error" ? (
        <div className="flex flex-col gap-3 py-2">
          <div>
            <p className="mb-1 text-xs text-muted">{t("resolution")}</p>
            <div className="flex flex-wrap gap-2">
              {sizes.map((s) => (
                <Chip key={s.label} active={size === s.label} onClick={() => setSize(s.label)} testId={`export-size-${s.label}`}>
                  {s.label}
                </Chip>
              ))}
            </div>
            {size === "4K" && <p className="mt-1 text-xs text-muted">{t("heavyExport")}</p>}
          </div>
          <div>
            <p className="mb-1 text-xs text-muted">{t("frameRate")}</p>
            <div className="flex flex-wrap gap-2">
              {[24, 25, 30, 60].map((f) => (
                <Chip key={f} active={fps === f} onClick={() => setFps(f)} testId={`export-fps-${f}`}>
                  {f}
                </Chip>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-1 text-xs text-muted">{t("quality")}</p>
            <div className="flex gap-2">
              <Chip active={quality === "standard"} onClick={() => setQuality("standard")}>
                {t("standard")}
              </Chip>
              <Chip active={quality === "high"} onClick={() => setQuality("high")}>
                {t("high")}
              </Chip>
            </div>
          </div>
          {state.kind === "error" && (
            <p className="rounded-xl bg-danger/15 p-2 text-sm text-danger" role="alert">
              {t("exportFailed")}: {state.message}
            </p>
          )}
          <button
            type="button"
            disabled={duration <= 0}
            onClick={() => void start()}
            data-testid="start-export"
            className="mt-1 rounded-xl bg-accent py-3 font-semibold text-accent-contrast disabled:opacity-40"
          >
            {t("startExport")} · {formatTimecode(duration)}
          </button>
          <p className="text-center text-xs text-muted">{t("noWatermark")}</p>
        </div>
      ) : state.kind === "running" ? (
        <div className="py-4" aria-live="polite">
          <p className="mb-2 text-sm">{t(PHASE[state.phase] ?? "exporting")}</p>
          <div className="h-2 w-full overflow-hidden rounded-full bg-surface-2">
            <div
              className="h-full bg-accent transition-[width]"
              style={{ width: `${Math.round((state.phase === "video" ? state.progress : state.phase === "finalize" ? 1 : 0.02) * 100)}%` }}
              data-testid="export-progress"
            />
          </div>
          <button type="button" className="mt-4 w-full rounded-xl bg-surface-2 py-2 text-sm" onClick={() => abort.current?.abort()}>
            {t("cancel")}
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-3 py-2" data-testid="export-done">
          <p className="font-semibold">{t("exportDone")}</p>
          <video src={state.url} controls playsInline className="max-h-56 w-full rounded-xl bg-black" />
          <p className="text-xs text-muted" data-testid="export-info">
            {state.info}
          </p>
          <div className="flex gap-2">
            <a
              href={state.url}
              download={state.name}
              data-testid="download"
              className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-accent py-3 font-semibold text-accent-contrast"
            >
              <Icon name="download" size={20} />
              {t("download")}
            </a>
            {typeof navigator !== "undefined" && "share" in navigator && (
              <button type="button" onClick={() => void share()} className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-surface-2 py-3">
                <Icon name="share" size={20} />
                {t("share")}
              </button>
            )}
          </div>
        </div>
      )}
    </Sheet>
  );
}
