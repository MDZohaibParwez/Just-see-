import type { Asset, Clip, MediaClip, Project, Sequence, Track } from "./model";
import { isMediaClip } from "./model";

/** Shortest clip we allow on a timeline: 1/10 s. */
export const MIN_CLIP_DURATION_US = 100_000;
/** Shortest transition. */
export const MIN_TRANSITION_US = 100_000;

export function getSequence(project: Project, sequenceId?: string): Sequence {
  const id = sequenceId ?? project.activeSequenceId;
  const seq = project.sequences.find((s) => s.id === id);
  if (!seq) throw new Error(`Sequence not found: ${id}`);
  return seq;
}

export function getAsset(project: Project, assetId: string): Asset | undefined {
  return project.assets.find((a) => a.id === assetId);
}

export function getMainTrack(seq: Sequence): Track {
  const track = seq.tracks.find((t) => t.type === "main");
  if (!track) throw new Error("Sequence has no main track");
  return track;
}

export interface ClipLocation {
  sequence: Sequence;
  track: Track;
  clip: Clip;
  index: number;
}

export function findClip(project: Project, clipId: string): ClipLocation | undefined {
  for (const sequence of project.sequences) {
    for (const track of sequence.tracks) {
      const index = track.clips.findIndex((c) => c.id === clipId);
      if (index >= 0) {
        const clip = track.clips[index];
        if (clip) return { sequence, track, clip, index };
      }
    }
  }
  return undefined;
}

export function clipEndUs(clip: Clip): number {
  return clip.startUs + clip.durationUs;
}

/** Amount of source media a clip consumes. */
export function sourceSpanUs(clip: MediaClip): number {
  return Math.round(clip.durationUs * clip.speed);
}

/** Source time for a timeline time inside the clip. */
export function sourceTimeAt(clip: MediaClip, timelineUs: number): number {
  return Math.round(clip.sourceInUs + (timelineUs - clip.startUs) * clip.speed);
}

export function trackEndUs(track: Track): number {
  let end = 0;
  for (const c of track.clips) end = Math.max(end, clipEndUs(c));
  return end;
}

export function sequenceDurationUs(seq: Sequence): number {
  let end = 0;
  for (const t of seq.tracks) end = Math.max(end, trackEndUs(t));
  return end;
}

/**
 * Longest timeline duration a media clip can have, given its source and speed.
 * Images have no source limit.
 */
export function maxClipDurationUs(clip: MediaClip, asset: Asset | undefined): number {
  if (clip.kind === "image" || !asset) return Number.MAX_SAFE_INTEGER;
  const remaining = Math.max(0, asset.durationUs - clip.sourceInUs);
  return Math.floor(remaining / clip.speed);
}

/** Largest transition allowed between two neighbouring clips. */
export function maxTransitionUs(prev: Clip, next: Clip): number {
  return Math.floor(Math.min(prev.durationUs, next.durationUs) / 2);
}

/**
 * The main track is magnetic: clips sit back to back from 0 in array order.
 * A transition makes the clip overlap the previous one by its duration.
 * Mutates the track in place.
 */
export function normalizeMainTrack(track: Track): void {
  let cursor = 0;
  track.clips.forEach((clip, i) => {
    if (isMediaClip(clip)) {
      const prev = i > 0 ? track.clips[i - 1] : undefined;
      if (!prev) {
        clip.transitionIn = null;
      } else if (clip.transitionIn) {
        const max = maxTransitionUs(prev, clip);
        if (max < MIN_TRANSITION_US) clip.transitionIn = null;
        else clip.transitionIn.durationUs = Math.min(Math.max(clip.transitionIn.durationUs, MIN_TRANSITION_US), max);
      }
      const overlap = clip.transitionIn ? clip.transitionIn.durationUs : 0;
      clip.startUs = Math.max(0, cursor - overlap);
    } else {
      clip.startUs = cursor;
    }
    cursor = clip.startUs + clip.durationUs;
  });
}

/** Keep free tracks sorted by start time. */
export function sortTrack(track: Track): void {
  track.clips.sort((a, b) => a.startUs - b.startUs);
}

/** True if [startUs, startUs+durationUs) overlaps any clip on the track (ignoring `ignoreId`). */
export function overlapsOnTrack(track: Track, startUs: number, durationUs: number, ignoreId?: string): boolean {
  const end = startUs + durationUs;
  return track.clips.some((c) => c.id !== ignoreId && c.startUs < end && startUs < clipEndUs(c));
}

/** Clip on `track` that covers time `t`, if any. */
export function clipAt(track: Track, t: number): Clip | undefined {
  return track.clips.find((c) => c.startUs <= t && t < clipEndUs(c));
}

/** Main-track index where a clip dropped at time `t` should go. */
export function mainTrackInsertIndex(track: Track, t: number, ignoreId?: string): number {
  const clips = track.clips.filter((c) => c.id !== ignoreId);
  for (let i = 0; i < clips.length; i++) {
    const c = clips[i];
    if (!c) continue;
    if (t < c.startUs + c.durationUs / 2) return i;
  }
  return clips.length;
}

export interface SnapResult {
  timeUs: number;
  snapped: boolean;
  target?: number;
}

/** Snap `t` to the nearest candidate within `thresholdUs`. */
export function snapTime(t: number, candidates: readonly number[], thresholdUs: number): SnapResult {
  let best: number | undefined;
  let bestDist = thresholdUs;
  for (const c of candidates) {
    const d = Math.abs(c - t);
    if (d <= bestDist) {
      bestDist = d;
      best = c;
    }
  }
  return best === undefined ? { timeUs: t, snapped: false } : { timeUs: best, snapped: true, target: best };
}

/** Clip edges, playhead and 0 — the points an edit may snap to. */
export function collectSnapPoints(seq: Sequence, opts: { excludeClipId?: string; playheadUs?: number } = {}): number[] {
  const points = new Set<number>([0]);
  if (opts.playheadUs !== undefined) points.add(opts.playheadUs);
  for (const t of seq.tracks) {
    for (const c of t.clips) {
      if (c.id === opts.excludeClipId) continue;
      points.add(c.startUs);
      points.add(clipEndUs(c));
    }
  }
  return [...points].sort((a, b) => a - b);
}
