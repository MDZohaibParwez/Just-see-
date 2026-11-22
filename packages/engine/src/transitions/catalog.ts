/**
 * Transitions. Each is a GLSL function `vec4 transition(vec2 uv)` using
 * getFrom(uv), getTo(uv) and `progress` (0..1, already eased).
 * uv is (0,0) top-left.
 */

export interface TransitionDef {
  type: string;
  label: string;
  category: "basic" | "slide" | "wipe" | "zoom" | "stylish";
  glsl: string;
}

export const TRANSITIONS: readonly TransitionDef[] = [
  {
    type: "crossfade",
    label: "Dissolve",
    category: "basic",
    glsl: `vec4 transition(vec2 uv){ return mix(getFrom(uv), getTo(uv), progress); }`,
  },
  {
    type: "fade-black",
    label: "Dip to black",
    category: "basic",
    glsl: `vec4 transition(vec2 uv){ vec4 k = vec4(0.0, 0.0, 0.0, 1.0); return progress < 0.5 ? mix(getFrom(uv), k, progress * 2.0) : mix(k, getTo(uv), progress * 2.0 - 1.0); }`,
  },
  {
    type: "fade-white",
    label: "Flash",
    category: "basic",
    glsl: `vec4 transition(vec2 uv){ vec4 k = vec4(1.0); return progress < 0.5 ? mix(getFrom(uv), k, progress * 2.0) : mix(k, getTo(uv), progress * 2.0 - 1.0); }`,
  },
  {
    type: "slide-left",
    label: "Slide left",
    category: "slide",
    glsl: `vec4 transition(vec2 uv){ return uv.x >= 1.0 - progress ? getTo(uv - vec2(1.0 - progress, 0.0)) : getFrom(uv); }`,
  },
  {
    type: "slide-right",
    label: "Slide right",
    category: "slide",
    glsl: `vec4 transition(vec2 uv){ return uv.x <= progress ? getTo(uv + vec2(1.0 - progress, 0.0)) : getFrom(uv); }`,
  },
  {
    type: "slide-up",
    label: "Slide up",
    category: "slide",
    glsl: `vec4 transition(vec2 uv){ return uv.y >= 1.0 - progress ? getTo(uv - vec2(0.0, 1.0 - progress)) : getFrom(uv); }`,
  },
  {
    type: "slide-down",
    label: "Slide down",
    category: "slide",
    glsl: `vec4 transition(vec2 uv){ return uv.y <= progress ? getTo(uv + vec2(0.0, 1.0 - progress)) : getFrom(uv); }`,
  },
  {
    type: "push-left",
    label: "Push left",
    category: "slide",
    glsl: `vec4 transition(vec2 uv){ return uv.x < 1.0 - progress ? getFrom(uv + vec2(progress, 0.0)) : getTo(uv - vec2(1.0 - progress, 0.0)); }`,
  },
  {
    type: "push-up",
    label: "Push up",
    category: "slide",
    glsl: `vec4 transition(vec2 uv){ return uv.y < 1.0 - progress ? getFrom(uv + vec2(0.0, progress)) : getTo(uv - vec2(0.0, 1.0 - progress)); }`,
  },
  {
    type: "wipe-left",
    label: "Wipe left",
    category: "wipe",
    glsl: `vec4 transition(vec2 uv){ float e = 0.02; float m = smoothstep(1.0 - progress * (1.0 + e) - e, 1.0 - progress * (1.0 + e), uv.x); return mix(getFrom(uv), getTo(uv), m); }`,
  },
  {
    type: "wipe-right",
    label: "Wipe right",
    category: "wipe",
    glsl: `vec4 transition(vec2 uv){ float e = 0.02; float m = 1.0 - smoothstep(progress * (1.0 + e) - e, progress * (1.0 + e), uv.x); return mix(getFrom(uv), getTo(uv), m); }`,
  },
  {
    type: "wipe-down",
    label: "Wipe down",
    category: "wipe",
    glsl: `vec4 transition(vec2 uv){ float e = 0.02; float m = 1.0 - smoothstep(progress * (1.0 + e) - e, progress * (1.0 + e), uv.y); return mix(getFrom(uv), getTo(uv), m); }`,
  },
  {
    type: "circle-open",
    label: "Circle open",
    category: "wipe",
    glsl: `vec4 transition(vec2 uv){ vec2 d = (uv - 0.5) * vec2(aspect(), 1.0); float r = progress * length(vec2(aspect(), 1.0)) * 0.5 * 1.05; float m = 1.0 - smoothstep(r - 0.01, r, length(d)); return mix(getFrom(uv), getTo(uv), m); }`,
  },
  {
    type: "diagonal",
    label: "Diagonal wipe",
    category: "wipe",
    glsl: `vec4 transition(vec2 uv){ float v = (uv.x + uv.y) * 0.5; float m = 1.0 - smoothstep(progress * 1.1 - 0.05, progress * 1.1, v); return mix(getFrom(uv), getTo(uv), m); }`,
  },
  {
    type: "zoom-in",
    label: "Zoom in",
    category: "zoom",
    glsl: `vec4 transition(vec2 uv){ float z = 1.0 + progress * 1.5; vec4 a = getFrom((uv - 0.5) / z + 0.5); float y = 2.5 - progress * 1.5; vec4 b = getTo((uv - 0.5) / y + 0.5); return mix(a, b, smoothstep(0.35, 0.65, progress)); }`,
  },
  {
    type: "zoom-out",
    label: "Zoom out",
    category: "zoom",
    glsl: `vec4 transition(vec2 uv){ float z = 1.0 - progress * 0.6; vec4 a = getFrom((uv - 0.5) / z + 0.5); float y = 0.4 + progress * 0.6; vec4 b = getTo((uv - 0.5) / y + 0.5); return mix(a, b, smoothstep(0.35, 0.65, progress)); }`,
  },
  {
    type: "spin",
    label: "Spin",
    category: "zoom",
    glsl: `vec4 transition(vec2 uv){ float a = progress * 6.28318; float z = 1.0 + sin(progress * 3.14159) * 1.5; vec2 d = (uv - 0.5) * vec2(aspect(), 1.0) * z; float s = sin(a), c = cos(a); d = mat2(c, -s, s, c) * d; vec2 q = d / vec2(aspect(), 1.0) + 0.5; q = abs(mod(q + 1.0, 2.0) - 1.0); return progress < 0.5 ? getFrom(q) : getTo(q); }`,
  },
  {
    type: "blur-dissolve",
    label: "Blur dissolve",
    category: "stylish",
    glsl: `vec4 transition(vec2 uv){ float r = sin(progress * 3.14159) * 0.02; vec4 a = vec4(0.0); vec4 b = vec4(0.0); for (int i = 0; i < 16; i++) { float t = float(i) * 2.39996; vec2 o = vec2(cos(t) / aspect(), sin(t)) * r * sqrt(float(i) / 16.0); a += getFrom(uv + o); b += getTo(uv + o); } return mix(a / 16.0, b / 16.0, progress); }`,
  },
  {
    type: "glitch",
    label: "Glitch",
    category: "stylish",
    glsl: `vec4 transition(vec2 uv){ float s = sin(progress * 3.14159); float band = floor(uv.y * 30.0); float h = hash(vec2(band, floor(progress * 20.0))); vec2 q = uv + vec2((h - 0.5) * 0.2 * s, 0.0); float o = 0.02 * s; vec4 f = vec4(getFrom(q + vec2(o, 0.0)).r, getFrom(q).g, getFrom(q - vec2(o, 0.0)).b, getFrom(q).a); vec4 t = vec4(getTo(q + vec2(o, 0.0)).r, getTo(q).g, getTo(q - vec2(o, 0.0)).b, getTo(q).a); return mix(f, t, step(0.5, progress + (h - 0.5) * 0.3)); }`,
  },
  {
    type: "pixelize",
    label: "Pixelize",
    category: "stylish",
    glsl: `vec4 transition(vec2 uv){ float s = sin(progress * 3.14159); float cells = mix(200.0, 8.0, s); vec2 cell = vec2(1.0 / (cells * aspect()), 1.0 / cells); vec2 q = s > 0.02 ? (floor(uv / cell) + 0.5) * cell : uv; return mix(getFrom(q), getTo(q), smoothstep(0.4, 0.6, progress)); }`,
  },
];

export const TRANSITIONS_BY_TYPE: ReadonlyMap<string, TransitionDef> = new Map(TRANSITIONS.map((t) => [t.type, t]));

export const DEFAULT_TRANSITION_US = 500_000;
