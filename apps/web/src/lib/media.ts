"use client";

import { Mp4Demuxer, computePeaks, decodeWithWebAudio, isMp4Like, type MediaLoader } from "@just-see/engine";
import { createId, secondsToUs, type Asset, type AssetKind } from "@just-see/schema";
import { getMedia, putMedia } from "./storage/media-store";
import { loadPeaks, loadThumbs, savePeaks, saveThumbs } from "./storage/db";

/** Object URLs for assets, created once per session. */
const urls = new Map<string, string>();
const blobs = new Map<string, Blob>();

export async function assetBlob(asset: Asset): Promise<Blob> {
  const cached = blobs.get(asset.id);
  if (cached) return cached;
  const b = await getMedia(asset.storageKey);
  if (!b) throw new Error(`Media file missing for ${asset.name}`);
  blobs.set(asset.id, b);
  return b;
}

export async function assetUrl(asset: Asset): Promise<string> {
  const u = urls.get(asset.id);
  if (u) return u;
  const url = URL.createObjectURL(await assetBlob(asset));
  urls.set(asset.id, url);
  return url;
}

export const mediaLoader: MediaLoader = { getBlob: assetBlob };

export function kindOf(file: File): AssetKind | null {
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("audio/")) return "audio";
  if (/\.(mp4|mov|m4v|webm|mkv|3gp)$/i.test(file.name)) return "video";
  if (/\.(png|jpe?g|webp|gif|avif|bmp)$/i.test(file.name)) return "image";
  if (/\.(mp3|m4a|aac|wav|ogg|oga|opus|flac)$/i.test(file.name)) return "audio";
  return null;
}

function loadMediaElement(url: string, kind: "video" | "audio"): Promise<HTMLMediaElement> {
  return new Promise((resolve, reject) => {
    const el = document.createElement(kind);
    el.preload = "metadata";
    el.muted = true;
    const timer = setTimeout(() => reject(new Error("Timed out reading media")), 20000);
    el.onloadedmetadata = () => {
      clearTimeout(timer);
      resolve(el);
    };
    el.onerror = () => {
      clearTimeout(timer);
      reject(new Error("This format is not supported by your browser"));
    };
    el.src = url;
  });
}

/** Read a file's metadata, store it on the device and return a new asset. */
export async function importFile(file: File): Promise<Asset> {
  const kind = kindOf(file);
  if (!kind) throw new Error("Unsupported file type");
  const id = createId("a_");
  const storageKey = `media/${id}`;
  const base: Omit<Asset, "durationUs" | "width" | "height" | "rotation" | "fps" | "hasAudio"> = {
    id,
    kind,
    name: file.name.slice(0, 500),
    mimeType: file.type || "application/octet-stream",
    sizeBytes: file.size,
    storageKey,
    license: { kind: "user-upload", commercialUse: true, licenseName: "Your own media", source: "user" },
    createdAt: Date.now(),
  };
  let asset: Asset;
  const url = URL.createObjectURL(file);
  try {
    if (kind === "image") {
      const bmp = await createImageBitmap(file);
      asset = { ...base, durationUs: 0, width: bmp.width, height: bmp.height, rotation: 0, fps: 0, hasAudio: false };
      bmp.close();
    } else if (kind === "audio") {
      const el = await loadMediaElement(url, "audio");
      asset = { ...base, durationUs: secondsToUs(el.duration), width: 0, height: 0, rotation: 0, fps: 0, hasAudio: true };
    } else {
      const el = (await loadMediaElement(url, "video")) as HTMLVideoElement;
      let rotation = 0;
      let hasAudio = true;
      let fps = 30;
      let durationUs = secondsToUs(el.duration);
      if (isMp4Like(file.type, file.name)) {
        try {
          const d = await Mp4Demuxer.open(file);
          rotation = d.video?.rotation ?? 0;
          hasAudio = !!d.audio;
          fps = d.video?.fps ?? fps;
          if (d.video?.durationUs) durationUs = Math.min(durationUs || d.video.durationUs, d.video.durationUs);
        } catch {
          // Element metadata is enough.
        }
      }
      if (!Number.isFinite(durationUs) || durationUs <= 0) throw new Error("Could not read video length");
      asset = {
        ...base,
        durationUs,
        // videoWidth/Height are already in display orientation.
        width: el.videoWidth,
        height: el.videoHeight,
        rotation,
        fps,
        hasAudio,
      };
    }
  } finally {
    URL.revokeObjectURL(url);
  }
  await putMedia(storageKey, file);
  blobs.set(id, file);
  return asset;
}

export interface Thumb {
  timeUs: number;
  url: string;
}

const thumbCache = new Map<string, Thumb[]>();
const thumbJobs = new Map<string, Promise<Thumb[]>>();

/** A strip of small frames for timeline clips. Cached in IndexedDB. */
export function getThumbnails(asset: Asset): Promise<Thumb[]> {
  const hit = thumbCache.get(asset.id);
  if (hit) return Promise.resolve(hit);
  let job = thumbJobs.get(asset.id);
  if (!job) {
    job = buildThumbnails(asset).then((t) => {
      thumbCache.set(asset.id, t);
      return t;
    });
    thumbJobs.set(asset.id, job);
  }
  return job;
}

async function buildThumbnails(asset: Asset): Promise<Thumb[]> {
  const saved = await loadThumbs(asset.id).catch(() => undefined);
  if (saved) return saved.frames.map((f) => ({ timeUs: f.timeUs, url: URL.createObjectURL(f.blob) }));
  const h = 96;
  const w = Math.max(1, Math.round((asset.width / Math.max(1, asset.height)) * h));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return [];
  const toBlob = () => new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.7));
  const frames: { timeUs: number; blob: Blob }[] = [];
  if (asset.kind === "image") {
    const bmp = await createImageBitmap(await assetBlob(asset));
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close();
    const b = await toBlob();
    if (b) frames.push({ timeUs: 0, blob: b });
  } else if (asset.kind === "video") {
    const v = (await loadMediaElement(await assetUrl(asset), "video")) as HTMLVideoElement;
    const count = Math.min(24, Math.max(2, Math.ceil(asset.durationUs / 1e6 / 1.5)));
    for (let i = 0; i < count; i++) {
      const t = ((i + 0.5) / count) * (asset.durationUs / 1e6);
      await new Promise<void>((resolve) => {
        const done = () => resolve();
        v.onseeked = done;
        setTimeout(done, 3000);
        v.currentTime = Math.min(t, Math.max(0, asset.durationUs / 1e6 - 0.05));
      });
      ctx.drawImage(v, 0, 0, w, h);
      const b = await toBlob();
      if (b) frames.push({ timeUs: Math.round(t * 1e6), blob: b });
    }
    v.removeAttribute("src");
    v.load();
  }
  await saveThumbs({ assetId: asset.id, frames }).catch(() => undefined);
  return frames.map((f) => ({ timeUs: f.timeUs, url: URL.createObjectURL(f.blob) }));
}

export const PEAKS_PER_SECOND = 40;
const peakCache = new Map<string, Promise<Float32Array | null>>();

/** Waveform peaks (min/max pairs) for audio assets. */
export function getPeaks(asset: Asset): Promise<Float32Array | null> {
  let job = peakCache.get(asset.id);
  if (!job) {
    job = (async () => {
      const saved = await loadPeaks(asset.id).catch(() => undefined);
      if (saved) return saved.peaks;
      try {
        const pcm = await decodeWithWebAudio(await assetBlob(asset));
        const ch = pcm.channels[0];
        if (!ch) return null;
        const buckets = Math.max(1, Math.round((ch.length / pcm.sampleRate) * PEAKS_PER_SECOND));
        const peaks = computePeaks(ch, buckets);
        await savePeaks({ assetId: asset.id, perSecond: PEAKS_PER_SECOND, peaks }).catch(() => undefined);
        return peaks;
      } catch {
        return null;
      }
    })();
    peakCache.set(asset.id, job);
  }
  return job;
}

/** Forget cached data for an asset whose file was replaced (e.g. a re-bounced studio mix). */
export function invalidateAsset(assetId: string): void {
  blobs.delete(assetId);
  const u = urls.get(assetId);
  if (u) URL.revokeObjectURL(u);
  urls.delete(assetId);
  thumbCache.delete(assetId);
  thumbJobs.delete(assetId);
  peakCache.delete(assetId);
}
