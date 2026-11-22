import type { TextClip } from "@just-see/schema";
import type { TextAnimState } from "../resolve";

export type Canvas2D = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

/** CSS rgba() from #rrggbb plus opacity. */
export function hexToRgba(hex: string, alpha = 1): string {
  const m = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(hex.trim());
  if (!m || !m[1]) return `rgba(0,0,0,${alpha})`;
  let h = m[1];
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

/** Visible text after the typewriter cut, split into lines. Grapheme-aware. */
export function visibleLines(text: string, visible: number): string[] {
  const seg =
    typeof Intl !== "undefined" && "Segmenter" in Intl
      ? Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text), (s) => s.segment)
      : Array.from(text);
  const count = Math.round(seg.length * Math.min(1, Math.max(0, visible)));
  return seg.slice(0, count).join("").split("\n");
}

export function textRasterKey(clip: TextClip, anim: TextAnimState, width: number, height: number): string {
  return JSON.stringify([clip.text, clip.style, clip.transform, anim.dx, anim.dy, anim.scale, anim.visible, anim.blur, width, height]);
}

/**
 * Draw a text clip onto a transparent canvas the size of the frame. Opacity is
 * applied later by the compositor. The browser shapes complex scripts
 * (Devanagari, Nastaliq, Gujarati) natively here; a HarfBuzz path is planned.
 */
export function drawText(ctx: Canvas2D, clip: TextClip, anim: TextAnimState, width: number, height: number): void {
  const st = clip.style;
  const tf = clip.transform;
  ctx.save();
  ctx.clearRect(0, 0, width, height);
  const fontPx = st.fontSize * height;
  ctx.font = `${st.italic ? "italic " : ""}${st.fontWeight} ${fontPx}px ${st.fontFamily}`;
  ctx.textBaseline = "middle";
  ctx.textAlign = st.align;
  if ("letterSpacing" in ctx) {
    (ctx as unknown as { letterSpacing: string }).letterSpacing = `${st.letterSpacing * fontPx}px`;
  }
  const lines = visibleLines(clip.text, anim.visible);
  const allLines = clip.text.split("\n");
  const lineH = fontPx * st.lineHeight;
  // Box size uses the full text so typewriter does not jump around.
  let maxW = 0;
  for (const l of allLines) maxW = Math.max(maxW, ctx.measureText(l).width);
  const boxH = lineH * allLines.length;

  const cx = width / 2 + (tf.x + anim.dx) * width;
  const cy = height / 2 + (tf.y + anim.dy) * height;
  ctx.translate(cx, cy);
  ctx.rotate((tf.rotation * Math.PI) / 180);
  const s = tf.scale * anim.scale;
  ctx.scale(s * (tf.flipH ? -1 : 1), s * (tf.flipV ? -1 : 1));
  if (anim.blur > 0 && "filter" in ctx) ctx.filter = `blur(${anim.blur * height}px)`;

  const pad = fontPx * 0.3;
  if (st.backgroundOpacity > 0) {
    ctx.fillStyle = hexToRgba(st.backgroundColor, st.backgroundOpacity);
    const r = fontPx * 0.25;
    const x = -maxW / 2 - pad;
    const y = -boxH / 2 - pad * 0.6;
    const w = maxW + pad * 2;
    const h = boxH + pad * 1.2;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    ctx.fill();
  }
  const ax = st.align === "left" ? -maxW / 2 : st.align === "right" ? maxW / 2 : 0;
  if (st.shadow) {
    ctx.shadowColor = "rgba(0,0,0,0.55)";
    ctx.shadowBlur = fontPx * 0.15;
    ctx.shadowOffsetY = fontPx * 0.04;
  }
  lines.forEach((line, i) => {
    const y = -boxH / 2 + lineH * (i + 0.5);
    if (st.strokeWidth > 0) {
      ctx.lineJoin = "round";
      ctx.lineWidth = st.strokeWidth * fontPx * 2;
      ctx.strokeStyle = st.strokeColor;
      ctx.strokeText(line, ax, y);
      ctx.shadowColor = "transparent";
    }
    ctx.fillStyle = st.color;
    ctx.fillText(line, ax, y);
  });
  ctx.restore();
}

/** Bounding box of a text clip in canvas pixels (for selection handles). */
export function measureTextBox(
  ctx: Canvas2D,
  clip: TextClip,
  width: number,
  height: number,
): { cx: number; cy: number; w: number; h: number } {
  const st = clip.style;
  const fontPx = st.fontSize * height;
  ctx.save();
  ctx.font = `${st.italic ? "italic " : ""}${st.fontWeight} ${fontPx}px ${st.fontFamily}`;
  let maxW = 0;
  const lines = clip.text.split("\n");
  for (const l of lines) maxW = Math.max(maxW, ctx.measureText(l).width);
  ctx.restore();
  const pad = fontPx * 0.3;
  return {
    cx: width / 2 + clip.transform.x * width,
    cy: height / 2 + clip.transform.y * height,
    w: (maxW + pad * 2) * clip.transform.scale,
    h: (fontPx * st.lineHeight * lines.length + pad * 1.2) * clip.transform.scale,
  };
}
