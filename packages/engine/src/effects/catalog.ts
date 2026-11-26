/**
 * Visual effects. Each effect is a GLSL ES 3.00 function
 * `vec4 effect(vec2 uv)` where `uv` is (0,0) top-left .. (1,1) bottom-right.
 * Helpers available: src(uv), unpremul, premul, luma, hash, noise, rgb2hsv,
 * hsv2rgb, aspect(). Params are `uniform float p_<key>`.
 * Every size is relative to the frame so preview and export match at any
 * resolution.
 */

import { LIBRARY_EFFECTS } from "./library";

export interface ParamDef {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  default: number;
}

export type EffectCategory = "look" | "color" | "blur" | "stylize" | "distort" | "motion" | "retro" | "key" | "light";

export interface EffectDef {
  type: string;
  label: string;
  category: EffectCategory;
  params: ParamDef[];
  /** Number of render passes; the shader can read `uPass`. */
  passes?: number;
  /** Needs a 3D LUT bound as `uLut` (size in `uLutSize`). */
  lut?: boolean;
  glsl: string;
}

const p = (key: string, label: string, min: number, max: number, def: number, step = 0.01): ParamDef => ({
  key,
  label,
  min,
  max,
  step,
  default: def,
});

const amount = (def = 0.5, min = 0, max = 1) => p("amount", "Amount", min, max, def);

const CORE_EFFECTS: readonly EffectDef[] = [
  // ---------- Colour ----------
  {
    type: "brightness",
    label: "Brightness",
    category: "color",
    params: [amount(0.2, -1, 1)],
    glsl: `vec4 effect(vec2 uv){ vec4 c = unpremul(src(uv)); c.rgb = clamp(c.rgb + p_amount * 0.5, 0.0, 1.0); return premul(c); }`,
  },
  {
    type: "contrast",
    label: "Contrast",
    category: "color",
    params: [amount(0.3, -1, 1)],
    glsl: `vec4 effect(vec2 uv){ vec4 c = unpremul(src(uv)); float k = p_amount >= 0.0 ? 1.0 + p_amount * 2.0 : 1.0 + p_amount; c.rgb = clamp((c.rgb - 0.5) * k + 0.5, 0.0, 1.0); return premul(c); }`,
  },
  {
    type: "saturation",
    label: "Saturation",
    category: "color",
    params: [amount(0.4, -1, 1)],
    glsl: `vec4 effect(vec2 uv){ vec4 c = unpremul(src(uv)); float l = luma(c.rgb); c.rgb = clamp(mix(vec3(l), c.rgb, 1.0 + p_amount), 0.0, 1.0); return premul(c); }`,
  },
  {
    type: "exposure",
    label: "Exposure",
    category: "color",
    params: [p("stops", "Stops", -2, 2, 0.5)],
    glsl: `vec4 effect(vec2 uv){ vec4 c = unpremul(src(uv)); c.rgb = clamp(c.rgb * pow(2.0, p_stops), 0.0, 1.0); return premul(c); }`,
  },
  {
    type: "temperature",
    label: "Temperature",
    category: "color",
    params: [amount(0.3, -1, 1)],
    glsl: `vec4 effect(vec2 uv){ vec4 c = unpremul(src(uv)); c.rgb = clamp(c.rgb + vec3(0.12, 0.03, -0.12) * p_amount, 0.0, 1.0); return premul(c); }`,
  },
  {
    type: "tint",
    label: "Tint",
    category: "color",
    params: [amount(0.3, -1, 1)],
    glsl: `vec4 effect(vec2 uv){ vec4 c = unpremul(src(uv)); c.rgb = clamp(c.rgb + vec3(0.06, -0.1, 0.06) * p_amount, 0.0, 1.0); return premul(c); }`,
  },
  {
    type: "hue",
    label: "Hue shift",
    category: "color",
    params: [p("angle", "Angle", -180, 180, 60, 1)],
    glsl: `vec4 effect(vec2 uv){ vec4 c = unpremul(src(uv)); vec3 h = rgb2hsv(c.rgb); h.x = fract(h.x + p_angle / 360.0); c.rgb = hsv2rgb(h); return premul(c); }`,
  },
  {
    type: "grayscale",
    label: "Black & white",
    category: "color",
    params: [amount(1)],
    glsl: `vec4 effect(vec2 uv){ vec4 c = unpremul(src(uv)); c.rgb = mix(c.rgb, vec3(luma(c.rgb)), p_amount); return premul(c); }`,
  },
  {
    type: "sepia",
    label: "Sepia",
    category: "color",
    params: [amount(1)],
    glsl: `vec4 effect(vec2 uv){ vec4 c = unpremul(src(uv)); vec3 s = vec3(dot(c.rgb, vec3(0.393, 0.769, 0.189)), dot(c.rgb, vec3(0.349, 0.686, 0.168)), dot(c.rgb, vec3(0.272, 0.534, 0.131))); c.rgb = mix(c.rgb, clamp(s, 0.0, 1.0), p_amount); return premul(c); }`,
  },
  {
    type: "invert",
    label: "Invert",
    category: "color",
    params: [amount(1)],
    glsl: `vec4 effect(vec2 uv){ vec4 c = unpremul(src(uv)); c.rgb = mix(c.rgb, 1.0 - c.rgb, p_amount); return premul(c); }`,
  },
  {
    type: "duotone",
    label: "Duotone",
    category: "color",
    params: [p("shadow", "Shadow hue", 0, 360, 260, 1), p("highlight", "Highlight hue", 0, 360, 40, 1), amount(1)],
    glsl: `vec4 effect(vec2 uv){ vec4 c = unpremul(src(uv)); float l = luma(c.rgb); vec3 a = hsv2rgb(vec3(p_shadow / 360.0, 0.8, 0.25)); vec3 b = hsv2rgb(vec3(p_highlight / 360.0, 0.6, 1.0)); c.rgb = mix(c.rgb, mix(a, b, l), p_amount); return premul(c); }`,
  },
  {
    type: "vignette",
    label: "Vignette",
    category: "color",
    params: [amount(0.6), p("softness", "Softness", 0.05, 1, 0.5)],
    glsl: `vec4 effect(vec2 uv){ vec4 c = src(uv); vec2 d = (uv - 0.5) * vec2(aspect(), 1.0) / max(aspect(), 1.0); float r = length(d) * 1.4; float v = 1.0 - smoothstep(1.0 - p_softness, 1.0 + 0.0001, r) * p_amount; return vec4(c.rgb * v, c.a); }`,
  },
  {
    type: "posterize",
    label: "Posterize",
    category: "stylize",
    params: [p("levels", "Levels", 2, 16, 5, 1)],
    glsl: `vec4 effect(vec2 uv){ vec4 c = unpremul(src(uv)); c.rgb = floor(c.rgb * p_levels) / (p_levels - 1.0); c.rgb = clamp(c.rgb, 0.0, 1.0); return premul(c); }`,
  },
  // ---------- Blur & detail ----------
  {
    type: "blur",
    label: "Blur",
    category: "blur",
    params: [p("radius", "Radius", 0, 1, 0.3)],
    passes: 2,
    glsl: `vec4 effect(vec2 uv){
      float r = p_radius * 0.03;
      vec2 dir = uPass == 0 ? vec2(r / aspect(), 0.0) : vec2(0.0, r);
      vec4 sum = vec4(0.0); float wsum = 0.0;
      for (int i = -8; i <= 8; i++) { float f = float(i) / 8.0; float w = exp(-f * f * 2.5); sum += src(uv + dir * f) * w; wsum += w; }
      return sum / wsum; }`,
  },
  {
    type: "sharpen",
    label: "Sharpen",
    category: "blur",
    params: [amount(0.5)],
    glsl: `vec4 effect(vec2 uv){ vec2 px = 1.5 / uRes; vec4 c = src(uv); vec4 n = src(uv + vec2(px.x, 0.0)) + src(uv - vec2(px.x, 0.0)) + src(uv + vec2(0.0, px.y)) + src(uv - vec2(0.0, px.y)); vec4 o = c + (c * 4.0 - n) * p_amount; return vec4(clamp(o.rgb, 0.0, o.a), c.a); }`,
  },
  {
    type: "glow",
    label: "Glow",
    category: "blur",
    params: [amount(0.6), p("threshold", "Threshold", 0, 1, 0.6), p("radius", "Radius", 0, 1, 0.4)],
    glsl: `vec4 effect(vec2 uv){
      vec4 c = src(uv); vec3 acc = vec3(0.0); float r = p_radius * 0.04;
      for (int i = 0; i < 24; i++) { float a = float(i) * 2.39996; float d = sqrt(float(i) / 24.0) * r; vec2 o = vec2(cos(a) / aspect(), sin(a)) * d; vec4 s = unpremul(src(uv + o)); acc += max(s.rgb - p_threshold, 0.0) * s.a; }
      acc /= 24.0; vec3 rgb = c.rgb + acc * p_amount * 4.0; return vec4(min(rgb, vec3(1.0)), max(c.a, min(1.0, luma(acc) * p_amount * 4.0))); }`,
  },
  {
    type: "edge",
    label: "Edges",
    category: "stylize",
    params: [amount(1)],
    glsl: `vec4 effect(vec2 uv){ vec2 px = 1.0 / uRes;
      float tl = luma(src(uv + px * vec2(-1., -1.)).rgb), t = luma(src(uv + px * vec2(0., -1.)).rgb), tr = luma(src(uv + px * vec2(1., -1.)).rgb);
      float l = luma(src(uv + px * vec2(-1., 0.)).rgb), r = luma(src(uv + px * vec2(1., 0.)).rgb);
      float bl = luma(src(uv + px * vec2(-1., 1.)).rgb), b = luma(src(uv + px * vec2(0., 1.)).rgb), br = luma(src(uv + px * vec2(1., 1.)).rgb);
      float gx = -tl - 2.0 * l - bl + tr + 2.0 * r + br; float gy = -tl - 2.0 * t - tr + bl + 2.0 * b + br;
      vec4 c = src(uv); float e = clamp(length(vec2(gx, gy)), 0.0, 1.0); return vec4(mix(c.rgb, vec3(e) * c.a, p_amount), c.a); }`,
  },
  // ---------- Stylize ----------
  {
    type: "pixelate",
    label: "Pixelate",
    category: "stylize",
    params: [p("size", "Block size", 0.002, 0.1, 0.02, 0.001)],
    glsl: `vec4 effect(vec2 uv){ vec2 cell = vec2(p_size / aspect(), p_size); return src((floor(uv / cell) + 0.5) * cell); }`,
  },
  {
    type: "kaleidoscope",
    label: "Kaleidoscope",
    category: "distort",
    params: [p("segments", "Segments", 2, 12, 6, 1)],
    glsl: `vec4 effect(vec2 uv){ vec2 d = (uv - 0.5) * vec2(aspect(), 1.0); float r = length(d); float a = atan(d.y, d.x); float seg = 6.28318 / p_segments; a = mod(a, seg); a = abs(a - seg * 0.5); vec2 q = vec2(cos(a), sin(a)) * r; return src(q / vec2(aspect(), 1.0) + 0.5); }`,
  },
  {
    type: "mirror",
    label: "Mirror",
    category: "distort",
    params: [p("mode", "Mode (0 left, 1 top, 2 both)", 0, 2, 0, 1)],
    glsl: `vec4 effect(vec2 uv){ vec2 q = uv; if (p_mode < 0.5 || p_mode > 1.5) q.x = q.x > 0.5 ? 1.0 - q.x : q.x; if (p_mode > 0.5) q.y = q.y > 0.5 ? 1.0 - q.y : q.y; return src(q); }`,
  },
  {
    type: "lens",
    label: "Lens distortion",
    category: "distort",
    params: [amount(0.4, -1, 1)],
    glsl: `vec4 effect(vec2 uv){ vec2 d = (uv - 0.5) * vec2(aspect(), 1.0); float r2 = dot(d, d); vec2 q = d * (1.0 + p_amount * r2 * 1.2); q = q / vec2(aspect(), 1.0) + 0.5; if (q.x < 0.0 || q.x > 1.0 || q.y < 0.0 || q.y > 1.0) return vec4(0.0); return src(q); }`,
  },
  {
    type: "swirl",
    label: "Swirl",
    category: "distort",
    params: [amount(0.5, -1, 1), p("radius", "Radius", 0.05, 1, 0.5)],
    glsl: `vec4 effect(vec2 uv){ vec2 d = (uv - 0.5) * vec2(aspect(), 1.0); float r = length(d); float k = max(0.0, 1.0 - r / p_radius); float a = k * k * p_amount * 6.0; float s = sin(a), c = cos(a); d = mat2(c, -s, s, c) * d; return src(d / vec2(aspect(), 1.0) + 0.5); }`,
  },
  // ---------- Motion ----------
  {
    type: "shake",
    label: "Shake",
    category: "motion",
    params: [amount(0.4), p("speed", "Speed", 0.1, 3, 1)],
    glsl: `vec4 effect(vec2 uv){ float t = uTime * 12.0 * p_speed; vec2 o = vec2(noise(vec2(t, 1.7)) - 0.5, noise(vec2(3.1, t)) - 0.5) * p_amount * 0.06; float z = 1.0 + p_amount * 0.06; return src((uv - 0.5) / z + 0.5 + o); }`,
  },
  {
    type: "zoom-pulse",
    label: "Zoom pulse",
    category: "motion",
    params: [amount(0.3), p("speed", "Beats per second", 0.25, 4, 2, 0.25)],
    glsl: `vec4 effect(vec2 uv){ float ph = fract(uTime * p_speed); float z = 1.0 + p_amount * 0.25 * exp(-ph * 6.0); return src((uv - 0.5) / z + 0.5); }`,
  },
  {
    type: "rgb-split",
    label: "RGB split",
    category: "retro",
    params: [amount(0.4), p("angle", "Angle", 0, 360, 0, 1)],
    glsl: `vec4 effect(vec2 uv){ float a = radians(p_angle); vec2 o = vec2(cos(a) / aspect(), sin(a)) * p_amount * 0.02; vec4 r = src(uv + o); vec4 g = src(uv); vec4 b = src(uv - o); return vec4(r.r, g.g, b.b, max(max(r.a, g.a), b.a)); }`,
  },
  {
    type: "glitch",
    label: "Glitch",
    category: "retro",
    params: [amount(0.5), p("speed", "Speed", 0.1, 3, 1)],
    glsl: `vec4 effect(vec2 uv){ float t = floor(uTime * 15.0 * p_speed); float band = floor(uv.y * 24.0); float h = hash(vec2(band, t)); float on = step(1.0 - p_amount * 0.6, h); vec2 q = uv; q.x += (hash(vec2(t, band + 7.0)) - 0.5) * 0.15 * on * p_amount; float o = 0.01 * p_amount * (1.0 + on * 3.0); vec4 r = src(q + vec2(o, 0.0)); vec4 g = src(q); vec4 b = src(q - vec2(o, 0.0)); return vec4(r.r, g.g, b.b, g.a); }`,
  },
  {
    type: "vhs",
    label: "VHS",
    category: "retro",
    params: [amount(0.6)],
    glsl: `vec4 effect(vec2 uv){ float t = uTime; vec2 q = uv; q.x += (noise(vec2(uv.y * 40.0, t * 6.0)) - 0.5) * 0.006 * p_amount; float o = 0.004 * p_amount; vec4 c = vec4(src(q + vec2(o, 0.0)).r, src(q).g, src(q - vec2(o, 0.0)).b, src(q).a); c = unpremul(c); float scan = 0.85 + 0.15 * sin(uv.y * uRes.y * 1.5); float n = (hash(uv * uRes + t) - 0.5) * 0.12 * p_amount; c.rgb = mix(c.rgb, c.rgb * scan + n, p_amount); c.rgb = mix(c.rgb, vec3(luma(c.rgb)) * vec3(1.05, 1.0, 0.9), 0.25 * p_amount); return premul(clamp(c, 0.0, 1.0)); }`,
  },
  {
    type: "grain",
    label: "Film grain",
    category: "retro",
    params: [amount(0.35), p("size", "Size", 0.5, 4, 1.5, 0.1)],
    glsl: `vec4 effect(vec2 uv){ vec4 c = unpremul(src(uv)); vec2 g = floor(uv * uRes.y / p_size); float n = hash(g + fract(uTime * 24.0) * 97.0) - 0.5; c.rgb = clamp(c.rgb + n * p_amount * 0.4, 0.0, 1.0); return premul(c); }`,
  },
  {
    type: "scanlines",
    label: "Scanlines",
    category: "retro",
    params: [amount(0.4), p("density", "Lines", 50, 800, 300, 10)],
    glsl: `vec4 effect(vec2 uv){ vec4 c = src(uv); float s = 0.5 + 0.5 * sin(uv.y * p_density * 3.14159); return vec4(c.rgb * (1.0 - p_amount * s), c.a); }`,
  },
  {
    type: "light-leak",
    label: "Light leak",
    category: "retro",
    params: [amount(0.5), p("speed", "Speed", 0, 2, 0.5)],
    glsl: `vec4 effect(vec2 uv){ vec4 c = src(uv); float t = uTime * p_speed; vec2 cnt = vec2(0.5 + 0.6 * sin(t * 0.7), 0.3 + 0.4 * cos(t * 0.5)); float d = length((uv - cnt) * vec2(aspect(), 1.0)); float l = exp(-d * d * 4.0) * p_amount; vec3 col = mix(vec3(1.0, 0.45, 0.15), vec3(1.0, 0.85, 0.4), noise(uv * 3.0 + t)); return vec4(min(c.rgb + col * l * c.a, vec3(1.0)), c.a); }`,
  },
];

export const EFFECTS: readonly EffectDef[] = [...CORE_EFFECTS, ...LIBRARY_EFFECTS.map((e) => (e.type === "lut" ? { ...e, lut: true } : e))];

export const EFFECTS_BY_TYPE: ReadonlyMap<string, EffectDef> = new Map(EFFECTS.map((e) => [e.type, e]));

export function defaultParams(def: { params: readonly ParamDef[] }): Record<string, number> {
  const out: Record<string, number> = {};
  for (const prm of def.params) out[prm.key] = prm.default;
  return out;
}

/** Param values with defaults filled in and clamped to range. */
export function resolveParams(def: { params: readonly ParamDef[] }, values: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const prm of def.params) {
    const v = values[prm.key];
    out[prm.key] = typeof v === "number" && Number.isFinite(v) ? Math.min(prm.max, Math.max(prm.min, v)) : prm.default;
  }
  return out;
}
