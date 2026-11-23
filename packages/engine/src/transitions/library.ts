import type { TransitionDef } from "./catalog";

/**
 * Phase 2 transitions. Same conventions as catalog.ts: `vec4 transition(vec2 uv)`
 * with getFrom/getTo and `progress` (0..1, eased). uv (0,0) is top-left.
 */

const f = (n: number) => (Number.isInteger(n) ? `${n}.0` : `${n}`);

// Soft wipes at 8 angles.
const angleWipes: TransitionDef[] = [0, 45, 90, 135, 180, 225, 270, 315].map((deg) => ({
  type: `wipe-${deg}`,
  label: `Wipe ${deg}°`,
  category: "wipe",
  glsl: `vec4 transition(vec2 uv){ vec2 dir = vec2(cos(radians(${f(deg)})), sin(radians(${f(deg)}))); float proj = dot(uv - 0.5, dir) / (abs(dir.x) * 0.5 + abs(dir.y) * 0.5) * 0.5 + 0.5; float e = 0.06; float m = smoothstep(proj - e, proj, progress * (1.0 + e)); return mix(getFrom(uv), getTo(uv), m); }`,
}));

// Iris shapes opening/closing.
const shape = (type: string, label: string, sdf: string): TransitionDef[] => [
  {
    type: `${type}-open`,
    label: `${label} open`,
    category: "wipe",
    glsl: `float sdf(vec2 q){ ${sdf} } vec4 transition(vec2 uv){ vec2 q = (uv - 0.5) * vec2(aspect(), 1.0); float d = sdf(q / max(progress * 1.6, 0.0001)); float m = 1.0 - smoothstep(-0.02, 0.02, d); return mix(getFrom(uv), getTo(uv), progress >= 1.0 ? 1.0 : m); }`,
  },
  {
    type: `${type}-close`,
    label: `${label} close`,
    category: "wipe",
    glsl: `float sdf(vec2 q){ ${sdf} } vec4 transition(vec2 uv){ vec2 q = (uv - 0.5) * vec2(aspect(), 1.0); float d = sdf(q / max((1.0 - progress) * 1.6, 0.0001)); float m = 1.0 - smoothstep(-0.02, 0.02, d); return mix(getTo(uv), getFrom(uv), progress >= 1.0 ? 0.0 : m); }`,
  },
];

const shapes: TransitionDef[] = [
  ...shape("diamond", "Diamond", "return (abs(q.x) + abs(q.y)) - 0.5;"),
  ...shape("square", "Square", "return sdBox(q, vec2(0.35));"),
  ...shape("star", "Star", "float a = atan(q.y, q.x); float r = length(q); float k = 0.35 + 0.12 * cos(a * 5.0); return r - k;"),
  ...shape("heart", "Heart", "q.y = -q.y + 0.1; q *= 1.4; float x = q.x; float y = q.y; float v = pow(x * x + y * y - 0.25, 3.0) - x * x * y * y * y; return v * 8.0;"),
  { type: "circle-close", label: "Circle close", category: "wipe", glsl: `vec4 transition(vec2 uv){ vec2 d = (uv - 0.5) * vec2(aspect(), 1.0); float r = (1.0 - progress) * length(vec2(aspect(), 1.0)) * 0.5 * 1.05; float m = 1.0 - smoothstep(r - 0.01, r, length(d)); return mix(getTo(uv), getFrom(uv), m); }` },
];

const blinds: TransitionDef[] = [
  { type: "blinds-h", label: "Blinds", category: "wipe", glsl: `vec4 transition(vec2 uv){ float m = step(fract(uv.y * 10.0), progress); return mix(getFrom(uv), getTo(uv), m); }` },
  { type: "blinds-v", label: "Vertical blinds", category: "wipe", glsl: `vec4 transition(vec2 uv){ float m = step(fract(uv.x * 10.0), progress); return mix(getFrom(uv), getTo(uv), m); }` },
  { type: "checker", label: "Checkerboard", category: "wipe", glsl: `vec4 transition(vec2 uv){ vec2 g = floor(uv * vec2(8.0 * aspect(), 8.0)); float off = mod(g.x + g.y, 2.0) * 0.5; float m = step(off, progress * 1.5 - 0.0) * step(fract(uv.x * 8.0 * aspect()), (progress * 1.5 - off) * 2.0); return mix(getFrom(uv), getTo(uv), clamp(m, 0.0, 1.0) * step(0.0001, progress) + step(0.999, progress)); }` },
  { type: "random-blocks", label: "Random blocks", category: "wipe", glsl: `vec4 transition(vec2 uv){ vec2 g = floor(uv * vec2(12.0 * aspect(), 12.0)); float m = step(hash(g), progress); return mix(getFrom(uv), getTo(uv), m); }` },
  { type: "stripes", label: "Diagonal stripes", category: "wipe", glsl: `vec4 transition(vec2 uv){ float s = fract((uv.x + uv.y) * 6.0); float m = step(s, progress * 1.2 - (uv.x + uv.y) * 0.1); return mix(getFrom(uv), getTo(uv), clamp(m, 0.0, 1.0)); }` },
  { type: "barn-h", label: "Barn doors", category: "wipe", glsl: `vec4 transition(vec2 uv){ float m = step(abs(uv.x - 0.5), progress * 0.5); return mix(getFrom(uv), getTo(uv), m); }` },
  { type: "barn-v", label: "Split vertical", category: "wipe", glsl: `vec4 transition(vec2 uv){ float m = step(abs(uv.y - 0.5), progress * 0.5); return mix(getFrom(uv), getTo(uv), m); }` },
  { type: "clock", label: "Clock wipe", category: "wipe", glsl: `vec4 transition(vec2 uv){ vec2 d = uv - 0.5; float a = fract(atan(d.x, -d.y) / 6.28318 + 1.0); float m = step(a, progress); return mix(getFrom(uv), getTo(uv), m); }` },
  { type: "radial", label: "Radial wipe", category: "wipe", glsl: `vec4 transition(vec2 uv){ vec2 d = uv - 0.5; float a = abs(atan(d.x, -d.y)) / 3.14159; float m = smoothstep(a - 0.02, a, progress); return mix(getFrom(uv), getTo(uv), m); }` },
  { type: "spiral", label: "Spiral", category: "wipe", glsl: `vec4 transition(vec2 uv){ vec2 d = (uv - 0.5) * vec2(aspect(), 1.0); float a = fract(atan(d.y, d.x) / 6.28318 + 0.5); float r = length(d); float v = fract(a + r * 3.0); float m = step(v * 0.5 + r * 0.5, progress * 1.2); return mix(getFrom(uv), getTo(uv), m); }` },
];

const slides: TransitionDef[] = [
  { type: "push-right", label: "Push right", category: "slide", glsl: `vec4 transition(vec2 uv){ return uv.x > progress ? getFrom(uv - vec2(progress, 0.0)) : getTo(uv + vec2(1.0 - progress, 0.0)); }` },
  { type: "push-down", label: "Push down", category: "slide", glsl: `vec4 transition(vec2 uv){ return uv.y > progress ? getFrom(uv - vec2(0.0, progress)) : getTo(uv + vec2(0.0, 1.0 - progress)); }` },
  { type: "slide-tl", label: "Slide from corner", category: "slide", glsl: `vec4 transition(vec2 uv){ vec2 o = vec2(1.0 - progress); vec2 q = uv + o; return (q.x <= 1.0 && q.y <= 1.0) ? getTo(q) : getFrom(uv); }` },
  { type: "slide-br", label: "Slide to corner", category: "slide", glsl: `vec4 transition(vec2 uv){ vec2 q = uv - vec2(progress); return (q.x >= 0.0 && q.y >= 0.0) ? getFrom(q) : getTo(uv); }` },
  { type: "cover-left", label: "Cover left", category: "slide", glsl: `vec4 transition(vec2 uv){ vec4 a = getFrom(uv) * (1.0 - progress * 0.4); return uv.x > 1.0 - progress ? getTo(uv - vec2(1.0 - progress, 0.0)) : a; }` },
  { type: "reveal-left", label: "Reveal left", category: "slide", glsl: `vec4 transition(vec2 uv){ vec2 q = uv + vec2(progress, 0.0); return q.x < 1.0 ? getFrom(q) : getTo(uv) * (0.6 + 0.4 * progress); }` },
];

const zooms: TransitionDef[] = [
  { type: "zoom-blur-in", label: "Zoom blur in", category: "zoom", glsl: `vec4 transition(vec2 uv){ float s = sin(progress * 3.14159); vec4 a = vec4(0.0); vec4 b = vec4(0.0); for (int i = 0; i < 12; i++) { float k = 1.0 - s * 0.3 * float(i) / 11.0; a += getFrom(0.5 + (uv - 0.5) * k / (1.0 + progress)); b += getTo(0.5 + (uv - 0.5) * k * (2.0 - progress)); } return mix(a / 12.0, b / 12.0, smoothstep(0.4, 0.6, progress)); }` },
  { type: "zoom-blur-out", label: "Zoom blur out", category: "zoom", glsl: `vec4 transition(vec2 uv){ float s = sin(progress * 3.14159); vec4 a = vec4(0.0); vec4 b = vec4(0.0); for (int i = 0; i < 12; i++) { float k = 1.0 + s * 0.3 * float(i) / 11.0; a += getFrom(0.5 + (uv - 0.5) * k * (1.0 + progress)); b += getTo(0.5 + (uv - 0.5) * k / (2.0 - progress)); } return mix(a / 12.0, b / 12.0, smoothstep(0.4, 0.6, progress)); }` },
  { type: "whip-left", label: "Whip pan left", category: "zoom", glsl: `vec4 transition(vec2 uv){ float s = sin(progress * 3.14159); vec4 c = vec4(0.0); for (int i = 0; i < 16; i++) { float o = (float(i) / 15.0 - 0.5) * s * 0.25; vec2 q = uv + vec2(progress + o, 0.0); c += q.x < 1.0 ? getFrom(q) : getTo(q - vec2(1.0, 0.0)); } return c / 16.0; }` },
  { type: "whip-right", label: "Whip pan right", category: "zoom", glsl: `vec4 transition(vec2 uv){ float s = sin(progress * 3.14159); vec4 c = vec4(0.0); for (int i = 0; i < 16; i++) { float o = (float(i) / 15.0 - 0.5) * s * 0.25; vec2 q = uv - vec2(progress + o, 0.0); c += q.x > 0.0 ? getFrom(q) : getTo(q + vec2(1.0, 0.0)); } return c / 16.0; }` },
  { type: "whip-up", label: "Whip pan up", category: "zoom", glsl: `vec4 transition(vec2 uv){ float s = sin(progress * 3.14159); vec4 c = vec4(0.0); for (int i = 0; i < 16; i++) { float o = (float(i) / 15.0 - 0.5) * s * 0.25; vec2 q = uv + vec2(0.0, progress + o); c += q.y < 1.0 ? getFrom(q) : getTo(q - vec2(0.0, 1.0)); } return c / 16.0; }` },
  { type: "whip-down", label: "Whip pan down", category: "zoom", glsl: `vec4 transition(vec2 uv){ float s = sin(progress * 3.14159); vec4 c = vec4(0.0); for (int i = 0; i < 16; i++) { float o = (float(i) / 15.0 - 0.5) * s * 0.25; vec2 q = uv - vec2(0.0, progress + o); c += q.y > 0.0 ? getFrom(q) : getTo(q + vec2(0.0, 1.0)); } return c / 16.0; }` },
  { type: "zoom-rotate", label: "Zoom & rotate", category: "zoom", glsl: `vec4 transition(vec2 uv){ vec2 d = (uv - 0.5) * vec2(aspect(), 1.0); vec2 a = rot2(d, progress * 1.5) * (1.0 + progress * 2.0); vec2 b = rot2(d, (progress - 1.0) * 1.5) * (1.0 + (1.0 - progress) * 2.0); vec4 fa = getFrom(a / vec2(aspect(), 1.0) + 0.5); vec4 tb = getTo(b / vec2(aspect(), 1.0) + 0.5); return mix(fa, tb, smoothstep(0.3, 0.7, progress)); }` },
  { type: "scale-fade", label: "Scale fade", category: "zoom", glsl: `vec4 transition(vec2 uv){ vec4 a = getFrom(0.5 + (uv - 0.5) / (1.0 + progress * 0.3)); vec4 b = getTo(0.5 + (uv - 0.5) / (0.7 + progress * 0.3)); return mix(a, b, progress); }` },
];

const glitches: TransitionDef[] = [
  { type: "digital-blocks", label: "Digital blocks", category: "stylish", glsl: `vec4 transition(vec2 uv){ float s = sin(progress * 3.14159); vec2 g = floor(uv * vec2(16.0, 9.0)); float h = hash(g + floor(progress * 12.0)); vec2 o = (vec2(hash(g + 1.0), hash(g + 2.0)) - 0.5) * 0.1 * s * step(0.7, h); return mix(getFrom(uv + o), getTo(uv + o), step(h, progress)); }` },
  { type: "scan-glitch", label: "Scanline glitch", category: "stylish", glsl: `vec4 transition(vec2 uv){ float s = sin(progress * 3.14159); float line = floor(uv.y * 120.0); float o = (hash(vec2(line, floor(progress * 30.0))) - 0.5) * 0.08 * s; vec2 q = uv + vec2(o, 0.0); return mix(getFrom(q), getTo(q), smoothstep(0.45, 0.55, progress + o * 3.0)); }` },
  { type: "noise-dissolve", label: "Noise dissolve", category: "stylish", glsl: `vec4 transition(vec2 uv){ float n = fbm(uv * 6.0); float m = smoothstep(n - 0.05, n + 0.05, progress * 1.1); return mix(getFrom(uv), getTo(uv), m); }` },
  { type: "rgb-glitch", label: "RGB glitch", category: "stylish", glsl: `vec4 transition(vec2 uv){ float s = sin(progress * 3.14159) * 0.04; vec4 a = vec4(getFrom(uv + vec2(s, 0.0)).r, getFrom(uv).g, getFrom(uv - vec2(s, 0.0)).b, 1.0); vec4 b = vec4(getTo(uv + vec2(s, 0.0)).r, getTo(uv).g, getTo(uv - vec2(s, 0.0)).b, 1.0); return mix(a, b, progress); }` },
];

const lights: TransitionDef[] = [
  { type: "light-leak", label: "Light leak", category: "stylish", glsl: `vec4 transition(vec2 uv){ float s = sin(progress * 3.14159); vec3 col = mix(vec3(1.0, 0.45, 0.1), vec3(1.0, 0.85, 0.5), uv.x); float k = s * (0.6 + 0.4 * fbm(uv * 3.0 + progress)); vec4 m = mix(getFrom(uv), getTo(uv), smoothstep(0.35, 0.65, progress)); return vec4(min(m.rgb + col * k, vec3(1.0)), m.a); }` },
  { type: "flash-burn", label: "Flash burn", category: "stylish", glsl: `vec4 transition(vec2 uv){ float s = pow(sin(progress * 3.14159), 3.0); vec4 m = mix(getFrom(uv), getTo(uv), step(0.5, progress)); return vec4(min(m.rgb + vec3(s * 1.2), vec3(1.0)), m.a); }` },
  { type: "film-burn", label: "Film burn", category: "stylish", glsl: `vec4 transition(vec2 uv){ float n = fbm(uv * 4.0 + progress * 2.0); float b = smoothstep(progress - 0.2, progress, n * 0.8 + uv.x * 0.2); vec4 m = mix(getTo(uv), getFrom(uv), b); float edge = smoothstep(0.0, 0.15, abs(b - 0.5) * 2.0); vec3 fire = vec3(1.0, 0.5, 0.1) * (1.0 - edge) * sin(progress * 3.14159); return vec4(min(m.rgb + fire, vec3(1.0)), m.a); }` },
  { type: "glow-dissolve", label: "Glow dissolve", category: "stylish", glsl: `vec4 transition(vec2 uv){ float s = sin(progress * 3.14159); vec4 m = mix(getFrom(uv), getTo(uv), progress); vec4 b = vec4(0.0); for (int i = 0; i < 12; i++) { float a = float(i) * 0.5236; b += mix(getFrom(uv + vec2(cos(a), sin(a)) * 0.02 * s), getTo(uv + vec2(cos(a), sin(a)) * 0.02 * s), progress); } b /= 12.0; return vec4(min(m.rgb + b.rgb * s * 0.8, vec3(1.0)), m.a); }` },
];

const morphs: TransitionDef[] = [
  { type: "ripple", label: "Ripple", category: "stylish", glsl: `vec4 transition(vec2 uv){ vec2 d = (uv - 0.5) * vec2(aspect(), 1.0); float r = length(d); float s = sin(progress * 3.14159); vec2 o = normalize(d + 1e-5) * sin(r * 40.0 - progress * 20.0) * 0.02 * s / vec2(aspect(), 1.0); return mix(getFrom(uv + o), getTo(uv + o), progress); }` },
  { type: "swirl", label: "Swirl", category: "stylish", glsl: `vec4 transition(vec2 uv){ vec2 d = (uv - 0.5) * vec2(aspect(), 1.0); float r = length(d); float s = sin(progress * 3.14159); d = rot2(d, s * 4.0 * max(0.0, 1.0 - r)); vec2 q = d / vec2(aspect(), 1.0) + 0.5; return mix(getFrom(q), getTo(q), progress); }` },
  { type: "liquid", label: "Liquid", category: "stylish", glsl: `vec4 transition(vec2 uv){ float s = sin(progress * 3.14159); vec2 o = (vec2(fbm(uv * 4.0 + progress), fbm(uv * 4.0 + 3.0 - progress)) - 0.5) * 0.15 * s; return mix(getFrom(uv + o), getTo(uv - o), smoothstep(0.3, 0.7, progress)); }` },
  { type: "wave", label: "Wave", category: "stylish", glsl: `vec4 transition(vec2 uv){ float s = sin(progress * 3.14159); vec2 o = vec2(sin(uv.y * 20.0 + progress * 10.0), 0.0) * 0.03 * s; return mix(getFrom(uv + o), getTo(uv + o), progress); }` },
  { type: "dreamy", label: "Dreamy", category: "stylish", glsl: `vec4 transition(vec2 uv){ float s = sin(progress * 3.14159); vec2 o = vec2(0.0, sin(uv.x * 10.0 + progress * 8.0) * 0.03 * s); vec4 m = mix(getFrom(uv + o), getTo(uv + o), progress); return vec4(min(m.rgb + s * 0.15, vec3(1.0)), m.a); }` },
  { type: "morph", label: "Morph", category: "stylish", glsl: `vec4 transition(vec2 uv){ vec4 a = getFrom(uv); vec4 b = getTo(uv); vec2 oa = (vec2(a.r, a.g) - 0.5) * 0.12 * progress; vec2 ob = (vec2(b.r, b.g) - 0.5) * 0.12 * (1.0 - progress); return mix(getFrom(uv + ob), getTo(uv + oa), progress); }` },
  { type: "flip-h", label: "Flip", category: "stylish", glsl: `vec4 transition(vec2 uv){ float a = progress * 3.14159; float c = cos(a); float x = (uv.x - 0.5) / max(abs(c), 0.001) + 0.5; float persp = 1.0 + (uv.x - 0.5) * sin(a) * 0.4 * sign(c); vec2 q = vec2(x, (uv.y - 0.5) * persp + 0.5); if (q.x < 0.0 || q.x > 1.0 || q.y < 0.0 || q.y > 1.0) return vec4(0.0, 0.0, 0.0, 1.0); return c > 0.0 ? getFrom(q) : getTo(vec2(1.0 - q.x, q.y)); }` },
  { type: "flip-v", label: "Flip vertical", category: "stylish", glsl: `vec4 transition(vec2 uv){ float a = progress * 3.14159; float c = cos(a); float y = (uv.y - 0.5) / max(abs(c), 0.001) + 0.5; vec2 q = vec2(uv.x, y); if (q.y < 0.0 || q.y > 1.0) return vec4(0.0, 0.0, 0.0, 1.0); return c > 0.0 ? getFrom(q) : getTo(vec2(q.x, 1.0 - q.y)); }` },
  { type: "cube", label: "Cube", category: "stylish", glsl: `vec4 transition(vec2 uv){ float p = progress; if (uv.x < 1.0 - p) { float w = 1.0 - p; float x = uv.x / w; float sh = 1.0 + (1.0 - x) * p * 0.25; return getFrom(vec2(x, (uv.y - 0.5) * sh + 0.5)) * (1.0 - p * 0.3); } float w2 = max(p, 0.0001); float x2 = (uv.x - (1.0 - p)) / w2; float sh2 = 1.0 + x2 * (1.0 - p) * 0.25; return getTo(vec2(x2, (uv.y - 0.5) * sh2 + 0.5)) * (0.7 + p * 0.3); }` },
  { type: "page-fold", label: "Page fold", category: "stylish", glsl: `vec4 transition(vec2 uv){ float edge = 1.0 - progress * 1.2; if (uv.x < edge) return getFrom(uv); float fold = uv.x - edge; vec2 q = vec2(edge - fold, uv.y); if (q.x > 0.0 && fold < 0.2) return getFrom(q) * 0.75; return getTo(uv); }` },
  { type: "doorway", label: "Doorway", category: "stylish", glsl: `vec4 transition(vec2 uv){ float half1 = 0.5 * (1.0 - progress); if (uv.x < half1) return getFrom(vec2(uv.x + 0.5 - half1 - 0.0, uv.y)); if (uv.x > 1.0 - half1) return getFrom(vec2(uv.x - 0.5 + half1, uv.y)); float z = 0.6 + 0.4 * progress; return getTo(0.5 + (uv - 0.5) * z); }` },
];

const colorTr: TransitionDef[] = [
  { type: "luma-wipe", label: "Luma wipe", category: "basic", glsl: `vec4 transition(vec2 uv){ float l = luma(getFrom(uv).rgb); float m = smoothstep(l - 0.1, l + 0.1, progress * 1.2); return mix(getFrom(uv), getTo(uv), m); }` },
  { type: "color-fade", label: "Dip to colour", category: "basic", glsl: `vec4 transition(vec2 uv){ vec4 k = vec4(1.0, 0.54, 0.12, 1.0); return progress < 0.5 ? mix(getFrom(uv), k, progress * 2.0) : mix(k, getTo(uv), progress * 2.0 - 1.0); }` },
  { type: "burn", label: "Burn", category: "basic", glsl: `vec4 transition(vec2 uv){ vec4 a = getFrom(uv); vec4 b = getTo(uv); vec3 burn = 1.0 - (1.0 - a.rgb) / max(b.rgb + (1.0 - progress), vec3(0.01)); return vec4(mix(mix(a.rgb, clamp(burn, 0.0, 1.0), sin(progress * 3.14159)), b.rgb, smoothstep(0.5, 1.0, progress)), 1.0); }` },
  { type: "grain-dissolve", label: "Grain dissolve", category: "basic", glsl: `vec4 transition(vec2 uv){ float n = hash(floor(uv * uRes / 2.0)); return mix(getFrom(uv), getTo(uv), step(n, progress)); }` },
  { type: "additive", label: "Additive", category: "basic", glsl: `vec4 transition(vec2 uv){ vec4 a = getFrom(uv); vec4 b = getTo(uv); vec3 add = min(a.rgb * (1.0 - progress) * 1.5 + b.rgb * progress * 1.5, vec3(1.0)); return vec4(mix(add, b.rgb, smoothstep(0.7, 1.0, progress)), 1.0); }` },
  { type: "mono-fade", label: "Mono fade", category: "basic", glsl: `vec4 transition(vec2 uv){ float s = sin(progress * 3.14159); vec4 m = mix(getFrom(uv), getTo(uv), progress); return vec4(mix(m.rgb, vec3(luma(m.rgb)), s), m.a); }` },
];

export const LIBRARY_TRANSITIONS: readonly TransitionDef[] = [
  ...angleWipes,
  ...shapes,
  ...blinds,
  ...slides,
  ...zooms,
  ...glitches,
  ...lights,
  ...morphs,
  ...colorTr,
];
