/**
 * Video stabilisation without AI: measure how each frame moved compared with
 * the one before (global translation, coarse-to-fine block matching on small
 * greyscale frames), smooth the camera path, and return keyframes that move
 * the picture the opposite way plus a small zoom to hide the edges.
 */

export interface GrayFrame {
  data: Uint8Array;
  width: number;
  height: number;
}

/** Mean absolute difference of b shifted by (dx, dy) against a, over the overlap (centre-weighted). */
function sad(a: GrayFrame, b: GrayFrame, dx: number, dy: number, step: number): number {
  const { width: w, height: h } = a;
  const m = Math.ceil(Math.max(Math.abs(dx), Math.abs(dy))) + 2;
  let sum = 0;
  let n = 0;
  for (let y = m; y < h - m; y += step) {
    const yb = y + dy;
    for (let x = m; x < w - m; x += step) {
      const xb = x + dx;
      sum += Math.abs(a.data[y * w + x]! - b.data[yb * w + xb]!);
      n++;
    }
  }
  return n ? sum / n : Infinity;
}

export function downsample(f: GrayFrame): GrayFrame {
  const w = Math.max(1, f.width >> 1);
  const h = Math.max(1, f.height >> 1);
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = 2 * y * f.width + 2 * x;
      out[y * w + x] = (f.data[i]! + f.data[i + 1]! + f.data[i + f.width]! + f.data[i + f.width + 1]!) >> 2;
    }
  return { data: out, width: w, height: h };
}

/**
 * How far frame b's content moved relative to a, in pixels (positive = moved right / down).
 * Searches ±maxShift pixels at full size using a 3-level pyramid.
 */
export function estimateShift(a: GrayFrame, b: GrayFrame, maxShift = 12): { dx: number; dy: number; error: number } {
  const levels: [GrayFrame, GrayFrame][] = [[a, b]];
  while (levels.length < 3 && levels[levels.length - 1]![0].width > 48) {
    const [pa, pb] = levels[levels.length - 1]!;
    levels.push([downsample(pa), downsample(pb)]);
  }
  let dx = 0;
  let dy = 0;
  for (let l = levels.length - 1; l >= 0; l--) {
    const [la, lb] = levels[l]!;
    const scale = 1 << l;
    const range = l === levels.length - 1 ? Math.ceil(maxShift / scale) + 1 : 2;
    let best = Infinity;
    let bx = dx;
    let by = dy;
    for (let sy = dy - range; sy <= dy + range; sy++)
      for (let sx = dx - range; sx <= dx + range; sx++) {
        // Content moving by +s means b(x + s) = a(x).
        const e = sad(la, lb, sx, sy, l === 0 ? 2 : 1);
        if (e < best) {
          best = e;
          bx = sx;
          by = sy;
        }
      }
    dx = bx;
    dy = by;
    if (l > 0) {
      dx *= 2;
      dy *= 2;
    }
  }
  // Sub-pixel refine with a parabola on each axis.
  const e0 = sad(a, b, dx, dy, 2);
  const ref = (p: number, m: number) => {
    const d = p + m - 2 * e0;
    return d > 1e-9 ? (0.5 * (m - p)) / d : 0;
  };
  const fx = ref(sad(a, b, dx - 1, dy, 2), sad(a, b, dx + 1, dy, 2));
  const fy = ref(sad(a, b, dx, dy - 1, 2), sad(a, b, dx, dy + 1, 2));
  return { dx: dx + Math.max(-0.5, Math.min(0.5, fx)), dy: dy + Math.max(-0.5, Math.min(0.5, fy)), error: e0 };
}

/** Gaussian smoothing of a series (sigma in samples), with edge clamping. */
export function smoothSeries(v: readonly number[], sigma: number): number[] {
  if (sigma <= 0) return [...v];
  const r = Math.ceil(sigma * 3);
  const k = Array.from({ length: 2 * r + 1 }, (_, i) => Math.exp(-((i - r) ** 2) / (2 * sigma * sigma)));
  return v.map((_, i) => {
    let s = 0;
    let ws = 0;
    for (let j = -r; j <= r; j++) {
      const idx = Math.min(v.length - 1, Math.max(0, i + j));
      s += v[idx]! * k[j + r]!;
      ws += k[j + r]!;
    }
    return s / ws;
  });
}

export interface StabilizePlan {
  /** Keyframes (clip-local µs) for the clip's x / y offsets, as fractions of the canvas. */
  x: { t: number; v: number }[];
  y: { t: number; v: number }[];
  /** Zoom needed to hide the moving edges. */
  scale: number;
  /** Average shake removed, as a fraction of the frame. */
  shake: number;
}

/**
 * Turn frame-to-frame shifts into correction keyframes.
 * shifts[i] is the motion from sample i to i+1, in pixels of a frame `width`×`height`.
 * `displayW/H` are the clip's on-screen size as fractions of the canvas at scale 1.
 */
export function stabilizePlan(
  timesUs: readonly number[],
  shifts: readonly { dx: number; dy: number }[],
  width: number,
  height: number,
  opts: { smoothSec?: number; sampleFps?: number; displayW?: number; displayH?: number; maxZoom?: number } = {},
): StabilizePlan {
  const fps = opts.sampleFps ?? 10;
  const sigma = (opts.smoothSec ?? 1) * fps;
  const px: number[] = [0];
  const py: number[] = [0];
  for (const s of shifts) {
    px.push(px[px.length - 1]! + s.dx / width);
    py.push(py[py.length - 1]! + s.dy / height);
  }
  const sx = smoothSeries(px, sigma);
  const sy = smoothSeries(py, sigma);
  // Correction moves the picture back towards the smooth path.
  const cx = px.map((v, i) => sx[i]! - v);
  const cy = py.map((v, i) => sy[i]! - v);
  const maxC = Math.max(1e-6, ...cx.map(Math.abs), ...cy.map(Math.abs));
  const scale = Math.min(opts.maxZoom ?? 1.25, 1 + 2 * maxC + 0.01);
  const dw = (opts.displayW ?? 1) * scale;
  const dh = (opts.displayH ?? 1) * scale;
  const shake = cx.concat(cy).reduce((a, b) => a + Math.abs(b), 0) / Math.max(1, cx.length * 2);
  // If the zoom is capped, scale the correction down so edges never show.
  const fit = Math.min(1, (scale - 1) / 2 / maxC);
  return {
    x: timesUs.map((t, i) => ({ t, v: (cx[i] ?? 0) * fit * dw })),
    y: timesUs.map((t, i) => ({ t, v: (cy[i] ?? 0) * fit * dh })),
    scale,
    shake,
  };
}
