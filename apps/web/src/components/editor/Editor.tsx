"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { addText, deleteSelection, duplicateSelection, importFiles, splitAtPlayhead, stepFrame, togglePlay } from "@/lib/actions";
import { startAutosave } from "@/lib/autosave";
import { useEditor } from "@/lib/editor-store";
import { useT } from "@/lib/i18n";
import { ExportPanel } from "./ExportPanel";
import {
  AdjustPanel,
  AnimationPanel,
  CanvasPanel,
  CropPanel,
  EffectsPanel,
  HistoryPanel,
  SpeedPanel,
  TextPanel,
  TextStylePanel,
  TransitionPanel,
  VolumePanel,
} from "./panels";
import { Preview } from "./Preview";
import { Timeline } from "./Timeline";
import { Toolbar } from "./Toolbar";
import { TopBar } from "./TopBar";
import { Transport } from "./Transport";

function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(query);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

function ActivePanel() {
  const panel = useEditor((s) => s.panel);
  switch (panel) {
    case "speed":
      return <SpeedPanel />;
    case "volume":
      return <VolumePanel />;
    case "effects":
      return <EffectsPanel />;
    case "transition":
      return <TransitionPanel />;
    case "text":
      return <TextPanel />;
    case "textStyle":
      return <TextStylePanel />;
    case "animation":
      return <AnimationPanel />;
    case "adjust":
      return <AdjustPanel />;
    case "crop":
      return <CropPanel />;
    case "canvas":
      return <CanvasPanel />;
    case "export":
      return <ExportPanel />;
    case "history":
      return <HistoryPanel />;
    default:
      return null;
  }
}

function Toasts() {
  const toasts = useEditor((s) => s.toasts);
  return (
    <div className="pointer-events-none fixed inset-x-0 top-16 z-50 flex flex-col items-center gap-2 px-4" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          role={t.kind === "error" ? "alert" : "status"}
          className={`pointer-events-auto max-w-sm rounded-xl px-4 py-2 text-sm shadow-lg ${
            t.kind === "error" ? "bg-danger text-white" : "bg-surface-3 text-fg"
          }`}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}

export function Editor() {
  const t = useT();
  const mediaInput = useRef<HTMLInputElement>(null);
  const musicInput = useRef<HTMLInputElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const hasPanel = useEditor((s) => s.panel !== null);
  const desktop = useMediaQuery("(min-width: 1024px)");

  useEffect(() => startAutosave(), []);

  // Keyboard shortcuts for desktop.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      const s = useEditor.getState();
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) s.redo();
        else s.undo();
      } else if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        s.redo();
      } else if (mod && e.key.toLowerCase() === "d") {
        e.preventDefault();
        duplicateSelection();
      } else if (mod && e.key.toLowerCase() === "e") {
        e.preventDefault();
        s.openPanel("export");
      } else if (e.key === " ") {
        e.preventDefault();
        togglePlay();
      } else if (e.key.toLowerCase() === "s" || (mod && e.key.toLowerCase() === "b")) {
        e.preventDefault();
        splitAtPlayhead();
      } else if (e.key === "Delete" || e.key === "Backspace") {
        deleteSelection();
      } else if (e.key === "ArrowLeft") {
        stepFrame(-1);
      } else if (e.key === "ArrowRight") {
        stepFrame(1);
      } else if (e.key === "Home") {
        s.setPlayhead(0);
      } else if (e.key === "End") {
        s.setPlayhead(Number.MAX_SAFE_INTEGER);
      } else if (e.key === "=" || e.key === "+") {
        s.setZoom(s.pxPerSecond * 1.4);
      } else if (e.key === "-") {
        s.setZoom(s.pxPerSecond / 1.4);
      } else if (e.key.toLowerCase() === "m") {
        void import("@/lib/audio-tools").then((m) => m.addMarker());
      } else if (e.key.toLowerCase() === "t") {
        addText();
      } else if (e.key.toLowerCase() === "i") {
        mediaInput.current?.click();
      } else if (e.key === "Escape") {
        if (s.panel) s.openPanel(null);
        else s.select(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const fullscreen = () => {
    const el = stageRef.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el.requestFullscreen?.().catch(() => undefined);
  };

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-bg text-fg">
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <div ref={stageRef} className="min-h-0 flex-1 bg-bg px-2 py-1">
            <Preview />
          </div>
          <Transport onFullscreen={fullscreen} />
          <div className="h-[30vh] min-h-[180px] shrink-0 lg:h-[32vh]">
            <Timeline onAddMedia={() => mediaInput.current?.click()} />
          </div>
          {hasPanel && !desktop && <ActivePanel />}
          {(!hasPanel || desktop) && (
            <Toolbar onImport={() => mediaInput.current?.click()} onImportMusic={() => musicInput.current?.click()} />
          )}
        </div>
        {hasPanel && desktop && <aside className="flex w-[360px] shrink-0 flex-col">{<ActivePanel />}</aside>}
      </div>
      <p className="sr-only">{t("keyboardHint")}</p>
      <input
        ref={mediaInput}
        type="file"
        accept="video/*,image/*"
        multiple
        hidden
        data-testid="media-input"
        onChange={(e) => {
          const files = e.currentTarget.files;
          if (files) void importFiles(Array.from(files), "media");
          e.currentTarget.value = "";
        }}
      />
      <input
        ref={musicInput}
        type="file"
        accept="audio/*"
        multiple
        hidden
        data-testid="music-input"
        onChange={(e) => {
          const files = e.currentTarget.files;
          if (files) void importFiles(Array.from(files), "music");
          e.currentTarget.value = "";
        }}
      />
      <Toasts />
    </div>
  );
}
