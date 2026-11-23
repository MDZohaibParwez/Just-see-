/**
 * Pure helpers for motion compositions: property sampling (keyframes, loop,
 * wiggle), layer matrices with parenting, shape outlines, trim paths and
 * text-animator amounts. No DOM, so everything here is unit-tested.
 */
import { applyEasing, baseValue, type MotionComp, type MotionKeyframe, type MotionLayer, type PathPoint, type Shape } from "@just-see/schema";

export type Affine = [number, number, number, number, number, number]; // a b c d e f (canvas setTransform order)

export const IDENTITY: Affine = [1, 0, 0, 1, 0, 0];

export function mul(m: Affine, n: Affine): Affine {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

export function applyAffine(m: Affine, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

/** Keyframe value at time t (µs). `loop` repeats the keyframed span. */
export function sampleMotionKeyframes(kfs: readonly MotionKeyframe[] | undefined, t: number, fallback: number, loop = false): number {
  if (!kfs || kfs.length === 0) return fallback;
  const first = kfs[0]!;
  const last = kfs[kfs.length - 1]!;
  if (loop && kfs.length > 1 && t > last.t) {
    const span = last.t - first.t;
    if (span > 0) t = first.t + ((t - first.t) % span);
  }
  if (t <= first.t) return first.v;
  for (let i = 1; i < kfs.length; i++) {
    const b = kfs[i]!;
    if (t <= b.t) {
      const a = kfs[i - 1]!;
      const span = b.t - a.t;
      const f = span <= 0 ? 1 : (t - a.t) / span;
      return a.v + (b.v - a.v) * applyEasing(a.ease, f, a.bezier);
    }
  }
  return last.v;
}

/** Smooth deterministic noise in -1..1 (sum of sines with seeded phases). */
export function wiggleNoise(tSec: number, freq: number, seed: number): number {
  const ph = (k: number) => ((Math.sin(seed * 12.9898 + k * 78.233) * 43758.5453) % 1) * Math.PI * 2;
  const x = tSec * freq;
  return (Math.sin(x * 2.1 + ph(1)) * 0.5 + Math.sin(x * 3.7 + ph(2)) * 0.3 + Math.sin(x * 6.3 + ph(3)) * 0.2) / 1;
}

export function prop(layer: MotionLayer, name: string, t: number): number {
  let v = sampleMotionKeyframes(layer.keyframes[name], t, baseValue(layer, name), layer.loop);
  for (const w of layer.wiggles) if (w.prop === name) v += wiggleNoise(t / 1e6, w.freq, w.seed) * w.amp;
  return v;
}

/** Layer with every animatable value sampled at time t. */
export function evaluateLayer(layer: MotionLayer, t: number): MotionLayer {
  const keys = new Set([...Object.keys(layer.keyframes), ...layer.wiggles.map((w) => w.prop)]);
  if (keys.size === 0) return layer;
  const out: MotionLayer = structuredClone(layer);
  for (const k of keys) {
    const v = prop(layer, k, t);
    if (k in out.transform) (out.transform as Record<string, number>)[k] = v;
    else if (k === "width") out.width = v;
    else if (k === "height") out.height = v;
    else if (k.startsWith("shape.") && out.shape) (out.shape as unknown as Record<string, number>)[k.slice(6)] = k === "shape.copies" ? Math.max(1, Math.round(v)) : v;
    else if (k.startsWith("text.") && out.text) (out.text as unknown as Record<string, number>)[k.slice(5)] = v;
    else if (k === "anim.progress" && out.text?.animator) out.text.animator.progress = Math.min(1, Math.max(0, v));
    else if (k.startsWith("fx.")) {
      const fx = out.effects.find((e) => e.type === k.slice(3));
      if (fx) fx.params = { ...fx.params, amount: v };
    }
  }
  if (out.shape) {
    out.shape.trimStart = clamp01(out.shape.trimStart);
    out.shape.trimEnd = clamp01(out.shape.trimEnd);
  }
  out.transform.opacity = clamp01(out.transform.opacity);
  return out;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Local matrix: position · rotation · scale · -anchor. */
export function localMatrix(l: MotionLayer): Affine {
  const tf = l.transform;
  const r = (tf.rotation * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  const rs: Affine = [c * tf.scaleX, s * tf.scaleX, -s * tf.scaleY, c * tf.scaleY, tf.x, tf.y];
  return mul(rs, [1, 0, 0, 1, -tf.anchorX, -tf.anchorY]);
}

/** World matrix including parents (parents are evaluated at the same time). */
export function worldMatrix(layerId: string, evaluated: ReadonlyMap<string, MotionLayer>, depth = 0): Affine {
  const l = evaluated.get(layerId);
  if (!l || depth > 32) return IDENTITY;
  const local = localMatrix(l);
  return l.parentId ? mul(worldMatrix(l.parentId, evaluated, depth + 1), local) : local;
}

export function isActive(l: MotionLayer, t: number): boolean {
  return !l.hidden && t >= l.inUs && t < l.outUs;
}

/** Layers in draw order (bottom first) with values at time t. */
export function frameLayers(comp: MotionComp, t: number): { layer: MotionLayer; matrix: Affine }[] {
  const evaluated = new Map(comp.layers.map((l) => [l.id, evaluateLayer(l, t)] as const));
  const out: { layer: MotionLayer; matrix: Affine }[] = [];
  for (let i = comp.layers.length - 1; i >= 0; i--) {
    const l = evaluated.get(comp.layers[i]!.id)!;
    out.push({ layer: l, matrix: worldMatrix(l.id, evaluated) });
  }
  return out;
}

// ---------- Shapes ----------

export type Polyline = { pts: [number, number][]; closed: boolean };

function bezierPts(p0: [number, number], c1: [number, number], c2: [number, number], p1: [number, number], steps: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    out.push([
      u * u * u * p0[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * p1[0],
      u * u * u * p0[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * p1[1],
    ]);
  }
  return out;
}

/** Shape outline as a polyline centred on 0,0. */
export function shapeOutline(s: Shape): Polyline {
  const w = s.width / 2;
  const h = s.height / 2;
  switch (s.kind) {
    case "rect": {
      const r = Math.min(s.roundness, w, h);
      if (r <= 0) return { pts: [[-w, -h], [w, -h], [w, h], [-w, h]], closed: true };
      const pts: [number, number][] = [];
      const corner = (cx: number, cy: number, a0: number) => {
        for (let i = 0; i <= 8; i++) {
          const a = a0 + (i / 8) * (Math.PI / 2);
          pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
        }
      };
      corner(w - r, -h + r, -Math.PI / 2);
      corner(w - r, h - r, 0);
      corner(-w + r, h - r, Math.PI / 2);
      corner(-w + r, -h + r, Math.PI);
      return { pts, closed: true };
    }
    case "ellipse": {
      const n = 96;
      // Start at the top, go clockwise (like a clock hand) so trim paths draw naturally.
      return { pts: Array.from({ length: n }, (_, i) => [Math.sin((i / n) * Math.PI * 2) * w, -Math.cos((i / n) * Math.PI * 2) * h] as [number, number]), closed: true };
    }
    case "star":
    case "polygon": {
      const n = s.kind === "star" ? s.points * 2 : s.points;
      return {
        pts: Array.from({ length: n }, (_, i) => {
          const a = (i / n) * Math.PI * 2 - Math.PI / 2;
          const k = s.kind === "star" && i % 2 === 1 ? s.innerRatio : 1;
          return [Math.cos(a) * w * k, Math.sin(a) * h * k] as [number, number];
        }),
        closed: true,
      };
    }
    case "path": {
      const P = s.path;
      if (P.length === 0) return { pts: [], closed: s.closed };
      const pts: [number, number][] = [[P[0]!.x, P[0]!.y]];
      const seg = (a: PathPoint, b: PathPoint) => {
        if (!a.outX && !a.outY && !b.inX && !b.inY) pts.push([b.x, b.y]);
        else pts.push(...bezierPts([a.x, a.y], [a.x + a.outX, a.y + a.outY], [b.x + b.inX, b.y + b.inY], [b.x, b.y], 24));
      };
      for (let i = 1; i < P.length; i++) seg(P[i - 1]!, P[i]!);
      if (s.closed && P.length > 2) seg(P[P.length - 1]!, P[0]!);
      return { pts, closed: s.closed };
    }
  }
}

export function polylineLength(p: Polyline): number {
  let len = 0;
  const n = p.pts.length;
  const segs = p.closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const a = p.pts[i]!;
    const b = p.pts[(i + 1) % n]!;
    len += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return len;
}

/** Part of an outline between fractions start..end (+offset, wrapping on closed paths). */
export function trimPolyline(p: Polyline, start: number, end: number, offset = 0): Polyline[] {
  if (start <= 0 && end >= 1 && offset === 0) return [p];
  const total = polylineLength(p);
  if (total <= 0 || end <= start) return [];
  const n = p.pts.length;
  const segs = p.closed ? n : n - 1;
  // Pieces in [0,1] after offset (wrap for closed paths).
  let a = start + offset;
  let b = end + offset;
  const ranges: [number, number][] = [];
  if (p.closed) {
    const shift = Math.floor(a);
    a -= shift;
    b -= shift;
    if (b <= 1) ranges.push([a, b]);
    else ranges.push([a, 1], [0, Math.min(1, b - 1)]);
  } else ranges.push([Math.max(0, a), Math.min(1, b)]);
  const out: Polyline[] = [];
  for (const [r0, r1] of ranges) {
    if (r1 <= r0) continue;
    const d0 = r0 * total;
    const d1 = r1 * total;
    const pts: [number, number][] = [];
    let acc = 0;
    for (let i = 0; i < segs; i++) {
      const pa = p.pts[i]!;
      const pb = p.pts[(i + 1) % n]!;
      const L = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]);
      const s0 = acc;
      const s1 = acc + L;
      acc = s1;
      if (s1 < d0 || s0 > d1 || L === 0) continue;
      const at = (d: number): [number, number] => {
        const f = (d - s0) / L;
        return [pa[0] + (pb[0] - pa[0]) * f, pa[1] + (pb[1] - pa[1]) * f];
      };
      if (pts.length === 0) pts.push(at(Math.max(d0, s0)));
      pts.push(at(Math.min(d1, s1)));
    }
    if (pts.length > 1) out.push({ pts, closed: false });
  }
  // Join a wrapped trim into one stroke.
  if (out.length === 2 && p.closed) return [{ pts: [...out[0]!.pts, ...out[1]!.pts.slice(1)], closed: false }];
  return out;
}

// ---------- Text animator ----------

/** How far unit i of n is revealed (0 = animator values, 1 = normal). */
export function revealAmount(i: number, n: number, progress: number, smoothness: number, order?: readonly number[]): number {
  const idx = order ? order[i] ?? i : i;
  const s = Math.max(0, smoothness);
  const front = progress * (n + s);
  const x = front - idx;
  if (s <= 0) return x > 0 ? 1 : 0;
  return Math.min(1, Math.max(0, x / s));
}

/** Stable shuffled order for "random" text animators. */
export function randomOrder(n: number, seed = 7): number[] {
  const idx = Array.from({ length: n }, (_, i) => i);
  let s = seed;
  for (let i = n - 1; i > 0; i--) {
    s = (s * 16807) % 2147483647;
    const j = s % (i + 1);
    [idx[i], idx[j]] = [idx[j]!, idx[i]!];
  }
  const order = new Array<number>(n);
  idx.forEach((v, k) => (order[v] = k));
  return order;
}

/** Split text into animator units, keeping spaces attached so layout stays the same. */
export function textUnits(text: string, by: "char" | "word" | "line"): string[] {
  if (by === "line") return text.split("\n");
  if (by === "word") return text.split(/(\s+)/).filter((x) => x.length > 0);
  const seg = typeof Intl !== "undefined" && "Segmenter" in Intl ? Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text), (s) => s.segment) : Array.from(text);
  return seg;
}
