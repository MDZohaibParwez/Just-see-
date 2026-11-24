/**
 * The Just See connector (MCP). Claude, ChatGPT or any MCP client builds a
 * video "recipe" with these tools; the video is assembled and rendered in a
 * browser when someone opens the render link, so the server stays free.
 */
import { randomBytes } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { RecipeOpSchema, RecipeSchema, recipeDurationSec, type Recipe, type RecipeOp, type RenderJob } from "@just-see/schema";
import { SFX } from "../../../packages/engine/src/audio/sfx";
import { MOODS } from "../../../packages/engine/src/audio/moods";
import { TEMPLATES } from "../../../packages/engine/src/motion/templates";
import { TRANSITIONS } from "../../../packages/engine/src/transitions/catalog";
import { EFFECTS } from "../../../packages/engine/src/effects/catalog";
import { REEL_STYLES, REEL_STYLE_BY_ID, styleGuide } from "../../../packages/engine/src/styles/reel-styles";
import { probe } from "./probe";
import type { Store } from "./store";

export interface Ctx {
  store: Store;
  /** Public web app, e.g. https://just-see-one.vercel.app */
  webBase: string;
  /** This API, e.g. https://just-see-api.vercel.app */
  apiBase: string;
}

export const newId = (n = 10) => randomBytes(n).toString("base64url").replace(/[-_]/g, "").slice(0, n).toLowerCase() || "x";

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });
const fail = (t: string) => ({ content: [{ type: "text" as const, text: t }], isError: true });

export async function loadRecipe(store: Store, id: string): Promise<Recipe | null> {
  if (!/^[a-z0-9]{4,40}$/.test(id)) return null;
  const r = await store.getJson<unknown>(`recipes/${id}.json`);
  return r ? RecipeSchema.parse(r) : null;
}

export async function saveRecipe(store: Store, r: Recipe): Promise<void> {
  r.updatedAt = Date.now();
  await store.putJson(`recipes/${r.id}.json`, RecipeSchema.parse(r));
}

export function links(ctx: Ctx, recipeId: string) {
  const api = encodeURIComponent(ctx.apiBase);
  return {
    upload: `${ctx.webBase}/upload/?recipe=${recipeId}&api=${api}`,
    editor: `${ctx.webBase}/open/?recipe=${recipeId}&api=${api}`,
  };
}

function describe(r: Recipe): string {
  const lines = [`Video "${r.name}" (${r.aspect}), id ${r.id}`];
  const d = recipeDurationSec(r);
  lines.push(`Estimated length: ${d == null ? "unknown (some clip lengths unknown)" : `${d.toFixed(1)} s`}`);
  lines.push(`Media (${r.media.length}):`);
  for (const m of r.media) lines.push(`  - ${m.id}: ${m.kind} "${m.name}"${m.durationSec != null ? `, ${m.durationSec.toFixed(1)} s` : ""}`);
  lines.push(`Steps (${r.ops.length}):`);
  r.ops.forEach((o, i) => lines.push(`  ${i}. ${JSON.stringify(o)}`));
  return lines.join("\n");
}

const MAX_BYTES = 300 * 1024 * 1024;

/**
 * Share links from cloud drives point at a web page, not the file. Turn them
 * into direct download links. Google Drive: `confirm=t` skips the "can't scan
 * for viruses" page that big files (over ~100 MB) show.
 */
export function directDownloadUrl(url: string): { url: string; source: "google-drive" | "dropbox" | "onedrive" | "link" } {
  const u = new URL(url);
  const host = u.hostname.toLowerCase();
  if (host === "drive.google.com" || host === "docs.google.com" || host === "drive.usercontent.google.com") {
    const id = /\/file\/d\/([\w-]{10,})/.exec(u.pathname)?.[1] ?? u.searchParams.get("id");
    if (!id || !/^[\w-]{10,200}$/.test(id)) throw new Error("This Google Drive link has no file id. Use the file's Share link.");
    return { url: `https://drive.usercontent.google.com/download?id=${id}&export=download&confirm=t`, source: "google-drive" };
  }
  if (host === "www.dropbox.com" || host === "dropbox.com") {
    u.searchParams.delete("dl");
    u.searchParams.set("raw", "1");
    return { url: u.toString(), source: "dropbox" };
  }
  if (host === "1drv.ms" || host.endsWith("onedrive.live.com") || host.endsWith("sharepoint.com")) {
    if (!u.searchParams.has("download")) u.searchParams.set("download", "1");
    return { url: u.toString(), source: "onedrive" };
  }
  return { url, source: "link" };
}

function nameFromHeaders(res: Response, fallback: string): string {
  const cd = res.headers.get("content-disposition") ?? "";
  const star = /filename\*=UTF-8''([^;]+)/i.exec(cd)?.[1];
  const plain = /filename="?([^";]+)"?/i.exec(cd)?.[1];
  const raw = star ? decodeURIComponent(star) : plain;
  return (raw ?? fallback).replace(/[\\/\r\n]/g, "_").slice(0, 300) || fallback;
}

export async function fetchMedia(url: string): Promise<{ bytes: Uint8Array; type: string; name: string }> {
  const first = new URL(url);
  if (!/^https?:$/.test(first.protocol)) throw new Error("Only http(s) links are supported");
  const direct = directDownloadUrl(url);
  const u = new URL(direct.url);
  const res = await fetch(u, { redirect: "follow" });
  if (!res.ok || !res.body) {
    if (direct.source === "google-drive" && (res.status === 403 || res.status === 404)) throw new Error("Google Drive did not share the file. In Drive: Share → General access → \"Anyone with the link\", then try again.");
    throw new Error(`Could not download (${res.status})`);
  }
  // A web page instead of the file: the link is private or needs a sign-in.
  if (/text\/html/i.test(res.headers.get("content-type") ?? "")) {
    await res.body.cancel().catch(() => undefined);
    throw new Error(direct.source === "google-drive" ? "Google Drive asked for a sign-in. In Drive: Share → General access → \"Anyone with the link\", then try again." : "The link opens a web page, not a file. Use a direct download link.");
  }
  const len = Number(res.headers.get("content-length") ?? 0);
  if (len > MAX_BYTES) throw new Error("File is larger than 300 MB");
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_BYTES) throw new Error("File is larger than 300 MB");
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    bytes.set(c, o);
    o += c.length;
  }
  const fallback = direct.source === "link" ? decodeURIComponent(u.pathname.split("/").pop() || "media") : "media";
  return { bytes, type: res.headers.get("content-type") ?? "", name: nameFromHeaders(res, fallback) };
}

/** Add a downloaded or uploaded file to a recipe (shared by the MCP tool and the upload page). */
export async function addMediaBytes(ctx: Ctx, r: Recipe, bytes: Uint8Array, contentType: string, name: string, kindHint?: string): Promise<Recipe["media"][number]> {
  const p = await probe(bytes, contentType, name);
  const kind = (kindHint as "video" | "image" | "audio" | undefined) ?? p.kind;
  if (!kind) throw new Error("Unknown file type: use a video, image or audio file");
  const id = `m${r.media.length + 1}${newId(4)}`;
  const ext = (name.match(/\.([a-z0-9]{2,5})$/i)?.[1] ?? (kind === "video" ? "mp4" : kind === "image" ? "png" : "mp3")).toLowerCase();
  const url = await ctx.store.putBytes(`media/${r.id}/${id}.${ext}`, bytes, contentType || (kind === "video" ? "video/mp4" : kind === "image" ? `image/${ext === "jpg" ? "jpeg" : ext}` : "audio/mpeg"));
  const m = { id, url, kind, name: name.slice(0, 300), durationSec: p.durationSec, license: null };
  r.media.push(m);
  return m;
}

async function withRecipe(ctx: Ctx, id: string, fn: (r: Recipe) => Promise<string> | string) {
  const r = await loadRecipe(ctx.store, id);
  if (!r) return fail(`No video with id "${id}". Create one with create_video first.`);
  try {
    const msg = await fn(r);
    await saveRecipe(ctx.store, r);
    return text(msg);
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
}

function addOp(ctx: Ctx, id: string, op: unknown) {
  return withRecipe(ctx, id, (r) => {
    const parsed: RecipeOp = RecipeOpSchema.parse(op);
    if ((parsed.op === "clip" || (parsed.op === "music" && parsed.mediaId)) && !r.media.some((m) => m.id === (parsed.op === "clip" ? parsed.mediaId : parsed.mediaId))) {
      throw new Error(`Unknown media id. Known: ${r.media.map((m) => m.id).join(", ") || "none (add_media first)"}`);
    }
    r.ops.push(parsed);
    const d = recipeDurationSec(r);
    return `Added step ${r.ops.length - 1}: ${parsed.op}.${d != null ? ` Estimated length now ${d.toFixed(1)} s.` : ""}`;
  });
}

export function buildMcpServer(ctx: Ctx): McpServer {
  const server = new McpServer(
    { name: "just-see", version: "0.6.0" },
    {
      instructions:
        "Just See edits videos. Clips can come from Google Drive: ask the user for the file's Share link (General access: Anyone with the link) and pass it to add_media; files up to 300 MB work. Source clips are deleted from Just See's storage after the render is saved. For popular Reels formats (anime dialogue, POV story with notification, aesthetic detail, hook + lyric montage, quote reveal, talking head + captions + CTA, scenic lyric montage, dream card, minimal lyric card) call list_styles / get_style_guide and apply_style after adding clips. Typical flow: create_video → add_media (public links) or give the user get_upload_link to add phone clips → list_media to see lengths → add_clip for each clip in order (with trims) → add_captions / add_text / add_music / add_sound_effect / add_motion_template → fit_duration if needed → render_video. Give the user the render link: opening it renders the video in their browser and saves it; then get_render returns the MP4 download link. Use list_options to see sound effects, moods, transitions, effects and templates.",
    },
  );

  server.registerTool(
    "create_video",
    {
      title: "Create a video",
      description: "Start a new video project. Returns its id plus links to upload media and to open it in the editor.",
      inputSchema: { name: z.string().max(200).default("Video"), aspect: z.enum(["9:16", "16:9", "1:1", "4:5"]).default("9:16").describe("9:16 for Reels/Shorts, 16:9 for YouTube") },
    },
    async ({ name, aspect }) => {
      const r: Recipe = RecipeSchema.parse({ id: newId(), name, aspect, createdAt: Date.now() });
      await saveRecipe(ctx.store, r);
      const l = links(ctx, r.id);
      return text(`Created video ${r.id}.\nUpload clips from a phone: ${l.upload}\nOpen in the editor: ${l.editor}`);
    },
  );

  server.registerTool(
    "add_media",
    {
      title: "Add media from a link",
      description: "Add a video, image or audio file to the project from a link: Google Drive share links (\"Anyone with the link\"), Dropbox, OneDrive or any direct http(s) link. Up to 300 MB. Returns a media id and its length.",
      inputSchema: { video_id: z.string(), url: z.string().url(), name: z.string().max(300).optional(), kind: z.enum(["video", "image", "audio"]).optional() },
    },
    async ({ video_id, url, name, kind }) =>
      withRecipe(ctx, video_id, async (r) => {
        const f = await fetchMedia(url);
        const m = await addMediaBytes(ctx, r, f.bytes, f.type, name ?? f.name, kind);
        return `Added ${m.kind} ${m.id} "${m.name}"${m.durationSec != null ? ` (${m.durationSec.toFixed(1)} s)` : ""}.`;
      }),
  );

  server.registerTool(
    "get_upload_link",
    { title: "Upload link", description: "A page where the user can add clips from their phone or computer to this video.", inputSchema: { video_id: z.string() } },
    async ({ video_id }) => {
      const r = await loadRecipe(ctx.store, video_id);
      if (!r) return fail("Unknown video id");
      return text(`Ask the user to open this link and add their clips, then call list_media:\n${links(ctx, r.id).upload}`);
    },
  );

  server.registerTool("list_media", { title: "List media", description: "Media in the project with ids, types and lengths.", inputSchema: { video_id: z.string() } }, async ({ video_id }) => {
    const r = await loadRecipe(ctx.store, video_id);
    if (!r) return fail("Unknown video id");
    if (!r.media.length) return text("No media yet. Use add_media or get_upload_link.");
    return text(r.media.map((m) => `${m.id}: ${m.kind} "${m.name}"${m.durationSec != null ? `, ${m.durationSec.toFixed(2)} s` : ""}`).join("\n"));
  });

  server.registerTool(
    "add_clip",
    {
      title: "Add a clip",
      description: "Put media on the main timeline, after the previous clip. Trim with trim_start_sec and duration_sec. Optional transition from the previous clip (see list_options).",
      inputSchema: {
        video_id: z.string(),
        media_id: z.string(),
        trim_start_sec: z.number().min(0).default(0),
        duration_sec: z.number().min(0.1).optional(),
        speed: z.number().min(0.1).max(10).default(1),
        volume: z.number().min(0).max(2).default(1),
        transition: z.string().optional(),
      },
    },
    async (a) => addOp(ctx, a.video_id, { op: "clip", mediaId: a.media_id, trimStartSec: a.trim_start_sec, durationSec: a.duration_sec ?? null, speed: a.speed, volume: a.volume, transition: a.transition ?? null }),
  );

  server.registerTool(
    "add_text",
    {
      title: "Add text",
      description: "Show text on top of the video.",
      inputSchema: { video_id: z.string(), text: z.string().min(1).max(500), start_sec: z.number().min(0), duration_sec: z.number().min(0.2).default(3), position: z.enum(["top", "center", "bottom"]).default("center"), style: z.enum(["title", "subtitle", "bold", "neon", "minimal"]).default("bold") },
    },
    async (a) => addOp(ctx, a.video_id, { op: "text", text: a.text, startSec: a.start_sec, durationSec: a.duration_sec, position: a.position, style: a.style }),
  );

  server.registerTool(
    "add_captions",
    {
      title: "Add captions",
      description: "Captions for speech. mode 'auto' transcribes the audio in the browser while rendering (Hindi, English, Hinglish, Urdu). mode 'manual' uses your own timed segments.",
      inputSchema: {
        video_id: z.string(),
        mode: z.enum(["auto", "manual"]).default("auto"),
        language: z.string().default("auto"),
        segments: z.array(z.object({ start_sec: z.number().min(0), end_sec: z.number().min(0), text: z.string().min(1) })).default([]),
        style: z.enum(["karaoke", "bold", "minimal"]).default("karaoke"),
      },
    },
    async (a) => addOp(ctx, a.video_id, { op: "captions", mode: a.mode, language: a.language, segments: a.segments.map((s) => ({ startSec: s.start_sec, endSec: s.end_sec, text: s.text })), style: a.style }),
  );

  server.registerTool(
    "add_music",
    {
      title: "Add background music",
      description: "Background music for the whole video: a built-in mood (made by Just See, free to use) or an audio media id. Music is lowered under speech when duck is true.",
      inputSchema: { video_id: z.string(), mood: z.string().optional(), media_id: z.string().optional(), volume: z.number().min(0).max(2).default(0.6), duck: z.boolean().default(true) },
    },
    async (a) => {
      if (!a.mood && !a.media_id) return fail("Give a mood or a media_id");
      if (a.mood && !MOODS.some((m) => m.id === a.mood)) return fail(`Unknown mood. Moods: ${MOODS.map((m) => m.id).join(", ")}`);
      return addOp(ctx, a.video_id, { op: "music", mood: a.mood ?? null, mediaId: a.media_id ?? null, volume: a.volume, duck: a.duck });
    },
  );

  server.registerTool(
    "add_sound_effect",
    { title: "Add a sound effect", description: "Place a built-in sound effect (whoosh, boom, pop, ding …) at a time. See list_options.", inputSchema: { video_id: z.string(), id: z.string(), at_sec: z.number().min(0) } },
    async (a) => (SFX.some((s) => s.id === a.id) ? addOp(ctx, a.video_id, { op: "sfx", id: a.id, atSec: a.at_sec }) : fail(`Unknown sound. Try one of: ${SFX.slice(0, 40).map((s) => s.id).join(", ")} …`)),
  );

  server.registerTool(
    "add_effect",
    { title: "Add an effect or look", description: "Apply a visual effect or colour look to a clip (clip_index 0 = first clip). See list_options.", inputSchema: { video_id: z.string(), clip_index: z.number().int().min(0), type: z.string() } },
    async (a) => (EFFECTS.some((e) => e.type === a.type) ? addOp(ctx, a.video_id, { op: "effect", clipIndex: a.clip_index, type: a.type }) : fail("Unknown effect. Call list_options.")),
  );

  server.registerTool(
    "enhance_voice",
    { title: "Studio voice", description: "Clean up speech (noise, hum, level to -14 LUFS) on one clip or all (clip_index -1).", inputSchema: { video_id: z.string(), clip_index: z.number().int().min(-1).default(-1) } },
    async (a) => addOp(ctx, a.video_id, { op: "voice", clipIndex: a.clip_index }),
  );

  server.registerTool(
    "add_motion_template",
    {
      title: "Add an animated template",
      description: "Lower third, logo reveal, title, subscribe button or callout. fields fills the template's text by label (see list_options).",
      inputSchema: { video_id: z.string(), template: z.string(), at_sec: z.number().min(0).default(0), fields: z.record(z.string(), z.string()).default({}) },
    },
    async (a) => (TEMPLATES.some((t) => t.id === a.template) ? addOp(ctx, a.video_id, { op: "motion", template: a.template, atSec: a.at_sec, fields: a.fields }) : fail("Unknown template. Call list_options.")),
  );

  server.registerTool(
    "fit_duration",
    { title: "Fit to a length", description: "Trim clips evenly so the final video lasts exactly this many seconds (e.g. 30 for a reel).", inputSchema: { video_id: z.string(), seconds: z.number().min(1).max(3600) } },
    async (a) => addOp(ctx, a.video_id, { op: "fit", seconds: a.seconds }),
  );

  server.registerTool("remove_step", { title: "Remove a step", description: "Remove a step by its number (see get_video).", inputSchema: { video_id: z.string(), step: z.number().int().min(0) } }, async (a) =>
    withRecipe(ctx, a.video_id, (r) => {
      if (a.step >= r.ops.length) throw new Error("No such step");
      const [gone] = r.ops.splice(a.step, 1);
      return `Removed step ${a.step} (${gone?.op}).`;
    }),
  );

  server.registerTool("get_video", { title: "Show the plan", description: "The project's media, steps and estimated length.", inputSchema: { video_id: z.string() } }, async ({ video_id }) => {
    const r = await loadRecipe(ctx.store, video_id);
    return r ? text(describe(r)) : fail("Unknown video id");
  });

  server.registerTool("list_options", { title: "List options", description: "Sound effects, music moods, transitions, effects and templates you can use.", inputSchema: {} }, async () => {
    const tpl = TEMPLATES.map((t) => {
      const c = t.build((p) => `${p}x`, { width: 1080, height: 1920 });
      return `${t.id} (fields: ${c.editable.filter((e) => e.field === "text").map((e) => e.label).join(", ") || "none"})`;
    });
    return text(
      [
        `Moods: ${MOODS.map((m) => `${m.id} (${m.hint})`).join("; ")}`,
        `Sound effects: ${SFX.map((s) => s.id).join(", ")}`,
        `Transitions: ${TRANSITIONS.map((t) => t.type).join(", ")}`,
        `Effects/looks: ${EFFECTS.filter((e) => !("lut" in e && e.lut)).map((e) => e.type).join(", ")}`,
        `Templates: ${tpl.join("; ")}`,
      ].join("\n"),
    );
  });

  server.registerTool("list_styles", { title: "Reel styles", description: "Ready-made Reels formats with their look, structure and fields.", inputSchema: {} }, async () =>
    text(REEL_STYLES.map((s) => `${s.id}: ${s.label} — ${s.format}. Fields: ${s.fields.map((f) => f.key).join(", ")}`).join("\n")),
  );

  server.registerTool(
    "get_style_guide",
    { title: "How a reel style works", description: "The hook, structure, shooting tips, text, sound, colour and pacing of a reel style. Use it to plan clips, trims and text before apply_style.", inputSchema: { style: z.string() } },
    async ({ style }) => {
      const s = REEL_STYLE_BY_ID.get(style);
      return s ? text(styleGuide(s)) : fail(`Unknown style. Styles: ${REEL_STYLES.map((x) => x.id).join(", ")}`);
    },
  );

  server.registerTool(
    "apply_style",
    {
      title: "Apply a reel style",
      description: "Give the video a ready-made Reels look: colour grade, transitions, slow motion or Ken Burns, overlays (header, notification, dialogue, lyric card, end card), and music/captions when the style uses them. Add clips first. fields fills the style's text (see list_styles).",
      inputSchema: { video_id: z.string(), style: z.string(), fields: z.record(z.string(), z.string()).default({}), music: z.boolean().default(true) },
    },
    async (a) => (REEL_STYLE_BY_ID.has(a.style) ? addOp(ctx, a.video_id, { op: "style", style: a.style, fields: a.fields, music: a.music }) : fail(`Unknown style. Styles: ${REEL_STYLES.map((x) => x.id).join(", ")}`)),
  );

  server.registerTool(
    "render_video",
    {
      title: "Render the video",
      description: "Create a render job. Returns a link: opening it on any phone or computer builds and renders the MP4 in that browser and uploads it. Then call get_render for the download link.",
      inputSchema: {
        video_id: z.string(),
        resolution: z.enum(["720p", "1080p"]).default("1080p"),
        keep_media: z.boolean().default(false).describe("Keep the source clips online after the MP4 is saved (default: delete them to save space)"),
      },
    },
    async ({ video_id, resolution, keep_media }) => {
      const r = await loadRecipe(ctx.store, video_id);
      if (!r) return fail("Unknown video id");
      if (!r.ops.some((o) => o.op === "clip")) return fail("Add at least one clip first.");
      const job: RenderJob = { id: newId(), recipeId: r.id, status: "waiting", token: randomBytes(18).toString("base64url"), resolution, outputUrl: null, error: null, deleteMedia: !keep_media, createdAt: Date.now(), updatedAt: Date.now() };
      await ctx.store.putJson(`jobs/${job.id}.json`, job);
      const link = `${ctx.webBase}/render/?job=${job.id}&key=${job.token}&api=${encodeURIComponent(ctx.apiBase)}`;
      return text(`Render job ${job.id} created.\nOpen this link to render (keep the page open until it finishes):\n${link}\nThen call get_render with job_id ${job.id} to get the MP4 download link.${keep_media ? "" : "\nAfter the MP4 is saved, the source clips are deleted from Just See's online storage (the user's own Drive files are not touched)."}`);
    },
  );

  server.registerTool(
    "delete_video",
    {
      title: "Delete a project",
      description: "Delete a project's clips and plan from Just See's online storage now. Rendered MP4s are kept until they expire (30 days). Does not touch the user's Google Drive.",
      inputSchema: { video_id: z.string() },
    },
    async ({ video_id }) => {
      if (!/^[a-z0-9]{4,40}$/.test(video_id)) return fail("Bad video id");
      const r = await loadRecipe(ctx.store, video_id);
      if (!r) return fail("Unknown video id");
      const n = await ctx.store.deletePrefix(`media/${video_id}/`);
      await ctx.store.deletePrefix(`recipes/${video_id}.json`);
      return text(`Deleted project ${video_id} (${n} clip${n === 1 ? "" : "s"}).`);
    },
  );

  server.registerTool("get_render", { title: "Render status", description: "Status of a render job and the MP4 download link when done.", inputSchema: { job_id: z.string() } }, async ({ job_id }) => {
    if (!/^[a-z0-9]{4,40}$/.test(job_id)) return fail("Bad job id");
    const job = await ctx.store.getJson<RenderJob>(`jobs/${job_id}.json`);
    if (!job) return fail("Unknown job id");
    if (job.status === "done" && job.outputUrl) return text(`Done. Download: ${job.outputUrl}${job.deleteMedia ? "\nThe source clips were deleted from Just See's storage, so this project can no longer be reopened in the editor. The MP4 link works for 30 days." : ""}`);
    if (job.status === "failed") return fail(`Render failed: ${job.error ?? "unknown error"}`);
    return text(job.status === "rendering" ? "Rendering now in the browser…" : "Waiting: the render link has not been opened yet.");
  });

  return server;
}
