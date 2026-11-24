"use client";

import { useMotionUi } from "@/lib/ui-stores";
import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import {
  TEMPLATES,
  TEXT_PRESETS,
  applyAffine,
  applyTextPreset,
  evaluateLayer,
  frameLayers,
  newMotionLayer,
  renderMotion,
  sampleMotionKeyframes,
  shapeOutline,
  type Affine,
} from "@just-see/engine";
import { baseValue, createId, type MotionComp, type MotionKeyframe, type MotionLayer } from "@just-see/schema";
import { Icon } from "@just-see/ui";
import { useEditor } from "@/lib/editor-store";
import { useT } from "@/lib/i18n";
import {
  addCompToVideo,
  compImages,
  createBlank,
  createFromTemplate,
  downloadLottie,
  imageAssetFromFile,
  importLottieFile,
  previewComp,
  setLayer,
  setProp,
  updateComp,
} from "@/lib/motion";
import { Chip } from "./controls";

export { useMotionUi };

const NO_COMPS: MotionComp[] = [];
const S = 1e6;
type Tab = "layers" | "props" | "graph";

export function MotionScreen() {
  const openId = useMotionUi((s) => s.openId);
  const comps = useEditor((s) => (s.draft ?? s.history?.project)?.motionComps ?? NO_COMPS);
  if (!openId) return null;
  const comp = comps.find((c) => c.id === openId);
  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-bg" role="dialog" aria-label="Motion studio" data-testid="motion">
      {comp ? <CompEditor key={comp.id} comp={comp} /> : <MotionHome comps={comps} />}
    </div>
  );
}

function MotionHome({ comps }: { comps: MotionComp[] }) {
  const t = useT();
  const [logo, setLogo] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useEditor((s) => s.toast);
  const open = (c: MotionComp | null) => c && useMotionUi.getState().open(c.id);
  const make = async (id: string) => {
    setBusy(true);
    try {
      const isLogo = TEMPLATES.find((x) => x.id === id)?.category === "logo";
      open(await createFromTemplate(id, isLogo ? logo : null));
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-3">
        <button type="button" className="flex h-9 w-9 items-center justify-center rounded-full bg-surface-2" aria-label={t("studioBack")} onClick={() => useMotionUi.getState().open(null)} data-testid="motion-close">
          <Icon name="back" size={18} />
        </button>
        <h1 className="text-base font-semibold">{t("motion")}</h1>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <h2 className="mb-2 text-sm font-semibold">{t("motionTemplates")}</h2>
        <label className="mb-2 flex items-center gap-2 rounded-xl border border-dashed border-line px-3 py-2 text-xs">
          <Icon name="media" size={16} />
          <span className="flex-1">{logo ? logo.name : t("motionLogoPick")}</span>
          <input type="file" accept="image/*" hidden data-testid="motion-logo-input" onChange={(e) => setLogo(e.target.files?.[0] ?? null)} />
        </label>
        <div className="mb-4 grid grid-cols-2 gap-2">
          {TEMPLATES.map((tp) => (
            <button key={tp.id} type="button" disabled={busy} data-testid={`motion-template-${tp.id}`} className="rounded-xl border border-line bg-surface-2 p-3 text-left text-sm active:scale-95" onClick={() => void make(tp.id)}>
              {tp.label}
            </button>
          ))}
        </div>
        <div className="mb-4 flex gap-2">
          <button type="button" data-testid="motion-blank" className="flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-accent text-sm text-accent-contrast" onClick={() => open(createBlank())}>
            <Icon name="plus" size={16} />
            {t("motionBlank")}
          </button>
          <label className="flex h-11 flex-1 cursor-pointer items-center justify-center rounded-xl bg-surface-2 text-sm">
            {t("motionImportLottie")}
            <input type="file" accept=".json,application/json" hidden data-testid="motion-lottie-input" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void importLottieFile(f).then(open).catch((err: unknown) => toast(String(err), "error")); }} />
          </label>
        </div>
        {comps.length > 0 && (
          <>
            <h2 className="mb-2 text-sm font-semibold">{t("motionYours")}</h2>
            <ul className="flex flex-col gap-2">
              {comps.map((c) => (
                <li key={c.id}>
                  <button type="button" className="flex w-full items-center justify-between rounded-xl border border-line bg-surface-2 px-3 py-3 text-sm" onClick={() => open(c)}>
                    <span>{c.name}</span>
                    <span className="text-xs text-muted">{(c.durationUs / S).toFixed(1)}s · {c.layers.length} layers</span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
        <p className="mt-4 text-center text-[11px] text-muted">{t("motionOwn")}</p>
      </div>
    </>
  );
}

// ---------- Editor ----------

function toHexColor(c: string | null | undefined): string {
  if (!c) return "#000000";
  if (/^#[0-9a-f]{6}$/i.test(c)) return c;
  if (/^#[0-9a-f]{3}$/i.test(c)) return `#${Array.from(c.slice(1), (x) => x + x).join("")}`;
  const m = /rgba?\(([^)]+)\)/i.exec(c);
  if (m) return `#${m[1]!.split(",").slice(0, 3).map((x) => Math.round(parseFloat(x)).toString(16).padStart(2, "0")).join("")}`;
  return "#000000";
}

/** Local bounds of a layer (centred on 0,0). */
function localBounds(l: MotionLayer, ctx: CanvasRenderingContext2D | null): [number, number, number, number] {
  if (l.type === "shape" && l.shape) {
    const o = shapeOutline(l.shape);
    if (!o.pts.length) return [-10, -10, 10, 10];
    let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const [x, y] of o.pts) {
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
    const pad = l.shape.strokeWidth / 2;
    return [x0 - pad, y0 - pad, x1 + pad, y1 + pad];
  }
  if (l.type === "text" && l.text) {
    const lines = (l.text.caps ? l.text.text.toUpperCase() : l.text.text).split("\n");
    let w = l.text.fontSize * 4;
    if (ctx) {
      ctx.font = `${l.text.fontWeight} ${l.text.fontSize}px ${l.text.fontFamily}`;
      w = Math.max(...lines.map((s) => ctx.measureText(s).width + l.text!.letterSpacing * s.length));
    }
    const h = lines.length * l.text.fontSize * l.text.lineHeight;
    const x0 = l.text.align === "left" ? 0 : l.text.align === "right" ? -w : -w / 2;
    return [x0, -h / 2, x0 + w, h / 2];
  }
  if (l.type === "null") return [-20, -20, 20, 20];
  return [-l.width / 2, -l.height / 2, l.width / 2, l.height / 2];
}

function invert(m: Affine): Affine {
  const det = m[0] * m[3] - m[1] * m[2] || 1e-9;
  return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det, (m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det];
}

function CompEditor({ comp }: { comp: MotionComp }) {
  const t = useT();
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [selId, setSelId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("layers");
  const [graphProp, setGraphProp] = useState<string>("x");
  const [, force] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [cssW, setCssW] = useState(320);
  const toast = useEditor((s) => s.toast);
  const inVideo = useEditor((s) => (s.history?.project.sequences ?? []).some((q) => q.tracks.some((tr) => tr.clips.some((c) => c.kind === "text" && c.motionCompId === comp.id))));
  const sel = comp.layers.find((l) => l.id === selId) ?? null;

  // Fit the preview into the available space.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const maxW = el.clientWidth;
      const maxH = el.clientHeight;
      setCssW(Math.max(80, Math.min(maxW, (maxH * comp.width) / comp.height)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [comp.width, comp.height]);

  // Playback loop.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      setTime((x) => (x + (now - last) * 1000) % Math.max(1, comp.durationUs));
      last = now;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, comp.durationUs]);

  const dpr = typeof window !== "undefined" ? Math.min(2, window.devicePixelRatio || 1) : 1;
  const pxW = Math.round(cssW * dpr);
  const pxH = Math.round((cssW * comp.height * dpr) / comp.width);
  const scale = pxW / comp.width;

  // Draw.
  useEffect(() => {
    const c = canvasRef.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    if (c.width !== pxW) c.width = pxW;
    if (c.height !== pxH) c.height = pxH;
    const images = compImages(comp, () => force((n) => n + 1));
    renderMotion(ctx, comp, time, { scale, images });
    if (sel && !playing) {
      const fl = frameLayers(comp, time).find((x) => x.layer.id === sel.id);
      if (fl) {
        const [x0, y0, x1, y1] = localBounds(fl.layer, ctx);
        const corners = [applyAffine(fl.matrix, x0, y0), applyAffine(fl.matrix, x1, y0), applyAffine(fl.matrix, x1, y1), applyAffine(fl.matrix, x0, y1)];
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.strokeStyle = "#ff8a1f";
        ctx.lineWidth = 2 * dpr;
        ctx.setLineDash([6 * dpr, 4 * dpr]);
        ctx.beginPath();
        corners.forEach(([x, y], i) => (i ? ctx.lineTo(x * scale, y * scale) : ctx.moveTo(x * scale, y * scale)));
        ctx.closePath();
        ctx.stroke();
        ctx.restore();
      }
    }
  });

  // Tap to select, drag to move.
  const drag = useRef<{ id: string; startX: number; startY: number; x0: number; y0: number; inv: Affine; moved: boolean } | null>(null);
  const toComp = (e: RPointerEvent) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * comp.width, ((e.clientY - r.top) / r.height) * comp.height] as const;
  };
  const onDown = (e: RPointerEvent) => {
    const [px, py] = toComp(e);
    const ctx = canvasRef.current?.getContext("2d") ?? null;
    const layers = frameLayers(comp, time).reverse(); // top first
    const hit = layers.find(({ layer, matrix }) => {
      if (layer.hidden || layer.locked || layer.type === "null" || time < layer.inUs || time >= layer.outUs) return false;
      const [lx, ly] = applyAffine(invert(matrix), px, py);
      const [x0, y0, x1, y1] = localBounds(layer, ctx);
      return lx >= x0 && lx <= x1 && ly >= y0 && ly <= y1;
    });
    if (!hit) {
      setSelId(null);
      return;
    }
    setSelId(hit.layer.id);
    const parent = hit.layer.parentId ? frameLayers(comp, time).find((x) => x.layer.id === hit.layer.parentId)?.matrix : undefined;
    const inv = parent ? invert(parent) : ([1, 0, 0, 1, 0, 0] as Affine);
    drag.current = { id: hit.layer.id, startX: px, startY: py, x0: hit.layer.transform.x, y0: hit.layer.transform.y, inv, moved: false };
    (e.target as Element).setPointerCapture(e.pointerId);
  };
  const moveTo = (e: RPointerEvent, commit: boolean) => {
    const d = drag.current;
    if (!d) return;
    const [px, py] = toComp(e);
    const dx = px - d.startX;
    const dy = py - d.startY;
    if (!commit && Math.hypot(dx, dy) < 2 && !d.moved) return;
    d.moved = true;
    // Delta in parent space (linear part of the inverse parent matrix).
    const lx = d.inv[0] * dx + d.inv[2] * dy;
    const ly = d.inv[1] * dx + d.inv[3] * dy;
    setLayer(comp.id, d.id, (l) => {
      setProp(l, "x", Math.round(d.x0 + lx), time);
      setProp(l, "y", Math.round(d.y0 + ly), time);
    }, !commit);
  };
  const onUp = (e: RPointerEvent) => {
    if (drag.current?.moved) moveTo(e, true);
    drag.current = null;
  };

  const kfTimes = useMemo(() => {
    const ts = new Set<number>();
    for (const l of sel ? [sel] : comp.layers) for (const k of Object.values(l.keyframes)) for (const kf of k) ts.add(kf.t);
    return [...ts].sort((a, b) => a - b);
  }, [sel, comp.layers]);

  return (
    <>
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-2">
        <button type="button" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-2" aria-label={t("studioBack")} onClick={() => useMotionUi.getState().open("home")} data-testid="motion-back">
          <Icon name="back" size={18} />
        </button>
        <input className="min-w-0 flex-1 bg-transparent text-sm font-semibold outline-none" value={comp.name} aria-label={t("studioName")} onChange={(e) => updateComp(comp.id, (c) => void (c.name = e.target.value.slice(0, 200)))} />
        <button
          type="button"
          className="h-9 shrink-0 rounded-full bg-surface-2 px-3 text-xs"
          data-testid="motion-save-template"
          aria-label={t("saveMyTemplate")}
          onClick={() => void import("@/lib/library").then((m) => m.saveMyTemplate(comp)).then(() => toast(t("savedMyTemplate")))}
        >
          ★
        </button>
        <button type="button" className="h-9 shrink-0 rounded-full bg-surface-2 px-3 text-xs" onClick={() => downloadLottie(comp)} data-testid="motion-lottie-export">
          Lottie
        </button>
        <button
          type="button"
          data-testid="motion-add-to-video"
          className="h-9 shrink-0 rounded-full bg-accent px-3 text-xs text-accent-contrast"
          onClick={() => {
            if (addCompToVideo(comp.id)) {
              toast(t("motionAdded"));
              useMotionUi.getState().open(null);
            }
          }}
        >
          {inVideo ? `✓ ${t("motionAddAgain")}` : t("motionAddToVideo")}
        </button>
      </header>

      <div ref={wrapRef} className="flex min-h-[28vh] flex-1 items-center justify-center overflow-hidden bg-[repeating-conic-gradient(#2a2a2e_0%_25%,#1f1f22_0%_50%)] [background-size:20px_20px]">
        <canvas
          ref={canvasRef}
          data-testid="motion-canvas"
          style={{ width: cssW, height: (cssW * comp.height) / comp.width, touchAction: "none" }}
          onPointerDown={onDown}
          onPointerMove={(e) => moveTo(e, false)}
          onPointerUp={onUp}
          onPointerCancel={onUp}
        />
      </div>

      <div className="shrink-0 border-t border-line px-2 py-1">
        <div className="flex items-center gap-2">
          <button type="button" data-testid="motion-play" aria-label={playing ? t("studioStop") : t("play")} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-accent-contrast" onClick={() => setPlaying((p) => !p)}>
            <Icon name={playing ? "pause" : "play"} size={18} />
          </button>
          <div className="relative flex-1">
            <input type="range" data-testid="motion-time" min={0} max={comp.durationUs} step={S / comp.fps} value={time} onChange={(e) => { setPlaying(false); setTime(Number(e.target.value)); }} className="w-full" aria-label={t("motionTime")} />
            <div className="pointer-events-none absolute inset-x-0 -bottom-1 h-2">
              {kfTimes.map((k) => (
                <span key={k} className="absolute h-2 w-2 -translate-x-1 rotate-45 bg-accent" style={{ left: `${(k / comp.durationUs) * 100}%` }} />
              ))}
            </div>
          </div>
          <span className="w-12 text-right text-xs tabular-nums" data-testid="motion-time-label">{(time / S).toFixed(2)}s</span>
          <label className="flex items-center gap-1 text-xs">
            <input
              type="number"
              min={0.5}
              max={120}
              step={0.5}
              value={comp.durationUs / S}
              aria-label={t("motionDuration")}
              className="w-12 rounded-lg bg-surface-2 px-1 py-1"
              onChange={(e) => { const v = Number(e.target.value); if (v >= 0.5 && v <= 120) updateComp(comp.id, (c) => void (c.durationUs = Math.round(v * S))); }}
            />
            s
          </label>
        </div>
      </div>

      <div className="flex shrink-0 gap-2 px-2 py-1">
        {(["layers", "props", "graph"] as const).map((k) => (
          <Chip key={k} active={tab === k} onClick={() => setTab(k)} testId={`motion-tab-${k}`}>
            {t(k === "layers" ? "motionLayers" : k === "props" ? "motionProps" : "motionGraph")}
          </Chip>
        ))}
      </div>
      <div className="max-h-[38vh] min-h-[22vh] shrink-0 overflow-y-auto px-2 pb-4 text-xs">
        {tab === "layers" && <LayersTab comp={comp} selId={selId} onSelect={(id) => { setSelId(id); }} time={time} />}
        {tab === "props" && <PropsTab comp={comp} layer={sel} time={time} onGraph={(p) => { setGraphProp(p); setTab("graph"); }} />}
        {tab === "graph" && <GraphTab comp={comp} layer={sel} prop={graphProp} setProp={setGraphProp} time={time} setTime={setTime} />}
      </div>
    </>
  );
}

// ---------- Layers ----------

function LayersTab({ comp, selId, onSelect, time }: { comp: MotionComp; selId: string | null; onSelect: (id: string | null) => void; time: number }) {
  const t = useT();
  const add = (type: MotionLayer["type"], extra: Parameters<typeof newMotionLayer>[4] = {}) => {
    const l = newMotionLayer(createId, comp.width, comp.height, type, { inUs: 0, ...extra });
    updateComp(comp.id, (c) => void c.layers.unshift(l));
    onSelect(l.id);
  };
  const move = (id: string, d: -1 | 1) =>
    updateComp(comp.id, (c) => {
      const i = c.layers.findIndex((l) => l.id === id);
      const j = i + d;
      if (i < 0 || j < 0 || j >= c.layers.length) return;
      [c.layers[i], c.layers[j]] = [c.layers[j]!, c.layers[i]!];
    });
  void time;
  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-1">
        <button type="button" data-testid="motion-add-text" className="rounded-lg bg-surface-2 px-2 py-2" onClick={() => add("text")}>+ {t("text")}</button>
        <button type="button" data-testid="motion-add-rect" className="rounded-lg bg-surface-2 px-2 py-2" onClick={() => add("shape")}>+ ▭</button>
        <button type="button" data-testid="motion-add-ellipse" className="rounded-lg bg-surface-2 px-2 py-2" onClick={() => add("shape", { name: "Circle", shape: { kind: "ellipse", width: 300, height: 300, fill: "#34c759" } })}>+ ◯</button>
        <button type="button" className="rounded-lg bg-surface-2 px-2 py-2" onClick={() => add("shape", { name: "Star", shape: { kind: "star", width: 320, height: 320, fill: "#ffd60a" } })}>+ ★</button>
        <button type="button" className="rounded-lg bg-surface-2 px-2 py-2" onClick={() => add("shape", { name: "Line", shape: { kind: "path", closed: false, fill: null, stroke: "#ffffff", strokeWidth: 12, path: [{ x: -200, y: 0 }, { x: 200, y: 0 }] } })}>+ ╱</button>
        <button type="button" className="rounded-lg bg-surface-2 px-2 py-2" onClick={() => add("solid")}>+ {t("motionSolid")}</button>
        <button type="button" className="rounded-lg bg-surface-2 px-2 py-2" onClick={() => add("null", { name: "Null" })}>+ Null</button>
        <label className="cursor-pointer rounded-lg bg-surface-2 px-2 py-2">
          + {t("motionImage")}
          <input
            type="file"
            accept="image/*"
            hidden
            data-testid="motion-add-image"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (!f) return;
              void imageAssetFromFile(f).then((asset) => {
                const fit = Math.min((comp.width * 0.5) / asset.width, (comp.height * 0.5) / asset.height);
                const l = newMotionLayer(createId, comp.width, comp.height, "image", { name: asset.name.slice(0, 60), assetId: asset.id, width: asset.width * fit, height: asset.height * fit });
                const cur = useEditor.getState().history?.project.motionComps.find((c) => c.id === comp.id);
                if (!cur) return;
                const next = structuredClone(cur);
                next.layers.unshift(l);
                next.updatedAt = Date.now();
                useEditor.getState().dispatch({ type: "batch", payload: { label: "Add image", commands: [{ type: "asset/add", payload: { asset } }, { type: "motion/put", payload: { comp: next } }] } });
                onSelect(l.id);
              });
            }}
          />
        </label>
      </div>
      <ul className="flex flex-col gap-1">
        {comp.layers.map((l) => (
          <li key={l.id} className={`flex items-center gap-1 rounded-lg border px-2 py-1 ${l.id === selId ? "border-accent bg-accent/10" : "border-line bg-surface-2"}`}>
            <button type="button" className="flex-1 truncate text-left text-sm" data-testid={`motion-layer-${l.name}`} onClick={() => onSelect(l.id)}>
              {l.type === "text" ? "T" : l.type === "shape" ? "◆" : l.type === "image" ? "▣" : l.type === "null" ? "○" : "■"} {l.name}
              {l.parentId && <span className="text-muted"> ↳</span>}
            </button>
            <button type="button" className="h-7 w-7 rounded-md bg-surface-3" aria-label="Up" onClick={() => move(l.id, -1)}>↑</button>
            <button type="button" className="h-7 w-7 rounded-md bg-surface-3" aria-label="Down" onClick={() => move(l.id, 1)}>↓</button>
            <button type="button" className="h-7 w-7 rounded-md bg-surface-3" aria-label={l.hidden ? "Show" : "Hide"} onClick={() => setLayer(comp.id, l.id, (x) => void (x.hidden = !x.hidden))}>{l.hidden ? "◌" : "●"}</button>
            <button type="button" className="h-7 w-7 rounded-md bg-surface-3" aria-label={t("duplicate")} onClick={() => updateComp(comp.id, (c) => { const i = c.layers.findIndex((x) => x.id === l.id); const copy = { ...structuredClone(l), id: createId("ml_"), name: `${l.name} copy`.slice(0, 200) }; c.layers.splice(i, 0, copy); })}>⧉</button>
            <button type="button" className="h-7 w-7 rounded-md bg-surface-3" aria-label={t("delete")} onClick={() => { updateComp(comp.id, (c) => { c.layers = c.layers.filter((x) => x.id !== l.id).map((x) => (x.parentId === l.id ? { ...x, parentId: null } : x)); c.editable = c.editable.filter((e) => e.layerId !== l.id); }); if (selId === l.id) onSelect(null); }}>✕</button>
          </li>
        ))}
      </ul>
      {comp.layers.length === 0 && <p className="p-4 text-center text-muted">{t("motionEmpty")}</p>}
    </div>
  );
}

// ---------- Properties ----------

type Row = { prop: string; label: string; min: number; max: number; step: number };

function NumRow({ comp, layer, row, time, onGraph }: { comp: MotionComp; layer: MotionLayer; row: Row; time: number; onGraph: (p: string) => void }) {
  const kfs = layer.keyframes[row.prop];
  const animated = (kfs?.length ?? 0) > 0;
  const atKey = kfs?.some((k) => Math.abs(k.t - time) <= 1000) ?? false;
  const value = sampleMotionKeyframes(kfs, time, baseValue(layer, row.prop), layer.loop);
  const [local, setLocal] = useState(String(+value.toFixed(3)));
  useEffect(() => setLocal(String(+value.toFixed(3))), [value]);
  const commit = (v: number) => {
    if (!Number.isFinite(v)) return;
    setLayer(comp.id, layer.id, (l) => setProp(l, row.prop, v, time));
  };
  const toggleKey = () =>
    setLayer(comp.id, layer.id, (l) => {
      if (atKey) {
        const rest = (l.keyframes[row.prop] ?? []).filter((k) => Math.abs(k.t - time) > 1000);
        if (rest.length) l.keyframes[row.prop] = rest;
        else {
          delete l.keyframes[row.prop];
          // Keep the value the user saw.
          setProp(l, row.prop, value, time);
        }
      } else setProp(l, row.prop, value, time, true);
    });
  return (
    <div className="flex items-center gap-1 py-[2px]">
      <button type="button" data-testid={`kf-${row.prop}`} aria-pressed={atKey} aria-label={`Keyframe ${row.label}`} onClick={toggleKey} className={`h-6 w-6 shrink-0 text-sm ${atKey ? "text-accent" : animated ? "text-fg" : "text-muted"}`}>
        {atKey ? "◆" : "◇"}
      </button>
      <button type="button" className="w-20 shrink-0 truncate text-left text-muted" onClick={() => onGraph(row.prop)} title="Graph">
        {row.label}
      </button>
      <input
        type="range"
        min={row.min}
        max={row.max}
        step={row.step}
        value={Math.min(row.max, Math.max(row.min, Number(local) || 0))}
        onChange={(e) => setLocal(e.target.value)}
        onPointerUp={(e) => commit(Number((e.target as HTMLInputElement).value))}
        onKeyUp={(e) => commit(Number((e.target as HTMLInputElement).value))}
        className="min-w-0 flex-1"
      />
      <input
        type="number"
        data-testid={`prop-${row.prop}`}
        value={local}
        step={row.step}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={() => commit(Number(local))}
        onKeyDown={(e) => e.key === "Enter" && commit(Number(local))}
        className="w-16 rounded-md bg-surface-2 px-1 py-1 text-right tabular-nums"
      />
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-2 rounded-xl border border-line p-2">
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">{title}</div>
      {children}
    </div>
  );
}

function ColorRow({ label, value, onChange, testId, allowNone }: { label: string; value: string | null; onChange: (v: string | null) => void; testId?: string; allowNone?: boolean }) {
  return (
    <label className="flex items-center gap-2 py-[2px]">
      <span className="w-24 shrink-0 text-muted">{label}</span>
      <input type="color" data-testid={testId} value={toHexColor(value)} onChange={(e) => onChange(e.target.value)} className="h-7 w-12 rounded" />
      {allowNone && (
        <button type="button" className={`rounded-md px-2 py-1 ${value ? "bg-surface-2" : "bg-accent text-accent-contrast"}`} onClick={() => onChange(value ? null : "#ffffff")}>
          {value ? "None" : "Off"}
        </button>
      )}
    </label>
  );
}

const FONTS = ["system-ui, sans-serif", "Georgia, serif", "'Courier New', monospace", "Impact, sans-serif", "'Trebuchet MS', sans-serif", "'Noto Sans Devanagari', system-ui, sans-serif"];

function PropsTab({ comp, layer, time, onGraph }: { comp: MotionComp; layer: MotionLayer | null; time: number; onGraph: (p: string) => void }) {
  const t = useT();
  const set = (fn: (l: MotionLayer) => void) => layer && setLayer(comp.id, layer.id, fn);
  const W = Math.max(comp.width, comp.height) * 2;
  const num = (rows: Row[]) => rows.map((r) => layer && <NumRow key={r.prop} comp={comp} layer={layer} row={r} time={time} onGraph={onGraph} />);
  return (
    <div>
      {comp.editable.length > 0 && <QuickEdit comp={comp} />}
      {!layer && <p className="p-4 text-center text-muted">{t("motionPickLayer")}</p>}
      {layer && (
        <>
          <Section title={t("motionTransform")}>
            {num([
              { prop: "x", label: "X", min: -comp.width, max: comp.width * 2, step: 1 },
              { prop: "y", label: "Y", min: -comp.height, max: comp.height * 2, step: 1 },
              { prop: "scaleX", label: "Scale X", min: 0, max: 4, step: 0.01 },
              { prop: "scaleY", label: "Scale Y", min: 0, max: 4, step: 0.01 },
              { prop: "rotation", label: "Rotation", min: -360, max: 360, step: 1 },
              { prop: "opacity", label: "Opacity", min: 0, max: 1, step: 0.01 },
              { prop: "anchorX", label: "Anchor X", min: -W / 2, max: W / 2, step: 1 },
              { prop: "anchorY", label: "Anchor Y", min: -W / 2, max: W / 2, step: 1 },
            ])}
          </Section>
          {layer.type === "text" && layer.text && (
            <Section title={t("text")}>
              <textarea data-testid="motion-text-input" className="mb-1 w-full rounded-lg bg-surface-2 p-2 text-sm" rows={2} value={layer.text.text} onChange={(e) => set((l) => void (l.text!.text = e.target.value.slice(0, 2000)))} />
              <div className="mb-1 flex flex-wrap gap-1">
                <select value={layer.text.fontFamily} className="rounded-md bg-surface-2 px-1 py-1" onChange={(e) => set((l) => void (l.text!.fontFamily = e.target.value))}>
                  {FONTS.map((f) => <option key={f} value={f}>{f.split(",")[0]!.replace(/'/g, "")}</option>)}
                </select>
                <select value={layer.text.fontWeight} className="rounded-md bg-surface-2 px-1 py-1" onChange={(e) => set((l) => void (l.text!.fontWeight = Number(e.target.value)))}>
                  {[300, 400, 500, 700, 800, 900].map((w) => <option key={w} value={w}>{w}</option>)}
                </select>
                {(["left", "center", "right"] as const).map((a) => <Chip key={a} active={layer.text!.align === a} onClick={() => set((l) => void (l.text!.align = a))}>{a}</Chip>)}
                <Chip active={layer.text.caps} onClick={() => set((l) => void (l.text!.caps = !l.text!.caps))}>AA</Chip>
              </div>
              <ColorRow label={t("motionColor")} value={layer.text.color} onChange={(v) => set((l) => void (l.text!.color = v ?? "#ffffff"))} />
              <ColorRow label={t("motionStroke")} value={layer.text.stroke} allowNone onChange={(v) => set((l) => { l.text!.stroke = v; if (v && l.text!.strokeWidth === 0) l.text!.strokeWidth = 4; })} />
              {num([
                { prop: "text.fontSize", label: "Size", min: 8, max: 400, step: 1 },
                { prop: "text.letterSpacing", label: "Spacing", min: -20, max: 120, step: 1 },
              ])}
              <label className="flex items-center gap-2 py-1">
                <span className="w-24 shrink-0 text-muted">{t("motionAnimate")}</span>
                <select
                  data-testid="motion-text-preset"
                  value=""
                  className="flex-1 rounded-md bg-surface-2 px-1 py-1"
                  onChange={(e) => {
                    const pr = TEXT_PRESETS.find((p) => p.id === e.target.value);
                    if (e.target.value === "none") set((l) => { l.text!.animator = null; delete l.keyframes["anim.progress"]; });
                    else if (pr) set((l) => applyTextPreset(l, pr, time / S));
                  }}
                >
                  <option value="">{layer.text.animator ? t("motionChangeAnim") : t("motionPickAnim")}</option>
                  <option value="none">— None —</option>
                  {TEXT_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                </select>
              </label>
              {layer.text.animator && num([{ prop: "anim.progress", label: "Reveal", min: 0, max: 1, step: 0.01 }])}
            </Section>
          )}
          {layer.type === "shape" && layer.shape && (
            <Section title={t("motionShape")}>
              <div className="mb-1 flex flex-wrap gap-1">
                {(["rect", "ellipse", "star", "polygon", "path"] as const).map((k) => <Chip key={k} active={layer.shape!.kind === k} onClick={() => set((l) => void (l.shape!.kind = k))}>{k}</Chip>)}
              </div>
              <ColorRow label={t("motionFill")} value={layer.shape.fill} allowNone testId="motion-fill" onChange={(v) => set((l) => void (l.shape!.fill = v))} />
              <ColorRow label={t("motionGradient")} value={layer.shape.fill2} allowNone onChange={(v) => set((l) => void (l.shape!.fill2 = v))} />
              <ColorRow label={t("motionStroke")} value={layer.shape.stroke} allowNone onChange={(v) => set((l) => { l.shape!.stroke = v; if (v && l.shape!.strokeWidth === 0) l.shape!.strokeWidth = 8; })} />
              {num([
                { prop: "shape.width", label: "Width", min: 0, max: W, step: 1 },
                { prop: "shape.height", label: "Height", min: 0, max: W, step: 1 },
                { prop: "shape.roundness", label: "Round", min: 0, max: 500, step: 1 },
                { prop: "shape.strokeWidth", label: "Stroke", min: 0, max: 100, step: 0.5 },
                ...(layer.shape.kind === "star" || layer.shape.kind === "polygon" ? [{ prop: "shape.innerRatio", label: "Inner", min: 0.05, max: 1, step: 0.01 }] : []),
              ])}
              <div className="mt-1 text-[11px] text-muted">{t("motionTrim")}</div>
              {num([
                { prop: "shape.trimStart", label: "Start", min: 0, max: 1, step: 0.01 },
                { prop: "shape.trimEnd", label: "End", min: 0, max: 1, step: 0.01 },
                { prop: "shape.trimOffset", label: "Offset", min: -1, max: 1, step: 0.01 },
              ])}
              <div className="mt-1 text-[11px] text-muted">{t("motionRepeater")}</div>
              {num([
                { prop: "shape.copies", label: "Copies", min: 1, max: 60, step: 1 },
                { prop: "shape.copyX", label: "Offset X", min: -500, max: 500, step: 1 },
                { prop: "shape.copyY", label: "Offset Y", min: -500, max: 500, step: 1 },
                { prop: "shape.copyRotation", label: "Rotate", min: -180, max: 180, step: 1 },
              ])}
            </Section>
          )}
          {(layer.type === "solid" || layer.type === "image") && (
            <Section title={t("motionSize")}>
              {layer.type === "solid" && <ColorRow label={t("motionColor")} value={layer.color} onChange={(v) => set((l) => void (l.color = v ?? "#ffffff"))} />}
              {num([
                { prop: "width", label: "Width", min: 0, max: W, step: 1 },
                { prop: "height", label: "Height", min: 0, max: W, step: 1 },
              ])}
            </Section>
          )}
          <Section title={t("motionEffects")}>
            {(["glow", "blur", "shadow"] as const).map((type) => {
              const fx = layer.effects.find((e) => e.type === type);
              return (
                <div key={type}>
                  <label className="flex items-center gap-2 py-1">
                    <input
                      type="checkbox"
                      data-testid={`motion-fx-${type}`}
                      checked={!!fx?.enabled}
                      onChange={(e) =>
                        set((l) => {
                          const f = l.effects.find((x) => x.type === type);
                          if (f) f.enabled = e.target.checked;
                          else l.effects.push({ id: createId("fx_"), type, enabled: true, params: { amount: type === "glow" ? 24 : type === "blur" ? 8 : 16, intensity: 1, opacity: 0.5, dy: 6 } });
                        })
                      }
                    />
                    <span className="capitalize">{type}</span>
                  </label>
                  {fx?.enabled && type !== "shadow" && num([{ prop: `fx.${type}`, label: "Amount", min: 0, max: 120, step: 1 }])}
                </div>
              );
            })}
          </Section>
          <Section title={t("motionLayer")}>
            <label className="flex items-center gap-2 py-[2px]">
              <span className="w-24 shrink-0 text-muted">{t("studioName")}</span>
              <input className="flex-1 rounded-md bg-surface-2 px-2 py-1" value={layer.name} onChange={(e) => set((l) => void (l.name = e.target.value.slice(0, 200)))} />
            </label>
            <label className="flex items-center gap-2 py-[2px]">
              <span className="w-24 shrink-0 text-muted">{t("motionParent")}</span>
              <select data-testid="motion-parent" value={layer.parentId ?? ""} className="flex-1 rounded-md bg-surface-2 px-1 py-1" onChange={(e) => set((l) => void (l.parentId = e.target.value || null))}>
                <option value="">—</option>
                {comp.layers.filter((x) => x.id !== layer.id && x.parentId !== layer.id).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
            </label>
            <label className="flex items-center gap-2 py-[2px]">
              <span className="w-24 shrink-0 text-muted">{t("motionBlend")}</span>
              <select value={layer.blendMode} className="flex-1 rounded-md bg-surface-2 px-1 py-1" onChange={(e) => set((l) => void (l.blendMode = e.target.value as MotionLayer["blendMode"]))}>
                {["normal", "multiply", "screen", "overlay", "lighten", "darken", "color-dodge", "add"].map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
            </label>
            <label className="flex items-center gap-2 py-[2px]">
              <span className="w-24 shrink-0 text-muted">{t("motionMatte")}</span>
              <select value={layer.matte} className="flex-1 rounded-md bg-surface-2 px-1 py-1" onChange={(e) => set((l) => void (l.matte = e.target.value as MotionLayer["matte"]))}>
                {["none", "alpha", "alpha-inverted", "luma"].map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
            </label>
            <div className="flex items-center gap-2 py-[2px]">
              <span className="w-24 shrink-0 text-muted">{t("motionInOut")}</span>
              <input type="number" step={0.1} min={0} className="w-16 rounded-md bg-surface-2 px-1 py-1" value={+(layer.inUs / S).toFixed(2)} onChange={(e) => set((l) => void (l.inUs = Math.max(0, Math.round(Number(e.target.value) * S))))} />
              <input type="number" step={0.1} min={0} className="w-16 rounded-md bg-surface-2 px-1 py-1" value={+(Math.min(layer.outUs, comp.durationUs) / S).toFixed(2)} onChange={(e) => set((l) => void (l.outUs = Math.max(l.inUs + 1000, Math.round(Number(e.target.value) * S))))} />
            </div>
            <label className="flex items-center gap-2 py-1">
              <input type="checkbox" checked={layer.loop} onChange={(e) => set((l) => void (l.loop = e.target.checked))} />
              {t("motionLoop")}
            </label>
            <label className="flex items-center gap-2 py-1">
              <input
                type="checkbox"
                data-testid="motion-wiggle"
                checked={layer.wiggles.some((w) => w.prop === "x")}
                onChange={(e) => set((l) => { l.wiggles = e.target.checked ? [...l.wiggles.filter((w) => w.prop !== "x" && w.prop !== "y"), { prop: "x", freq: 2, amp: 20, seed: 1 }, { prop: "y", freq: 2, amp: 20, seed: 2 }] : l.wiggles.filter((w) => w.prop !== "x" && w.prop !== "y"); })}
              />
              {t("motionWiggle")}
            </label>
          </Section>
        </>
      )}
    </div>
  );
}

function QuickEdit({ comp }: { comp: MotionComp }) {
  const t = useT();
  return (
    <Section title={t("motionQuickEdit")}>
      {comp.editable.map((f) => {
        const l = comp.layers.find((x) => x.id === f.layerId);
        if (!l) return null;
        const set = (fn: (x: MotionLayer) => void) => setLayer(comp.id, l.id, fn);
        if (f.field === "text" && l.text)
          return (
            <label key={f.layerId + f.field} className="flex items-center gap-2 py-[2px]">
              <span className="w-24 shrink-0 text-muted">{f.label}</span>
              <input data-testid={`quick-${f.label}`} className="flex-1 rounded-md bg-surface-2 px-2 py-2 text-sm" value={l.text.text} onChange={(e) => set((x) => void (x.text!.text = e.target.value.slice(0, 2000)))} />
            </label>
          );
        if (f.field === "image")
          return (
            <label key={f.layerId + f.field} className="flex items-center gap-2 py-[2px]">
              <span className="w-24 shrink-0 text-muted">{f.label}</span>
              <input
                type="file"
                accept="image/*"
                data-testid={`quick-${f.label}`}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  void imageAssetFromFile(file).then((asset) => {
                    const cur = useEditor.getState().history?.project.motionComps.find((c) => c.id === comp.id);
                    if (!cur) return;
                    const next = structuredClone(cur);
                    const target = next.layers.find((x) => x.id === l.id);
                    if (target) {
                      target.assetId = asset.id;
                      const aspect = asset.width / Math.max(1, asset.height);
                      const size = Math.max(target.width, target.height);
                      target.width = aspect >= 1 ? size : size * aspect;
                      target.height = aspect >= 1 ? size / aspect : size;
                    }
                    next.updatedAt = Date.now();
                    useEditor.getState().dispatch({ type: "batch", payload: { label: "Replace image", commands: [{ type: "asset/add", payload: { asset } }, { type: "motion/put", payload: { comp: next } }] } });
                  });
                }}
              />
            </label>
          );
        const value = f.field === "fill" ? l.shape?.fill ?? l.color : f.field === "color" ? (l.shape?.stroke ?? l.text?.color ?? l.color) : l.color;
        return (
          <ColorRow
            key={f.layerId + f.field}
            label={f.label}
            value={value}
            testId={`quick-${f.label}`}
            onChange={(v) =>
              set((x) => {
                if (!v) return;
                if (x.shape) {
                  if (f.field === "fill" || !x.shape.stroke) x.shape.fill = v;
                  else x.shape.stroke = v;
                } else if (x.text) x.text.color = v;
                else x.color = v;
              })
            }
          />
        );
      })}
    </Section>
  );
}

// ---------- Graph editor ----------

const EASES: { id: string; label: string; ease: MotionKeyframe["ease"]; bezier?: MotionKeyframe["bezier"] }[] = [
  { id: "linear", label: "Linear", ease: "linear" },
  { id: "ease-in-out", label: "Ease", ease: "ease-in-out" },
  { id: "ease-in", label: "In", ease: "ease-in" },
  { id: "ease-out", label: "Out", ease: "ease-out" },
  { id: "hold", label: "Hold", ease: "hold" },
  { id: "back", label: "Overshoot", ease: "bezier", bezier: [0.34, 1.56, 0.64, 1] },
  { id: "snap", label: "Snap", ease: "bezier", bezier: [0.16, 1, 0.3, 1] },
  { id: "anticipate", label: "Anticipate", ease: "bezier", bezier: [0.36, -0.4, 0.6, 1] },
];

function GraphTab({ comp, layer, prop, setProp: pickProp, time, setTime }: { comp: MotionComp; layer: MotionLayer | null; prop: string; setProp: (p: string) => void; time: number; setTime: (t: number) => void }) {
  const t = useT();
  const [kIdx, setKIdx] = useState(0);
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<{ i: number } | null>(null);
  const handleRef = useRef<0 | 1 | null>(null);
  if (!layer) return <p className="p-4 text-center text-muted">{t("motionPickLayer")}</p>;
  const animatedProps = Object.keys(layer.keyframes).filter((k) => (layer.keyframes[k]?.length ?? 0) > 0);
  const kfs = layer.keyframes[prop] ?? [];
  const GW = 320;
  const GH = 140;
  const dur = comp.durationUs;
  const samples = Array.from({ length: 161 }, (_, i) => (i / 160) * dur);
  const values = samples.map((s) => sampleMotionKeyframes(kfs, s, baseValue(layer, prop), layer.loop));
  let lo = Math.min(...values, ...kfs.map((k) => k.v));
  let hi = Math.max(...values, ...kfs.map((k) => k.v));
  if (hi - lo < 1e-6) {
    lo -= 1;
    hi += 1;
  }
  const pad = (hi - lo) * 0.12;
  lo -= pad;
  hi += pad;
  const X = (us: number) => (us / dur) * GW;
  const Y = (v: number) => GH - ((v - lo) / (hi - lo)) * GH;
  const sel = kfs[Math.min(kIdx, kfs.length - 1)];
  const setKfs = (fn: (k: MotionKeyframe[]) => void, preview = false) =>
    setLayer(comp.id, layer.id, (l) => {
      const arr = structuredClone(l.keyframes[prop] ?? []);
      fn(arr);
      arr.sort((a, b) => a.t - b.t);
      l.keyframes[prop] = arr;
    }, preview);
  const svgPoint = (e: RPointerEvent) => {
    const r = svgRef.current!.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * GW, ((e.clientY - r.top) / r.height) * GH] as const;
  };
  const onMove = (e: RPointerEvent, commit: boolean) => {
    const d = dragRef.current;
    if (!d) return;
    const [x, y] = svgPoint(e);
    const tt = Math.round(Math.min(dur, Math.max(0, (x / GW) * dur)) / (S / comp.fps)) * (S / comp.fps);
    const v = lo + ((GH - y) / GH) * (hi - lo);
    setKfs((arr) => {
      const k = arr[d.i];
      if (k) {
        k.t = Math.round(tt);
        k.v = +v.toFixed(3);
      }
    }, !commit);
  };
  return (
    <div>
      <div className="mb-1 flex flex-wrap gap-1">
        {[...new Set([...animatedProps, "x", "y", "scaleX", "rotation", "opacity"])].map((p) => (
          <Chip key={p} active={p === prop} onClick={() => { pickProp(p); setKIdx(0); }} testId={`graph-prop-${p}`}>
            {p}
          </Chip>
        ))}
      </div>
      {kfs.length < 2 ? (
        <p className="p-3 text-center text-muted">{t("motionGraphHint")}</p>
      ) : (
        <>
          <svg ref={svgRef} viewBox={`0 0 ${GW} ${GH}`} className="w-full touch-none rounded-lg bg-surface-2" data-testid="graph" onPointerMove={(e) => onMove(e, false)} onPointerUp={(e) => { if (dragRef.current) onMove(e, true); dragRef.current = null; }}>
            <line x1={X(time)} x2={X(time)} y1={0} y2={GH} stroke="currentColor" strokeOpacity={0.3} />
            <polyline fill="none" stroke="#ff8a1f" strokeWidth={2} points={samples.map((s, i) => `${X(s).toFixed(1)},${Y(values[i]!).toFixed(1)}`).join(" ")} />
            {kfs.map((k, i) => (
              <circle
                key={i}
                cx={X(k.t)}
                cy={Y(k.v)}
                r={i === kIdx ? 7 : 5}
                fill={i === kIdx ? "#ff8a1f" : "#ffffff"}
                data-testid={`graph-kf-${i}`}
                onPointerDown={(e) => { setKIdx(i); setTime(k.t); dragRef.current = { i }; (e.target as Element).setPointerCapture(e.pointerId); }}
              />
            ))}
          </svg>
          {sel && kIdx < kfs.length - 1 && (
            <div className="mt-2">
              <div className="mb-1 text-muted">
                {t("motionEaseFrom")} {(sel.t / S).toFixed(2)}s
              </div>
              <div className="mb-2 flex flex-wrap gap-1">
                {EASES.map((e) => (
                  <Chip
                    key={e.id}
                    testId={`ease-${e.id}`}
                    active={sel.ease === e.ease && (e.ease !== "bezier" || JSON.stringify(sel.bezier) === JSON.stringify(e.bezier))}
                    onClick={() => setKfs((arr) => { const k = arr[kIdx]; if (k) { k.ease = e.ease; if (e.bezier) k.bezier = e.bezier; else delete k.bezier; } })}
                  >
                    {e.label}
                  </Chip>
                ))}
              </div>
              <BezierEditor
                value={sel.ease === "bezier" && sel.bezier ? sel.bezier : sel.ease === "ease-in" ? [0.42, 0, 1, 1] : sel.ease === "ease-out" ? [0, 0, 0.58, 1] : sel.ease === "linear" ? [0, 0, 1, 1] : [0.42, 0, 0.58, 1]}
                handleRef={handleRef}
                onChange={(b, commit) => setKfs((arr) => { const k = arr[kIdx]; if (k) { k.ease = "bezier"; k.bezier = b; } }, !commit)}
              />
            </div>
          )}
          {sel && (
            <button type="button" className="mt-2 rounded-md bg-surface-2 px-2 py-1" onClick={() => { setKfs((arr) => void arr.splice(kIdx, 1)); setKIdx(0); }}>
              {t("motionDeleteKey")}
            </button>
          )}
        </>
      )}
    </div>
  );
}

function BezierEditor({ value, onChange, handleRef }: { value: [number, number, number, number]; onChange: (b: [number, number, number, number], commit: boolean) => void; handleRef: React.MutableRefObject<0 | 1 | null> }) {
  const ref = useRef<SVGSVGElement>(null);
  const B = 120;
  const yMin = -0.5;
  const yMax = 1.5;
  const px = (x: number) => x * B;
  const py = (y: number) => B * 1.5 - ((y - yMin) / (yMax - yMin)) * B * 1.5;
  const [x1, y1, x2, y2] = value;
  const at = (e: RPointerEvent): [number, number] => {
    const r = ref.current!.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const y = yMax - ((e.clientY - r.top) / r.height) * (yMax - yMin);
    return [+x.toFixed(3), +Math.min(2.5, Math.max(-1.5, y)).toFixed(3)];
  };
  const move = (e: RPointerEvent, commit: boolean) => {
    const h = handleRef.current;
    if (h === null) return;
    const [x, y] = at(e);
    onChange(h === 0 ? [x, y, x2, y2] : [x1, y1, x, y], commit);
  };
  return (
    <svg ref={ref} viewBox={`0 0 ${B} ${B * 1.5}`} className="h-44 w-32 touch-none rounded-lg bg-surface-2" data-testid="bezier" onPointerMove={(e) => move(e, false)} onPointerUp={(e) => { move(e, true); handleRef.current = null; }}>
      <rect x={0} y={py(1)} width={B} height={py(0) - py(1)} fill="none" stroke="currentColor" strokeOpacity={0.2} />
      <path d={`M ${px(0)} ${py(0)} C ${px(x1)} ${py(y1)}, ${px(x2)} ${py(y2)}, ${px(1)} ${py(1)}`} fill="none" stroke="#ff8a1f" strokeWidth={2} />
      <line x1={px(0)} y1={py(0)} x2={px(x1)} y2={py(y1)} stroke="currentColor" strokeOpacity={0.5} />
      <line x1={px(1)} y1={py(1)} x2={px(x2)} y2={py(y2)} stroke="currentColor" strokeOpacity={0.5} />
      <circle cx={px(x1)} cy={py(y1)} r={6} fill="#0a84ff" onPointerDown={(e) => { handleRef.current = 0; (e.target as Element).setPointerCapture(e.pointerId); }} />
      <circle cx={px(x2)} cy={py(y2)} r={6} fill="#0a84ff" onPointerDown={(e) => { handleRef.current = 1; (e.target as Element).setPointerCapture(e.pointerId); }} />
    </svg>
  );
}
