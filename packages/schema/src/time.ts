/** Time helpers. All timeline values are integer microseconds. */

export const US_PER_SECOND = 1_000_000;

export function secondsToUs(seconds: number): number {
  return Math.round(seconds * US_PER_SECOND);
}

export function usToSeconds(us: number): number {
  return us / US_PER_SECOND;
}

/** Duration of one frame in microseconds (not rounded). */
export function frameDurationUs(fps: number): number {
  return US_PER_SECOND / fps;
}

/** Index of the frame that contains time `us`. */
export function usToFrame(us: number, fps: number): number {
  // +0.5 µs absorbs the rounding done in frameToUs.
  return Math.floor(((us + 0.5) * fps) / US_PER_SECOND);
}

/** Start time of frame `frame`, rounded to whole microseconds. */
export function frameToUs(frame: number, fps: number): number {
  return Math.round((frame * US_PER_SECOND) / fps);
}

/** Snap a time to the nearest frame boundary. */
export function quantizeToFrame(us: number, fps: number): number {
  return frameToUs(Math.round((us * fps) / US_PER_SECOND), fps);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Format as m:ss.f or h:mm:ss for display. */
export function formatTimecode(us: number, withFraction = true): string {
  const totalSeconds = Math.max(0, us) / US_PER_SECOND;
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  const tenths = Math.floor((totalSeconds * 10) % 10);
  const ss = String(s).padStart(2, "0");
  const base = h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
  return withFraction ? `${base}.${tenths}` : base;
}
