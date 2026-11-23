"use client";

import {
  Mp4Demuxer,
  decodeMp4Audio,
  decodeWithWebAudio,
  detectBeats,
  detectSilence,
  fitToBeats,
  isMp4Like,
  toMono,
  type Pcm,
} from "@just-see/engine";
import {
  clipEndUs,
  createId,
  findClip,
  getAsset,
  getMainTrack,
  getSequence,
  isMediaClip,
  maxClipDurationUs,
  type Asset,
  type Command,
} from "@just-see/schema";
import { useEditor } from "./editor-store";
import { assetBlob } from "./media";
import { translate, useLocale } from "./i18n";

const tr = (k: Parameters<typeof translate>[1]) => translate(useLocale.getState().locale, k);
const pcmCache = new Map<string, Promise<Pcm>>();

/** Whole-file PCM for an asset (cached for the session). */
export function assetPcm(asset: Asset): Promise<Pcm> {
  let job = pcmCache.get(asset.id);
  if (!job) {
    job = (async () => {
      const blob = await assetBlob(asset);
      if (isMp4Like(asset.mimeType, asset.name) && typeof AudioDecoder !== "undefined") {
        try {
          const d = await Mp4Demuxer.open(blob);
          if (d.audio) return await decodeMp4Audio(d, 0, asset.durationUs);
        } catch {
          // fall back below
        }
      }
      return decodeWithWebAudio(blob);
    })();
    pcmCache.set(asset.id, job);
  }
  return job;
}

/** Detect beats in an audio (or video) clip and add them as timeline markers. */
export async function markBeats(clipId: string): Promise<number> {
  const s = useEditor.getState();
  const p = s.history?.project;
  const loc = p ? findClip(p, clipId) : undefined;
  if (!p || !loc || !isMediaClip(loc.clip)) return 0;
  const asset = getAsset(p, loc.clip.assetId);
  if (!asset) return 0;
  s.toast(tr("analyzing"));
  const pcm = await assetPcm(asset);
  const a = detectBeats(toMono(pcm.channels), pcm.sampleRate);
  const clip = loc.clip;
  // Source time → timeline time for this clip (constant speed).
  const times = a.beatsUs
    .map((b) => b + pcm.startUs)
    .filter((b) => b >= clip.sourceInUs && b <= clip.sourceInUs + clip.durationUs * clip.speed)
    .map((b) => Math.round(clip.startUs + (b - clip.sourceInUs) / clip.speed));
  useEditor.getState().dispatch({ type: "marker/setBeats", payload: { timesUs: times, idPrefix: createId("b_") } });
  useEditor.getState().toast(`${tr("beatsFound")}: ${times.length} · ${a.bpm} BPM`);
  return times.length;
}

/** Retime main-track clips so every cut lands on a beat marker. */
export function cutToBeat(): boolean {
  const s = useEditor.getState();
  const p = s.history?.project;
  if (!p) return false;
  const seq = getSequence(p);
  const beats = seq.markers.filter((m) => m.kind === "beat").map((m) => m.timeUs);
  if (beats.length < 2) {
    s.toast(tr("needBeats"), "error");
    return false;
  }
  const main = getMainTrack(seq);
  const clips = main.clips;
  const durations = clips.map((c) => c.durationUs);
  const max = clips.map((c) => (isMediaClip(c) ? maxClipDurationUs(c, getAsset(p, c.assetId)) : c.durationUs));
  const overlaps = clips.map((c) => (isMediaClip(c) && c.transitionIn ? c.transitionIn.durationUs : 0));
  const next = fitToBeats(durations, max, overlaps, beats);
  const commands: Command[] = [];
  clips.forEach((c, i) => {
    const d = next[i]!;
    if (d !== c.durationUs) commands.push({ type: "clip/update", payload: { clipId: c.id, patch: { durationUs: d } } });
  });
  if (!commands.length) return true;
  return s.dispatch({ type: "batch", payload: { label: "Cut to beat", commands } });
}

/** Cut out quiet parts of a clip (ripples on the main track). */
export async function removeSilence(clipId: string): Promise<number> {
  const s = useEditor.getState();
  const p = s.history?.project;
  const loc = p ? findClip(p, clipId) : undefined;
  if (!p || !loc || !isMediaClip(loc.clip) || loc.clip.kind === "image") return 0;
  const asset = getAsset(p, loc.clip.assetId);
  if (!asset) return 0;
  s.toast(tr("analyzing"));
  const pcm = await assetPcm(asset);
  const clip = loc.clip;
  const ranges = detectSilence(toMono(pcm.channels), pcm.sampleRate)
    .map((r) => ({ startUs: r.startUs + pcm.startUs, endUs: r.endUs + pcm.startUs }))
    // To clip-local timeline time.
    .map((r) => ({ start: (r.startUs - clip.sourceInUs) / clip.speed, end: (r.endUs - clip.sourceInUs) / clip.speed }))
    .map((r) => ({ start: Math.max(0, Math.round(r.start)), end: Math.min(clip.durationUs, Math.round(r.end)) }))
    .filter((r) => r.end - r.start > 200_000);
  if (!ranges.length) {
    s.toast(tr("noSilence"));
    return 0;
  }
  // Work from the end so earlier times stay valid; the id chain follows the left part.
  const commands: Command[] = [];
  const start = clip.startUs;
  const isMain = loc.track.type === "main";
  let current = clip.id;
  const sorted = [...ranges].sort((a, b) => b.start - a.start);
  for (const r of sorted) {
    const atEnd = r.end >= clip.durationUs - 50_000;
    const atStart = r.start <= 50_000;
    if (atStart && atEnd) continue;
    if (atEnd) {
      commands.push({ type: "clip/trim", payload: { clipId: current, edge: "end", timeUs: start + r.start } });
      continue;
    }
    const tail = createId("c_");
    commands.push({ type: "clip/split", payload: { clipId: current, atUs: start + r.end, newClipId: tail } });
    if (atStart) {
      commands.push({ type: "clip/delete", payload: { clipId: current } });
      current = tail;
      continue;
    }
    const gap = createId("c_");
    commands.push({ type: "clip/split", payload: { clipId: current, atUs: start + r.start, newClipId: gap } });
    commands.push({ type: "clip/delete", payload: { clipId: gap } });
  }
  if (!isMain) {
    // Free tracks do not ripple; that is fine, the gaps stay visible.
  }
  const ok = s.dispatch({ type: "batch", payload: { label: "Remove silence", commands } });
  if (ok) useEditor.getState().toast(`${tr("silenceRemoved")}: ${ranges.length}`);
  return ok ? ranges.length : 0;
}

/** Add a user marker at the playhead. */
export function addMarker(): void {
  const s = useEditor.getState();
  s.dispatch({
    type: "marker/add",
    payload: { marker: { id: createId("m_"), timeUs: s.playheadUs, label: "", color: "#0a84ff", kind: "user" } },
  });
}

export { clipEndUs };
