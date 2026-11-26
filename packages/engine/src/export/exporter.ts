import { ArrayBufferTarget as Mp4Target, Muxer as Mp4Muxer } from "mp4-muxer";
import { ArrayBufferTarget as WebmTarget, Muxer as WebmMuxer } from "webm-muxer";
import { getSequence, sequenceDurationUs, type Project } from "@just-see/schema";
import { defaultVideoBitrate, pickAudioCodec, pickVideoCodec, type MuxVideoCodec } from "./codecs";
import { GifEncoder } from "./gif";
import { RenderSession, checkAbort, type MaskProvider, type MediaLoader } from "./session";
import { ZipWriter } from "./zip";

export type { MediaLoader } from "./session";

export type ExportFormat = "mp4" | "webm" | "gif" | "png-zip";

export interface ExportOptions {
  width: number;
  height: number;
  fps: number;
  format?: ExportFormat;
  /** Preferred video codec; falls back automatically when unsupported. */
  codec?: MuxVideoCodec;
  videoBitrate?: number;
  audioBitrate?: number;
  /** PNG sequence only: keep the canvas transparent. */
  transparent?: boolean;
  /** Person masks for background removal. */
  maskProvider?: MaskProvider;
  signal?: AbortSignal;
  onProgress?: (p: { phase: "prepare" | "audio" | "video" | "finalize"; progress: number }) => void;
}

export interface ExportResult {
  blob: Blob;
  mimeType: string;
  extension: string;
  videoCodec: string;
  audioCodec: string | null;
  frames: number;
  durationUs: number;
}

const SAMPLE_RATE = 48000;

function prepare(project: Project, opts: ExportOptions) {
  const seq = getSequence(project);
  const durationUs = sequenceDurationUs(seq);
  if (durationUs <= 0) throw new Error("The timeline is empty");
  const width = opts.width - (opts.width % 2);
  const height = opts.height - (opts.height % 2);
  const totalFrames = Math.max(1, Math.round((durationUs * opts.fps) / 1e6));
  return { durationUs, width, height, totalFrames, progress: opts.onProgress ?? (() => {}) };
}

/** Encode stereo PCM with WebCodecs, handing chunks to `sink`. */
async function encodeAudio(
  left: Float32Array,
  right: Float32Array,
  config: AudioEncoderConfig,
  sink: (chunk: EncodedAudioChunk, meta?: EncodedAudioChunkMetadata) => void,
  signal?: AbortSignal,
): Promise<void> {
  let audioErr: Error | null = null;
  const encoder = new AudioEncoder({
    output: sink,
    error: (e) => {
      audioErr = e instanceof Error ? e : new Error(String(e));
    },
  });
  encoder.configure(config);
  const block = 4800; // 100 ms
  for (let s = 0; s < left.length; s += block) {
    checkAbort(signal);
    const n = Math.min(block, left.length - s);
    const planar = new Float32Array(n * 2);
    planar.set(left.subarray(s, s + n), 0);
    planar.set(right.subarray(s, s + n), n);
    const data = new AudioData({
      format: "f32-planar",
      sampleRate: SAMPLE_RATE,
      numberOfFrames: n,
      numberOfChannels: 2,
      timestamp: Math.round((s / SAMPLE_RATE) * 1e6),
      data: planar,
    });
    encoder.encode(data);
    data.close();
    if (audioErr) throw audioErr;
  }
  await encoder.flush();
  encoder.close();
  if (audioErr) throw audioErr;
}

/** Render to MP4 or WebM with WebCodecs, entirely in the browser. */
export async function exportVideo(project: Project, loader: MediaLoader, opts: ExportOptions): Promise<ExportResult> {
  const format = opts.format === "webm" ? "webm" : "mp4";
  const { durationUs, width, height, totalFrames, progress } = prepare(project, opts);
  const fps = opts.fps;
  progress({ phase: "prepare", progress: 0 });

  const prefer: MuxVideoCodec[] = format === "webm" ? ["vp9", "av1"] : opts.codec ? [opts.codec, "avc", "hevc", "vp9", "av1"] : ["avc", "vp9", "av1"];
  const video = await pickVideoCodec(width, height, fps, opts.videoBitrate ?? defaultVideoBitrate(width, height, fps), prefer);
  const audio = await pickAudioCodec(SAMPLE_RATE, 2, opts.audioBitrate ?? 160_000, format === "webm" ? ["opus"] : ["aac", "opus"]);

  let addVideo: (c: EncodedVideoChunk, m?: EncodedVideoChunkMetadata) => void;
  let addAudio: (c: EncodedAudioChunk, m?: EncodedAudioChunkMetadata) => void;
  let finalize: () => Blob;
  if (format === "mp4") {
    const target = new Mp4Target();
    const muxer = new Mp4Muxer({
      target,
      video: { codec: video.mux, width, height, frameRate: fps },
      audio: audio ? { codec: audio.mux, sampleRate: SAMPLE_RATE, numberOfChannels: 2 } : undefined,
      fastStart: "in-memory",
      firstTimestampBehavior: "offset",
    });
    addVideo = (c, m) => muxer.addVideoChunk(c, m);
    addAudio = (c, m) => muxer.addAudioChunk(c, m);
    finalize = () => {
      muxer.finalize();
      return new Blob([target.buffer], { type: "video/mp4" });
    };
  } else {
    const target = new WebmTarget();
    const muxer = new WebmMuxer({
      target,
      video: { codec: video.mux === "av1" ? "V_AV1" : "V_VP9", width, height, frameRate: fps },
      audio: audio ? { codec: "A_OPUS", sampleRate: SAMPLE_RATE, numberOfChannels: 2 } : undefined,
      firstTimestampBehavior: "offset",
    });
    addVideo = (c, m) => muxer.addVideoChunk(c, m);
    addAudio = (c, m) => muxer.addAudioChunk(c, m);
    finalize = () => {
      muxer.finalize();
      return new Blob([target.buffer], { type: "video/webm" });
    };
  }

  const session = new RenderSession(project, loader, width, height, { maskProvider: opts.maskProvider });
  try {
    if (audio) {
      progress({ phase: "audio", progress: 0 });
      const [left, right] = await session.mixAudio(durationUs, SAMPLE_RATE, opts.signal, (p) => progress({ phase: "audio", progress: p / 2 }));
      await encodeAudio(left, right, audio.config, addAudio, opts.signal);
      progress({ phase: "audio", progress: 1 });
    }

    let videoErr: Error | null = null;
    const encoder = new VideoEncoder({
      output: (chunk, meta) => addVideo(chunk, meta),
      error: (e) => {
        videoErr = e instanceof Error ? e : new Error(String(e));
      },
    });
    encoder.configure(video.config);
    try {
      for (let i = 0; i < totalFrames; i++) {
        checkAbort(opts.signal);
        if (videoErr) throw videoErr;
        const t = await session.renderFrame(i, fps);
        const frame = new VideoFrame(session.canvas, { timestamp: t, duration: Math.round(1e6 / fps) });
        encoder.encode(frame, { keyFrame: i % Math.max(1, Math.round(fps * 2)) === 0 });
        frame.close();
        while (encoder.encodeQueueSize > 4) {
          await new Promise<void>((r) => encoder.addEventListener("dequeue", () => r(), { once: true }));
        }
        if (i % 5 === 0) progress({ phase: "video", progress: i / totalFrames });
      }
      await encoder.flush();
      if (videoErr) throw videoErr;
    } finally {
      if (encoder.state !== "closed") encoder.close();
    }
  } finally {
    session.close();
  }

  progress({ phase: "finalize", progress: 0 });
  const blob = finalize();
  progress({ phase: "finalize", progress: 1 });
  return {
    blob,
    mimeType: blob.type,
    extension: format,
    videoCodec: video.label,
    audioCodec: audio?.label ?? null,
    frames: totalFrames,
    durationUs,
  };
}

/** Back-compat name from Phase 1. */
export const exportMp4 = (project: Project, loader: MediaLoader, opts: ExportOptions) => exportVideo(project, loader, { ...opts, format: "mp4" });

/** Animated GIF (no audio). Keep it short and small: GIFs get big fast. */
export async function exportGif(project: Project, loader: MediaLoader, opts: ExportOptions): Promise<ExportResult> {
  const { durationUs, width, height, totalFrames, progress } = prepare(project, opts);
  progress({ phase: "prepare", progress: 0 });
  const session = new RenderSession(project, loader, width, height, { maskProvider: opts.maskProvider });
  const gif = new GifEncoder(width, height);
  try {
    for (let i = 0; i < totalFrames; i++) {
      checkAbort(opts.signal);
      await session.renderFrame(i, opts.fps);
      gif.addFrame(session.readPixels(), 1000 / opts.fps);
      if (i % 3 === 0) progress({ phase: "video", progress: i / totalFrames });
      // Yield so the UI stays responsive.
      if (i % 10 === 0) await new Promise((r) => setTimeout(r, 0));
    }
  } finally {
    session.close();
  }
  const blob = new Blob([gif.finish() as Uint8Array<ArrayBuffer>], { type: "image/gif" });
  progress({ phase: "finalize", progress: 1 });
  return { blob, mimeType: "image/gif", extension: "gif", videoCodec: "GIF", audioCodec: null, frames: totalFrames, durationUs };
}

/** PNG sequence in a ZIP; with `transparent` the background stays clear (alpha). */
export async function exportPngSequence(project: Project, loader: MediaLoader, opts: ExportOptions): Promise<ExportResult> {
  const { durationUs, width, height, totalFrames, progress } = prepare(project, opts);
  progress({ phase: "prepare", progress: 0 });
  const session = new RenderSession(project, loader, width, height, { transparent: opts.transparent ?? true, maskProvider: opts.maskProvider });
  const zip = new ZipWriter();
  const digits = String(totalFrames).length + 1;
  try {
    for (let i = 0; i < totalFrames; i++) {
      checkAbort(opts.signal);
      await session.renderFrame(i, opts.fps);
      const c = session.canvas;
      const blob =
        "convertToBlob" in c
          ? await c.convertToBlob({ type: "image/png" })
          : await new Promise<Blob>((res, rej) => (c as HTMLCanvasElement).toBlob((b) => (b ? res(b) : rej(new Error("PNG encode failed"))), "image/png"));
      zip.add(`frame_${String(i).padStart(digits, "0")}.png`, new Uint8Array(await blob.arrayBuffer()));
      if (i % 3 === 0) progress({ phase: "video", progress: i / totalFrames });
    }
  } finally {
    session.close();
  }
  const blob = zip.finish();
  progress({ phase: "finalize", progress: 1 });
  return { blob, mimeType: "application/zip", extension: "zip", videoCodec: "PNG", audioCodec: null, frames: totalFrames, durationUs };
}

/** One entry point for every format. */
export function exportProject(project: Project, loader: MediaLoader, opts: ExportOptions): Promise<ExportResult> {
  switch (opts.format ?? "mp4") {
    case "gif":
      return exportGif(project, loader, opts);
    case "png-zip":
      return exportPngSequence(project, loader, opts);
    default:
      return exportVideo(project, loader, opts);
  }
}

/** Export sizes offered in the UI for a sequence. */
export function exportSizes(seqW: number, seqH: number): { label: string; width: number; height: number }[] {
  const short = Math.min(seqW, seqH);
  const sizes = [
    { label: "480p", short: 480 },
    { label: "720p", short: 720 },
    { label: "1080p", short: 1080 },
    { label: "2K", short: 1440 },
    { label: "4K", short: 2160 },
  ];
  return sizes.map((s) => {
    const k = s.short / short;
    const even = (v: number) => Math.round(v / 2) * 2;
    return { label: s.label, width: even(seqW * k), height: even(seqH * k) };
  });
}

export interface ExportPreset {
  id: string;
  label: string;
  /** Recommended aspect ("9:16" etc.). */
  aspect: string;
  size: string;
  fps: number;
  format: ExportFormat;
  quality: "standard" | "high";
  /** Platform limit shown as a hint. */
  maxSeconds?: number;
}

/** Social presets. Limits are hints only; we do not block longer exports. */
export const EXPORT_PRESETS: readonly ExportPreset[] = [
  { id: "reels", label: "Instagram Reels", aspect: "9:16", size: "1080p", fps: 30, format: "mp4", quality: "high", maxSeconds: 180 },
  { id: "shorts", label: "YouTube Shorts", aspect: "9:16", size: "1080p", fps: 60, format: "mp4", quality: "high", maxSeconds: 180 },
  { id: "youtube", label: "YouTube 1080p", aspect: "16:9", size: "1080p", fps: 30, format: "mp4", quality: "high" },
  { id: "youtube-4k", label: "YouTube 4K", aspect: "16:9", size: "4K", fps: 30, format: "mp4", quality: "high" },
  { id: "x", label: "X (Twitter)", aspect: "16:9", size: "720p", fps: 30, format: "mp4", quality: "standard", maxSeconds: 140 },
  { id: "whatsapp", label: "WhatsApp status", aspect: "9:16", size: "720p", fps: 30, format: "mp4", quality: "standard", maxSeconds: 60 },
  { id: "gif", label: "GIF", aspect: "any", size: "480p", fps: 12, format: "gif", quality: "standard", maxSeconds: 15 },
];
