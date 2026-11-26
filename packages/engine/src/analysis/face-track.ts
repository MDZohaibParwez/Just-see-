/**
 * Face tracking: turn per-frame face boxes into smooth paths for follow-zoom,
 * face blur and stickers that stick to a face. Boxes are fractions of the
 * source frame (0..1). Missing detections hold the last known box; short
 * gaps are filled by blending, so the track never jumps or freezes for long.
 */

export interface FaceBox {
  /** Centre X / Y and size as fractions of the source width / height. */
  cx: number;
  cy: number;
  w: number;
  h: number;
}

export interface FaceSample {
  /** Source time in µs. */
  tUs: number;
  face: FaceBox | null;
}

export interface FaceTrackPoint extends FaceBox {
  tUs: number;
  /** False where no face was seen and the box was held or blended. */
  seen: boolean;
}

export interface TrackOptions {
  /**
   * Smoothing window in samples (each side). Small = follows every move
   * (CapCut-like), large = calmer camera. Default 2.
   */
  smooth?: number;
  /** Gaps up to this many samples are blended between the faces around them. Default 8. */
  maxGap?: number;
}

/** Pick the face to track in one frame: the biggest, but prefer the one near the last position. */
export function pickFace(faces: FaceBox[], last: FaceBox | null): FaceBox | null {
  if (!faces.length) return null;
  if (!last) return [...faces].sort((a, b) => b.w * b.h - a.w * a.h)[0]!;
  const score = (f: FaceBox) => Math.hypot(f.cx - last.cx, f.cy - last.cy) - Math.sqrt(f.w * f.h) * 0.5;
  return [...faces].sort((a, b) => score(a) - score(b))[0]!;
}

/** Fill gaps, hold edges, then smooth with a small centred window. */
export function trackFaces(samples: FaceSample[], opts: TrackOptions = {}): FaceTrackPoint[] {
  const smooth = Math.max(0, Math.round(opts.smooth ?? 2));
  const maxGap = Math.max(0, Math.round(opts.maxGap ?? 8));
  const n = samples.length;
  if (!n) return [];
  const boxes: (FaceBox | null)[] = samples.map((s) => s.face);
  const firstSeen = boxes.findIndex((b) => b);
  if (firstSeen < 0) return [];
  const filled: FaceBox[] = new Array(n);
  // Before the first face: hold the first one.
  for (let i = 0; i <= firstSeen; i++) filled[i] = boxes[firstSeen]!;
  let lastIdx = firstSeen;
  for (let i = firstSeen + 1; i < n; i++) {
    const b = boxes[i];
    if (!b) continue;
    const gap = i - lastIdx - 1;
    const a = boxes[lastIdx]!;
    for (let k = 1; k <= gap; k++) {
      // Short gap: glide between the two faces. Long gap: hold the last one.
      const f = gap <= maxGap ? k / (gap + 1) : 0;
      filled[lastIdx + k] = { cx: a.cx + (b.cx - a.cx) * f, cy: a.cy + (b.cy - a.cy) * f, w: a.w + (b.w - a.w) * f, h: a.h + (b.h - a.h) * f };
    }
    filled[i] = b;
    lastIdx = i;
  }
  for (let i = lastIdx + 1; i < n; i++) filled[i] = boxes[lastIdx]!;

  const out: FaceTrackPoint[] = [];
  for (let i = 0; i < n; i++) {
    let cx = 0;
    let cy = 0;
    let w = 0;
    let h = 0;
    let wsum = 0;
    for (let k = -smooth; k <= smooth; k++) {
      const j = Math.min(n - 1, Math.max(0, i + k));
      // Triangle weights keep the curve smooth without lagging behind.
      const wt = smooth + 1 - Math.abs(k);
      cx += filled[j]!.cx * wt;
      cy += filled[j]!.cy * wt;
      w += filled[j]!.w * wt;
      h += filled[j]!.h * wt;
      wsum += wt;
    }
    out.push({ tUs: samples[i]!.tUs, cx: cx / wsum, cy: cy / wsum, w: w / wsum, h: h / wsum, seen: boxes[i] !== null });
  }
  return out;
}

export interface FollowKey {
  /** Time from the clip start in µs (timeline time). */
  tUs: number;
  /** Transform offsets as fractions of the canvas (0 = centred) and scale. */
  x: number;
  y: number;
  scale: number;
}

/**
 * Follow-zoom keyframes: keep the face at the frame centre (or `targetY` from
 * the top) at a zoom where the face is `faceHeight` of the canvas height,
 * never showing past the source edges.
 */
export function followKeys(
  track: FaceTrackPoint[],
  srcAspect: number,
  canvasAspect: number,
  opts: { sourceInUs: number; speed: number; faceHeight?: number; targetY?: number; maxScale?: number },
): FollowKey[] {
  // Scale 1 = source fitted inside the canvas. "Cover" is the minimum zoom with no empty bars.
  const fitW = srcAspect >= canvasAspect ? 1 : srcAspect / canvasAspect;
  const fitH = srcAspect >= canvasAspect ? canvasAspect / srcAspect : 1;
  const cover = Math.max(1 / fitW, 1 / fitH);
  const want = opts.faceHeight ?? 0.32;
  const targetY = opts.targetY ?? 0.42;
  const maxScale = opts.maxScale ?? 6;
  return track.map((p) => {
    const faceOnCanvas = p.h * fitH;
    const scale = Math.min(maxScale, Math.max(cover, want / Math.max(0.01, faceOnCanvas)));
    // Displayed source size as fractions of the canvas.
    const dw = fitW * scale;
    const dh = fitH * scale;
    // Move so the face lands at (0.5, targetY); clamp so the source still covers the canvas.
    let x = (0.5 - p.cx) * dw;
    let y = (targetY - 0.5) - (p.cy - 0.5) * dh;
    const maxX = Math.max(0, (dw - 1) / 2);
    const maxY = Math.max(0, (dh - 1) / 2);
    x = Math.min(maxX, Math.max(-maxX, x));
    y = Math.min(maxY, Math.max(-maxY, y));
    return { tUs: Math.max(0, Math.round((p.tUs - opts.sourceInUs) / opts.speed)), x, y, scale };
  });
}

/**
 * Where a face sits on the canvas for a clip with a static transform
 * (scale, x, y), as canvas fractions. Used for face blur masks and stickers.
 */
export function faceOnCanvas(p: FaceBox, srcAspect: number, canvasAspect: number, t: { scale: number; x: number; y: number }): FaceBox {
  const fitW = srcAspect >= canvasAspect ? 1 : srcAspect / canvasAspect;
  const fitH = srcAspect >= canvasAspect ? canvasAspect / srcAspect : 1;
  const dw = fitW * t.scale;
  const dh = fitH * t.scale;
  return { cx: 0.5 + t.x + (p.cx - 0.5) * dw, cy: 0.5 + t.y + (p.cy - 0.5) * dh, w: p.w * dw, h: p.h * dh };
}

/** Drop keyframes that a straight line through their neighbours already gives (keeps projects small). */
export function thinKeys<T extends { tUs: number }>(keys: T[], fields: (keyof T)[], tolerance = 0.002): T[] {
  if (keys.length <= 2) return keys;
  const out: T[] = [keys[0]!];
  for (let i = 1; i < keys.length - 1; i++) {
    const a = out[out.length - 1]!;
    const b = keys[i]!;
    const c = keys[i + 1]!;
    const f = (b.tUs - a.tUs) / Math.max(1, c.tUs - a.tUs);
    const off = fields.some((k) => Math.abs((a[k] as number) + ((c[k] as number) - (a[k] as number)) * f - (b[k] as number)) > tolerance);
    if (off) out.push(b);
  }
  out.push(keys[keys.length - 1]!);
  return out;
}
