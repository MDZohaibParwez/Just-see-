"use client";

import { useEffect, useRef, useState } from "react";
import { animatedTransform, measureTextBox, placedCorners, placementMatrix } from "@just-see/engine";
import { findClip, getAsset, getSequence, isMediaClip, isTextClip, type Clip, type Command, type Project, type Transform } from "@just-see/schema";
import { animatableCommand } from "@/lib/actions";
import { currentProject, useEditor, useProject } from "@/lib/editor-store";
import { PreviewPlayer } from "@/lib/playback";
import { useT } from "@/lib/i18n";

let measureCtx: CanvasRenderingContext2D | null = null;
function measurer(): CanvasRenderingContext2D | null {
  if (!measureCtx) measureCtx = document.createElement("canvas").getContext("2d");
  return measureCtx;
}

/** Corners of a clip on the canvas, in canvas pixels, at timeline time t. */
function clipCorners(project: Project, clip0: Clip, w: number, h: number, t = clip0.startUs): [number, number][] | null {
  const clip = { ...clip0, transform: animatedTransform(clip0.transform, clip0.keyframes, t - clip0.startUs) } as Clip;
  if (isTextClip(clip)) {
    const ctx = measurer();
    if (!ctx) return null;
    const b = measureTextBox(ctx, clip, w, h);
    const r = (clip.transform.rotation * Math.PI) / 180;
    const c = Math.cos(r);
    const s = Math.sin(r);
    return ([[-1, -1], [1, -1], [1, 1], [-1, 1]] as const).map(([dx, dy]) => {
      const x = (dx * b.w) / 2;
      const y = (dy * b.h) / 2;
      return [b.cx + x * c - y * s, b.cy + x * s + y * c] as [number, number];
    });
  }
  if (!isMediaClip(clip) || clip.kind === "audio") return null;
  const asset = getAsset(project, clip.assetId);
  if (!asset) return null;
  const c = clip.crop;
  return placedCorners(placementMatrix(clip.transform, asset.width * (1 - c.left - c.right), asset.height * (1 - c.top - c.bottom), w, h));
}

function pointInPoly(pts: [number, number][], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i]!;
    const [xj, yj] = pts[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

interface Gesture {
  clipId: string;
  start: Transform;
  pointers: Map<number, { x: number; y: number }>;
  startDist: number;
  startAngle: number;
  startCenter: { x: number; y: number };
  moved: boolean;
  last?: Command;
}

/** Keyframed properties get a keyframe at the playhead; others change directly. */
function gestureCommand(clipId: string, patch: Partial<Transform>): Command {
  const commands = Object.entries(patch)
    .map(([k, v]) => animatableCommand(clipId, k, v as number))
    .filter((c): c is Command => c !== null);
  return { type: "batch", payload: { label: "Move", commands } };
}

export function Preview() {
  const t = useT();
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const playerRef = useRef<PreviewPlayer | null>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [error, setError] = useState<string | null>(null);
  const project = useProject();
  const selection = useEditor((s) => s.selection);
  const seq = project ? getSequence(project) : null;
  const seqW = seq?.width ?? 1080;
  const seqH = seq?.height ?? 1920;

  // Create the player once.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let player: PreviewPlayer;
    try {
      player = new PreviewPlayer(canvas, {
        onTime: (us) => useEditor.getState().setPlayhead(us),
        onEnded: () => useEditor.getState().setPlaying(false),
      });
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    playerRef.current = player;
    (window as unknown as { __justSeePreview?: unknown }).__justSeePreview = {
      capture: async (us: number, w: number, h: number) => {
        const blob = await player.capture(us, w, h);
        const buf = new Uint8Array(await blob.arrayBuffer());
        let bin = "";
        for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
        return btoa(bin);
      },
    };
    const s = useEditor.getState();
    const p = currentProject(s);
    if (p) player.setProject(p);
    player.seek(s.playheadUs);
    const onFonts = () => {
      const st = useEditor.getState();
      if (!st.playing) player.seek(st.playheadUs);
    };
    window.addEventListener("justsee:fonts", onFonts);
    const onMedia = (e: Event) => player.refreshAsset((e as CustomEvent<string>).detail);
    window.addEventListener("justsee:media", onMedia);
    const unsub = useEditor.subscribe((st, prev) => {
      const np = currentProject(st);
      const pp = currentProject(prev);
      if (np && np !== pp) player.setProject(np);
      if (st.playing !== prev.playing) {
        if (st.playing) player.play();
        else {
          player.pause();
          player.seek(st.playheadUs);
        }
      } else if (!st.playing && st.playheadUs !== prev.playheadUs) {
        player.seek(st.playheadUs);
      }
    });
    return () => {
      window.removeEventListener("justsee:fonts", onFonts);
      window.removeEventListener("justsee:media", onMedia);
      unsub();
      player.destroy();
      playerRef.current = null;
    };
  }, []);

  // Fit the canvas into the available space, keeping the sequence aspect.
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const ro = new ResizeObserver(() => {
      const r = wrap.getBoundingClientRect();
      const k = Math.min(r.width / seqW, r.height / seqH);
      const w = Math.max(2, Math.floor(seqW * k));
      const h = Math.max(2, Math.floor(seqH * k));
      setBox({ w, h });
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      // Never render above the sequence size; cap preview cost on phones.
      const scale = Math.min(1, (w * dpr) / seqW, 1280 / Math.max(seqW, seqH));
      playerRef.current?.resize(seqW * scale, seqH * scale);
    });
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [seqW, seqH]);

  const toCanvas = (e: { clientX: number; clientY: number }) => {
    const c = canvasRef.current;
    if (!c) return { x: 0, y: 0 };
    const r = c.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * seqW, y: ((e.clientY - r.top) / r.height) * seqH };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    const s = useEditor.getState();
    const p = currentProject(s);
    if (!p) return;
    const pt = toCanvas(e);
    const g = gestureRef.current;
    if (g) {
      // Second finger: start pinch/rotate on the same clip.
      g.pointers.set(e.pointerId, pt);
      (e.target as Element).setPointerCapture?.(e.pointerId);
      const pts = [...g.pointers.values()];
      if (pts.length === 2) {
        const [a, b] = pts as [{ x: number; y: number }, { x: number; y: number }];
        const loc = findClip(p, g.clipId);
        if (loc) g.start = animatedTransform(loc.clip.transform, loc.clip.keyframes, s.playheadUs - loc.clip.startUs);
        g.startDist = Math.hypot(b.x - a.x, b.y - a.y);
        g.startAngle = Math.atan2(b.y - a.y, b.x - a.x);
        g.startCenter = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      }
      return;
    }
    // Hit-test from the top layer down.
    const seqNow = getSequence(p);
    let hit: Clip | undefined;
    for (let ti = seqNow.tracks.length - 1; ti >= 0 && !hit; ti--) {
      const track = seqNow.tracks[ti];
      if (!track || track.hidden || track.type === "audio") continue;
      for (const clip of track.clips) {
        if (clip.startUs > s.playheadUs || s.playheadUs >= clip.startUs + clip.durationUs) continue;
        const corners = clipCorners(p, clip, seqW, seqH, s.playheadUs);
        if (corners && pointInPoly(corners, pt.x, pt.y)) {
          hit = clip;
          break;
        }
      }
    }
    if (!hit) {
      if (s.selection) s.select(null);
      return;
    }
    if (s.playing) s.setPlaying(false);
    if (s.selection?.clipId !== hit.id) s.select({ kind: "clip", clipId: hit.id });
    (e.target as Element).setPointerCapture?.(e.pointerId);
    gestureRef.current = {
      clipId: hit.id,
      start: animatedTransform(hit.transform, hit.keyframes, s.playheadUs - hit.startUs),
      pointers: new Map([[e.pointerId, pt]]),
      startDist: 0,
      startAngle: 0,
      startCenter: pt,
      moved: false,
    };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const g = gestureRef.current;
    if (!g || !g.pointers.has(e.pointerId)) return;
    const pt = toCanvas(e);
    g.pointers.set(e.pointerId, pt);
    const pts = [...g.pointers.values()];
    let patch: Partial<Transform>;
    if (pts.length >= 2) {
      const [a, b] = pts as [{ x: number; y: number }, { x: number; y: number }];
      const dist = Math.hypot(b.x - a.x, b.y - a.y);
      const angle = Math.atan2(b.y - a.y, b.x - a.x);
      const center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      patch = {
        scale: Math.min(20, Math.max(0.05, g.start.scale * (dist / Math.max(1, g.startDist)))),
        rotation: Math.round(g.start.rotation + ((angle - g.startAngle) * 180) / Math.PI),
        x: g.start.x + (center.x - g.startCenter.x) / seqW,
        y: g.start.y + (center.y - g.startCenter.y) / seqH,
      };
    } else {
      const dx = (pt.x - g.startCenter.x) / seqW;
      const dy = (pt.y - g.startCenter.y) / seqH;
      if (!g.moved && Math.hypot(dx * seqW, dy * seqH) < 6) return;
      // Snap to centre lines.
      let x = g.start.x + dx;
      let y = g.start.y + dy;
      if (Math.abs(x) < 0.015) x = 0;
      if (Math.abs(y) < 0.015) y = 0;
      patch = { x, y };
    }
    g.moved = true;
    g.last = gestureCommand(g.clipId, patch);
    useEditor.getState().preview(g.last);
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const g = gestureRef.current;
    if (!g) return;
    g.pointers.delete(e.pointerId);
    if (g.pointers.size > 0) {
      // Continue as a one-finger drag from the remaining pointer.
      const rest = [...g.pointers.values()][0]!;
      const st = useEditor.getState();
      const loc = findClip(currentProject(st)!, g.clipId);
      if (loc) g.start = animatedTransform(loc.clip.transform, loc.clip.keyframes, st.playheadUs - loc.clip.startUs);
      g.startCenter = rest;
      return;
    }
    gestureRef.current = null;
    const s = useEditor.getState();
    if (g.moved && g.last) {
      s.dispatch(g.last);
    } else {
      s.preview(null);
    }
  };

  // Selection outline.
  let outline: [number, number][] | null = null;
  if (project && selection?.kind === "clip") {
    const loc = findClip(project, selection.clipId);
    const ph = useEditor.getState().playheadUs;
    if (loc && loc.clip.startUs <= ph && ph < loc.clip.startUs + loc.clip.durationUs) {
      outline = clipCorners(project, loc.clip, seqW, seqH, ph);
    }
  }
  const sx = box.w / seqW;
  const sy = box.h / seqH;

  return (
    <div ref={wrapRef} className="relative flex h-full w-full items-center justify-center overflow-hidden" data-testid="preview">
      {error ? (
        <p className="max-w-xs p-4 text-center text-sm text-muted">{t("unsupportedBrowser")}</p>
      ) : (
        <div className="relative" style={{ width: box.w, height: box.h }}>
          <canvas
            ref={canvasRef}
            className="block h-full w-full rounded-md bg-black shadow-lg"
            aria-label="Preview"
            data-testid="preview-canvas"
          />
          <div
            className="absolute inset-0"
            style={{ touchAction: "none" }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            title={t("layerHint")}
          >
            {outline && (
              <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" aria-hidden>
                <polygon
                  points={outline.map(([x, y]) => `${x * sx},${y * sy}`).join(" ")}
                  fill="none"
                  stroke="var(--accent)"
                  strokeWidth={2}
                />
                {outline.map(([x, y], i) => (
                  <circle key={i} cx={x * sx} cy={y * sy} r={5} fill="var(--accent)" />
                ))}
              </svg>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

