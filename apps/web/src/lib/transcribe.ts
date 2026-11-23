"use client";

import { RenderSession, type CaptionLanguage, type TranscriptWord } from "@just-see/engine";
import { getSequence, sequenceDurationUs, type Project } from "@just-see/schema";
import { mediaLoader } from "./media";

/**
 * Speech to text in the browser with Whisper (MIT weights) through
 * transformers.js (Apache-2.0). Model files download from Hugging Face on
 * first use and are cached by the browser.
 */

export type ModelSize = "base" | "small";

export const WHISPER_MODELS: Record<ModelSize, string> = {
  base: "onnx-community/whisper-base_timestamped",
  small: "onnx-community/whisper-small_timestamped",
};

const LANG_NAME: Record<CaptionLanguage, string | undefined> = {
  auto: undefined,
  hi: "hindi",
  hinglish: "hindi",
  en: "english",
  ur: "urdu",
};

export interface TranscribeProgress {
  phase: "audio" | "download" | "transcribe";
  progress: number;
}

type Fake = (pcm: Float32Array, sampleRate: number, language: CaptionLanguage) => Promise<TranscriptWord[]>;

interface AsrChunk {
  text: string;
  timestamp: [number, number | null];
}
type AsrFn = (audio: Float32Array, opts: Record<string, unknown>) => Promise<{ text: string; chunks?: AsrChunk[] }>;

const pipelines = new Map<string, Promise<AsrFn>>();

async function getAsr(model: string, onProgress: (p: number) => void): Promise<AsrFn> {
  let job = pipelines.get(model);
  if (!job) {
    job = (async () => {
      const { pipeline } = await import("@huggingface/transformers");
      const device = (navigator as Navigator & { gpu?: unknown }).gpu ? "webgpu" : "wasm";
      const files = new Map<string, number>();
      const asr = await pipeline("automatic-speech-recognition", model, {
        device,
        dtype: device === "webgpu" ? "fp32" : "q8",
        progress_callback: (info: { status?: string; file?: string; progress?: number }) => {
          if (info.status === "progress" && info.file) {
            files.set(info.file, info.progress ?? 0);
            const vals = [...files.values()];
            onProgress(vals.reduce((a, b) => a + b, 0) / vals.length / 100);
          }
        },
      });
      return asr as unknown as AsrFn;
    })();
    pipelines.set(model, job);
    job.catch(() => pipelines.delete(model));
  }
  return job;
}

/** Spread a segment's text evenly over its time span (fallback when word times are missing). */
function spread(text: string, startUs: number, endUs: number): TranscriptWord[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const total = words.reduce((n, w) => n + w.length, 0) || 1;
  let t = startUs;
  return words.map((w) => {
    const d = ((endUs - startUs) * w.length) / total;
    const word = { text: w, startUs: Math.round(t), endUs: Math.round(t + d) };
    t += d;
    return word;
  });
}

/** Mixed timeline audio, mono, at `sampleRate`. */
export async function timelineAudio(project: Project, sampleRate = 16000): Promise<Float32Array> {
  const duration = sequenceDurationUs(getSequence(project));
  const session = new RenderSession(project, mediaLoader, 16, 16);
  try {
    const [l, r] = await session.mixAudio(duration, sampleRate);
    const mono = new Float32Array(l.length);
    for (let i = 0; i < mono.length; i++) mono[i] = (l[i]! + r[i]!) / 2;
    return mono;
  } finally {
    session.close();
  }
}

/** Transcribe the whole timeline. Times are timeline µs. */
export async function transcribeTimeline(
  project: Project,
  language: CaptionLanguage,
  size: ModelSize,
  onProgress: (p: TranscribeProgress) => void,
): Promise<TranscriptWord[]> {
  onProgress({ phase: "audio", progress: 0 });
  const sr = 16000;
  const pcm = await timelineAudio(project, sr);
  const fake = (window as unknown as { __justSeeTranscriber?: Fake }).__justSeeTranscriber;
  if (fake) return fake(pcm, sr, language);

  onProgress({ phase: "download", progress: 0 });
  const asr = await getAsr(WHISPER_MODELS[size], (p) => onProgress({ phase: "download", progress: p }));
  onProgress({ phase: "transcribe", progress: 0 });
  const base = { task: "transcribe", language: LANG_NAME[language], chunk_length_s: 30, stride_length_s: 5 };
  let out: { text: string; chunks?: AsrChunk[] };
  let wordLevel = true;
  try {
    out = await asr(pcm, { ...base, return_timestamps: "word" });
  } catch {
    wordLevel = false;
    out = await asr(pcm, { ...base, return_timestamps: true });
  }
  onProgress({ phase: "transcribe", progress: 1 });
  const chunks = out.chunks ?? [{ text: out.text, timestamp: [0, pcm.length / sr] as [number, number] }];
  const words: TranscriptWord[] = [];
  for (const c of chunks) {
    const s = Math.round((c.timestamp[0] ?? 0) * 1e6);
    const e = Math.round((c.timestamp[1] ?? c.timestamp[0] + 0.5) * 1e6);
    if (wordLevel) {
      const text = c.text.trim();
      if (text) words.push({ text, startUs: s, endUs: Math.max(e, s + 50_000) });
    } else words.push(...spread(c.text, s, e));
  }
  return words;
}
