"use client";

import { parseCubeLut, type Lut3D } from "@just-see/engine";
import { createId, type Asset } from "@just-see/schema";
import { putMedia } from "./storage/media-store";
import { assetBlob } from "./media";

const cache = new Map<string, Lut3D | "loading" | "error">();
let onLoaded: (() => void) | null = null;

/** Called by the preview so it re-renders once a LUT finishes loading. */
export function setLutLoadedListener(fn: (() => void) | null): void {
  onLoaded = fn;
}

/** Parsed LUT if ready; starts loading it otherwise. */
export function getLutSync(asset: Asset | undefined): Lut3D | null {
  if (!asset) return null;
  const hit = cache.get(asset.id);
  if (hit && hit !== "loading" && hit !== "error") return hit;
  if (!hit) {
    cache.set(asset.id, "loading");
    void assetBlob(asset)
      .then((b) => b.text())
      .then((text) => {
        cache.set(asset.id, parseCubeLut(text));
        onLoaded?.();
      })
      .catch(() => cache.set(asset.id, "error"));
  }
  return null;
}

/** Validate and store a .cube file as a LUT asset. */
export async function importLut(file: File): Promise<Asset> {
  const text = await file.text();
  const lut = parseCubeLut(text);
  const id = createId("a_");
  const storageKey = `media/${id}`;
  await putMedia(storageKey, file);
  cache.set(id, lut);
  return {
    id,
    kind: "lut",
    name: (lut.title || file.name).slice(0, 500),
    mimeType: "text/plain",
    sizeBytes: file.size,
    durationUs: 0,
    width: lut.size,
    height: lut.size,
    rotation: 0,
    fps: 0,
    hasAudio: false,
    storageKey,
    license: { kind: "user-upload", commercialUse: true, licenseName: "Your own media", source: "user" },
    createdAt: Date.now(),
  };
}
