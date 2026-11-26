"use client";

import type { ImageSegmenter } from "@mediapipe/tasks-vision";
import type { ResolvedImage } from "@just-see/engine";

/**
 * Person segmentation for background removal, running fully in the browser
 * with MediaPipe Tasks (Apache-2.0). The wasm runtime is served from our own
 * origin (/vendor/mediapipe); the model file comes from Google's model CDN.
 */
export const SEGMENTER_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite";

let segmenter: ImageSegmenter | null = null;
let loading: Promise<ImageSegmenter | null> | null = null;
let failed = false;
const listeners = new Set<() => void>();

export function onSegmenterReady(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function loadSegmenter(): Promise<ImageSegmenter | null> {
  if (segmenter) return Promise.resolve(segmenter);
  if (failed) return Promise.resolve(null);
  if (!loading) {
    loading = (async () => {
      try {
        const { FilesetResolver, ImageSegmenter: Seg } = await import("@mediapipe/tasks-vision");
        const fileset = await FilesetResolver.forVisionTasks("/vendor/mediapipe");
        const make = (delegate: "GPU" | "CPU") =>
          Seg.createFromOptions(fileset, {
            baseOptions: { modelAssetPath: SEGMENTER_MODEL_URL, delegate },
            runningMode: "IMAGE",
            outputConfidenceMasks: true,
            outputCategoryMask: false,
          });
        segmenter = await make("GPU").catch(() => make("CPU"));
        for (const l of listeners) l();
        return segmenter;
      } catch (e) {
        console.error("Background removal unavailable", e);
        failed = true;
        return null;
      }
    })();
  }
  return loading;
}

/** Ready segmenter or null (and starts loading it). */
export function segmenterSync(): ImageSegmenter | null {
  if (!segmenter && !failed) void loadSegmenter();
  return segmenter;
}

let maskCanvas: OffscreenCanvas | HTMLCanvasElement | null = null;
let version = 0;

/** Person mask (white = person) for an image, as a texture source. */
export function personMask(seg: ImageSegmenter, image: TexImageSource): ResolvedImage | null {
  try {
    const result = seg.segment(image as Parameters<ImageSegmenter["segment"]>[0]);
    const mask = result.confidenceMasks?.[0];
    if (!mask) return null;
    const w = mask.width;
    const h = mask.height;
    const data = mask.getAsFloat32Array();
    if (!maskCanvas) maskCanvas = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(w, h) : document.createElement("canvas");
    if (maskCanvas.width !== w) maskCanvas.width = w;
    if (maskCanvas.height !== h) maskCanvas.height = h;
    const ctx = maskCanvas.getContext("2d") as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null;
    if (!ctx) return null;
    const img = ctx.createImageData(w, h);
    for (let i = 0; i < data.length; i++) {
      const v = Math.round(Math.min(1, Math.max(0, data[i]!)) * 255);
      img.data[i * 4] = v;
      img.data[i * 4 + 1] = v;
      img.data[i * 4 + 2] = v;
      img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    result.close();
    return { image: maskCanvas, rotation: 0, version: ++version };
  } catch (e) {
    console.error("Segmentation failed", e);
    return null;
  }
}

/** Async mask provider for export. */
export async function maskForExport(image: TexImageSource): Promise<ResolvedImage | null> {
  const seg = await loadSegmenter();
  return seg ? personMask(seg, image) : null;
}
