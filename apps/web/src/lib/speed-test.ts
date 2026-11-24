/**
 * Device speed test: renders the same work as the README budget (1080p
 * preview, 3 video-sized layers + an effect) for a few seconds and reports
 * frames per second. Runs on the user's phone from /diagnostics.
 */
import { Compositor, defaultParams, EFFECTS_BY_TYPE, type FramePlan, type VisualLayer } from "@just-see/engine";
import { DEFAULT_TRANSFORM, NO_CROP } from "@just-see/schema";

export interface SpeedResult {
  fps: number;
  renderMs: number;
  frames: number;
  gpu: string;
  pass: boolean;
}

function source(w: number, h: number, hue: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = Object.assign(document.createElement("canvas"), { width: w, height: h });
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas is not available");
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, `hsl(${hue} 80% 50%)`);
  g.addColorStop(1, `hsl(${hue + 120} 80% 40%)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  return { canvas, ctx };
}

export function gpuName(): string {
  const gl = document.createElement("canvas").getContext("webgl2");
  const ext = gl?.getExtension("WEBGL_debug_renderer_info");
  return gl && ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : gl ? "WebGL2" : "none";
}

/** Runs for `ms` and resolves with the result. `target` is shown, so the browser really paints. */
export async function runSpeedTest(target: HTMLCanvasElement, ms = 4000): Promise<SpeedResult> {
  const comp = new Compositor(target);
  // Preview size used by the editor for a 1080×1920 project (capped at 1280).
  comp.resize(720, 1280);
  const sources = [source(1080, 1920, 10), source(1920, 1080, 140), source(720, 1280, 260)];
  const brightness = EFFECTS_BY_TYPE.get("brightness");
  const layer = (i: number, scale: number, x: number, y: number): VisualLayer => {
    const s = sources[i]!;
    return {
      kind: "visual",
      clipId: `c${i}`,
      trackId: `t${i}`,
      source: { kind: "image", clipId: `c${i}`, assetId: `a${i}`, sourceTimeUs: 0, width: s.canvas.width, height: s.canvas.height, rotation: 0 },
      transform: { ...DEFAULT_TRANSFORM, scale, x, y },
      crop: NO_CROP,
      blendMode: "normal",
      opacity: 1,
      effects: i === 0 && brightness ? [{ id: "fx", type: "brightness", enabled: true, params: defaultParams(brightness) }] : [],
      localTime: 0,
    };
  };
  let frame = 0;
  // Like video, every source has a new frame each time (forces a texture upload).
  const provider = { getImage: (src: { clipId: string }) => ({ image: sources[Number(src.clipId.slice(1))]!.canvas, rotation: 0, version: frame }) };
  const renderTimes: number[] = [];
  const start = performance.now();
  let last = start;
  const gaps: number[] = [];
  await new Promise<void>((resolve) => {
    const tick = (now: number) => {
      frame++;
      for (const [i, s] of sources.entries()) {
        s.ctx.fillStyle = i === 1 ? "#fff" : "#000";
        s.ctx.fillRect((frame * 7) % s.canvas.width, 0, 6, s.canvas.height);
      }
      const plan: FramePlan = {
        timeUs: 0,
        width: 720,
        height: 1280,
        background: "#000000",
        layers: [layer(0, 1, 0, 0), layer(1, 0.5, 0, -0.25), layer(2, 0.4, 0.2, 0.25)],
      };
      const t0 = performance.now();
      comp.render(plan, provider);
      renderTimes.push(performance.now() - t0);
      if (frame > 1) gaps.push(now - last);
      last = now;
      if (now - start < ms) requestAnimationFrame(tick);
      else resolve();
    };
    requestAnimationFrame(tick);
  });
  comp.dispose();
  const total = gaps.reduce((a, b) => a + b, 0);
  const fps = total ? (gaps.length * 1000) / total : 0;
  const renderMs = renderTimes.reduce((a, b) => a + b, 0) / Math.max(1, renderTimes.length);
  return { fps, renderMs, frames: gaps.length, gpu: gpuName(), pass: fps >= 29 };
}
