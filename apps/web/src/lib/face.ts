"use client";

/**
 * Face tracking (CapCut-style): find the face in every frame of a clip, then
 * - follow: zoom and move the clip so the face stays in frame,
 * - blur / mosaic: hide the face with a mask that moves with it,
 * - stick: make a text or sticker follow the face.
 * Runs on the device with MediaPipe's face detector (Apache-2.0).
 */
import type { FaceDetector } from "@mediapipe/tasks-vision";
import { Mp4Demuxer, VideoFrameReader, faceOnCanvas, followKeys, pickFace, thinKeys, trackFaces, type FaceBox, type FaceSample, type FaceTrackPoint } from "@just-see/engine";
import { createId, findClip, getSequence, isMediaClip, type Asset, type Command, type MediaClip } from "@just-see/schema";
import { getMedia } from "./storage/media-store";
import { assetUrl } from "./media";
import { currentProject, useEditor } from "./editor-store";
import { translate, useLocale } from "./i18n";
import { track as trackUse } from "./telemetry";

const tr = (k: Parameters<typeof translate>[1]) => translate(useLocale.getState().locale, k);

/** BlazeFace short range (Apache-2.0), from Google's model storage. */
const MODEL_URL = "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/latest/blaze_face_short_range.tflite";

type Detect = (frame: TexImageSource, width: number, height: number) => FaceBox[] | Promise<FaceBox[]>;

let detector: Promise<Detect | null> | null = null;

/** Tests can replace the detector (the real model needs network access). */
declare global {
  interface Window {
    __justSeeFaceDetector?: Detect;
  }
}

function loadDetector(): Promise<Detect | null> {
  if (typeof window !== "undefined" && window.__justSeeFaceDetector) return Promise.resolve(window.__justSeeFaceDetector);
  if (!detector) {
    detector = (async () => {
      try {
        const { FilesetResolver, FaceDetector: FD } = await import("@mediapipe/tasks-vision");
        const fileset = await FilesetResolver.forVisionTasks("/vendor/mediapipe");
        const make = (delegate: "GPU" | "CPU") =>
          FD.createFromOptions(fileset, { baseOptions: { modelAssetPath: MODEL_URL, delegate }, runningMode: "IMAGE", minDetectionConfidence: 0.4 });
        const fd: FaceDetector = await make("GPU").catch(() => make("CPU"));
        return (frame: TexImageSource, w: number, h: number) => {
          const r = fd.detect(frame as Parameters<FaceDetector["detect"]>[0]);
          return r.detections
            .filter((d) => d.boundingBox)
            .map((d) => {
              const b = d.boundingBox!;
              return { cx: (b.originX + b.width / 2) / w, cy: (b.originY + b.height / 2) / h, w: b.width / w, h: b.height / h };
            });
        };
      } catch (e) {
        console.error("Face detector unavailable", e);
        return null;
      }
    })();
  }
  return detector;
}

/** Samples per second: dense enough that the track moves with the face. */
const RATE = 12;
/** Cap on samples for very long clips (about 4 minutes at the full rate). */
const MAX_SAMPLES = 3000;

/** Face box at regular steps over a span of the source. */
export async function sampleFaces(asset: Asset, fromUs: number, toUs: number, onProgress?: (p: number) => void): Promise<FaceSample[]> {
  const detect = await loadDetector();
  if (!detect) throw new Error(tr("faceUnavailable"));
  const span = Math.max(1, toUs - fromUs);
  const step = Math.max(1_000_000 / RATE, span / MAX_SAMPLES);
  const times: number[] = [];
  for (let t = fromUs; t <= toUs; t += step) times.push(Math.round(t));
  const out: FaceSample[] = [];
  let last: FaceBox | null = null;
  const take = async (frame: TexImageSource, w: number, h: number, t: number) => {
    const face = pickFace(await detect(frame, w, h), last);
    if (face) last = face;
    out.push({ tUs: t, face });
    onProgress?.(out.length / times.length);
  };
  // Fast path: decode frames in order with WebCodecs.
  const blob = await getMedia(asset.storageKey).catch(() => undefined);
  if (blob && typeof VideoDecoder !== "undefined") {
    try {
      const dm = await Mp4Demuxer.open(blob);
      if (await VideoFrameReader.isSupported(dm)) {
        const reader = new VideoFrameReader(dm);
        try {
          for (const t of times) {
            const f = await reader.frameAt(t);
            if (!f) {
              out.push({ tUs: t, face: null });
              continue;
            }
            await take(f, f.displayWidth, f.displayHeight, t);
          }
          return out;
        } finally {
          reader.close();
        }
      }
    } catch {
      out.length = 0;
      last = null;
    }
  }
  // Fallback: seek a video element.
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.src = await assetUrl(asset);
  await new Promise<void>((res, rej) => {
    video.onloadeddata = () => res();
    video.onerror = () => rej(new Error("Could not read video"));
  });
  for (const t of times) {
    await new Promise<void>((res) => {
      video.onseeked = () => res();
      video.currentTime = Math.min(t, asset.durationUs - 1000) / 1e6;
    });
    await take(video, video.videoWidth, video.videoHeight, t);
  }
  video.removeAttribute("src");
  video.load();
  return out;
}

export type FaceMode = "follow" | "blur" | "mosaic" | "stick";

function clipContext(clipId: string) {
  const p = currentProject(useEditor.getState());
  const loc = p ? findClip(p, clipId) : undefined;
  if (!p || !loc || !isMediaClip(loc.clip) || loc.clip.kind !== "video") return null;
  const clip = loc.clip as MediaClip;
  const asset = p.assets.find((a) => a.id === clip.assetId);
  if (!asset) return null;
  const seq = getSequence(p);
  const rotated = asset.rotation === 90 || asset.rotation === 270;
  const srcAspect = rotated ? asset.height / asset.width : asset.width / asset.height;
  return { p, clip, asset, srcAspect, canvasAspect: seq.width / seq.height };
}

/** Track the face over the visible part of a clip. */
export async function trackClipFace(clipId: string, onProgress?: (p: number) => void): Promise<FaceTrackPoint[]> {
  const c = clipContext(clipId);
  if (!c) throw new Error(tr("faceNeedsVideo"));
  const span = c.clip.durationUs * c.clip.speed;
  const samples = await sampleFaces(c.asset, c.clip.sourceInUs, c.clip.sourceInUs + span, onProgress);
  return trackFaces(samples, { smooth: 2, maxGap: RATE });
}

const localT = (clip: MediaClip, sourceUs: number) => Math.max(0, Math.min(clip.durationUs, Math.round((sourceUs - clip.sourceInUs) / clip.speed)));

/** Apply a face effect to a clip. `targetId` is the text/sticker clip for "stick". Returns the number of keyframes. */
export async function applyFace(clipId: string, mode: FaceMode, opts: { zoom?: number; targetId?: string; onProgress?: (p: number) => void } = {}): Promise<number> {
  const c = clipContext(clipId);
  if (!c) throw new Error(tr("faceNeedsVideo"));
  const store = useEditor.getState();
  store.toast(tr("faceTracking"));
  const track = await trackClipFace(clipId, opts.onProgress);
  if (!track.length) throw new Error(tr("faceNotFound"));
  trackUse(`face-${mode}`);
  const { clip, srcAspect, canvasAspect } = c;
  const commands: Command[] = [];
  let count = 0;
  if (mode === "follow") {
    const keys = thinKeys(
      followKeys(track, srcAspect, canvasAspect, { sourceInUs: clip.sourceInUs, speed: clip.speed, faceHeight: 0.32 * (opts.zoom ?? 1) }),
      ["x", "y", "scale"],
      0.0015,
    );
    for (const prop of ["x", "y", "scale"] as const) commands.push({ type: "clip/clearKeyframes", payload: { clipId, prop } });
    for (const k of keys) {
      for (const prop of ["x", "y", "scale"] as const) commands.push({ type: "clip/setKeyframe", payload: { clipId, prop, t: Math.min(k.tUs, clip.durationUs), v: k[prop], ease: "linear" } });
    }
    count = keys.length;
  } else if (mode === "blur" || mode === "mosaic") {
    const fxId = createId("fx_");
    const type = mode === "blur" ? "face-blur" : "face-mosaic";
    const t0 = track[0]!;
    const pad = 1.35;
    const place = (p: FaceTrackPoint) => {
      const f = faceOnCanvas(p, srcAspect, canvasAspect, clip.transform);
      return { x: f.cx, y: f.cy, w: f.w * pad, h: f.h * pad * 1.1 };
    };
    const first = place(t0);
    commands.push({ type: "clip/addEffect", payload: { clipId, effect: { id: fxId, type, enabled: true, params: { ...first, ...(mode === "blur" ? { amount: 0.85, feather: 0.04 } : { size: 0.2, feather: 0.02 }) } } } });
    const keys = thinKeys(
      track.map((p) => ({ tUs: localT(clip, p.tUs), ...place(p) })),
      ["x", "y", "w", "h"],
      0.002,
    );
    for (const k of keys) for (const prop of ["x", "y", "w", "h"] as const) commands.push({ type: "clip/setKeyframe", payload: { clipId, prop: `fx.${fxId}.${prop}`, t: k.tUs, v: k[prop], ease: "linear" } });
    count = keys.length;
  } else {
    const targetId = opts.targetId;
    const p = c.p;
    const target = targetId ? findClip(p, targetId)?.clip : undefined;
    if (!target) throw new Error(tr("faceNeedsSticker"));
    // Keyframes on the target are relative to its own start.
    const keys = thinKeys(
      track.map((pt) => {
        const f = faceOnCanvas(pt, srcAspect, canvasAspect, clip.transform);
        const tl = clip.startUs + localT(clip, pt.tUs) - target.startUs;
        // Sit just above the head.
        return { tUs: tl, x: f.cx - 0.5, y: f.cy - 0.5 - f.h * 0.85 };
      }).filter((k) => k.tUs >= 0 && k.tUs <= target.durationUs),
      ["x", "y"],
      0.002,
    );
    for (const prop of ["x", "y"] as const) commands.push({ type: "clip/clearKeyframes", payload: { clipId: target.id, prop } });
    for (const k of keys) for (const prop of ["x", "y"] as const) commands.push({ type: "clip/setKeyframe", payload: { clipId: target.id, prop, t: k.tUs, v: k[prop], ease: "linear" } });
    count = keys.length;
  }
  const label = mode === "follow" ? "Face follow" : mode === "stick" ? "Stick to face" : "Face blur";
  if (store.dispatch({ type: "batch", payload: { label, commands } })) store.toast(tr("faceDone"));
  return count;
}
