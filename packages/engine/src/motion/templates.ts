/**
 * Built-in motion templates and text animation presets. All original designs
 * made from our own shapes and text, so they are free to use.
 */
import {
  MotionCompSchema,
  MotionLayerSchema,
  type MotionComp,
  type MotionKeyframe,
  type MotionLayer,
  type TextAnimator,
} from "@just-see/schema";

type IdFn = (prefix: string) => string;
type LayerInput = Parameters<typeof MotionLayerSchema.parse>[0];

const S = 1_000_000;
const kf = (t: number, v: number, ease: MotionKeyframe["ease"] = "ease-in-out", bezier?: MotionKeyframe["bezier"]): MotionKeyframe => ({ t: Math.round(t * S), v, ease, ...(bezier ? { bezier } : {}) });
/** Snappy ease-out with a small overshoot. */
const BACK: MotionKeyframe["bezier"] = [0.34, 1.56, 0.64, 1];
const QUART_OUT: MotionKeyframe["bezier"] = [0.16, 1, 0.3, 1];

function layer(id: IdFn, input: Omit<LayerInput, "id">): MotionLayer {
  return MotionLayerSchema.parse({ id: id("ml_"), ...input });
}

export interface TemplateOptions {
  width: number;
  height: number;
  /** Seconds. */
  duration?: number;
  title?: string;
  subtitle?: string;
  accent?: string;
  /** Image asset for logo templates. */
  logoAssetId?: string | null;
  logoAspect?: number;
}

export interface TemplateDef {
  id: string;
  label: string;
  category: "lower-third" | "logo" | "title" | "social" | "callout";
  build(id: IdFn, o: TemplateOptions): MotionComp;
}

function comp(id: IdFn, name: string, template: string, o: TemplateOptions, layers: MotionLayer[], editable: MotionComp["editable"], dur: number): MotionComp {
  return MotionCompSchema.parse({ id: id("mc_"), name, width: o.width, height: o.height, fps: 30, durationUs: Math.round(dur * S), background: null, layers, editable, template, updatedAt: Date.now() });
}

const anim = (a: Partial<TextAnimator>): TextAnimator => ({ by: "char", opacity: 0, offsetX: 0, offsetY: 40, scale: 1, rotation: 0, blur: 0, smoothness: 3, progress: 1, random: false, ...a });

export const TEMPLATES: readonly TemplateDef[] = [
  {
    id: "lower-third-clean",
    label: "Lower third · Clean",
    category: "lower-third",
    build: (id, o) => {
      const dur = o.duration ?? 5;
      const u = Math.min(o.width, o.height) / 1080;
      const x0 = o.width * 0.07;
      const y0 = o.height * 0.8;
      const accent = o.accent ?? "#ff8a1f";
      const barW = 620 * u;
      const out = dur - 0.6;
      const group = layer(id, { name: "Group", type: "null", transform: { x: x0, y: y0 } });
      const name = layer(id, {
        name: "Name",
        type: "text",
        parentId: group.id,
        transform: { x: 34 * u, y: -38 * u },
        text: { text: o.title ?? "Your Name", fontSize: 64 * u, fontWeight: 800, align: "left", color: "#ffffff", animator: anim({ by: "char", offsetY: 30 * u, smoothness: 4, progress: 0 }) },
        keyframes: { "anim.progress": [kf(0.25, 0, "bezier", QUART_OUT), kf(1.0, 1, "linear"), kf(out, 1), kf(out + 0.4, 0)] },
      });
      const sub = layer(id, {
        name: "Title",
        type: "text",
        parentId: group.id,
        transform: { x: 34 * u, y: 30 * u },
        text: { text: o.subtitle ?? "Designer · Creator", fontSize: 36 * u, fontWeight: 500, align: "left", color: "#e6e6e6", animator: anim({ by: "word", offsetY: 0, offsetX: -20 * u, smoothness: 1, progress: 0 }) },
        keyframes: { "anim.progress": [kf(0.6, 0), kf(1.2, 1, "linear"), kf(out, 1), kf(out + 0.35, 0)] },
      });
      const bar = layer(id, {
        name: "Bar",
        type: "shape",
        parentId: group.id,
        transform: { x: 0, y: 0, anchorX: -barW / 2 },
        shape: { kind: "rect", width: barW, height: 150 * u, roundness: 14 * u, fill: "rgba(12,12,16,0.78)" },
        keyframes: { scaleX: [kf(0, 0, "bezier", QUART_OUT), kf(0.55, 1), kf(out + 0.1, 1, "ease-in"), kf(out + 0.6, 0)] },
      });
      const line = layer(id, {
        name: "Accent",
        type: "shape",
        parentId: group.id,
        transform: { x: 10 * u, y: 0 },
        shape: { kind: "rect", width: 8 * u, height: 150 * u, roundness: 4 * u, fill: accent },
        keyframes: { scaleY: [kf(0.1, 0, "bezier", BACK), kf(0.5, 1), kf(out + 0.2, 1), kf(out + 0.6, 0)] },
      });
      return comp(id, "Lower third", "lower-third-clean", o, [name, sub, line, bar, group], [
        { layerId: name.id, field: "text", label: "Name" },
        { layerId: sub.id, field: "text", label: "Title" },
        { layerId: line.id, field: "fill", label: "Accent colour" },
      ], dur);
    },
  },
  {
    id: "lower-third-modern",
    label: "Lower third · Modern",
    category: "lower-third",
    build: (id, o) => {
      const dur = o.duration ?? 5;
      const u = Math.min(o.width, o.height) / 1080;
      const accent = o.accent ?? "#0a84ff";
      const out = dur - 0.7;
      const x0 = o.width * 0.06;
      const y0 = o.height * 0.78;
      const top = layer(id, {
        name: "Top bar",
        type: "shape",
        transform: { x: x0 + 280 * u, y: y0 - 40 * u },
        shape: { kind: "rect", width: 560 * u, height: 84 * u, roundness: 42 * u, fill: accent, fill2: "#bf5af2" },
        keyframes: { x: [kf(0, -600 * u, "bezier", QUART_OUT), kf(0.6, x0 + 280 * u), kf(out, x0 + 280 * u, "ease-in"), kf(out + 0.5, -600 * u)] },
      });
      const bottom = layer(id, {
        name: "Bottom bar",
        type: "shape",
        transform: { x: x0 + 220 * u, y: y0 + 46 * u },
        shape: { kind: "rect", width: 440 * u, height: 62 * u, roundness: 31 * u, fill: "#ffffff" },
        keyframes: { x: [kf(0.12, -600 * u, "bezier", QUART_OUT), kf(0.72, x0 + 220 * u), kf(out + 0.08, x0 + 220 * u, "ease-in"), kf(out + 0.55, -600 * u)] },
      });
      const name = layer(id, {
        name: "Name",
        type: "text",
        transform: { x: x0 + 36 * u, y: y0 - 40 * u },
        text: { text: o.title ?? "Your Name", fontSize: 50 * u, fontWeight: 800, align: "left", color: "#ffffff", caps: true, letterSpacing: 2 * u, animator: anim({ by: "char", offsetY: 0, offsetX: 30 * u, smoothness: 5, progress: 0 }) },
        keyframes: { "anim.progress": [kf(0.45, 0), kf(1.1, 1, "linear"), kf(out, 1), kf(out + 0.3, 0)] },
      });
      const sub = layer(id, {
        name: "Title",
        type: "text",
        transform: { x: x0 + 36 * u, y: y0 + 46 * u },
        text: { text: o.subtitle ?? "Follow for more", fontSize: 32 * u, fontWeight: 600, align: "left", color: "#111111", animator: anim({ by: "word", offsetY: 20 * u, smoothness: 1, progress: 0 }) },
        keyframes: { "anim.progress": [kf(0.7, 0), kf(1.2, 1, "linear"), kf(out, 1), kf(out + 0.3, 0)] },
      });
      return comp(id, "Lower third", "lower-third-modern", o, [name, sub, top, bottom], [
        { layerId: name.id, field: "text", label: "Name" },
        { layerId: sub.id, field: "text", label: "Title" },
        { layerId: top.id, field: "fill", label: "Colour" },
      ], dur);
    },
  },
  {
    id: "lower-third-news",
    label: "Lower third · News",
    category: "lower-third",
    build: (id, o) => {
      const dur = o.duration ?? 6;
      const u = Math.min(o.width, o.height) / 1080;
      const out = dur - 0.5;
      const y0 = o.height * 0.82;
      const tagW = 220 * u;
      const tag = layer(id, {
        name: "Tag",
        type: "shape",
        transform: { x: o.width * 0.05 + tagW / 2, y: y0 - 64 * u },
        shape: { kind: "rect", width: tagW, height: 56 * u, fill: o.accent ?? "#e0262b" },
        keyframes: { scaleY: [kf(0, 0, "bezier", BACK), kf(0.35, 1), kf(out, 1), kf(out + 0.3, 0)] },
      });
      const tagText = layer(id, {
        name: "Tag text",
        type: "text",
        transform: { x: o.width * 0.05 + tagW / 2, y: y0 - 64 * u },
        text: { text: "BREAKING", fontSize: 30 * u, fontWeight: 900, color: "#ffffff", letterSpacing: 3 * u },
        keyframes: { opacity: [kf(0.25, 0), kf(0.45, 1), kf(out, 1), kf(out + 0.2, 0)] },
      });
      const bar = layer(id, {
        name: "Bar",
        type: "shape",
        transform: { x: o.width * 0.05, y: y0, anchorX: -o.width * 0.45 },
        shape: { kind: "rect", width: o.width * 0.9, height: 80 * u, fill: "#ffffff" },
        keyframes: { scaleX: [kf(0.15, 0, "bezier", QUART_OUT), kf(0.75, 1), kf(out, 1), kf(out + 0.4, 0)] },
      });
      const head = layer(id, {
        name: "Headline",
        type: "text",
        transform: { x: o.width * 0.07, y: y0 },
        text: { text: o.title ?? "Your headline goes here", fontSize: 44 * u, fontWeight: 800, align: "left", color: "#111111", animator: anim({ by: "word", offsetY: 24 * u, smoothness: 2, progress: 0 }) },
        keyframes: { "anim.progress": [kf(0.6, 0), kf(1.4, 1, "linear"), kf(out, 1), kf(out + 0.3, 0)] },
      });
      return comp(id, "News lower third", "lower-third-news", o, [tagText, tag, head, bar], [
        { layerId: tagText.id, field: "text", label: "Tag" },
        { layerId: head.id, field: "text", label: "Headline" },
        { layerId: tag.id, field: "fill", label: "Tag colour" },
      ], dur);
    },
  },
  {
    id: "logo-reveal-glow",
    label: "Logo reveal · Glow",
    category: "logo",
    build: (id, o) => {
      const dur = o.duration ?? 4;
      const u = Math.min(o.width, o.height) / 1080;
      const cx = o.width / 2;
      const cy = o.height / 2;
      const accent = o.accent ?? "#ffd60a";
      const size = 420 * u;
      const ring = layer(id, {
        name: "Ring",
        type: "shape",
        transform: { x: cx, y: cy },
        shape: { kind: "ellipse", width: size * 1.35, height: size * 1.35, fill: null, stroke: accent, strokeWidth: 10 * u, trimEnd: 0 },
        keyframes: {
          "shape.trimEnd": [kf(0, 0, "bezier", QUART_OUT), kf(1.0, 1)],
          "shape.trimStart": [kf(1.1, 0, "ease-in-out"), kf(1.7, 1)],
          rotation: [kf(0, -90, "ease-out"), kf(1.7, 90)],
        },
        effects: [{ id: id("fx_"), type: "glow", enabled: true, params: { amount: 18, intensity: 1.5 } }],
      });
      const sparks = layer(id, {
        name: "Sparks",
        type: "shape",
        transform: { x: cx, y: cy },
        inUs: Math.round(1.0 * S),
        shape: { kind: "path", closed: false, fill: null, stroke: accent, strokeWidth: 8 * u, path: [{ x: 0, y: -size * 0.75 }, { x: 0, y: -size * 1.05 }], copies: 12, copyRotation: 30, trimEnd: 0 },
        keyframes: { "shape.trimEnd": [kf(1.0, 0, "ease-out"), kf(1.35, 1)], "shape.trimStart": [kf(1.2, 0, "ease-in"), kf(1.7, 1)] },
      });
      const logoLayer: MotionLayer = o.logoAssetId
        ? layer(id, {
            name: "Logo",
            type: "image",
            assetId: o.logoAssetId,
            width: (o.logoAspect ?? 1) >= 1 ? size : size * (o.logoAspect ?? 1),
            height: (o.logoAspect ?? 1) >= 1 ? size / (o.logoAspect ?? 1) : size,
            transform: { x: cx, y: cy },
            keyframes: {
              scaleX: [kf(0.9, 0.4, "bezier", BACK), kf(1.5, 1), kf(dur, 1.06, "linear")],
              scaleY: [kf(0.9, 0.4, "bezier", BACK), kf(1.5, 1), kf(dur, 1.06, "linear")],
              opacity: [kf(0.9, 0, "ease-out"), kf(1.2, 1)],
              "fx.glow": [kf(1.0, 60, "ease-out"), kf(2.2, 0)],
            },
            effects: [{ id: id("fx_"), type: "glow", enabled: true, params: { amount: 60, intensity: 1 } }],
          })
        : layer(id, {
            name: "Logo",
            type: "text",
            transform: { x: cx, y: cy },
            text: { text: o.title ?? "LOGO", fontSize: 150 * u, fontWeight: 900, color: "#ffffff", letterSpacing: 6 * u },
            keyframes: {
              scaleX: [kf(0.9, 0.4, "bezier", BACK), kf(1.5, 1), kf(dur, 1.06, "linear")],
              scaleY: [kf(0.9, 0.4, "bezier", BACK), kf(1.5, 1), kf(dur, 1.06, "linear")],
              opacity: [kf(0.9, 0, "ease-out"), kf(1.2, 1)],
              "fx.glow": [kf(1.0, 60, "ease-out"), kf(2.2, 0)],
            },
            effects: [{ id: id("fx_"), type: "glow", enabled: true, params: { amount: 60, intensity: 1 } }],
          });
      const tagline = layer(id, {
        name: "Tagline",
        type: "text",
        transform: { x: cx, y: cy + size * 0.85 },
        text: { text: o.subtitle ?? "your tagline", fontSize: 44 * u, fontWeight: 500, color: "#dddddd", letterSpacing: 8 * u, caps: true, animator: anim({ by: "char", offsetY: 0, blur: 12, smoothness: 6, progress: 0 }) },
        keyframes: { "anim.progress": [kf(1.6, 0), kf(2.6, 1, "linear")] },
      });
      const editable: MotionComp["editable"] = [{ layerId: tagline.id, field: "text", label: "Tagline" }, { layerId: ring.id, field: "color", label: "Ring colour" }];
      if (logoLayer.type === "text") editable.unshift({ layerId: logoLayer.id, field: "text", label: "Logo text" });
      else editable.unshift({ layerId: logoLayer.id, field: "image", label: "Logo" });
      return comp(id, "Logo reveal", "logo-reveal-glow", o, [tagline, logoLayer, sparks, ring], editable, dur);
    },
  },
  {
    id: "logo-reveal-line",
    label: "Logo reveal · Line draw",
    category: "logo",
    build: (id, o) => {
      const dur = o.duration ?? 4;
      const u = Math.min(o.width, o.height) / 1080;
      const cx = o.width / 2;
      const cy = o.height / 2;
      const box = layer(id, {
        name: "Frame",
        type: "shape",
        transform: { x: cx, y: cy },
        shape: { kind: "rect", width: 700 * u, height: 300 * u, roundness: 24 * u, fill: null, stroke: o.accent ?? "#ffffff", strokeWidth: 6 * u, trimEnd: 0 },
        keyframes: { "shape.trimEnd": [kf(0, 0, "bezier", QUART_OUT), kf(1.3, 1)], "shape.trimOffset": [kf(0, 0.125, "linear"), kf(1.3, 0.125)] },
      });
      const fillBox = layer(id, {
        name: "Fill",
        type: "shape",
        transform: { x: cx, y: cy },
        shape: { kind: "rect", width: 700 * u, height: 300 * u, roundness: 24 * u, fill: o.accent ?? "#ffffff" },
        keyframes: { opacity: [kf(1.1, 0), kf(1.5, 1), kf(dur - 0.4, 1), kf(dur, 0)], scaleX: [kf(1.1, 0.96, "bezier", BACK), kf(1.5, 1)], scaleY: [kf(1.1, 0.96, "bezier", BACK), kf(1.5, 1)] },
      });
      const logoText = layer(id, {
        name: "Logo",
        type: "text",
        transform: { x: cx, y: cy },
        text: { text: o.title ?? "BRAND", fontSize: 140 * u, fontWeight: 900, color: "#111111" },
        keyframes: { "text.letterSpacing": [kf(1.2, 60 * u, "bezier", QUART_OUT), kf(2.4, 8 * u)], opacity: [kf(1.2, 0), kf(1.6, 1)] },
      });
      return comp(id, "Logo reveal", "logo-reveal-line", o, [logoText, fillBox, box], [
        { layerId: logoText.id, field: "text", label: "Logo text" },
        { layerId: fillBox.id, field: "fill", label: "Colour" },
      ], dur);
    },
  },
  {
    id: "title-cinematic",
    label: "Title · Cinematic",
    category: "title",
    build: (id, o) => {
      const dur = o.duration ?? 5;
      const u = Math.min(o.width, o.height) / 1080;
      const t = layer(id, {
        name: "Title",
        type: "text",
        transform: { x: o.width / 2, y: o.height / 2 },
        text: { text: o.title ?? "THE JOURNEY", fontSize: Math.min(120 * u, o.width * 0.07), fontWeight: 300, color: "#ffffff", caps: true, letterSpacing: Math.min(20 * u, o.width * 0.01), animator: anim({ by: "char", offsetY: 0, blur: 24, smoothness: 8, progress: 0, random: true }) },
        keyframes: { "anim.progress": [kf(0, 0), kf(2, 1, "linear"), kf(dur - 0.8, 1), kf(dur, 0)], "text.letterSpacing": [kf(0, Math.min(40 * u, o.width * 0.02), "linear"), kf(dur, Math.min(12 * u, o.width * 0.006))] },
      });
      const sub = layer(id, {
        name: "Subtitle",
        type: "text",
        transform: { x: o.width / 2, y: o.height / 2 + 110 * u },
        text: { text: o.subtitle ?? "a short film", fontSize: 40 * u, fontWeight: 400, italic: true, color: "#cfcfcf" },
        keyframes: { opacity: [kf(1.4, 0), kf(2.2, 1), kf(dur - 0.8, 1), kf(dur, 0)], y: [kf(1.4, o.height / 2 + 140 * u, "ease-out"), kf(2.4, o.height / 2 + 110 * u)] },
      });
      return comp(id, "Title", "title-cinematic", o, [t, sub], [{ layerId: t.id, field: "text", label: "Title" }, { layerId: sub.id, field: "text", label: "Subtitle" }], dur);
    },
  },
  {
    id: "subscribe",
    label: "Subscribe button",
    category: "social",
    build: (id, o) => {
      const dur = o.duration ?? 4;
      const u = Math.min(o.width, o.height) / 1080;
      const cx = o.width / 2;
      const cy = o.height * 0.75;
      const btn = layer(id, {
        name: "Button",
        type: "shape",
        transform: { x: cx, y: cy },
        shape: { kind: "rect", width: 520 * u, height: 120 * u, roundness: 60 * u, fill: o.accent ?? "#e0262b" },
        keyframes: {
          scaleX: [kf(0, 0, "bezier", BACK), kf(0.5, 1), kf(1.6, 1, "ease-in-out"), kf(1.75, 0.92), kf(1.95, 1), kf(dur - 0.4, 1, "ease-in"), kf(dur, 0)],
          scaleY: [kf(0, 0, "bezier", BACK), kf(0.5, 1), kf(1.6, 1, "ease-in-out"), kf(1.75, 0.92), kf(1.95, 1), kf(dur - 0.4, 1, "ease-in"), kf(dur, 0)],
        },
        effects: [{ id: id("fx_"), type: "shadow", enabled: true, params: { amount: 24, opacity: 0.4, dy: 8 } }],
      });
      const label = layer(id, {
        name: "Label",
        type: "text",
        parentId: btn.id,
        transform: { x: 0, y: 0 },
        text: { text: "SUBSCRIBE", fontSize: 52 * u, fontWeight: 900, color: "#ffffff", letterSpacing: 2 * u },
      });
      const done = layer(id, {
        name: "Subscribed",
        type: "solid",
        parentId: btn.id,
        transform: { x: 0, y: 0 },
        width: 520 * u,
        height: 120 * u,
        color: "#4a4a4f",
        inUs: Math.round(1.75 * S),
        blendMode: "normal",
        keyframes: { opacity: [kf(1.75, 0), kf(1.9, 1)] },
      });
      const doneText = layer(id, {
        name: "Subscribed text",
        type: "text",
        parentId: btn.id,
        transform: { x: 0, y: 0 },
        inUs: Math.round(1.75 * S),
        text: { text: "SUBSCRIBED ✓", fontSize: 48 * u, fontWeight: 800, color: "#ffffff" },
        keyframes: { opacity: [kf(1.8, 0), kf(1.95, 1)] },
      });
      // The grey state is clipped to the button shape with an alpha matte.
      const matte = layer(id, {
        name: "Button matte",
        type: "shape",
        parentId: btn.id,
        transform: { x: 0, y: 0 },
        shape: { kind: "rect", width: 520 * u, height: 120 * u, roundness: 60 * u, fill: "#ffffff" },
      });
      done.matte = "alpha";
      return comp(id, "Subscribe", "subscribe", o, [doneText, matte, done, label, btn], [{ layerId: btn.id, field: "fill", label: "Button colour" }, { layerId: label.id, field: "text", label: "Label" }], dur);
    },
  },
  {
    id: "callout",
    label: "Callout circle",
    category: "callout",
    build: (id, o) => {
      const dur = o.duration ?? 4;
      const u = Math.min(o.width, o.height) / 1080;
      const cx = o.width * 0.6;
      const cy = o.height * 0.4;
      const accent = o.accent ?? "#ffd60a";
      const circle = layer(id, {
        name: "Circle",
        type: "shape",
        transform: { x: cx, y: cy, rotation: -20 },
        shape: { kind: "ellipse", width: 300 * u, height: 220 * u, fill: null, stroke: accent, strokeWidth: 10 * u, trimEnd: 0 },
        keyframes: { "shape.trimEnd": [kf(0, 0, "bezier", QUART_OUT), kf(0.7, 1)] },
      });
      const arrow = layer(id, {
        name: "Arrow",
        type: "shape",
        transform: { x: cx - 260 * u, y: cy + 220 * u },
        shape: {
          kind: "path",
          closed: false,
          fill: null,
          stroke: accent,
          strokeWidth: 10 * u,
          trimEnd: 0,
          path: [
            { x: -60 * u, y: 80 * u, outX: 40 * u, outY: -60 * u },
            { x: 110 * u, y: -100 * u },
            { x: 60 * u, y: -100 * u },
            { x: 110 * u, y: -100 * u },
            { x: 110 * u, y: -50 * u },
          ],
        },
        keyframes: { "shape.trimEnd": [kf(0.5, 0, "ease-out"), kf(1.1, 1)] },
      });
      const label = layer(id, {
        name: "Label",
        type: "text",
        transform: { x: cx - 330 * u, y: cy + 330 * u },
        text: { text: o.title ?? "Look here!", fontSize: 56 * u, fontWeight: 800, color: accent, animator: anim({ by: "char", offsetY: 0, scale: 0, smoothness: 3, progress: 0 }) },
        keyframes: { "anim.progress": [kf(0.9, 0), kf(1.5, 1, "linear")] },
      });
      return comp(id, "Callout", "callout", o, [label, arrow, circle], [{ layerId: label.id, field: "text", label: "Label" }, { layerId: circle.id, field: "color", label: "Colour" }], dur);
    },
  },
  {
    id: "hook-header",
    label: "Hook header (top banner)",
    category: "social",
    build: (id, o) => {
      const dur = o.duration ?? 10;
      const u = Math.min(o.width, o.height) / 1080;
      const top = o.height * 0.08;
      const compact = o.subtitle !== undefined && o.subtitle.trim() === "";
      const bannerH = (compact ? 150 : 230) * u;
      const maxW = o.width * 0.82;
      const banner = layer(id, {
        name: "Banner",
        type: "shape",
        transform: { x: o.width / 2, y: top + bannerH / 2 },
        shape: { kind: "rect", width: o.width * 0.9, height: bannerH, roundness: 28 * u, fill: o.accent ?? "#ffffff" },
        keyframes: { opacity: [kf(0, 0), kf(0.25, 1)], scaleY: [kf(0, 0.6, "bezier", BACK), kf(0.35, 1)] },
      });
      const head = layer(id, {
        name: "Header",
        type: "text",
        transform: { x: o.width / 2, y: top + bannerH * (compact ? 0.5 : 0.4) },
        text: { text: o.title ?? "If he sends you this 💓", fontSize: 64 * u, fontWeight: 800, color: "#111111", maxWidth: maxW },
        keyframes: { opacity: [kf(0.1, 0), kf(0.35, 1)] },
      });
      const sub = layer(id, {
        name: "Subline",
        type: "text",
        hidden: compact,
        transform: { x: o.width / 2, y: top + bannerH * 0.75 },
        text: { text: compact ? " " : o.subtitle ?? "(You won)", fontSize: 40 * u, fontWeight: 500, color: "#444444", maxWidth: maxW },
        keyframes: { opacity: [kf(0.25, 0), kf(0.5, 1)] },
      });
      return comp(id, "Hook header", "hook-header", o, [head, sub, banner], [
        { layerId: head.id, field: "text", label: "Header" },
        { layerId: sub.id, field: "text", label: "Subline" },
        { layerId: banner.id, field: "fill", label: "Banner colour" },
      ], dur);
    },
  },
  {
    id: "end-card",
    label: "End card (@handle)",
    category: "social",
    build: (id, o) => {
      const dur = o.duration ?? 2;
      const u = Math.min(o.width, o.height) / 1080;
      const bg = layer(id, { name: "Fade", type: "solid", width: o.width, height: o.height, color: "#000000", transform: { x: o.width / 2, y: o.height / 2 }, keyframes: { opacity: [kf(0, 0, "ease-out"), kf(0.6, 0.85)] } });
      const handle = layer(id, {
        name: "Handle",
        type: "text",
        transform: { x: o.width / 2, y: o.height * 0.52 },
        text: { text: o.title ?? "@yourhandle", fontSize: 66 * u, fontWeight: 800, color: "#ffffff", letterSpacing: 2 * u, maxWidth: o.width * 0.86 },
        keyframes: { opacity: [kf(0.3, 0), kf(0.7, 1)], y: [kf(0.3, o.height * 0.55, "bezier", QUART_OUT), kf(0.8, o.height * 0.52)] },
      });
      const follow = layer(id, {
        name: "Follow",
        type: "text",
        transform: { x: o.width / 2, y: o.height * 0.58 },
        text: { text: o.subtitle ?? "Follow for more", fontSize: 36 * u, fontWeight: 500, color: "#d0d0d0" },
        keyframes: { opacity: [kf(0.6, 0), kf(1.0, 1)] },
      });
      return comp(id, "End card", "end-card", o, [follow, handle, bg], [
        { layerId: handle.id, field: "text", label: "Handle" },
        { layerId: follow.id, field: "text", label: "Line" },
      ], dur);
    },
  },
  {
    id: "notification",
    label: "Message notification",
    category: "social",
    build: (id, o) => {
      const dur = o.duration ?? 3;
      const u = Math.min(o.width, o.height) / 1080;
      const w = o.width * 0.9;
      const h = 170 * u;
      const y0 = o.height * 0.24 + h / 2;
      const out = dur - 0.4;
      const card = layer(id, {
        name: "Card",
        type: "shape",
        transform: { x: o.width / 2, y: y0 },
        shape: { kind: "rect", width: w, height: h, roundness: 36 * u, fill: o.accent ?? "rgba(245,245,247,0.96)" },
        effects: [{ id: id("fx_"), type: "shadow", enabled: true, params: { amount: 30, opacity: 0.35, dy: 10 } }],
        keyframes: { y: [kf(0, -h, "bezier", QUART_OUT), kf(0.45, y0), kf(out, y0, "ease-in"), kf(dur, -h)] },
      });
      const icon = layer(id, { name: "Icon", type: "shape", parentId: card.id, transform: { x: -w / 2 + 75 * u, y: 0 }, shape: { kind: "rect", width: 86 * u, height: 86 * u, roundness: 22 * u, fill: "#34c759", fill2: "#30d158" } });
      const bubble = layer(id, { name: "Bubble", type: "shape", parentId: card.id, transform: { x: -w / 2 + 75 * u, y: 0 }, shape: { kind: "ellipse", width: 50 * u, height: 40 * u, fill: "#ffffff" } });
      const name = layer(id, {
        name: "Name",
        type: "text",
        parentId: card.id,
        transform: { x: -w / 2 + 145 * u, y: -28 * u },
        text: { text: o.title ?? "Babe ❤️", fontSize: 40 * u, fontWeight: 700, color: "#111111", align: "left", maxWidth: w - 260 * u },
      });
      const msg = layer(id, {
        name: "Message",
        type: "text",
        parentId: card.id,
        transform: { x: -w / 2 + 145 * u, y: 28 * u },
        text: { text: o.subtitle ?? "how am I looking? 😘", fontSize: 36 * u, fontWeight: 400, color: "#333333", align: "left", maxWidth: w - 190 * u },
      });
      const when = layer(id, { name: "Time", type: "text", parentId: card.id, transform: { x: w / 2 - 40 * u, y: -28 * u }, text: { text: "now", fontSize: 30 * u, fontWeight: 400, color: "#8a8a8e", align: "right" } });
      return comp(id, "Notification", "notification", o, [when, msg, name, bubble, icon, card], [
        { layerId: name.id, field: "text", label: "Name" },
        { layerId: msg.id, field: "text", label: "Message" },
      ], dur);
    },
  },
  {
    id: "lyric-card",
    label: "Lyric card (motion graphics)",
    category: "title",
    build: (id, o) => {
      const dur = o.duration ?? 10;
      const u = Math.min(o.width, o.height) / 1080;
      const cx = o.width / 2;
      const cy = o.height * 0.58;
      const size = Math.min(o.width * 0.9, o.height * 0.6);
      const third = dur / 3;
      const bg = layer(id, {
        name: "Background",
        type: "shape",
        transform: { x: cx, y: cy },
        shape: { kind: "rect", width: size, height: size, fill: "#0b0b0b" },
      });
      const cream = layer(id, {
        name: "Cream",
        type: "shape",
        transform: { x: cx, y: cy, anchorY: size / 2 },
        shape: { kind: "rect", width: size, height: size, fill: "#efe6d2" },
        keyframes: { scaleY: [kf(third - 0.4, 0, "bezier", QUART_OUT), kf(third, 1)] },
      });
      cream.transform.y = cy + size / 2;
      const circle = layer(id, {
        name: "Circle",
        type: "shape",
        transform: { x: cx, y: cy },
        inUs: Math.round(2 * third * S),
        shape: { kind: "ellipse", width: size * 0.7, height: size * 0.7, fill: o.accent ?? "#1f4d3a" },
        keyframes: { scaleX: [kf(2 * third, 0, "bezier", BACK), kf(2 * third + 0.5, 1)], scaleY: [kf(2 * third, 0, "bezier", BACK), kf(2 * third + 0.5, 1)] },
      });
      const star = layer(id, {
        name: "Star",
        type: "shape",
        transform: { x: cx, y: cy - size * 0.18 },
        shape: { kind: "star", width: 90 * u, height: 90 * u, points: 4, innerRatio: 0.25, fill: "#ffffff" },
        keyframes: { rotation: [kf(0, 0, "linear"), kf(dur, 180)], "shape.width": [kf(0, 0, "bezier", BACK), kf(0.5, 90 * u)], "shape.height": [kf(0, 0, "bezier", BACK), kf(0.5, 90 * u)] },
      });
      const lineAt = (i: number, txt: string, colour: string) =>
        layer(id, {
          name: `Line ${i + 1}`,
          type: "text",
          transform: { x: cx, y: cy + size * 0.08 },
          inUs: Math.round(i * third * S),
          outUs: Math.round((i + 1) * third * S),
          text: { text: txt, fontFamily: "Georgia, 'Times New Roman', serif", fontSize: 78 * u, fontWeight: 400, italic: true, color: colour, maxWidth: size * 0.85, animator: anim({ by: "word", offsetY: 30 * u, smoothness: 1, progress: 0 }) },
          keyframes: { "anim.progress": [kf(i * third + 0.2, 0), kf(i * third + 1.2, 1, "linear")] },
        });
      const l1 = lineAt(0, o.title ?? "Tu woh jo…", "#ffffff");
      const l2 = lineAt(1, o.subtitle ?? "Kaise ye bayaan?", "#1f4d3a");
      const l3 = lineAt(2, "Tu na ja…", "#efe6d2");
      return comp(id, "Lyric card", "lyric-card", o, [l3, l2, l1, star, circle, cream, bg], [
        { layerId: l1.id, field: "text", label: "Line 1" },
        { layerId: l2.id, field: "text", label: "Line 2" },
        { layerId: l3.id, field: "text", label: "Line 3" },
        { layerId: circle.id, field: "fill", label: "Accent colour" },
      ], dur);
    },
  },
  {
    id: "dialogue",
    label: "Dialogue lines",
    category: "title",
    build: (id, o) => {
      const dur = o.duration ?? 6;
      const u = Math.min(o.width, o.height) / 1080;
      const each = dur / 4;
      const defaults = [o.title ?? "Kya dekh rahi ho?", o.subtitle ?? "Aapke baal bahut acche hain", "Chhu sakti hoon?", "Zaroor!"];
      const lines = defaults.map((txt, i) =>
        layer(id, {
          name: `Line ${i + 1}`,
          type: "text",
          transform: { x: o.width / 2, y: o.height * (i % 2 === 0 ? 0.22 : 0.76) },
          inUs: Math.round(i * each * S),
          outUs: Math.round((i + 1) * each * S),
          text: { text: txt, fontFamily: "Georgia, 'Times New Roman', serif", fontSize: 64 * u, fontWeight: 700, color: "#ffffff", stroke: "#000000", strokeWidth: 6 * u, maxWidth: o.width * 0.88, animator: anim({ by: "char", offsetY: 0, blur: 10, smoothness: 6, progress: 0 }) },
          keyframes: { "anim.progress": [kf(i * each, 0), kf(i * each + Math.min(0.6, each * 0.5), 1, "linear")] },
          effects: [{ id: id("fx_"), type: "shadow", enabled: true, params: { amount: 14, opacity: 0.6, dy: 4 } }],
        }),
      );
      return comp(id, "Dialogue", "dialogue", o, [...lines].reverse(), lines.map((l, i) => ({ layerId: l.id, field: "text" as const, label: `Line ${i + 1}` })), dur);
    },
  },
  {
    id: "quote-card",
    label: "Quote card (black intro)",
    category: "title",
    build: (id, o) => {
      const dur = o.duration ?? 2;
      const u = Math.min(o.width, o.height) / 1080;
      const bg = layer(id, { name: "Black", type: "solid", width: o.width, height: o.height, color: "#000000", transform: { x: o.width / 2, y: o.height / 2 }, keyframes: { opacity: [kf(dur - 0.35, 1), kf(dur, 0)] } });
      const q = layer(id, {
        name: "Quote",
        type: "text",
        transform: { x: o.width / 2, y: o.height / 2 },
        text: { text: o.title ?? "“Relax, it was just a dream”", fontFamily: "Georgia, 'Times New Roman', serif", fontSize: 60 * u, fontWeight: 400, italic: true, color: "#ffffff", maxWidth: o.width * 0.86 },
        keyframes: { opacity: [kf(0, 0), kf(0.4, 1), kf(dur - 0.4, 1), kf(dur - 0.1, 0)] },
      });
      return comp(id, "Quote card", "quote-card", o, [q, bg], [{ layerId: q.id, field: "text", label: "Quote" }], dur);
    },
  },
  {
    id: "label-pop",
    label: "Label pop (key point)",
    category: "callout",
    build: (id, o) => {
      const dur = o.duration ?? 2.5;
      const u = Math.min(o.width, o.height) / 1080;
      const y = o.height * 0.3;
      const pill = layer(id, {
        name: "Pill",
        type: "shape",
        transform: { x: o.width / 2, y },
        shape: { kind: "rect", width: 640 * u, height: 120 * u, roundness: 60 * u, fill: o.accent ?? "#ffd60a" },
        keyframes: { scaleX: [kf(0, 0, "bezier", BACK), kf(0.35, 1), kf(dur - 0.25, 1, "ease-in"), kf(dur, 0)], scaleY: [kf(0, 0, "bezier", BACK), kf(0.35, 1), kf(dur - 0.25, 1, "ease-in"), kf(dur, 0)] },
      });
      const label = layer(id, {
        name: "Label",
        type: "text",
        parentId: pill.id,
        transform: { x: 0, y: 0 },
        text: { text: o.title ?? "Pattern Interrupt", fontSize: 60 * u, fontWeight: 900, color: "#111111", maxWidth: 580 * u },
      });
      return comp(id, "Label", "label-pop", o, [label, pill], [
        { layerId: label.id, field: "text", label: "Label" },
        { layerId: pill.id, field: "fill", label: "Colour" },
      ], dur);
    },
  },
];

export const TEMPLATE_BY_ID: ReadonlyMap<string, TemplateDef> = new Map(TEMPLATES.map((t) => [t.id, t]));

/** Text animation presets: an animator plus how long the reveal takes. */
export interface TextPreset {
  id: string;
  label: string;
  animator: Partial<TextAnimator>;
  /** Seconds for the reveal. */
  seconds: number;
}

export const TEXT_PRESETS: readonly TextPreset[] = [
  { id: "typewriter", label: "Typewriter", animator: { by: "char", offsetY: 0, smoothness: 0 }, seconds: 1.2 },
  { id: "fade-up", label: "Fade up", animator: { by: "char", offsetY: 40, smoothness: 4 }, seconds: 0.9 },
  { id: "fade-down", label: "Fade down", animator: { by: "char", offsetY: -40, smoothness: 4 }, seconds: 0.9 },
  { id: "slide-left", label: "Slide from right", animator: { by: "char", offsetX: 60, offsetY: 0, smoothness: 5 }, seconds: 0.9 },
  { id: "slide-right", label: "Slide from left", animator: { by: "char", offsetX: -60, offsetY: 0, smoothness: 5 }, seconds: 0.9 },
  { id: "pop-word", label: "Pop by word", animator: { by: "word", offsetY: 0, scale: 0, smoothness: 1 }, seconds: 0.8 },
  { id: "pop-char", label: "Pop by letter", animator: { by: "char", offsetY: 0, scale: 0, smoothness: 2 }, seconds: 0.8 },
  { id: "blur-in", label: "Blur in", animator: { by: "char", offsetY: 0, blur: 20, smoothness: 6 }, seconds: 1.2 },
  { id: "blur-random", label: "Blur in (random)", animator: { by: "char", offsetY: 0, blur: 20, smoothness: 6, random: true }, seconds: 1.4 },
  { id: "rotate-in", label: "Rotate in", animator: { by: "char", offsetY: 30, rotation: -90, smoothness: 3 }, seconds: 1 },
  { id: "drop", label: "Drop in", animator: { by: "char", offsetY: -120, smoothness: 2 }, seconds: 0.9 },
  { id: "rise-word", label: "Rise by word", animator: { by: "word", offsetY: 60, smoothness: 1 }, seconds: 0.9 },
  { id: "line-by-line", label: "Line by line", animator: { by: "line", offsetY: 40, smoothness: 1 }, seconds: 1.2 },
  { id: "zoom-in", label: "Zoom in", animator: { by: "char", offsetY: 0, scale: 3, smoothness: 4 }, seconds: 1 },
  { id: "zoom-out", label: "Shrink in", animator: { by: "char", offsetY: 0, scale: 0.2, smoothness: 4 }, seconds: 1 },
  { id: "flicker", label: "Flicker (random)", animator: { by: "char", offsetY: 0, smoothness: 0, random: true }, seconds: 1 },
  { id: "spread", label: "Wide spread", animator: { by: "char", offsetX: 120, offsetY: 0, blur: 8, smoothness: 8 }, seconds: 1.3 },
  { id: "bounce-word", label: "Bounce by word", animator: { by: "word", offsetY: 80, scale: 0.6, smoothness: 1 }, seconds: 0.9 },
  { id: "tilt", label: "Tilt up", animator: { by: "char", offsetY: 50, rotation: 25, smoothness: 3 }, seconds: 1 },
  { id: "soft-fade", label: "Soft fade", animator: { by: "char", offsetY: 0, smoothness: 12 }, seconds: 1.4 },
];

/** Apply a text preset to a text layer (in place): animator + reveal keyframes from startSec. */
export function applyTextPreset(layer: MotionLayer, preset: TextPreset, startSec = 0, ease: MotionKeyframe["ease"] = "linear"): void {
  if (!layer.text) return;
  layer.text.animator = anim({ ...preset.animator, progress: 0 });
  layer.keyframes = { ...layer.keyframes, "anim.progress": [kf(startSec, 0, ease), kf(startSec + preset.seconds, 1, "linear")] };
}

/** An empty composition the size of the video. */
export function blankComp(id: IdFn, width: number, height: number, seconds = 5): MotionComp {
  return MotionCompSchema.parse({ id: id("mc_"), name: "Composition", width, height, durationUs: Math.round(seconds * S), layers: [], updatedAt: Date.now() });
}

/** New layers with sensible defaults, centred in the comp. */
export function newMotionLayer(id: IdFn, compW: number, compH: number, type: MotionLayer["type"], extra: Partial<LayerInput> = {}): MotionLayer {
  const u = Math.min(compW, compH) / 1080;
  const base: Omit<LayerInput, "id"> = { name: type[0]!.toUpperCase() + type.slice(1), type, transform: { x: compW / 2, y: compH / 2 } };
  if (type === "solid") Object.assign(base, { width: 400 * u, height: 240 * u, color: "#ff8a1f" });
  if (type === "shape") Object.assign(base, { name: "Shape", shape: { kind: "rect", width: 300 * u, height: 300 * u, fill: "#0a84ff" } });
  if (type === "text") Object.assign(base, { name: "Text", text: { text: "Your text", fontSize: 96 * u } });
  if (type === "image") Object.assign(base, { name: "Image", width: 400 * u, height: 400 * u });
  return layer(id, { ...base, ...extra } as Omit<LayerInput, "id">);
}
