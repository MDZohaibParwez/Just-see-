"use client";

import type { ObjectDetector } from "@mediapipe/tasks-vision";
import type { SubjectSample } from "@just-see/engine";
import type { Asset } from "@just-see/schema";
import { assetUrl } from "./media";

/** Object detection (EfficientDet-Lite0, Apache-2.0) for auto reframe. */
const MODEL_URL = "https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/latest/efficientdet_lite0.tflite";

let detector: Promise<ObjectDetector | null> | null = null;

function loadDetector(): Promise<ObjectDetector | null> {
  if (!detector) {
    detector = (async () => {
      try {
        const { FilesetResolver, ObjectDetector: OD } = await import("@mediapipe/tasks-vision");
        const fileset = await FilesetResolver.forVisionTasks("/vendor/mediapipe");
        const make = (delegate: "GPU" | "CPU") =>
          OD.createFromOptions(fileset, { baseOptions: { modelAssetPath: MODEL_URL, delegate }, runningMode: "IMAGE", scoreThreshold: 0.35, maxResults: 5 });
        return await make("GPU").catch(() => make("CPU"));
      } catch (e) {
        console.error("Object detector unavailable", e);
        return null;
      }
    })();
  }
  return detector;
}

/**
 * Sample the clip every `stepUs` and return the horizontal centre of the
 * biggest person (or, failing that, the biggest object). Null when nothing is
 * found, so the reframer holds its last position.
 */
export async function findSubjects(asset: Asset, fromUs: number, toUs: number, stepUs: number): Promise<SubjectSample[]> {
  const det = await loadDetector();
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.src = await assetUrl(asset);
  await new Promise<void>((res, rej) => {
    video.onloadeddata = () => res();
    video.onerror = () => rej(new Error("Could not read video"));
  });
  const out: SubjectSample[] = [];
  for (let t = fromUs; t <= toUs; t += stepUs) {
    await new Promise<void>((res) => {
      video.onseeked = () => res();
      video.currentTime = Math.min(t, asset.durationUs - 1000) / 1e6;
    });
    let cx: number | null = null;
    if (det) {
      try {
        const r = det.detect(video);
        const area = (d: (typeof r.detections)[number]) => (d.boundingBox ? d.boundingBox.width * d.boundingBox.height : 0);
        const people = r.detections.filter((d) => d.categories.some((c) => c.categoryName === "person"));
        const pick = (people.length ? people : r.detections).sort((a, b) => area(b) - area(a))[0];
        if (pick?.boundingBox) cx = (pick.boundingBox.originX + pick.boundingBox.width / 2) / video.videoWidth;
      } catch {
        cx = null;
      }
    }
    out.push({ tUs: t, cx });
  }
  video.removeAttribute("src");
  video.load();
  return out;
}
