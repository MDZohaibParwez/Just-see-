"use client";

import { lazy, Suspense, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { addText, deleteSelection, duplicateSelection, importFiles, splitAtPlayhead, stepFrame, togglePlay } from "@/lib/actions";
import { startAutosave } from "@/lib/autosave";
import { useEditor } from "@/lib/editor-store";
import { useT } from "@/lib/i18n";
import { useLibraryUi, useMotionUi, useStudioUi } from "@/lib/ui-stores";
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

// Big screens and panels load only when opened, so the editor starts fast on phones.
const ExportPanel = lazy(() => import("./ExportPanel").then((m) => ({ default: m.ExportPanel })));
const CaptionsPanel = lazy(() => import("./CaptionsPanel").then((m) => ({ default: m.CaptionsPanel })));
const AiVoicePanel = lazy(() => import("./AudioPanels").then((m) => ({ default: m.AiVoicePanel })));
const AudioFxPanel = lazy(() => import("./AudioPanels").then((m) => ({ default: m.AudioFxPanel })));
const SfxPanel = lazy(() => import("./AudioPanels").then((m) => ({ default: m.SfxPanel })));
const StudioScreen = lazy(() => import("./StudioScreen").then((m) => ({ default: m.StudioScreen })));
const MotionScreen = lazy(() => import("./MotionScreen").then((m) => ({ default: m.MotionScreen })));
const LibraryScreen = lazy(() => import("./LibraryScreen").then((m) => ({ default: m.LibraryScreen })));
const LivePanel = lazy(() => import("./LivePanel").then((m) => ({ default: m.LivePanel })));

function PanelLoading() {
  return (
    <div className="flex h-24 items-center justify-center text-sm text-fg-muted" role="status">
      …
    </div>
  );
}

/** Loads the live-editing code (PeerJS) only once someone starts or joins a session. */
function LiveGate() {
  const [on, setOn] = useState(() => typeof window !== "undefined" && new URLSearchParams(window.location.search).has("live"));
  useEffect(() => {
    if (on) return;
    const go = () => {
      setOn(true);
      // The panel was not listening yet: ask it again once it has loaded.
      setTimeout(() => window.dispatchEvent(new Event("justsee:live")), 50);
    };
    window.addEventListener("justsee:live", go, { once: true });
    return () => window.removeEventListener("justsee:live", go);
  }, [on]);
  return on ? (
    <Suspense fallback={null}>
      <LivePanel />
    </Suspense>
  ) : null;
}

function Screens() {
  const studio = useStudioUi((s) => s.openId !== null);
  const motion = useMotionUi((s) => s.openId !== null);
  const library = useLibraryUi((s) => s.open);
  return (
    <Suspense fallback={null}>
      {studio && <StudioScreen />}
      {motion && <MotionScreen />}
      {library && <LibraryScreen />}
    </Suspense>
  );
}

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
  return (
    <Suspense fallback={<PanelLoading />}>
      <PanelBody />
    </Suspense>
  );
}

function PanelBody() {
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
    case "captions":
      return <CaptionsPanel />;
    case "audioFx":
      return <AudioFxPanel />;
    case "sfx":
      return <SfxPanel />;
    case "aiVoice":
      return <AiVoicePanel />;
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
  const overlayInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const on = () => overlayInput.current?.click();
    window.addEventListener("justsee:overlay", on);
    return () => window.removeEventListener("justsee:overlay", on);
  }, []);
  const stageRef = useRef<HTMLDivElement>(null);
  const hasPanel = useEditor((s) => s.panel !== null);
  const desktop = useMediaQuery("(min-width: 1024px)");

  useEffect(() => startAutosave(), []);

  // Keyboard shortcuts for desktop.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      if (useStudioUi.getState().openId || useMotionUi.getState().openId || useLibraryUi.getState().open) return;
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
      <Screens />
      <LiveGate />
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
        ref={overlayInput}
        type="file"
        accept="video/*,image/*"
        hidden
        data-testid="overlay-input"
        onChange={(e) => {
          const files = e.currentTarget.files;
          if (files) void importFiles(Array.from(files), "overlay");
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
