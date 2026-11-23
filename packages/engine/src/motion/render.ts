/**
 * Canvas 2D renderer for motion compositions. Works with a normal canvas or
 * an OffscreenCanvas, so the same code draws the editor preview, the video
 * timeline preview and the export.
 */
import type { MotionComp, MotionLayer, MotionText } from "@just-see/schema";
import {
  frameLayers,
  isActive,
  randomOrder,
  revealAmount,
  shapeOutline,
  textUnits,
  trimPolyline,
  type Affine,
  type Polyline,
} from "./eval";

export type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;

export interface MotionRenderOptions {
  /** Images for image layers, by asset id. */
  images?: ReadonlyMap<string, CanvasImageSource>;
  /** Output pixels per composition pixel. */
  scale?: number;
  /** Factory for scratch canvases (effects and mattes). */
  createCanvas?: (w: number, h: number) => AnyCanvas;
}

function defaultCanvas(w: number, h: number): AnyCanvas {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(w, h);
  return Object.assign(document.createElement("canvas"), { width: w, height: h });
}

const BLEND: Record<MotionLayer["blendMode"], GlobalCompositeOperation> = {
  normal: "source-over",
  multiply: "multiply",
  screen: "screen",
  overlay: "overlay",
  lighten: "lighten",
  darken: "darken",
  "color-dodge": "color-dodge",
  add: "lighter",
};

function tracePolyline(ctx: Ctx2D, p: Polyline): void {
  const [first, ...rest] = p.pts;
  if (!first) return;
  ctx.moveTo(first[0], first[1]);
  for (const q of rest) ctx.lineTo(q[0], q[1]);
  if (p.closed) ctx.closePath();
}

function drawShape(ctx: Ctx2D, l: MotionLayer): void {
  const s = l.shape;
  if (!s) return;
  const outline = shapeOutline(s);
  const parts = trimPolyline(outline, s.trimStart, s.trimEnd, s.trimOffset);
  const trimmed = !(s.trimStart <= 0 && s.trimEnd >= 1 && s.trimOffset === 0);
  for (let c = 0; c < s.copies; c++) {
    ctx.save();
    if (c > 0) {
      ctx.translate(s.copyX * c, s.copyY * c);
      ctx.rotate(((s.copyRotation * c) * Math.PI) / 180);
      const sc = Math.pow(s.copyScale, c);
      ctx.scale(sc, sc);
    }
    if (s.copies > 1) ctx.globalAlpha *= 1 + (s.copyOpacityEnd - 1) * (c / (s.copies - 1));
    if (s.fill && parts.length) {
      ctx.beginPath();
      for (const p of trimmed ? parts : [outline]) tracePolyline(ctx, p);
      if (s.fill2) {
        const g = ctx.createLinearGradient(-s.width / 2, 0, s.width / 2, 0);
        g.addColorStop(0, s.fill);
        g.addColorStop(1, s.fill2);
        ctx.fillStyle = g;
      } else ctx.fillStyle = s.fill;
      ctx.fill();
    }
    if (s.stroke && s.strokeWidth > 0) {
      ctx.beginPath();
      for (const p of parts) tracePolyline(ctx, p);
      ctx.strokeStyle = s.stroke;
      ctx.lineWidth = s.strokeWidth;
      ctx.lineCap = s.lineCap;
      ctx.lineJoin = "round";
      ctx.stroke();
    }
    ctx.restore();
  }
}

function fontOf(t: MotionText): string {
  return `${t.italic ? "italic " : ""}${t.fontWeight} ${t.fontSize}px ${t.fontFamily}`;
}

/** Draw text centred on 0,0 with the optional per-unit animator. */
function drawMotionText(ctx: Ctx2D, l: MotionLayer): void {
  const t = l.text;
  if (!t) return;
  const content = t.caps ? t.text.toUpperCase() : t.text;
  ctx.font = fontOf(t);
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  const lines = content.split("\n");
  const lh = t.fontSize * t.lineHeight;
  const anim = t.animator;
  // Lay out every unit with its own x position.
  type Unit = { text: string; x: number; y: number; w: number; line: number };
  const units: Unit[] = [];
  lines.forEach((line, li) => {
    const pieces = anim ? (anim.by === "line" ? [line] : textUnits(line, anim.by)) : [line];
    const widths = pieces.map((p) => ctx.measureText(p).width + t.letterSpacing * Array.from(p).length);
    const total = widths.reduce((a, b) => a + b, 0);
    let x = t.align === "left" ? 0 : t.align === "right" ? -total : -total / 2;
    const y = (li - (lines.length - 1) / 2) * lh;
    pieces.forEach((p, k) => {
      units.push({ text: p, x, y, w: widths[k]!, line: li });
      x += widths[k]!;
    });
  });
  // Fit to the box: scale everything down when the widest line is too wide.
  if (t.maxWidth) {
    let widest = 0;
    for (let li = 0; li < lines.length; li++) {
      const lu = units.filter((u) => u.line === li);
      if (lu.length) widest = Math.max(widest, lu[lu.length - 1]!.x + lu[lu.length - 1]!.w - lu[0]!.x);
    }
    if (widest > t.maxWidth) {
      const k = t.maxWidth / widest;
      ctx.scale(k, k);
    }
  }
  const visible = units.filter((u) => u.text.trim().length > 0);
  const order = anim?.random ? randomOrder(visible.length) : undefined;
  const drawUnit = (u: Unit) => {
    if (t.stroke && t.strokeWidth > 0) {
      ctx.lineWidth = t.strokeWidth;
      ctx.strokeStyle = t.stroke;
      ctx.lineJoin = "round";
      ctx.strokeText(u.text, 0, 0);
    }
    ctx.fillStyle = t.color;
    ctx.fillText(u.text, 0, 0);
  };
  const drawPlain = (u: Unit) => {
    // Letter spacing without an animator: draw char by char.
    if (t.letterSpacing !== 0 && (!anim || anim.by !== "char")) {
      let x = u.x;
      for (const ch of Array.from(u.text)) {
        ctx.save();
        ctx.translate(x, u.y);
        drawUnit({ ...u, text: ch });
        ctx.restore();
        x += ctx.measureText(ch).width + t.letterSpacing;
      }
      return;
    }
    ctx.save();
    ctx.translate(u.x, u.y);
    drawUnit(u);
    ctx.restore();
  };
  if (!anim) {
    for (const u of units) drawPlain(u);
    return;
  }
  const baseAlpha = ctx.globalAlpha;
  visible.forEach((u, i) => {
    const a = revealAmount(i, visible.length, anim.progress, anim.smoothness, order);
    if (a >= 1 && anim.blur === 0) {
      drawPlain(u);
      return;
    }
    const k = 1 - a;
    const op = 1 + (anim.opacity - 1) * k;
    if (op <= 0.001) return;
    ctx.save();
    ctx.globalAlpha = baseAlpha * op;
    const cx = u.x + u.w / 2;
    ctx.translate(cx + anim.offsetX * k, u.y + anim.offsetY * k);
    ctx.rotate((anim.rotation * k * Math.PI) / 180);
    const sc = 1 + (anim.scale - 1) * k;
    ctx.scale(sc, sc);
    if (anim.blur > 0 && k > 0 && "filter" in ctx) ctx.filter = `blur(${(anim.blur * k).toFixed(2)}px)`;
    ctx.translate(-u.w / 2, 0);
    drawUnit(u);
    ctx.restore();
  });
}

function drawContent(ctx: Ctx2D, l: MotionLayer, opts: MotionRenderOptions): void {
  switch (l.type) {
    case "solid":
      ctx.fillStyle = l.color;
      ctx.fillRect(-l.width / 2, -l.height / 2, l.width, l.height);
      return;
    case "shape":
      drawShape(ctx, l);
      return;
    case "text":
      drawMotionText(ctx, l);
      return;
    case "image": {
      const img = l.assetId ? opts.images?.get(l.assetId) : undefined;
      if (img) ctx.drawImage(img, -l.width / 2, -l.height / 2, l.width, l.height);
      else {
        // Placeholder until the image loads.
        ctx.strokeStyle = "rgba(255,255,255,0.4)";
        ctx.lineWidth = 2;
        ctx.strokeRect(-l.width / 2, -l.height / 2, l.width, l.height);
      }
      return;
    }
    case "null":
      return;
  }
}

const fx = (l: MotionLayer, type: string) => l.effects.find((e) => e.enabled && e.type === type);

function needsBuffer(l: MotionLayer): boolean {
  return l.matte !== "none" || l.effects.some((e) => e.enabled && (e.type === "glow" || e.type === "blur"));
}

/**
 * Draw the composition at time tUs. The context is expected to be the full
 * output size (comp size × scale); it is cleared first.
 */
export function renderMotion(ctx: Ctx2D, comp: MotionComp, tUs: number, opts: MotionRenderOptions = {}): void {
  const scale = opts.scale ?? 1;
  const W = Math.max(1, Math.round(comp.width * scale));
  const H = Math.max(1, Math.round(comp.height * scale));
  const make = opts.createCanvas ?? defaultCanvas;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  ctx.clearRect(0, 0, W, H);
  if (comp.background) {
    ctx.fillStyle = comp.background;
    ctx.fillRect(0, 0, W, H);
  }
  const t = Math.min(Math.max(0, tUs), comp.durationUs);
  const layers = frameLayers(comp, t);
  // Layers used as a matte by the layer below are not drawn themselves.
  const matteFor = new Map<string, MotionLayer>();
  for (let i = 0; i < comp.layers.length - 1; i++) {
    const below = comp.layers[i + 1]!;
    if (below.matte !== "none") matteFor.set(below.id, comp.layers[i]!);
  }
  const usedAsMatte = new Set([...matteFor.values()].map((l) => l.id));
  const matrixOf = new Map(layers.map((x) => [x.layer.id, x] as const));

  const paint = (c: Ctx2D, l: MotionLayer, m: Affine, alpha: number) => {
    c.save();
    c.setTransform(m[0] * scale, m[1] * scale, m[2] * scale, m[3] * scale, m[4] * scale, m[5] * scale);
    c.globalAlpha = alpha;
    const shadow = fx(l, "shadow");
    if (shadow) {
      c.shadowColor = `rgba(0,0,0,${shadow.params.opacity ?? 0.5})`;
      c.shadowBlur = (shadow.params.amount ?? 12) * scale;
      c.shadowOffsetX = (shadow.params.dx ?? 0) * scale;
      c.shadowOffsetY = (shadow.params.dy ?? 6) * scale;
    }
    drawContent(c, l, opts);
    c.restore();
  };

  for (const { layer: l, matrix } of layers) {
    if (!isActive(l, t) || usedAsMatte.has(l.id) || l.type === "null") continue;
    const alpha = l.transform.opacity;
    if (alpha <= 0) continue;
    ctx.globalCompositeOperation = BLEND[l.blendMode];
    if (!needsBuffer(l)) {
      paint(ctx, l, matrix, alpha);
      continue;
    }
    const buf = make(W, H);
    const b = buf.getContext("2d") as Ctx2D | null;
    if (!b) continue;
    paint(b, l, matrix, 1);
    const matte = matteFor.get(l.id);
    const mEntry = matte ? matrixOf.get(matte.id) : undefined;
    if (matte && mEntry && isActive(mEntry.layer, t)) {
      const mc = make(W, H);
      const m = mc.getContext("2d") as Ctx2D | null;
      if (m) {
        paint(m, mEntry.layer, mEntry.matrix, mEntry.layer.transform.opacity);
        if (l.matte === "luma") {
          const img = m.getImageData(0, 0, W, H);
          const d = img.data;
          for (let i = 0; i < d.length; i += 4) {
            const lum = (0.2126 * d[i]! + 0.7152 * d[i + 1]! + 0.0722 * d[i + 2]!) * (d[i + 3]! / 255);
            d[i + 3] = lum;
          }
          m.putImageData(img, 0, 0);
        }
        b.globalCompositeOperation = l.matte === "alpha-inverted" ? "destination-out" : "destination-in";
        b.drawImage(mc as CanvasImageSource, 0, 0);
        b.globalCompositeOperation = "source-over";
      }
    } else if (matte && l.matte !== "alpha-inverted") {
      // Matte layer not visible: nothing shows through.
      b.clearRect(0, 0, W, H);
    }
    const blur = fx(l, "blur");
    const glow = fx(l, "glow");
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = alpha;
    if (glow && "filter" in ctx) {
      const r = (glow.params.amount ?? 20) * scale;
      const intensity = glow.params.intensity ?? 1;
      ctx.globalCompositeOperation = "lighter";
      ctx.filter = `blur(${r.toFixed(1)}px)`;
      for (let k = 0; k < Math.ceil(intensity); k++) {
        ctx.globalAlpha = alpha * Math.min(1, intensity - k);
        ctx.drawImage(buf as CanvasImageSource, 0, 0);
      }
      ctx.filter = "none";
      ctx.globalAlpha = alpha;
      ctx.globalCompositeOperation = BLEND[l.blendMode];
    }
    if (blur && (blur.params.amount ?? 0) > 0 && "filter" in ctx) ctx.filter = `blur(${((blur.params.amount ?? 0) * scale).toFixed(1)}px)`;
    ctx.drawImage(buf as CanvasImageSource, 0, 0);
    ctx.restore();
  }
  ctx.restore();
}
