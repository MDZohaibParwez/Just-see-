"use client";

import { audioChainKey, encodeWav, loadDsp, processClipPcm } from "@just-see/engine";
import { sourceSpanUs, type Asset, type MediaClip } from "@just-see/schema";
import { assetPcm } from "./audio-tools";

/**
 * Processed audio for clips with an audio-effect chain, as playable URLs for
 * the preview. Uses the same processing call as export.
 */
const cache = new Map<string, Promise<string | null>>();
const ready = new Map<string, string>();
let listener: (() => void) | null = null;

export function setProcessedListener(fn: (() => void) | null): void {
  listener = fn;
}

export function processedKey(clip: MediaClip): string {
  return `${clip.assetId}|${clip.sourceInUs}|${sourceSpanUs(clip)}|${audioChainKey(clip.audioFx)}`;
}

/** URL of the processed audio if ready; starts processing otherwise. */
export function processedAudioUrl(clip: MediaClip, asset: Asset): string | null {
  const key = processedKey(clip);
  const hit = ready.get(key);
  if (hit) return hit;
  if (!cache.has(key)) {
    cache.set(
      key,
      (async () => {
        try {
          const [pcm, dsp] = await Promise.all([assetPcm(asset), loadDsp()]);
          const out = await processClipPcm(pcm, clip.sourceInUs, sourceSpanUs(clip), clip.audioFx, dsp);
          const url = URL.createObjectURL(new Blob([encodeWav(out.channels, out.sampleRate)], { type: "audio/wav" }));
          ready.set(key, url);
          listener?.();
          return url;
        } catch (e) {
          console.error("Audio effects failed", e);
          return null;
        }
      })(),
    );
  }
  return null;
}

export function isProcessing(clip: MediaClip): boolean {
  const key = processedKey(clip);
  return cache.has(key) && !ready.has(key);
}
