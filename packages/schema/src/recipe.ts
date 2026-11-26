import { z } from "zod";

/**
 * A recipe is a high-level edit plan (made by the Claude / ChatGPT connector).
 * The browser turns it into a normal project with the real editor code, then
 * renders it. Keeping the plan high level means the server never decodes or
 * renders media, so it can run on free hosting.
 */

export const RecipeMediaSchema = z.object({
  id: z.string().min(1).max(64),
  url: z.string().url().max(4000),
  kind: z.enum(["video", "image", "audio"]),
  name: z.string().max(300).default("media"),
  /** Known length in seconds (probed on upload when possible). */
  durationSec: z.number().min(0).max(36000).nullable().default(null),
  license: z
    .object({ name: z.string().max(200).optional(), author: z.string().max(300).optional(), licenseName: z.string().max(100).optional(), sourceUrl: z.string().max(2000).optional() })
    .nullable()
    .default(null),
});
export type RecipeMedia = z.infer<typeof RecipeMediaSchema>;

const Sec = z.number().min(0).max(36000);

export const RecipeOpSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("clip"),
    mediaId: z.string().min(1).max(64),
    /** Start inside the source, seconds. */
    trimStartSec: Sec.default(0),
    /** Length to use; null = until the end of the source. */
    durationSec: Sec.nullable().default(null),
    speed: z.number().min(0.1).max(10).default(1),
    volume: z.number().min(0).max(2).default(1),
    /** Transition into this clip from the previous one. */
    transition: z.string().max(60).nullable().default(null),
    transitionSec: z.number().min(0.1).max(3).default(0.5),
  }),
  z.object({
    op: z.literal("text"),
    text: z.string().min(1).max(500),
    startSec: Sec,
    durationSec: z.number().min(0.2).max(600).default(3),
    position: z.enum(["top", "center", "bottom"]).default("center"),
    style: z.enum(["title", "subtitle", "bold", "neon", "minimal"]).default("bold"),
  }),
  z.object({
    op: z.literal("captions"),
    /** auto = speech recognition in the browser; manual = the given segments. */
    mode: z.enum(["auto", "manual"]),
    language: z.string().max(20).default("auto"),
    segments: z.array(z.object({ startSec: Sec, endSec: Sec, text: z.string().min(1).max(500) })).max(1000).default([]),
    style: z.enum(["karaoke", "bold", "minimal"]).default("karaoke"),
  }),
  z.object({
    op: z.literal("music"),
    /** A built-in mood (upbeat, cinematic, lofi, suspense, theme) or an audio media id. */
    mood: z.string().max(40).nullable().default(null),
    mediaId: z.string().max(64).nullable().default(null),
    volume: z.number().min(0).max(2).default(0.6),
    /** Lower the music while people talk. */
    duck: z.boolean().default(true),
  }),
  z.object({ op: z.literal("sfx"), id: z.string().min(1).max(60), atSec: Sec }),
  z.object({ op: z.literal("effect"), clipIndex: z.number().int().min(0).max(999), type: z.string().min(1).max(60) }),
  /** Face tracking on a main-track clip: follow (zoom + move with the face), blur / mosaic the face, or stick an emoji or short text to it. */
  z.object({
    op: z.literal("face"),
    clipIndex: z.number().int().min(0).max(999),
    mode: z.enum(["follow", "blur", "mosaic", "stick"]),
    zoom: z.number().min(0.5).max(3).default(1),
    sticker: z.string().min(1).max(40).default("😎"),
  }),
  z.object({ op: z.literal("voice"), clipIndex: z.number().int().min(-1).max(999).default(-1) }),
  z.object({
    op: z.literal("motion"),
    template: z.string().min(1).max(60),
    atSec: Sec,
    /** Quick-edit fields by label (e.g. { "Name": "Aman" }). */
    fields: z.record(z.string().max(100), z.string().max(500)).default({}),
  }),
  /** Trim clips evenly so the video lasts exactly this long. */
  z.object({ op: z.literal("fit"), seconds: z.number().min(1).max(3600) }),
  /** A reel style: look, transitions, overlays, music and captions in one go. */
  z.object({ op: z.literal("style"), style: z.string().min(1).max(60), fields: z.record(z.string().max(60), z.string().max(500)).default({}), music: z.boolean().default(true) }),
]);
export type RecipeOp = z.infer<typeof RecipeOpSchema>;

export const RecipeSchema = z.object({
  version: z.literal(1).default(1),
  id: z.string().min(1).max(64),
  name: z.string().max(200).default("Video"),
  aspect: z.enum(["9:16", "16:9", "1:1", "4:5"]).default("9:16"),
  media: z.array(RecipeMediaSchema).max(200).default([]),
  ops: z.array(RecipeOpSchema).max(2000).default([]),
  createdAt: z.number().int().default(0),
  updatedAt: z.number().int().default(0),
});
export type Recipe = z.infer<typeof RecipeSchema>;

export const RenderJobSchema = z.object({
  id: z.string().min(1).max(64),
  recipeId: z.string().min(1).max(64),
  status: z.enum(["waiting", "rendering", "done", "failed"]),
  /** Secret that lets the render page report the result. */
  token: z.string().min(16).max(128),
  resolution: z.enum(["720p", "1080p"]).default("1080p"),
  outputUrl: z.string().max(4000).nullable().default(null),
  error: z.string().max(2000).nullable().default(null),
  /** Delete the project's source clips from online storage once the MP4 is saved. */
  deleteMedia: z.boolean().default(true),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});
export type RenderJob = z.infer<typeof RenderJobSchema>;

/** Seconds of the main track a recipe will produce (when clip lengths are known). */
export function recipeDurationSec(r: Recipe): number | null {
  let total = 0;
  let fit: number | null = null;
  for (const op of r.ops) {
    if (op.op === "fit") fit = op.seconds;
    if (op.op !== "clip") continue;
    const m = r.media.find((x) => x.id === op.mediaId);
    const len = op.durationSec ?? (m?.durationSec != null ? Math.max(0, m.durationSec - op.trimStartSec) : m?.kind === "image" ? 3 : null);
    if (len == null) return fit;
    total += len / op.speed;
  }
  return fit ?? total;
}
