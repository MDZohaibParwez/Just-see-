"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@just-see/ui";
import {
  clipEndUs,
  collectSnapPoints,
  createId,
  findClip,
  formatTimecode,
  getAsset,
  getSequence,
  isMediaClip,
  sequenceDurationUs,
  snapTime,
  type Command,
  type Project,
  type Track,
} from "@just-see/schema";
import { currentProject, useEditor, useProject } from "@/lib/editor-store";
import { haptic } from "@/lib/theme";
import { useT } from "@/lib/i18n";
import { ClipBlock } from "./ClipBlock";

const ROW_H: Record<Track["type"], number> = { main: 60, video: 44, text: 34, audio: 40 };
const ROW_GAP = 6;
const RULER_H = 22;
const SNAP_PX = 10;

const TRACK_COLOR: Record<Track["type"], string> = {
  main: "var(--track-main)",
  video: "var(--track-video)",
  text: "var(--track-text)",
  audio: "var(--track-audio)",
};

interface Row {
  track: Track;
  top: number;
  height: number;
}

function layoutRows(project: Project): Row[] {
  const seq = getSequence(project);
  const visual = seq.tracks.filter((t) => t.type !== "audio").reverse();
  const audio = seq.tracks.filter((t) => t.type === "audio");
  let y = RULER_H + 4;
  return [...visual, ...audio].map((track) => {
    const r = { track, top: y, height: ROW_H[track.type] };
    y += r.height + ROW_GAP;
    return r;
  });
}

function tickStep(pps: number): number {
  const steps = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];
  return steps.find((s) => s * pps >= 64) ?? 600;
}

type Drag =
  | { kind: "pan"; startX: number; startY: number; startT: number; startScroll: number; lastX: number; lastT: number; vel: number; moved: boolean; tapClip?: string }
  | { kind: "trim"; clipId: string; edge: "start" | "end"; startX: number; origEdge: number; snapped: boolean; lastCmd?: Command }
  | {
      kind: "move";
      clipId: string;
      startX: number;
      startY: number;
      origStart: number;
      duration: number;
      trackId: string;
      moved: boolean;
      snapped: boolean;
      newTrackId: string;
      lastCmd?: Command;
    }
  | { kind: "pinch"; startDist: number; startPps: number; centerT: number };

export function Timeline({ onAddMedia }: { onAddMedia: () => void }) {
  const t = useT();
  const project = useProject();
  const pps = useEditor((s) => s.pxPerSecond);
  const selection = useEditor((s) => s.selection);
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const inertia = useRef(0);
  const [width, setWidth] = useState(360);
  const [scrollY, setScrollY] = useState(0);

  const rows = useMemo(() => (project ? layoutRows(project) : []), [project]);
  const contentH = rows.length ? rows[rows.length - 1]!.top + rows[rows.length - 1]!.height + 12 : 120;
  const duration = project ? sequenceDurationUs(getSequence(project)) : 0;

  useLayoutEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  // Move content with the playhead without re-rendering React.
  useEffect(() => {
    const apply = () => {
      const s = useEditor.getState();
      const el = contentRef.current;
      if (el) el.style.transform = `translate3d(${width / 2 - (s.playheadUs / 1e6) * s.pxPerSecond}px, ${-scrollY}px, 0)`;
    };
    apply();
    return useEditor.subscribe((s, prev) => {
      if (s.playheadUs !== prev.playheadUs || s.pxPerSecond !== prev.pxPerSecond) apply();
    });
  }, [width, scrollY]);

  const maxScrollY = Math.max(0, contentH - (viewportRef.current?.clientHeight ?? contentH));

  const timeAtClientX = useCallback(
    (clientX: number) => {
      const el = viewportRef.current;
      if (!el) return 0;
      const r = el.getBoundingClientRect();
      const s = useEditor.getState();
      return s.playheadUs + ((clientX - r.left - width / 2) / s.pxPerSecond) * 1e6;
    },
    [width],
  );

  const rowAtClientY = (clientY: number): Row | undefined => {
    const el = viewportRef.current;
    if (!el) return undefined;
    const y = clientY - el.getBoundingClientRect().top + scrollY;
    return rows.find((r) => y >= r.top - ROW_GAP / 2 && y < r.top + r.height + ROW_GAP / 2);
  };

  const stopInertia = () => {
    if (inertia.current) cancelAnimationFrame(inertia.current);
    inertia.current = 0;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    const s = useEditor.getState();
    const p = currentProject(s);
    if (!p) return;
    stopInertia();
    viewportRef.current?.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      // Pinch to zoom; abandon any edit in progress.
      s.preview(null);
      const [a, b] = [...pointers.current.values()] as [{ x: number; y: number }, { x: number; y: number }];
      dragRef.current = {
        kind: "pinch",
        startDist: Math.max(10, Math.abs(b.x - a.x)),
        startPps: s.pxPerSecond,
        centerT: s.playheadUs,
      };
      return;
    }
    if (pointers.current.size > 2) return;
    const target = (e.target as HTMLElement).closest<HTMLElement>("[data-role]");
    const role = target?.dataset.role;
    const clipId = target?.dataset.clipId;
    if (s.playing) s.setPlaying(false);

    if ((role === "handle-start" || role === "handle-end") && clipId) {
      const loc = findClip(p, clipId);
      if (!loc || loc.track.locked) return;
      dragRef.current = {
        kind: "trim",
        clipId,
        edge: role === "handle-start" ? "start" : "end",
        startX: e.clientX,
        origEdge: role === "handle-start" ? loc.clip.startUs : clipEndUs(loc.clip),
        snapped: false,
      };
      return;
    }
    if (role === "transition" && clipId) {
      s.select({ kind: "transition", clipId });
      s.openPanel("transition");
      dragRef.current = null;
      return;
    }
    if (role === "add") {
      dragRef.current = null;
      onAddMedia();
      return;
    }
    if (role === "clip" && clipId && s.selection?.kind === "clip" && s.selection.clipId === clipId) {
      const loc = findClip(p, clipId);
      if (loc && !loc.track.locked) {
        dragRef.current = {
          kind: "move",
          clipId,
          startX: e.clientX,
          startY: e.clientY,
          origStart: loc.clip.startUs,
          duration: loc.clip.durationUs,
          trackId: loc.track.id,
          moved: false,
          snapped: false,
          newTrackId: createId("t_"),
        };
        return;
      }
    }
    dragRef.current = {
      kind: "pan",
      startX: e.clientX,
      startY: e.clientY,
      startT: s.playheadUs,
      startScroll: scrollY,
      lastX: e.clientX,
      lastT: performance.now(),
      vel: 0,
      moved: false,
      tapClip: role === "clip" ? clipId : undefined,
    };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const d = dragRef.current;
    const s = useEditor.getState();
    const p = s.history?.project;
    if (!d || !p) return;
    const pps0 = s.pxPerSecond;
    if (d.kind === "pinch") {
      const pts = [...pointers.current.values()];
      if (pts.length < 2) return;
      const [a, b] = pts as [{ x: number; y: number }, { x: number; y: number }];
      s.setZoom(d.startPps * (Math.max(10, Math.abs(b.x - a.x)) / d.startDist));
      return;
    }
    if (d.kind === "pan") {
      const dx = e.clientX - d.startX;
      const dy = e.clientY - d.startY;
      if (!d.moved && Math.hypot(dx, dy) < 6) return;
      d.moved = true;
      if (Math.abs(dy) > Math.abs(dx) * 1.2 && maxScrollY > 0) {
        setScrollY(Math.min(maxScrollY, Math.max(0, d.startScroll - dy)));
        return;
      }
      const now = performance.now();
      const dt = Math.max(1, now - d.lastT);
      d.vel = 0.8 * d.vel + 0.2 * ((e.clientX - d.lastX) / dt);
      d.lastX = e.clientX;
      d.lastT = now;
      s.setPlayhead(d.startT - (dx / pps0) * 1e6);
      return;
    }
    const seq = getSequence(p);
    const thresholdUs = (SNAP_PX / pps0) * 1e6;
    if (d.kind === "trim") {
      const raw = d.origEdge + ((e.clientX - d.startX) / pps0) * 1e6;
      const snap = snapTime(raw, collectSnapPoints(seq, { excludeClipId: d.clipId, playheadUs: s.playheadUs }), thresholdUs);
      if (snap.snapped && !d.snapped) haptic();
      d.snapped = snap.snapped;
      const loc = findClip(p, d.clipId);
      if (!loc) return;
      let timeUs = Math.round(snap.timeUs);
      if (d.edge === "start" && loc.track.type === "main") {
        // Main track is magnetic: trimming the start eats into the clip, its start stays.
        timeUs = Math.round(loc.clip.startUs + (raw - d.origEdge));
      }
      d.lastCmd = { type: "clip/trim", payload: { clipId: d.clipId, edge: d.edge, timeUs } };
      s.preview(d.lastCmd);
      return;
    }
    if (d.kind === "move") {
      const dx = e.clientX - d.startX;
      const dy = e.clientY - d.startY;
      if (!d.moved && Math.hypot(dx, dy) < 6) return;
      d.moved = true;
      const loc = findClip(p, d.clipId);
      if (!loc) return;
      const row = rowAtClientY(e.clientY);
      let trackId = d.trackId;
      if (row && row.track.id !== d.trackId && !row.track.locked) {
        const kind = loc.clip.kind;
        const ok =
          (row.track.type === "text" && kind === "text") ||
          (row.track.type === "audio" && kind === "audio") ||
          ((row.track.type === "main" || row.track.type === "video") && (kind === "video" || kind === "image"));
        if (ok) trackId = row.track.id;
      }
      const target = seq.tracks.find((x) => x.id === trackId);
      let start = Math.max(0, d.origStart + (dx / pps0) * 1e6);
      if (target?.type === "main") {
        start = Math.max(0, timeAtClientX(e.clientX));
      } else {
        const points = collectSnapPoints(seq, { excludeClipId: d.clipId, playheadUs: s.playheadUs });
        const a = snapTime(start, points, thresholdUs);
        const b = snapTime(start + d.duration, points, thresholdUs);
        const snapped = a.snapped || b.snapped;
        if (a.snapped) start = a.timeUs;
        else if (b.snapped) start = b.timeUs - d.duration;
        if (snapped && !d.snapped) haptic();
        d.snapped = snapped;
      }
      const cmd: Command = {
        type: "clip/move",
        payload: { clipId: d.clipId, trackId, startUs: Math.max(0, Math.round(start)), newTrackId: d.newTrackId },
      };
      d.lastCmd = cmd;
      s.preview(cmd);
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    const d = dragRef.current;
    const s = useEditor.getState();
    if (!d) return;
    if (d.kind === "pinch") {
      if (pointers.current.size === 0) dragRef.current = null;
      return;
    }
    dragRef.current = null;
    if (d.kind === "pan") {
      if (!d.moved) {
        if (d.tapClip) s.select({ kind: "clip", clipId: d.tapClip });
        else s.select(null);
        return;
      }
      // Fling.
      let v = d.vel;
      const step = () => {
        v *= 0.92;
        if (Math.abs(v) < 0.02) {
          inertia.current = 0;
          return;
        }
        const st = useEditor.getState();
        st.setPlayhead(st.playheadUs - ((v * 16) / st.pxPerSecond) * 1e6);
        inertia.current = requestAnimationFrame(step);
      };
      if (Math.abs(v) > 0.1) inertia.current = requestAnimationFrame(step);
      return;
    }
    // Commit what the gesture showed as a single undoable command.
    if (d.lastCmd) s.dispatch(d.lastCmd);
    else s.preview(null);
  };

  const onWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    const s = useEditor.getState();
    if (e.ctrlKey || e.metaKey) {
      s.setZoom(s.pxPerSecond * Math.exp(-e.deltaY * 0.002));
      return;
    }
    if (s.playing) s.setPlaying(false);
    const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    s.setPlayhead(s.playheadUs + (delta / s.pxPerSecond) * 1e6);
  }, []);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [onWheel]);

  if (!project) return null;
  const seq = getSequence(project);
  const step = tickStep(pps);
  const totalSec = duration / 1e6 + width / pps;
  const ticks: number[] = [];
  for (let s = 0; s <= totalSec && ticks.length < 2000; s += step) ticks.push(s);
  const mainRow = rows.find((r) => r.track.type === "main");
  const mainClips = mainRow?.track.clips ?? [];
  const endX = (duration / 1e6) * pps;

  return (
    <div
      ref={viewportRef}
      className="relative h-full w-full select-none overflow-hidden bg-surface"
      style={{ touchAction: "none" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      data-testid="timeline"
      aria-label="Timeline"
    >
      <div ref={contentRef} className="absolute left-0 top-0 will-change-transform" style={{ height: contentH }}>
        {/* Ruler */}
        <div className="absolute left-0 top-0" style={{ height: RULER_H, width: totalSec * pps }}>
          {ticks.map((s) => (
            <div key={s} className="absolute top-0 text-[10px] text-muted" style={{ left: s * pps }}>
              <div className="h-1.5 w-px bg-line" />
              <span className="absolute left-1 top-1 whitespace-nowrap">{formatTimecode(s * 1e6, step < 1)}</span>
            </div>
          ))}
        </div>
        {rows.map((r) => (
          <div key={r.track.id} className="absolute left-0" style={{ top: r.top, height: r.height }} data-testid={`track-${r.track.type}`}>
            {r.track.clips.map((c) => (
              <ClipBlock
                key={c.id}
                clip={c}
                asset={isMediaClip(c) ? getAsset(project, c.assetId) : undefined}
                pps={pps}
                height={r.height}
                selected={selection?.kind === "clip" && selection.clipId === c.id}
                trackColor={TRACK_COLOR[r.track.type]}
              />
            ))}
            {r.track.type === "main" &&
              mainClips.map((c, i) => {
                if (i === 0 || !isMediaClip(c)) return null;
                const has = !!c.transitionIn;
                const x = (c.startUs / 1e6) * pps + (has ? ((c.transitionIn?.durationUs ?? 0) / 1e6) * pps * 0.5 : 0);
                const active = selection?.kind === "transition" && selection.clipId === c.id;
                return (
                  <button
                    key={`tr-${c.id}`}
                    type="button"
                    data-role="transition"
                    data-clip-id={c.id}
                    data-testid="transition-button"
                    aria-label={t("transition")}
                    className={`absolute z-10 flex h-7 w-7 -translate-x-1/2 items-center justify-center rounded-md border ${
                      has || active ? "border-accent bg-accent text-accent-contrast" : "border-line bg-surface-2 text-fg"
                    }`}
                    style={{ left: x, top: r.height / 2 - 14 }}
                  >
                    <Icon name="transition" size={16} />
                  </button>
                );
              })}
            {r.track.type === "main" && (
              <button
                type="button"
                data-role="add"
                aria-label={t("addMedia")}
                data-testid="timeline-add"
                className="absolute flex items-center justify-center rounded-md bg-fg text-bg"
                style={{ left: endX + 10, top: r.height / 2 - 18, width: 36, height: 36 }}
              >
                <Icon name="plus" size={22} />
              </button>
            )}
            {r.track.type === "main" && mainClips.length === 0 && (
              <div className="pointer-events-none absolute whitespace-nowrap text-sm text-muted" style={{ left: 58, top: r.height / 2 - 10 }}>
                {t("emptyTimeline")}
              </div>
            )}
          </div>
        ))}
      </div>
      {/* Playhead */}
      <div className="pointer-events-none absolute inset-y-0 z-20 w-0.5 bg-fg" style={{ left: width / 2 - 1 }}>
        <div className="absolute -left-[5px] top-0 h-3 w-3 rotate-45 rounded-sm bg-fg" />
      </div>
      <span className="sr-only" aria-live="polite">
        {seq.tracks.length} {t("tracks")}
      </span>
    </div>
  );
}
