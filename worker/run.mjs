// Just See cloud worker (runs on GitHub Actions). Takes jobs from the API until
// none are left or time runs out. Logs only job kinds and counts: this repo is
// public, so nothing about the owner's videos may be printed.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const API = (process.env.JUST_SEE_API ?? "https://just-see-api.vercel.app").replace(/\/+$/, "");
const KEY = process.env.JUST_SEE_WORKER_KEY ?? "";
const STOP_AT = Date.now() + Number(process.env.WORKER_MINUTES ?? 50) * 60_000;
/** Longest stretch of a clip that is listened to. */
const LISTEN_SEC = Number(process.env.LISTEN_SECONDS ?? 1200);
const H = { "x-worker-key": KEY, "content-type": "application/json" };
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
/** Full errors only when debugging locally (logs on GitHub are public). */
const debug = (e) => process.env.WORKER_DEBUG && console.error(e);

if (!KEY) {
  log("JUST_SEE_WORKER_KEY secret is not set; nothing to do.");
  process.exit(0);
}

async function api(method, p, body) {
  // A kept-alive connection can be closed by the server while we work for
  // minutes; try again on a fresh one.
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(`${API}${p}`, { method, headers: { ...H, connection: "close" }, body: body ? JSON.stringify(body) : undefined });
      if (!res.ok) throw Object.assign(new Error(`${method} ${p.split("/").slice(0, 4).join("/")} → ${res.status}`), { final: res.status < 500 });
      return await res.json();
    } catch (e) {
      if (attempt >= 3 || e.final) throw e;
      await new Promise((r) => setTimeout(r, attempt * 2000));
    }
  }
}

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { stdio: ["ignore", "pipe", "pipe"], maxBuffer: 256 * 1024 * 1024, ...opts });
}

async function download(url, file) {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(res.status === 404 ? "the clip was already deleted from online storage" : `download failed (${res.status})`);
  const out = fs.createWriteStream(file);
  for await (const chunk of res.body) out.write(chunk);
  await new Promise((r) => out.end(r));
}

async function analyze(w) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "js-"));
  try {
    const src = path.join(dir, "clip");
    await download(w.url, src);
    let duration = null;
    try {
      duration = Number(run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", src]).toString().trim()) || null;
    } catch {}
    // Hear.
    let transcript = [];
    let language = null;
    let listenedSec = 0;
    const wav = path.join(dir, "a.wav");
    try {
      run("ffmpeg", ["-v", "error", "-y", "-i", src, "-t", String(LISTEN_SEC), "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", wav]);
      const r = JSON.parse(run("python3", ["-I", path.join(import.meta.dirname, "transcribe.py"), wav, String(LISTEN_SEC)]).toString());
      transcript = r.transcript;
      language = r.language;
      listenedSec = r.listenedSec;
    } catch {
      // No audio track: frames only.
    }
    // See: up to 12 frames spread over the clip.
    const frames = [];
    if (w.mediaKind === "video" && duration) {
      const n = Math.min(12, Math.max(3, Math.round(duration / 5)));
      for (let i = 0; i < n; i++) {
        const t = (duration * (i + 0.5)) / n;
        const jpg = path.join(dir, `f${i}.jpg`);
        try {
          run("ffmpeg", ["-v", "error", "-y", "-ss", t.toFixed(2), "-i", src, "-frames:v", "1", "-vf", "scale='min(480,iw)':-2", "-q:v", "6", jpg]);
          frames.push({ t: Math.round(t * 10) / 10, jpeg: fs.readFileSync(jpg).toString("base64") });
        } catch {}
      }
    }
    const r = await api("POST", `/api/worker/analysis/${w.recipeId}/${w.mediaId}`, { language, transcript, frames, listenedSec, durationSec: duration });
    log(`analysis done: ${r.segments} lines, ${r.frames} frames`);
  } catch (e) {
    debug(e);
    await api("POST", `/api/worker/analysis/${w.recipeId}/${w.mediaId}`, { error: e instanceof Error ? e.message : String(e) }).catch(() => {});
    log("analysis failed");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function render(w) {
  // PLAYWRIGHT_MODULE: use a Playwright installed elsewhere (local testing).
  const mod = process.env.PLAYWRIGHT_MODULE ? await import(process.env.PLAYWRIGHT_MODULE) : await import("playwright");
  const chromium = mod.chromium ?? mod.default?.chromium;
  const browser = await chromium.launch();
  try {
    const page = await (await browser.newContext({ viewport: { width: 540, height: 960 } })).newPage();
    await page.goto(w.link);
    const done = page.getByTestId("render-done");
    const failed = page.getByTestId("render-error");
    const left = Math.max(60_000, STOP_AT - Date.now());
    await Promise.race([done.waitFor({ timeout: left }), failed.waitFor({ timeout: left })]);
    log((await done.isVisible()) ? "render done" : "render failed");
  } finally {
    await browser.close();
  }
}

let jobs = 0;
while (Date.now() < STOP_AT - 60_000) {
  const w = await api("POST", "/api/worker/next");
  if (w.kind === "none") break;
  jobs++;
  log(`job ${jobs}: ${w.kind}`);
  if (w.kind === "analyze") await analyze(w);
  else if (w.kind === "render")
    await render(w).catch((e) => {
      debug(e);
      log("render crashed");
    });
}
log(`finished, ${jobs} job(s)`);
