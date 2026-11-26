"use client";

/**
 * Free "heavy" tools that run on the device:
 * - Stabilise: our own motion analysis (no AI download).
 * - HD enhance: denoise + sharpen + clarity effects on the GPU.
 * - AI photo upscale ×2: Swin2SR (Apache-2.0) through transformers.js.
 * - AI voice (English): SpeechT5 (MIT) through transformers.js.
 * Models download once from Hugging Face and are cached by the browser.
 */
import { encodeWav, estimateShift, stabilizePlan, type GrayFrame } from "@just-see/engine";
import { createId, createMediaClip, findClip, getSequence, isMediaClip, type Command } from "@just-see/schema";
import { useEditor } from "./editor-store";
import { assetBlob, assetUrl, importFile, invalidateAsset } from "./media";
import { putMedia } from "./storage/media-store";

const ANALYSE_W = 192;

function committed() {
  return useEditor.getState().history?.project ?? null;
}

/** Read small greyscale frames from a video by seeking. */
async function sampleFrames(url: string, fromUs: number, toUs: number, fps: number, onProgress?: (p: number) => void): Promise<{ t: number; f: GrayFrame }[]> {
  const v = document.createElement("video");
  v.muted = true;
  v.playsInline = true;
  v.preload = "auto";
  v.src = url;
  await new Promise<void>((res, rej) => {
    v.onloadeddata = () => res();
    v.onerror = () => rej(new Error("Could not read video"));
  });
  const w = ANALYSE_W;
  const h = Math.max(16, Math.round((w * v.videoHeight) / Math.max(1, v.videoWidth)));
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  const out: { t: number; f: GrayFrame }[] = [];
  const step = 1e6 / fps;
  for (let t = fromUs; t <= toUs; t += step) {
    await new Promise<void>((res) => {
      const done = () => res();
      v.onseeked = done;
      setTimeout(done, 2000);
      v.currentTime = t / 1e6;
    });
    ctx.drawImage(v, 0, 0, w, h);
    const px = ctx.getImageData(0, 0, w, h).data;
    const g = new Uint8Array(w * h);
    for (let i = 0; i < g.length; i++) g[i] = (px[i * 4]! * 77 + px[i * 4 + 1]! * 150 + px[i * 4 + 2]! * 29) >> 8;
    out.push({ t, f: { data: g, width: w, height: h } });
    onProgress?.((t - fromUs) / Math.max(1, toUs - fromUs));
  }
  v.removeAttribute("src");
  v.load();
  return out;
}

/** Remove camera shake from a video clip with keyframes and a small zoom. Returns the shake removed (% of frame). */
export async function stabilizeClip(clipId: string, onProgress?: (p: number) => void): Promise<number> {
  const p = committed();
  const loc = p ? findClip(p, clipId) : undefined;
  if (!p || !loc || !isMediaClip(loc.clip) || loc.clip.kind !== "video") throw new Error("Pick a video clip");
  const clip = loc.clip;
  const asset = p.assets.find((a) => a.id === clip.assetId);
  if (!asset) throw new Error("Media missing");
  const fps = 10;
  const span = clip.durationUs * clip.speed;
  const frames = await sampleFrames(await assetUrl(asset), clip.sourceInUs, clip.sourceInUs + span, fps, (x) => onProgress?.(x * 0.9));
  const shifts = frames.slice(1).map((s, i) => estimateShift(frames[i]!.f, s.f, 14));
  const seq = getSequence(p);
  const fit = Math.min(seq.width / asset.width, seq.height / asset.height);
  const base = clip.transform.scale;
  const plan = stabilizePlan(
    frames.map((s) => Math.round((s.t - clip.sourceInUs) / clip.speed)),
    shifts,
    frames[0]?.f.width ?? ANALYSE_W,
    frames[0]?.f.height ?? 1,
    { smoothSec: 1.2, sampleFps: fps, displayW: ((asset.width * fit) / seq.width) * base, displayH: ((asset.height * fit) / seq.height) * base },
  );
  const commands: Command[] = [
    { type: "clip/clearKeyframes", payload: { clipId, prop: "x" } },
    { type: "clip/clearKeyframes", payload: { clipId, prop: "y" } },
    { type: "clip/update", payload: { clipId, patch: { transform: { scale: Math.min(20, base * plan.scale) } } } },
    ...plan.x.filter((k) => k.t <= clip.durationUs).map((k) => ({ type: "clip/setKeyframe", payload: { clipId, prop: "x", t: k.t, v: clip.transform.x + k.v, ease: "linear" } }) as Command),
    ...plan.y.filter((k) => k.t <= clip.durationUs).map((k) => ({ type: "clip/setKeyframe", payload: { clipId, prop: "y", t: k.t, v: clip.transform.y + k.v, ease: "linear" } }) as Command),
  ];
  useEditor.getState().dispatch({ type: "batch", payload: { label: "Stabilise", commands } });
  onProgress?.(1);
  return plan.shake * 100;
}

/** One-tap "HD enhance": clean, sharpen and add clarity (on the GPU, preview = export). */
export function enhanceClip(clipId: string): void {
  const p = committed();
  const loc = p ? findClip(p, clipId) : undefined;
  if (!loc || !isMediaClip(loc.clip) || loc.clip.kind === "audio") return;
  const have = new Set(loc.clip.effects.map((e) => e.type));
  const fx = [
    { type: "denoise", params: { amount: 0.35 } },
    { type: "unsharp", params: { amount: 0.5, radius: 0.3 } },
    { type: "clarity", params: { amount: 0.25 } },
    { type: "vibrance", params: { amount: 0.15 } },
  ].filter((e) => !have.has(e.type));
  useEditor.getState().dispatch({
    type: "batch",
    payload: { label: "HD enhance", commands: fx.map((e) => ({ type: "clip/addEffect", payload: { clipId, effect: { id: createId("fx_"), type: e.type, enabled: true, params: e.params } } }) as Command) },
  });
}

// ---------- transformers.js models ----------

type ProgressCb = (p: number) => void;
const jobs = new Map<string, Promise<unknown>>();

async function loadPipeline<T>(task: string, model: string, onProgress?: ProgressCb, opts: Record<string, unknown> = {}): Promise<T> {
  const key = `${task}:${model}`;
  let job = jobs.get(key) as Promise<T> | undefined;
  if (!job) {
    job = (async () => {
      const { pipeline } = await import("@huggingface/transformers");
      const device = (navigator as Navigator & { gpu?: unknown }).gpu ? "webgpu" : "wasm";
      const files = new Map<string, number>();
      return (await pipeline(task as "text-to-speech", model, {
        device,
        dtype: device === "webgpu" ? "fp32" : "q8",
        ...opts,
        progress_callback: (info: { status?: string; file?: string; progress?: number }) => {
          if (info.status === "progress" && info.file) {
            files.set(info.file, info.progress ?? 0);
            const vals = [...files.values()];
            onProgress?.(vals.reduce((a, b) => a + b, 0) / vals.length / 100);
          }
        },
      })) as unknown as T;
    })();
    jobs.set(key, job);
    job.catch(() => jobs.delete(key));
  }
  return job;
}

type Upscaler = (img: ImageBitmap) => Promise<{ data: Uint8ClampedArray | Uint8Array; width: number; height: number; channels: number }>;

/** AI photo upscale ×2 (Swin2SR, Apache-2.0). Replaces the photo in place. */
export async function upscaleImageClip(clipId: string, onProgress?: ProgressCb): Promise<{ width: number; height: number }> {
  const p = committed();
  const loc = p ? findClip(p, clipId) : undefined;
  if (!p || !loc || !isMediaClip(loc.clip) || loc.clip.kind !== "image") throw new Error("Pick a photo");
  const asset = p.assets.find((a) => a.id === (loc.clip as { assetId: string }).assetId);
  if (!asset) throw new Error("Media missing");
  // Keep the input reasonable for phones: at most 1024 px on the long side.
  const src = await createImageBitmap(await assetBlob(asset));
  const k = Math.min(1, 1024 / Math.max(src.width, src.height));
  const bmp = k < 1 ? await createImageBitmap(src, { resizeWidth: Math.round(src.width * k), resizeHeight: Math.round(src.height * k), resizeQuality: "high" }) : src;
  const fake = (window as unknown as { __justSeeUpscaler?: Upscaler }).__justSeeUpscaler;
  let out: Awaited<ReturnType<Upscaler>>;
  if (fake) out = await fake(bmp);
  else {
    const up = await loadPipeline<(x: unknown) => Promise<{ data: Uint8Array; width: number; height: number; channels: number }>>("image-to-image", "Xenova/swin2SR-classical-sr-x2-64", (x) => onProgress?.(x * 0.6));
    const { RawImage } = await import("@huggingface/transformers");
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    c.getContext("2d")!.drawImage(bmp, 0, 0);
    const id = c.getContext("2d")!.getImageData(0, 0, bmp.width, bmp.height);
    onProgress?.(0.7);
    out = await up(new RawImage(id.data, bmp.width, bmp.height, 4));
  }
  const c = new OffscreenCanvas(out.width, out.height);
  const rgba = new Uint8ClampedArray(out.width * out.height * 4);
  for (let i = 0, j = 0; i < rgba.length; i += 4, j += out.channels) {
    rgba[i] = out.data[j]!;
    rgba[i + 1] = out.data[j + 1]!;
    rgba[i + 2] = out.data[j + 2]!;
    rgba[i + 3] = out.channels === 4 ? out.data[j + 3]! : 255;
  }
  c.getContext("2d")!.putImageData(new ImageData(rgba, out.width, out.height), 0, 0);
  const blob = await c.convertToBlob({ type: "image/png" });
  const key = `media/${asset.id}_hd_${Date.now()}`;
  await putMedia(key, blob);
  invalidateAsset(asset.id);
  window.dispatchEvent(new CustomEvent("justsee:media", { detail: asset.id }));
  useEditor.getState().dispatch({ type: "asset/update", payload: { assetId: asset.id, patch: { storageKey: key, width: out.width, height: out.height, sizeBytes: blob.size, mimeType: "image/png" } } });
  onProgress?.(1);
  return { width: out.width, height: out.height };
}

type Tts = (text: string, opts: Record<string, unknown>) => Promise<{ audio: Float32Array; sampling_rate: number }>;
const SPEAKER = "https://huggingface.co/datasets/Xenova/transformers.js-docs/resolve/main/speaker_embeddings.bin";

/** AI voice-over from text (English, SpeechT5 MIT). Adds it at the playhead on an audio track. */
export async function addVoiceover(text: string, onProgress?: ProgressCb): Promise<void> {
  const clean = text.trim().slice(0, 1500);
  if (!clean) return;
  const fake = (window as unknown as { __justSeeTts?: (t: string) => Promise<{ audio: Float32Array; sampling_rate: number }> }).__justSeeTts;
  // SpeechT5 is happiest with one sentence at a time.
  const sentences = clean.match(/[^.!?\n]+[.!?]*/g)?.map((s) => s.trim()).filter(Boolean) ?? [clean];
  const tts = fake ? null : await loadPipeline<Tts>("text-to-speech", "Xenova/speecht5_tts", (x) => onProgress?.(x * 0.6), { dtype: "fp32" });
  const parts: Float32Array[] = [];
  let sr = 16000;
  for (const [i, s] of sentences.entries()) {
    const r = fake ? await fake(s) : await tts!(s, { speaker_embeddings: SPEAKER });
    sr = r.sampling_rate;
    parts.push(r.audio, new Float32Array(Math.round(sr * 0.25)));
    onProgress?.(0.6 + (0.35 * (i + 1)) / sentences.length);
  }
  const total = parts.reduce((n, x) => n + x.length, 0);
  const mono = new Float32Array(total);
  let o = 0;
  for (const x of parts) {
    mono.set(x, o);
    o += x.length;
  }
  const file = new File([encodeWav([mono, mono], sr)], `Voice - ${clean.slice(0, 30)}.wav`, { type: "audio/wav" });
  const asset = await importFile(file);
  asset.license = { kind: "user-upload", commercialUse: true, name: "AI voice (SpeechT5, MIT)", licenseName: "Your own (AI voice)", source: "just-see-tts" };
  const s = useEditor.getState();
  const clip = createMediaClip(asset);
  clip.startUs = s.playheadUs;
  s.dispatch({ type: "batch", payload: { label: "AI voice", commands: [{ type: "asset/add", payload: { asset } }, { type: "clip/add", payload: { clip, trackType: "audio", newTrackId: createId("t_") } }] } });
  onProgress?.(1);
}
