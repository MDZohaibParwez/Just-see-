import type { Transform } from "@just-see/schema";

/** Column-major 3x3 matrix, as WebGL expects for mat3 uniforms. */
export type Mat3 = [number, number, number, number, number, number, number, number, number];

export function identity(): Mat3 {
  return [1, 0, 0, 0, 1, 0, 0, 0, 1];
}

export function multiply(a: Mat3, b: Mat3): Mat3 {
  const out = new Array<number>(9).fill(0) as Mat3;
  for (let col = 0; col < 3; col++) {
    for (let row = 0; row < 3; row++) {
      let sum = 0;
      for (let k = 0; k < 3; k++) sum += a[k * 3 + row]! * b[col * 3 + k]!;
      out[col * 3 + row] = sum;
    }
  }
  return out;
}

export function translation(tx: number, ty: number): Mat3 {
  return [1, 0, 0, 0, 1, 0, tx, ty, 1];
}

export function scaling(sx: number, sy: number): Mat3 {
  return [sx, 0, 0, 0, sy, 0, 0, 0, 1];
}

/** Rotation by `deg` clockwise in a y-down pixel space. */
export function rotation(deg: number): Mat3 {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return [c, s, 0, -s, c, 0, 0, 0, 1];
}

export function apply(m: Mat3, x: number, y: number): [number, number] {
  return [m[0] * x + m[3] * y + m[6], m[1] * x + m[4] * y + m[7]];
}

/** Scale that fits a w×h source entirely inside the canvas. */
export function containScale(srcW: number, srcH: number, canvasW: number, canvasH: number): number {
  if (srcW <= 0 || srcH <= 0) return 1;
  return Math.min(canvasW / srcW, canvasH / srcH);
}

/**
 * Matrix that maps the unit quad (-0.5..0.5) to canvas pixels (y down) for a
 * source of display size srcW×srcH with the given transform.
 */
export function placementMatrix(
  transform: Transform,
  srcW: number,
  srcH: number,
  canvasW: number,
  canvasH: number,
): Mat3 {
  const fit = containScale(srcW, srcH, canvasW, canvasH) * transform.scale;
  const w = srcW * fit * (transform.flipH ? -1 : 1);
  const h = srcH * fit * (transform.flipV ? -1 : 1);
  const cx = canvasW / 2 + transform.x * canvasW;
  const cy = canvasH / 2 + transform.y * canvasH;
  return multiply(translation(cx, cy), multiply(rotation(transform.rotation), scaling(w, h)));
}

/**
 * UV matrix for sources whose pixels are stored unrotated (decoded frames of a
 * video with a rotation flag). Maps display UV (0..1, y down) to stored UV.
 */
export function uvRotationMatrix(rotationDeg: number): Mat3 {
  const r = ((rotationDeg % 360) + 360) % 360;
  // Rotate around the centre of the unit square.
  return multiply(translation(0.5, 0.5), multiply(rotation(-r), translation(-0.5, -0.5)));
}

/** Axis-aligned bounds of a placed layer in canvas pixels (for hit-testing). */
export function placedCorners(m: Mat3): [number, number][] {
  return [
    apply(m, -0.5, -0.5),
    apply(m, 0.5, -0.5),
    apply(m, 0.5, 0.5),
    apply(m, -0.5, 0.5),
  ];
}

/** Is canvas point (px, py) inside the placed quad? */
export function hitTest(m: Mat3, px: number, py: number): boolean {
  const pts = placedCorners(m);
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i]!;
    const [xj, yj] = pts[j]!;
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
