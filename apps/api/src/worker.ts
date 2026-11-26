/**
 * Cloud worker queue. A GitHub Actions job (free for this public repo) asks
 * for work every few minutes, so videos are rendered and clips are listened
 * to / looked at even when every device of the owner is off.
 *
 * - Render jobs: the worker opens the render link in headless Chromium.
 * - Analysis jobs: the worker turns a clip's speech into text with times and
 *   takes a few frames, so Claude can "hear" and "see" it.
 *
 * The worker proves itself with WORKER_KEY (falls back to MCP_KEY).
 */
import type { RenderJob } from "@just-see/schema";
import type { Store } from "./store";

export interface AnalysisJob {
  recipeId: string;
  mediaId: string;
  url: string;
  name: string;
  kind: "video" | "audio";
  status: "waiting" | "working" | "done" | "failed";
  claimedAt: number;
  createdAt: number;
  error?: string;
}

export interface TranscriptSegment {
  /** Seconds from the clip start. */
  start: number;
  end: number;
  text: string;
}

export interface Analysis {
  recipeId: string;
  mediaId: string;
  language: string | null;
  transcript: TranscriptSegment[];
  /** Frame times (s) and their stored paths. */
  frames: { t: number; path: string }[];
  /** Seconds of the clip that were listened to (long clips are cut short). */
  listenedSec: number;
  durationSec: number | null;
  createdAt: number;
}

/** A job claimed this long ago without finishing is offered again. */
const RETRY_MS = 25 * 60 * 1000;

export const analysisJobPath = (rid: string, mid: string) => `analysis/${rid}/${mid}/job.json`;
export const analysisPath = (rid: string, mid: string) => `analysis/${rid}/${mid}/result.json`;

export function workerKey(): string | undefined {
  return process.env.WORKER_KEY || process.env.MCP_KEY || undefined;
}

/** Ask the worker to listen to and look at a clip. */
export async function queueAnalysis(store: Store, job: Omit<AnalysisJob, "status" | "claimedAt" | "createdAt">): Promise<void> {
  if (job.kind !== "video" && job.kind !== "audio") return;
  await store.putJson(analysisJobPath(job.recipeId, job.mediaId), { ...job, status: "waiting", claimedAt: 0, createdAt: Date.now() } satisfies AnalysisJob);
}

async function openAnalysisJobs(store: Store): Promise<{ path: string; job: AnalysisJob }[]> {
  const paths = (await store.list("analysis/").catch(() => [] as string[])).filter((p) => p.endsWith("/job.json"));
  const out: { path: string; job: AnalysisJob }[] = [];
  for (const p of paths) {
    const job = await store.getJson<AnalysisJob>(p);
    if (!job) continue;
    if (job.status === "waiting" || (job.status === "working" && Date.now() - job.claimedAt > RETRY_MS)) out.push({ path: p, job });
  }
  return out.sort((a, b) => a.job.createdAt - b.job.createdAt);
}

async function openRenderJobs(store: Store): Promise<RenderJob[]> {
  const paths = (await store.list("jobs/").catch(() => [] as string[])).filter((p) => p.endsWith(".json"));
  const out: RenderJob[] = [];
  for (const p of paths) {
    const job = await store.getJson<RenderJob & { workerClaimedAt?: number }>(p);
    if (!job) continue;
    const claimed = job.workerClaimedAt ?? 0;
    const stale = Date.now() - Math.max(job.updatedAt, claimed) > RETRY_MS;
    if (job.status === "waiting" && Date.now() - claimed > RETRY_MS) out.push(job);
    else if (job.status === "rendering" && stale) out.push(job);
  }
  return out.sort((a, b) => a.createdAt - b.createdAt);
}

/** How much work is waiting (cheap check so idle worker runs end at once). */
export async function peek(store: Store): Promise<{ analysis: number; render: number }> {
  return { analysis: (await openAnalysisJobs(store)).length, render: (await openRenderJobs(store)).length };
}

export type WorkItem =
  | { kind: "none" }
  | { kind: "analyze"; recipeId: string; mediaId: string; url: string; mediaKind: "video" | "audio" }
  | { kind: "render"; jobId: string; link: string };

/**
 * Hand out the next job and mark it claimed. Analysis first: clips are
 * deleted once a render has loaded them (personal mode).
 */
export async function nextWork(store: Store, webBase: string, apiBase: string): Promise<WorkItem> {
  const [a] = await openAnalysisJobs(store);
  if (a) {
    await store.putJson(a.path, { ...a.job, status: "working", claimedAt: Date.now() } satisfies AnalysisJob);
    return { kind: "analyze", recipeId: a.job.recipeId, mediaId: a.job.mediaId, url: a.job.url, mediaKind: a.job.kind };
  }
  const [r] = await openRenderJobs(store);
  if (r) {
    await store.putJson(`jobs/${r.id}.json`, { ...r, workerClaimedAt: Date.now() });
    const link = `${webBase}/render/?job=${r.id}&key=${r.token}&api=${encodeURIComponent(apiBase)}&worker=1`;
    return { kind: "render", jobId: r.id, link };
  }
  return { kind: "none" };
}

const MAX_FRAMES = 16;
const MAX_FRAME_BYTES = 400 * 1024;

/** Save what the worker heard and saw. Frames arrive as base64 JPEG. */
export async function saveAnalysis(
  store: Store,
  rid: string,
  mid: string,
  body: { language?: string | null; transcript?: TranscriptSegment[]; frames?: { t: number; jpeg: string }[]; listenedSec?: number; durationSec?: number | null; error?: string },
): Promise<Analysis | null> {
  const jobPath = analysisJobPath(rid, mid);
  const job = await store.getJson<AnalysisJob>(jobPath);
  if (!job) throw Object.assign(new Error("No such analysis job"), { status: 404 });
  if (body.error) {
    await store.putJson(jobPath, { ...job, status: "failed", error: String(body.error).slice(0, 500) } satisfies AnalysisJob);
    return null;
  }
  const frames: Analysis["frames"] = [];
  for (const [i, f] of (body.frames ?? []).slice(0, MAX_FRAMES).entries()) {
    const bytes = Buffer.from(String(f.jpeg ?? ""), "base64");
    if (!bytes.length || bytes.length > MAX_FRAME_BYTES || bytes[0] !== 0xff || bytes[1] !== 0xd8) continue;
    const path = `analysis/${rid}/${mid}/f${i}.jpg`;
    await store.putBytes(path, new Uint8Array(bytes), "image/jpeg");
    frames.push({ t: Math.max(0, Number(f.t) || 0), path });
  }
  const transcript = (body.transcript ?? [])
    .slice(0, 5000)
    .map((s) => ({ start: Math.max(0, Number(s.start) || 0), end: Math.max(0, Number(s.end) || 0), text: String(s.text ?? "").slice(0, 500) }))
    .filter((s) => s.text.trim());
  const result: Analysis = {
    recipeId: rid,
    mediaId: mid,
    language: body.language ? String(body.language).slice(0, 20) : null,
    transcript,
    frames,
    listenedSec: Math.max(0, Number(body.listenedSec) || 0),
    durationSec: body.durationSec == null ? null : Number(body.durationSec),
    createdAt: Date.now(),
  };
  await store.putJson(analysisPath(rid, mid), result);
  await store.putJson(jobPath, { ...job, status: "done" } satisfies AnalysisJob);
  return result;
}

export async function analysisState(store: Store, rid: string, mid: string): Promise<{ job: AnalysisJob | null; result: Analysis | null }> {
  return { job: await store.getJson<AnalysisJob>(analysisJobPath(rid, mid)), result: await store.getJson<Analysis>(analysisPath(rid, mid)) };
}

export function fmtTime(s: number): string {
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(1).padStart(4, "0")}`;
}
