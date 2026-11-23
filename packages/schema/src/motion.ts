import { z } from "zod";
import { EffectInstanceSchema, IdSchema, MicrosSchema } from "./base";

/**
 * Motion studio compositions (Module 3). A composition is a stack of layers
 * with keyframed properties, rendered by the engine with Canvas 2D. A text
 * clip on the video timeline can point at a composition (`motionCompId`), so
 * edits to the composition show up in the video straight away.
 *
 * Units: positions and sizes are composition pixels, rotation is degrees
 * clockwise, scale 1 = 100 %, opacity 0..1, times are µs from the
 * composition start.
 */

const ColorSchema = z.string().max(32);

/** Easing on the segment that starts at this keyframe. Bezier = graph editor handles. */
export const MotionEaseSchema = z.enum(["linear", "ease-in", "ease-out", "ease-in-out", "hold", "bezier"]);

export const MotionKeyframeSchema = z.object({
  t: MicrosSchema,
  v: z.number(),
  ease: MotionEaseSchema.default("ease-in-out"),
  /** CSS-style cubic bezier (x1, y1, x2, y2), used when ease = "bezier". y may overshoot. */
  bezier: z.tuple([z.number().min(0).max(1), z.number().min(-2).max(3), z.number().min(0).max(1), z.number().min(-2).max(3)]).optional(),
});
export type MotionKeyframe = z.infer<typeof MotionKeyframeSchema>;

export const LayerTransformSchema = z.object({
  /** Anchor point in layer space (pixels from the layer's own centre). */
  anchorX: z.number().default(0),
  anchorY: z.number().default(0),
  /** Position in parent space (composition pixels, 0,0 = top left). */
  x: z.number(),
  y: z.number(),
  scaleX: z.number().min(-100).max(100).default(1),
  scaleY: z.number().min(-100).max(100).default(1),
  rotation: z.number().min(-36000).max(36000).default(0),
  opacity: z.number().min(0).max(1).default(1),
});
export type LayerTransform = z.infer<typeof LayerTransformSchema>;

export const PathPointSchema = z.object({
  x: z.number(),
  y: z.number(),
  /** Bezier handles, relative to the point. */
  inX: z.number().default(0),
  inY: z.number().default(0),
  outX: z.number().default(0),
  outY: z.number().default(0),
});
export type PathPoint = z.infer<typeof PathPointSchema>;

export const ShapeSchema = z.object({
  kind: z.enum(["rect", "ellipse", "star", "polygon", "path"]),
  width: z.number().min(0).max(100000).default(200),
  height: z.number().min(0).max(100000).default(200),
  /** Round corners (rect) or point roundness. */
  roundness: z.number().min(0).max(10000).default(0),
  /** Star / polygon. */
  points: z.number().int().min(3).max(100).default(5),
  innerRatio: z.number().min(0.05).max(1).default(0.45),
  path: z.array(PathPointSchema).max(2000).default([]),
  closed: z.boolean().default(true),
  fill: ColorSchema.nullable().default("#ffffff"),
  /** Second fill colour for a linear gradient (left → right). */
  fill2: ColorSchema.nullable().default(null),
  stroke: ColorSchema.nullable().default(null),
  strokeWidth: z.number().min(0).max(1000).default(0),
  lineCap: z.enum(["butt", "round", "square"]).default("round"),
  /** Trim paths, 0..1 of the outline length. */
  trimStart: z.number().min(0).max(1).default(0),
  trimEnd: z.number().min(0).max(1).default(1),
  trimOffset: z.number().min(-10).max(10).default(0),
  /** Repeater. */
  copies: z.number().int().min(1).max(200).default(1),
  copyX: z.number().default(0),
  copyY: z.number().default(0),
  copyRotation: z.number().default(0),
  copyScale: z.number().min(0).max(10).default(1),
  copyOpacityEnd: z.number().min(0).max(1).default(1),
});
export type Shape = z.infer<typeof ShapeSchema>;

export const TextAnimatorSchema = z.object({
  /** Unit the animator walks over. */
  by: z.enum(["char", "word", "line"]).default("char"),
  /** Values applied to units outside the revealed range (they animate to normal). */
  opacity: z.number().min(0).max(1).default(0),
  offsetX: z.number().default(0),
  offsetY: z.number().default(40),
  scale: z.number().min(0).max(20).default(1),
  rotation: z.number().default(0),
  blur: z.number().min(0).max(200).default(0),
  /** How many units the soft edge spans. */
  smoothness: z.number().min(0).max(100).default(3),
  /** Reveal progress 0..1 (keyframe it as "anim.progress"). */
  progress: z.number().min(0).max(1).default(1),
  /** Random order instead of left-to-right. */
  random: z.boolean().default(false),
});
export type TextAnimator = z.infer<typeof TextAnimatorSchema>;

export const MotionTextSchema = z.object({
  text: z.string().max(2000),
  fontFamily: z.string().max(200).default("system-ui, sans-serif"),
  fontSize: z.number().min(1).max(2000).default(72),
  fontWeight: z.number().int().min(100).max(900).default(700),
  italic: z.boolean().default(false),
  color: ColorSchema.default("#ffffff"),
  align: z.enum(["left", "center", "right"]).default("center"),
  stroke: ColorSchema.nullable().default(null),
  strokeWidth: z.number().min(0).max(200).default(0),
  letterSpacing: z.number().min(-100).max(500).default(0),
  lineHeight: z.number().min(0.5).max(4).default(1.2),
  /** Uppercase on render. */
  caps: z.boolean().default(false),
  animator: TextAnimatorSchema.nullable().default(null),
});
export type MotionText = z.infer<typeof MotionTextSchema>;

/** Simple wiggle: random smooth motion added to a property. */
export const WiggleSchema = z.object({
  prop: z.string().max(60),
  freq: z.number().min(0).max(60),
  amp: z.number().min(0).max(100000),
  seed: z.number().int().default(1),
});

export const MotionLayerSchema = z.object({
  id: IdSchema,
  name: z.string().max(200),
  type: z.enum(["solid", "shape", "text", "image", "null"]),
  /** Layer is visible from inUs (inclusive) to outUs (exclusive). */
  inUs: MicrosSchema.default(0),
  outUs: MicrosSchema.default(3_600_000_000),
  hidden: z.boolean().default(false),
  locked: z.boolean().default(false),
  parentId: IdSchema.nullable().default(null),
  blendMode: z.enum(["normal", "multiply", "screen", "overlay", "lighten", "darken", "color-dodge", "add"]).default("normal"),
  /** Use the layer directly above as a matte for this layer. */
  matte: z.enum(["none", "alpha", "alpha-inverted", "luma"]).default("none"),
  transform: LayerTransformSchema,
  /** Property path → keyframes (e.g. "x", "opacity", "shape.trimEnd", "anim.progress", "text.color" is not animatable). */
  keyframes: z.record(z.string().max(120), z.array(MotionKeyframeSchema).max(1000)).default({}),
  /** Repeat keyframes after the last one (like loopOut("cycle")). */
  loop: z.boolean().default(false),
  wiggles: z.array(WiggleSchema).max(16).default([]),
  /** Solid colour or image tint. */
  color: ColorSchema.default("#ff8a1f"),
  width: z.number().min(0).max(100000).default(400),
  height: z.number().min(0).max(100000).default(200),
  shape: ShapeSchema.nullable().default(null),
  text: MotionTextSchema.nullable().default(null),
  assetId: IdSchema.nullable().default(null),
  /** Effects: "glow", "blur", "shadow", "motion-blur". Parameters in params. */
  effects: z.array(EffectInstanceSchema).max(16).default([]),
});
export type MotionLayer = z.infer<typeof MotionLayerSchema>;

/** A property marked as editable so a template can be changed in one place. */
export const EditableFieldSchema = z.object({
  layerId: IdSchema,
  field: z.enum(["text", "color", "fill", "image"]),
  label: z.string().max(100),
});
export type EditableField = z.infer<typeof EditableFieldSchema>;

export const MotionCompSchema = z.object({
  id: IdSchema,
  name: z.string().max(200),
  width: z.number().int().min(16).max(8192),
  height: z.number().int().min(16).max(8192),
  fps: z.number().min(1).max(120).default(30),
  durationUs: MicrosSchema,
  /** Null = transparent (normal for overlays). */
  background: ColorSchema.nullable().default(null),
  /** Top of the list is drawn last (on top), like layer panels in other apps: index 0 = top. */
  layers: z.array(MotionLayerSchema).max(500),
  editable: z.array(EditableFieldSchema).max(50).default([]),
  /** Template this comp was made from, for the UI. */
  template: z.string().max(60).nullable().default(null),
  updatedAt: z.number().int().default(0),
});
export type MotionComp = z.infer<typeof MotionCompSchema>;

/** Animatable numeric properties and where they live on a layer. */
export const MOTION_PROPS = [
  "x",
  "y",
  "anchorX",
  "anchorY",
  "scaleX",
  "scaleY",
  "rotation",
  "opacity",
  "width",
  "height",
  "shape.width",
  "shape.height",
  "shape.roundness",
  "shape.strokeWidth",
  "shape.trimStart",
  "shape.trimEnd",
  "shape.trimOffset",
  "shape.copies",
  "shape.copyX",
  "shape.copyY",
  "shape.copyRotation",
  "shape.innerRatio",
  "text.fontSize",
  "text.letterSpacing",
  "anim.progress",
  "fx.blur",
  "fx.glow",
] as const;
export type MotionProp = (typeof MOTION_PROPS)[number];

/** Static (un-keyframed) value of a property. */
export function baseValue(layer: MotionLayer, prop: string): number {
  const tf = layer.transform as Record<string, number>;
  if (prop in tf) return tf[prop] ?? 0;
  if (prop === "width") return layer.width;
  if (prop === "height") return layer.height;
  if (prop.startsWith("shape.") && layer.shape) return (layer.shape as unknown as Record<string, number>)[prop.slice(6)] ?? 0;
  if (prop.startsWith("text.") && layer.text) return (layer.text as unknown as Record<string, number>)[prop.slice(5)] ?? 0;
  if (prop === "anim.progress") return layer.text?.animator?.progress ?? 1;
  if (prop.startsWith("fx.")) {
    const fx = layer.effects.find((e) => e.type === prop.slice(3) && e.enabled);
    return fx?.params.amount ?? 0;
  }
  return 0;
}
