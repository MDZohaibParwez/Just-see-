import { z } from "zod";

/**
 * Project document, schema version 1.
 *
 * All times are integer microseconds (suffix `Us`) so timeline math is exact.
 * Positions in `Transform` are fractions of the canvas size, centred on 0.
 */

export const SCHEMA_VERSION = 1 as const;

export const IdSchema = z.string().min(1).max(64);
export const MicrosSchema = z.number().int().nonnegative();

export const TransformSchema = z.object({
  /** Horizontal offset as a fraction of canvas width. 0 = centred. */
  x: z.number().min(-10).max(10),
  /** Vertical offset as a fraction of canvas height. 0 = centred. */
  y: z.number().min(-10).max(10),
  /** 1 = media fitted inside the canvas. */
  scale: z.number().min(0.01).max(20),
  /** Degrees, clockwise. */
  rotation: z.number().min(-3600).max(3600),
  opacity: z.number().min(0).max(1),
  flipH: z.boolean(),
  flipV: z.boolean(),
});
export type Transform = z.infer<typeof TransformSchema>;

export const DEFAULT_TRANSFORM: Transform = {
  x: 0,
  y: 0,
  scale: 1,
  rotation: 0,
  opacity: 1,
  flipH: false,
  flipV: false,
};

export const EffectInstanceSchema = z.object({
  id: IdSchema,
  type: z.string().min(1).max(64),
  enabled: z.boolean(),
  params: z.record(z.string(), z.number()),
});
export type EffectInstance = z.infer<typeof EffectInstanceSchema>;

export const TransitionSchema = z.object({
  type: z.string().min(1).max(64),
  durationUs: MicrosSchema,
});
export type Transition = z.infer<typeof TransitionSchema>;

export const LicenseSchema = z.object({
  /** user-upload: the user's own media. Library assets come in Phase 5. */
  kind: z.enum(["user-upload", "library"]),
  name: z.string().max(200).optional(),
  attribution: z.string().max(1000).optional(),
  sourceUrl: z.string().max(2000).optional(),
  commercialUse: z.boolean(),
});
export type License = z.infer<typeof LicenseSchema>;

export const AssetKindSchema = z.enum(["video", "image", "audio"]);
export type AssetKind = z.infer<typeof AssetKindSchema>;

export const AssetSchema = z.object({
  id: IdSchema,
  kind: AssetKindSchema,
  name: z.string().max(500),
  mimeType: z.string().max(200),
  sizeBytes: z.number().int().nonnegative(),
  /** 0 for images. */
  durationUs: MicrosSchema,
  /** Display size (after container rotation). 0 for audio. */
  width: z.number().int().nonnegative(),
  height: z.number().int().nonnegative(),
  /** Container rotation in degrees (0, 90, 180, 270) that decoders must apply. */
  rotation: z.number().int(),
  fps: z.number().nonnegative(),
  hasAudio: z.boolean(),
  /** Key in the on-device media store (OPFS / IndexedDB). */
  storageKey: z.string().max(500),
  license: LicenseSchema,
  createdAt: z.number().int(),
});
export type Asset = z.infer<typeof AssetSchema>;

const ClipBase = {
  id: IdSchema,
  startUs: MicrosSchema,
  durationUs: MicrosSchema,
};

export const MediaClipSchema = z.object({
  ...ClipBase,
  kind: z.enum(["video", "image", "audio"]),
  assetId: IdSchema,
  /** Where the clip starts reading in the source, in source time. */
  sourceInUs: MicrosSchema,
  /** Playback rate. Timeline duration = source duration / speed. */
  speed: z.number().min(0.1).max(100),
  /** Linear gain, 0..2. */
  volume: z.number().min(0).max(2),
  muted: z.boolean(),
  transform: TransformSchema,
  effects: z.array(EffectInstanceSchema).max(32),
  /** Transition from the previous clip on the main track into this one. */
  transitionIn: TransitionSchema.nullable(),
  fadeInUs: MicrosSchema,
  fadeOutUs: MicrosSchema,
});
export type MediaClip = z.infer<typeof MediaClipSchema>;

export const TextAnimationSchema = z.enum([
  "none",
  "fade",
  "pop",
  "slide-up",
  "slide-down",
  "slide-left",
  "slide-right",
  "zoom",
  "typewriter",
  "blur",
]);
export type TextAnimation = z.infer<typeof TextAnimationSchema>;

export const TextStyleSchema = z.object({
  fontFamily: z.string().max(200),
  /** Font size as a fraction of canvas height. */
  fontSize: z.number().min(0.005).max(1),
  fontWeight: z.number().int().min(100).max(900),
  italic: z.boolean(),
  color: z.string().max(32),
  align: z.enum(["left", "center", "right"]),
  strokeColor: z.string().max(32),
  /** Stroke width as a fraction of font size. */
  strokeWidth: z.number().min(0).max(0.5),
  backgroundColor: z.string().max(32),
  /** 0 = no background box. */
  backgroundOpacity: z.number().min(0).max(1),
  shadow: z.boolean(),
  lineHeight: z.number().min(0.5).max(3),
  letterSpacing: z.number().min(-0.5).max(2),
});
export type TextStyle = z.infer<typeof TextStyleSchema>;

export const TextClipSchema = z.object({
  ...ClipBase,
  kind: z.literal("text"),
  text: z.string().max(5000),
  style: TextStyleSchema,
  transform: TransformSchema,
  animationIn: TextAnimationSchema,
  animationOut: TextAnimationSchema,
  animationDurationUs: MicrosSchema,
  effects: z.array(EffectInstanceSchema).max(32),
});
export type TextClip = z.infer<typeof TextClipSchema>;

export const ClipSchema = z.discriminatedUnion("kind", [
  MediaClipSchema.extend({ kind: z.literal("video") }),
  MediaClipSchema.extend({ kind: z.literal("image") }),
  MediaClipSchema.extend({ kind: z.literal("audio") }),
  TextClipSchema,
]);
export type Clip = MediaClip | TextClip;

export const TrackTypeSchema = z.enum(["main", "video", "text", "audio"]);
export type TrackType = z.infer<typeof TrackTypeSchema>;

export const TrackSchema = z.object({
  id: IdSchema,
  type: TrackTypeSchema,
  name: z.string().max(200),
  muted: z.boolean(),
  hidden: z.boolean(),
  locked: z.boolean(),
  clips: z.array(ClipSchema),
});
export type Track = Omit<z.infer<typeof TrackSchema>, "clips"> & { clips: Clip[] };

export const BackgroundSchema = z.object({
  kind: z.enum(["color"]),
  color: z.string().max(32),
});
export type Background = z.infer<typeof BackgroundSchema>;

export const SequenceSchema = z.object({
  id: IdSchema,
  name: z.string().max(200),
  width: z.number().int().min(16).max(7680),
  height: z.number().int().min(16).max(7680),
  fps: z.number().min(1).max(120),
  background: BackgroundSchema,
  /** Drawn bottom to top. Exactly one track has type "main". */
  tracks: z.array(TrackSchema),
});
export type Sequence = Omit<z.infer<typeof SequenceSchema>, "tracks"> & { tracks: Track[] };

export const ProjectSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  id: IdSchema,
  name: z.string().max(200),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
  assets: z.array(AssetSchema),
  sequences: z.array(SequenceSchema).min(1),
  activeSequenceId: IdSchema,
});
export type Project = Omit<z.infer<typeof ProjectSchema>, "sequences"> & { sequences: Sequence[] };

export function isMediaClip(clip: Clip): clip is MediaClip {
  return clip.kind !== "text";
}

export function isTextClip(clip: Clip): clip is TextClip {
  return clip.kind === "text";
}

/** Parse untrusted JSON (e.g. from storage) into a project, throwing on invalid data. */
export function parseProject(data: unknown): Project {
  return ProjectSchema.parse(data) as Project;
}
