/**
 * Lottie JSON export and import for a common subset: solids, shapes (rect,
 * ellipse, star, polygon, path) with fill, stroke, trim paths and repeater,
 * nulls, basic text and parenting. Animated values are baked to keyframes
 * every couple of frames, so timing matches our renderer. Text animators,
 * effects, mattes and images are not exported.
 */
import { MotionCompSchema, MotionLayerSchema, type MotionComp, type MotionKeyframe, type MotionLayer } from "@just-see/schema";
import { evaluateLayer } from "./eval";

type Json = Record<string, unknown>;

export function parseColor(c: string | null | undefined): [number, number, number, number] {
  if (!c) return [0, 0, 0, 0];
  const s = c.trim();
  if (s.startsWith("#")) {
    let h = s.slice(1);
    if (h.length === 3 || h.length === 4) h = Array.from(h, (x) => x + x).join("");
    const n = (i: number) => parseInt(h.slice(i, i + 2), 16) / 255;
    return [n(0), n(2), n(4), h.length >= 8 ? n(6) : 1];
  }
  const m = /rgba?\(([^)]+)\)/i.exec(s);
  if (m) {
    const p = m[1]!.split(",").map((x) => parseFloat(x));
    return [(p[0] ?? 0) / 255, (p[1] ?? 0) / 255, (p[2] ?? 0) / 255, p[3] ?? 1];
  }
  return [1, 1, 1, 1];
}

function toHex([r, g, b, a]: number[]): string {
  const h = (v: number | undefined) => Math.round(Math.min(1, Math.max(0, v ?? 0)) * 255).toString(16).padStart(2, "0");
  return a !== undefined && a < 0.999 ? `rgba(${Math.round((r ?? 0) * 255)},${Math.round((g ?? 0) * 255)},${Math.round((b ?? 0) * 255)},${+a.toFixed(3)})` : `#${h(r)}${h(g)}${h(b)}`;
}

/** Animated property: sample `get` on frames where anything changes. */
function prop(frames: number[], get: (f: number) => number[], animated: boolean): Json {
  if (!animated || frames.length < 2) return { a: 0, k: get(0) };
  const k = frames.map((f, i) => {
    const kf: Json = { t: f, s: get(f) };
    if (i < frames.length - 1) Object.assign(kf, { i: { x: [1], y: [1] }, o: { x: [0], y: [0] } });
    return kf;
  });
  return { a: 1, k };
}

function shapeItems(l: MotionLayer, frames: number[], at: (f: number) => MotionLayer, animated: (p: string) => boolean): Json[] {
  const s = l.shape!;
  const items: Json[] = [];
  const geo = (f: number) => at(f).shape!;
  const anyGeo = ["shape.width", "shape.height", "shape.roundness"].some(animated);
  if (s.kind === "rect") items.push({ ty: "rc", p: { a: 0, k: [0, 0] }, s: prop(frames, (f) => [geo(f).width, geo(f).height], anyGeo), r: prop(frames, (f) => [geo(f).roundness], animated("shape.roundness")) });
  else if (s.kind === "ellipse") items.push({ ty: "el", p: { a: 0, k: [0, 0] }, s: prop(frames, (f) => [geo(f).width, geo(f).height], anyGeo) });
  else if (s.kind === "star" || s.kind === "polygon")
    items.push({ ty: "sr", sy: s.kind === "star" ? 1 : 2, d: 1, pt: { a: 0, k: s.points }, p: { a: 0, k: [0, 0] }, r: { a: 0, k: 0 }, or: prop(frames, (f) => [geo(f).width / 2], anyGeo), os: { a: 0, k: 0 }, ...(s.kind === "star" ? { ir: prop(frames, (f) => [(geo(f).width / 2) * geo(f).innerRatio], anyGeo || animated("shape.innerRatio")), is: { a: 0, k: 0 } } : {}) });
  else
    items.push({ ty: "sh", ks: { a: 0, k: { c: s.closed, v: s.path.map((p) => [p.x, p.y]), i: s.path.map((p) => [p.inX, p.inY]), o: s.path.map((p) => [p.outX, p.outY]) } } });
  if (s.fill) items.push({ ty: "fl", c: { a: 0, k: parseColor(s.fill) }, o: { a: 0, k: parseColor(s.fill)[3]! * 100 }, r: 1 });
  if (s.stroke && s.strokeWidth > 0) items.push({ ty: "st", c: { a: 0, k: parseColor(s.stroke) }, o: { a: 0, k: 100 }, w: prop(frames, (f) => [geo(f).strokeWidth], animated("shape.strokeWidth")), lc: s.lineCap === "butt" ? 1 : s.lineCap === "round" ? 2 : 3, lj: 2 });
  const trimmed = ["shape.trimStart", "shape.trimEnd", "shape.trimOffset"].some(animated) || s.trimStart > 0 || s.trimEnd < 1 || s.trimOffset !== 0;
  if (trimmed) items.push({ ty: "tm", s: prop(frames, (f) => [geo(f).trimStart * 100], animated("shape.trimStart")), e: prop(frames, (f) => [geo(f).trimEnd * 100], animated("shape.trimEnd")), o: prop(frames, (f) => [geo(f).trimOffset * 360], animated("shape.trimOffset")), m: 1 });
  items.push({ ty: "tr", p: { a: 0, k: [0, 0] }, a: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] }, r: { a: 0, k: 0 }, o: { a: 0, k: 100 } });
  const group: Json = { ty: "gr", nm: "Shape", it: items };
  if (s.copies > 1) {
    return [
      group,
      { ty: "rp", c: { a: 0, k: s.copies }, o: { a: 0, k: 0 }, m: 1, tr: { ty: "tr", p: { a: 0, k: [s.copyX, s.copyY] }, a: { a: 0, k: [0, 0] }, s: { a: 0, k: [s.copyScale * 100, s.copyScale * 100] }, r: { a: 0, k: s.copyRotation }, so: { a: 0, k: 100 }, eo: { a: 0, k: s.copyOpacityEnd * 100 } } },
    ];
  }
  return [group];
}

/** Export a composition as Lottie (bodymovin) JSON. */
export function toLottie(comp: MotionComp): Json {
  const fps = comp.fps;
  const op = Math.max(1, Math.round((comp.durationUs / 1e6) * fps));
  const ind = new Map(comp.layers.map((l, i) => [l.id, i + 1] as const));
  const fonts = new Map<string, Json>();
  const layers: Json[] = [];
  comp.layers.forEach((l, i) => {
    if (l.type === "image") return;
    const animated = (p: string) => (l.keyframes[p]?.length ?? 0) > 1 || l.wiggles.some((w) => w.prop === p);
    const anyAnim = Object.keys(l.keyframes).length > 0 || l.wiggles.length > 0;
    const step = 2;
    const frames: number[] = [];
    if (anyAnim) {
      for (let f = 0; f < op; f += step) frames.push(f);
      frames.push(op);
    }
    const cache = new Map<number, MotionLayer>();
    const at = (f: number) => {
      let v = cache.get(f);
      if (!v) cache.set(f, (v = evaluateLayer(l, Math.round((f / fps) * 1e6))));
      return v;
    };
    const tf = (f: number) => at(f).transform;
    const solidOffset = l.type === "solid" ? [l.width / 2, l.height / 2] : [0, 0];
    const ks: Json = {
      a: prop(frames, (f) => [tf(f).anchorX + solidOffset[0]!, tf(f).anchorY + solidOffset[1]!, 0], animated("anchorX") || animated("anchorY")),
      p: prop(frames, (f) => [tf(f).x, tf(f).y, 0], animated("x") || animated("y")),
      s: prop(frames, (f) => [tf(f).scaleX * 100, tf(f).scaleY * 100, 100], animated("scaleX") || animated("scaleY")),
      r: prop(frames, (f) => [tf(f).rotation], animated("rotation")),
      o: prop(frames, (f) => [tf(f).opacity * 100], animated("opacity")),
    };
    const base: Json = {
      ddd: 0,
      ind: i + 1,
      nm: l.name,
      sr: 1,
      ks,
      ao: 0,
      ip: Math.round((l.inUs / 1e6) * fps),
      op: Math.min(op, Math.round((Math.min(l.outUs, comp.durationUs) / 1e6) * fps)),
      st: 0,
      bm: 0,
      ...(l.hidden ? { hd: true } : {}),
      ...(l.parentId && ind.has(l.parentId) ? { parent: ind.get(l.parentId) } : {}),
    };
    if (l.type === "null") layers.push({ ...base, ty: 3 });
    else if (l.type === "solid") layers.push({ ...base, ty: 1, sc: toHex(parseColor(l.color)), sw: l.width, sh: l.height });
    else if (l.type === "shape" && l.shape) layers.push({ ...base, ty: 4, shapes: shapeItems(l, frames, at, animated) });
    else if (l.type === "text" && l.text) {
      const t = l.text;
      const fName = `${t.fontFamily.split(",")[0]!.trim().replace(/['"]/g, "")}-${t.fontWeight}`;
      fonts.set(fName, { fName, fFamily: t.fontFamily.split(",")[0]!.trim().replace(/['"]/g, ""), fStyle: t.fontWeight >= 700 ? "Bold" : "Regular", ascent: 75 });
      layers.push({
        ...base,
        ty: 5,
        t: {
          d: { k: [{ s: { s: t.fontSize, f: fName, t: (t.caps ? t.text.toUpperCase() : t.text).replace(/\n/g, "\r"), j: t.align === "left" ? 0 : t.align === "right" ? 1 : 2, tr: (t.letterSpacing / t.fontSize) * 1000, lh: t.fontSize * t.lineHeight, ls: 0, fc: parseColor(t.color).slice(0, 3) }, t: 0 }] },
          p: {},
          m: { g: 1, a: { a: 0, k: [0, 0] } },
          a: [],
        },
      });
    }
  });
  return { v: "5.7.4", fr: fps, ip: 0, op, w: comp.width, h: comp.height, nm: comp.name, ddd: 0, assets: [], fonts: { list: [...fonts.values()] }, layers, markers: [] };
}

// ---------- Import ----------

type LProp = { a?: number; k?: unknown };

function readProp(p: unknown, fps: number, index = 0, scale = 1): { value: number; kfs: MotionKeyframe[] | null } {
  const lp = (p ?? {}) as LProp;
  const first = (k: unknown): number => (Array.isArray(k) ? Number(k[index] ?? 0) : Number(k ?? 0));
  if (lp.a === 1 && Array.isArray(lp.k)) {
    const kfs: MotionKeyframe[] = [];
    for (const raw of lp.k as Json[]) {
      const s = raw.s ?? raw.e;
      if (s === undefined) continue;
      kfs.push({ t: Math.round((Number(raw.t ?? 0) / fps) * 1e6), v: first(s) * scale, ease: raw.h ? "hold" : "linear" });
    }
    return { value: kfs[0]?.v ?? 0, kfs: kfs.length ? kfs : null };
  }
  return { value: first(lp.k) * scale, kfs: null };
}

/** Import a Lottie file (subset). Unknown layer types and items are skipped. */
export function fromLottie(json: unknown, id: (prefix: string) => string): MotionComp {
  const j = json as Json;
  const fps = Number(j.fr ?? 30);
  const w = Math.round(Number(j.w ?? 1080));
  const h = Math.round(Number(j.h ?? 1080));
  const op = Number(j.op ?? fps * 3);
  const layersIn = (j.layers ?? []) as Json[];
  const ids = new Map<number, string>();
  for (const L of layersIn) ids.set(Number(L.ind), id("ml_"));
  const layers: MotionLayer[] = [];
  for (const L of layersIn) {
    const ty = Number(L.ty);
    const type = ty === 1 ? "solid" : ty === 3 ? "null" : ty === 4 ? "shape" : ty === 5 ? "text" : null;
    if (!type) continue;
    const ks = (L.ks ?? {}) as Json;
    const keyframes: Record<string, MotionKeyframe[]> = {};
    const tfv: Record<string, number> = {};
    const read = (name: string, p: unknown, idx: number, scale = 1, offset = 0) => {
      const r = readProp(p, fps, idx, scale);
      tfv[name] = r.value + offset;
      if (r.kfs) keyframes[name] = r.kfs.map((k) => ({ ...k, v: k.v + offset }));
    };
    const sw = Number(L.sw ?? 0);
    const sh = Number(L.sh ?? 0);
    read("anchorX", ks.a, 0, 1, type === "solid" ? -sw / 2 : 0);
    read("anchorY", ks.a, 1, 1, type === "solid" ? -sh / 2 : 0);
    read("x", ks.p, 0);
    read("y", ks.p, 1);
    read("scaleX", ks.s, 0, 0.01);
    read("scaleY", ks.s, 1, 0.01);
    read("rotation", ks.r, 0);
    read("opacity", ks.o, 0, 0.01);
    const layer: Record<string, unknown> = {
      id: ids.get(Number(L.ind))!,
      name: String(L.nm ?? type).slice(0, 200),
      type,
      inUs: Math.round((Number(L.ip ?? 0) / fps) * 1e6),
      outUs: Math.round((Number(L.op ?? op) / fps) * 1e6),
      hidden: !!L.hd,
      parentId: L.parent !== undefined ? ids.get(Number(L.parent)) ?? null : null,
      transform: { x: tfv.x, y: tfv.y, anchorX: tfv.anchorX, anchorY: tfv.anchorY, scaleX: tfv.scaleX, scaleY: tfv.scaleY, rotation: tfv.rotation, opacity: tfv.opacity },
      keyframes,
    };
    if (type === "solid") Object.assign(layer, { width: sw, height: sh, color: String(L.sc ?? "#ffffff") });
    if (type === "shape") {
      const shape: Record<string, unknown> = { fill: null };
      const walk = (items: Json[]) => {
        for (const it of items) {
          const t = String(it.ty);
          if (t === "gr") walk((it.it ?? []) as Json[]);
          else if (t === "rc" || t === "el") {
            const s = readProp(it.s, fps, 0);
            const s2 = readProp(it.s, fps, 1);
            Object.assign(shape, { kind: t === "rc" ? "rect" : "ellipse", width: s.value, height: s2.value, roundness: t === "rc" ? readProp(it.r, fps).value : 0 });
            if (s.kfs) keyframes["shape.width"] = s.kfs;
            if (s2.kfs) keyframes["shape.height"] = s2.kfs;
          } else if (t === "sr") {
            const or = readProp(it.or, fps).value;
            const ir = readProp(it.ir, fps).value;
            Object.assign(shape, { kind: Number(it.sy) === 2 ? "polygon" : "star", width: or * 2, height: or * 2, points: Math.round(readProp(it.pt, fps).value) || 5, innerRatio: or > 0 && ir > 0 ? Math.min(1, ir / or) : 0.45 });
          } else if (t === "sh") {
            const k = ((it.ks as LProp)?.k ?? {}) as { c?: boolean; v?: number[][]; i?: number[][]; o?: number[][] };
            const v = Array.isArray(k) ? (((k as Json[])[0]?.s as unknown[])?.[0] as typeof k) ?? {} : k;
            Object.assign(shape, { kind: "path", closed: !!v.c, path: (v.v ?? []).map((p, n) => ({ x: p[0] ?? 0, y: p[1] ?? 0, inX: v.i?.[n]?.[0] ?? 0, inY: v.i?.[n]?.[1] ?? 0, outX: v.o?.[n]?.[0] ?? 0, outY: v.o?.[n]?.[1] ?? 0 })) });
          } else if (t === "fl") shape.fill = toHex([...(((it.c as LProp)?.k as number[]) ?? [1, 1, 1]).slice(0, 3), (readProp(it.o, fps).value || 100) / 100]);
          else if (t === "st") Object.assign(shape, { stroke: toHex(((it.c as LProp)?.k as number[]) ?? [1, 1, 1]), strokeWidth: readProp(it.w, fps).value });
          else if (t === "tm") {
            const s = readProp(it.s, fps, 0, 0.01);
            const e = readProp(it.e, fps, 0, 0.01);
            const o = readProp(it.o, fps, 0, 1 / 360);
            Object.assign(shape, { trimStart: s.value, trimEnd: e.value, trimOffset: o.value });
            if (s.kfs) keyframes["shape.trimStart"] = s.kfs;
            if (e.kfs) keyframes["shape.trimEnd"] = e.kfs;
            if (o.kfs) keyframes["shape.trimOffset"] = o.kfs;
          } else if (t === "rp") {
            const tr = (it.tr ?? {}) as Json;
            Object.assign(shape, { copies: Math.max(1, Math.round(readProp(it.c, fps).value)), copyX: readProp(tr.p, fps, 0).value, copyY: readProp(tr.p, fps, 1).value, copyRotation: readProp(tr.r, fps).value, copyScale: readProp(tr.s, fps, 0, 0.01).value || 1, copyOpacityEnd: (readProp(tr.eo, fps).value || 100) / 100 });
          }
        }
      };
      walk((L.shapes ?? []) as Json[]);
      if (!shape.kind) continue;
      layer.shape = shape;
    }
    if (type === "text") {
      const d = (((L.t as Json)?.d as Json)?.k as Json[])?.[0]?.s as Json | undefined;
      if (!d) continue;
      const fonts = (((j.fonts as Json)?.list ?? []) as Json[]).find((f) => f.fName === d.f);
      const size = Number(d.s ?? 48);
      layer.text = {
        text: String(d.t ?? "").replace(/\r/g, "\n"),
        fontSize: size,
        fontFamily: fonts ? `${String(fonts.fFamily)}, system-ui, sans-serif` : "system-ui, sans-serif",
        fontWeight: fonts && /bold|black|heavy/i.test(String(fonts.fStyle)) ? 700 : 400,
        color: toHex(((d.fc as number[]) ?? [1, 1, 1]).slice(0, 3)),
        align: Number(d.j) === 0 ? "left" : Number(d.j) === 1 ? "right" : "center",
        letterSpacing: (Number(d.tr ?? 0) / 1000) * size,
        lineHeight: Number(d.lh ?? size * 1.2) / size,
      };
    }
    layers.push(MotionLayerSchema.parse(layer));
  }
  return MotionCompSchema.parse({ id: id("mc_"), name: String(j.nm ?? "Lottie").slice(0, 200), width: w, height: h, fps, durationUs: Math.round((op / fps) * 1e6), layers, updatedAt: Date.now() });
}
