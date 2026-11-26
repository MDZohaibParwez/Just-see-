import type { EffectDef, ParamDef } from "./catalog";

/**
 * Phase 2 effect library. Same conventions as catalog.ts: each effect is
 * `vec4 effect(vec2 uv)`, uv (0,0) top-left, all sizes relative to the frame.
 */

const p = (key: string, label: string, min: number, max: number, def: number, step = 0.01): ParamDef => ({
  key,
  label,
  min,
  max,
  step,
  default: def,
});
const amount = (def = 1, min = 0, max = 1) => p("amount", "Amount", min, max, def);
const f = (n: number) => (Number.isInteger(n) ? `${n}.0` : `${n}`);
const v3 = (a: readonly [number, number, number]) => `vec3(${f(a[0])}, ${f(a[1])}, ${f(a[2])})`;

// ---------- Looks (colour filters) ----------
// Each look is a fixed grade; "Amount" blends it with the original.
interface Look {
  type: string;
  label: string;
  lift: [number, number, number];
  gamma: [number, number, number];
  gain: [number, number, number];
  sat: number;
  con: number;
  fade: number;
  shadow: [number, number, number];
  high: [number, number, number];
}

const Z: [number, number, number] = [0, 0, 0];
const ONE: [number, number, number] = [1, 1, 1];
const look = (type: string, label: string, o: Partial<Omit<Look, "type" | "label">>): Look => ({
  type: `look-${type}`,
  label,
  lift: o.lift ?? Z,
  gamma: o.gamma ?? ONE,
  gain: o.gain ?? ONE,
  sat: o.sat ?? 1,
  con: o.con ?? 1,
  fade: o.fade ?? 0,
  shadow: o.shadow ?? Z,
  high: o.high ?? Z,
});

const LOOKS: Look[] = [
  look("warm-sun", "Warm sun", { gain: [1.08, 1.0, 0.9], sat: 1.1, high: [0.04, 0.02, 0] }),
  look("cool-blue", "Cool blue", { gain: [0.92, 1.0, 1.1], sat: 0.95, shadow: [0, 0.01, 0.04] }),
  look("teal-orange", "Teal & orange", { shadow: [-0.02, 0.03, 0.06], high: [0.06, 0.02, -0.04], sat: 1.15, con: 1.08 }),
  look("vintage", "Vintage", { fade: 0.35, sat: 0.75, gain: [1.05, 1.0, 0.88], shadow: [0.03, 0.02, 0] }),
  look("noir", "Noir", { sat: 0, con: 1.35, gamma: [0.95, 0.95, 0.95] }),
  look("mono-soft", "Soft mono", { sat: 0, con: 0.9, fade: 0.2 }),
  look("faded", "Faded", { fade: 0.45, sat: 0.85 }),
  look("vivid", "Vivid", { sat: 1.45, con: 1.12 }),
  look("pastel", "Pastel", { sat: 0.7, fade: 0.3, lift: [0.05, 0.04, 0.06] }),
  look("film-gold", "Golden film", { gain: [1.06, 1.02, 0.86], shadow: [0.02, 0.01, -0.02], con: 1.05, fade: 0.1 }),
  look("film-green", "Green film", { gain: [0.96, 1.04, 0.94], shadow: [-0.01, 0.03, 0.0], fade: 0.12 }),
  look("matte", "Matte", { fade: 0.25, con: 0.92 }),
  look("moody", "Moody", { sat: 0.8, con: 1.15, gamma: [0.9, 0.92, 0.95], shadow: [0, 0.01, 0.03] }),
  look("sunset", "Sunset", { gain: [1.12, 0.98, 0.86], high: [0.06, 0.0, -0.02], sat: 1.1 }),
  look("neon-night", "Neon night", { gain: [1.0, 0.9, 1.15], sat: 1.3, con: 1.15, shadow: [0.03, 0, 0.06] }),
  look("cyberpunk", "Cyberpunk", { shadow: [0.05, -0.02, 0.08], high: [-0.02, 0.06, 0.05], sat: 1.25, con: 1.1 }),
  look("bleach", "Bleach bypass", { sat: 0.45, con: 1.3 }),
  look("cross-process", "Cross process", { gain: [1.05, 1.1, 0.85], lift: [0.0, 0.02, 0.08], con: 1.1 }),
  look("autumn", "Autumn", { gain: [1.08, 0.98, 0.84], sat: 1.15, shadow: [0.02, 0, -0.02] }),
  look("spring", "Spring", { gain: [0.98, 1.06, 0.98], sat: 1.1, lift: [0.01, 0.02, 0.0] }),
  look("winter", "Winter", { gain: [0.9, 0.98, 1.08], sat: 0.8, fade: 0.1 }),
  look("desert", "Desert", { gain: [1.1, 1.02, 0.84], sat: 0.95, con: 1.05 }),
  look("ocean", "Ocean", { gain: [0.86, 1.02, 1.1], sat: 1.1 }),
  look("forest", "Forest", { gain: [0.92, 1.08, 0.9], sat: 1.05, gamma: [0.95, 1.0, 0.95] }),
  look("rose", "Rose", { gain: [1.08, 0.96, 1.02], high: [0.03, 0, 0.02], sat: 0.95 }),
  look("lavender", "Lavender", { gain: [1.0, 0.95, 1.1], fade: 0.15, sat: 0.9 }),
  look("chrome", "Chrome", { sat: 1.2, con: 1.2, gain: [1.02, 1.02, 1.0] }),
  look("drama", "Drama", { con: 1.4, sat: 0.9, gamma: [0.9, 0.9, 0.9] }),
  look("dreamy", "Dreamy", { lift: [0.06, 0.05, 0.07], sat: 0.9, con: 0.85 }),
  look("retro-80s", "Retro 80s", { gain: [1.06, 0.95, 1.08], sat: 1.25, fade: 0.15, shadow: [0.04, 0, 0.05] }),
  look("polaroid", "Instant photo", { fade: 0.3, gain: [1.04, 1.02, 0.92], lift: [0.04, 0.03, 0.02] }),
  look("kodak-ish", "Warm print", { gain: [1.06, 1.02, 0.9], con: 1.08, sat: 1.05 }),
  look("silver", "Silver", { sat: 0.2, con: 1.1, gain: [0.98, 1.0, 1.03] }),
  look("sepia-soft", "Soft sepia", { sat: 0.2, gain: [1.1, 1.0, 0.8], fade: 0.1 }),
  look("highkey", "High key", { lift: [0.1, 0.1, 0.1], con: 0.9, sat: 0.9 }),
  look("lowkey", "Low key", { gain: [0.85, 0.85, 0.85], con: 1.25 }),
  look("tropical", "Tropical", { sat: 1.35, gain: [1.0, 1.06, 0.98] }),
  look("bollywood", "Filmi", { gain: [1.08, 1.0, 0.92], sat: 1.3, con: 1.1, high: [0.03, 0.01, 0] }),
  look("monsoon", "Monsoon", { gain: [0.9, 1.0, 1.04], sat: 0.85, fade: 0.12, shadow: [0, 0.02, 0.03] }),
  look("golden-hour", "Golden hour", { gain: [1.12, 1.03, 0.85], high: [0.05, 0.03, 0], sat: 1.1 }),
];

const lookEffects: EffectDef[] = LOOKS.map((l) => ({
  type: l.type,
  label: l.label,
  category: "look",
  params: [amount(1)],
  glsl: `vec4 effect(vec2 uv){ vec4 c = unpremul(src(uv)); vec3 g = grade(c.rgb, ${v3(l.lift)}, ${v3(l.gamma)}, ${v3(l.gain)}, ${f(l.sat)}, ${f(l.con)}, ${f(l.fade)}, ${v3(l.shadow)}, ${v3(l.high)}); c.rgb = mix(c.rgb, g, p_amount); return premul(c); }`,
}));

// ---------- Colour tools ----------
const colorTools: EffectDef[] = [
  {
    type: "color-wheels",
    label: "Colour wheels",
    category: "color",
    params: [
      p("liftR", "Shadows R", -0.3, 0.3, 0),
      p("liftG", "Shadows G", -0.3, 0.3, 0),
      p("liftB", "Shadows B", -0.3, 0.3, 0),
      p("gammaR", "Midtones R", 0.5, 2, 1),
      p("gammaG", "Midtones G", 0.5, 2, 1),
      p("gammaB", "Midtones B", 0.5, 2, 1),
      p("gainR", "Highlights R", 0.5, 1.5, 1),
      p("gainG", "Highlights G", 0.5, 1.5, 1),
      p("gainB", "Highlights B", 0.5, 1.5, 1),
      p("sat", "Saturation", 0, 2, 1),
    ],
    glsl: `vec4 effect(vec2 uv){ vec4 c = unpremul(src(uv)); c.rgb = grade(c.rgb, vec3(p_liftR, p_liftG, p_liftB), vec3(p_gammaR, p_gammaG, p_gammaB), vec3(p_gainR, p_gainG, p_gainB), p_sat, 1.0, 0.0, vec3(0.0), vec3(0.0)); return premul(c); }`,
  },
  {
    type: "curves",
    label: "Curves",
    category: "color",
    params: [
      p("shadows", "Shadows", -0.3, 0.3, 0),
      p("darks", "Darks", -0.3, 0.3, 0),
      p("lights", "Lights", -0.3, 0.3, 0),
      p("highlights", "Highlights", -0.3, 0.3, 0),
      p("red", "Red curve", -0.3, 0.3, 0),
      p("green", "Green curve", -0.3, 0.3, 0),
      p("blue", "Blue curve", -0.3, 0.3, 0),
    ],
    glsl: `float curveAt(float x){ float y = x;
      y += p_shadows * exp(-pow((x - 0.1) / 0.12, 2.0)); y += p_darks * exp(-pow((x - 0.35) / 0.15, 2.0));
      y += p_lights * exp(-pow((x - 0.65) / 0.15, 2.0)); y += p_highlights * exp(-pow((x - 0.9) / 0.12, 2.0)); return y; }
      vec4 effect(vec2 uv){ vec4 c = unpremul(src(uv));
      c.rgb = vec3(curveAt(c.r), curveAt(c.g), curveAt(c.b));
      vec3 bump = vec3(p_red, p_green, p_blue) * 4.0 * c.rgb * (1.0 - c.rgb);
      c.rgb = clamp(c.rgb + bump, 0.0, 1.0); return premul(c); }`,
  },
  {
    type: "hsl",
    label: "HSL",
    category: "color",
    params: [
      p("redH", "Red hue", -0.1, 0.1, 0, 0.005),
      p("redS", "Red sat", -1, 1, 0),
      p("redL", "Red light", -0.5, 0.5, 0),
      p("yellowS", "Yellow sat", -1, 1, 0),
      p("greenH", "Green hue", -0.1, 0.1, 0, 0.005),
      p("greenS", "Green sat", -1, 1, 0),
      p("greenL", "Green light", -0.5, 0.5, 0),
      p("cyanS", "Cyan sat", -1, 1, 0),
      p("blueH", "Blue hue", -0.1, 0.1, 0, 0.005),
      p("blueS", "Blue sat", -1, 1, 0),
      p("blueL", "Blue light", -0.5, 0.5, 0),
      p("magentaS", "Magenta sat", -1, 1, 0),
    ],
    glsl: `float band(float h, float c){ float d = abs(fract(h - c + 0.5) - 0.5); return smoothstep(0.12, 0.0, d); }
      vec4 effect(vec2 uv){ vec4 c = unpremul(src(uv)); vec3 hsv = rgb2hsv(c.rgb);
      float r = band(hsv.x, 0.0), y = band(hsv.x, 1.0/6.0), g = band(hsv.x, 2.0/6.0), cy = band(hsv.x, 3.0/6.0), b = band(hsv.x, 4.0/6.0), m = band(hsv.x, 5.0/6.0);
      hsv.x = fract(hsv.x + r * p_redH + g * p_greenH + b * p_blueH);
      hsv.y = clamp(hsv.y * (1.0 + r * p_redS + y * p_yellowS + g * p_greenS + cy * p_cyanS + b * p_blueS + m * p_magentaS), 0.0, 1.0);
      hsv.z = clamp(hsv.z * (1.0 + r * p_redL + g * p_greenL + b * p_blueL), 0.0, 1.0);
      c.rgb = hsv2rgb(hsv); return premul(c); }`,
  },
  {
    type: "levels",
    label: "Levels",
    category: "color",
    params: [p("black", "Black point", 0, 0.5, 0), p("white", "White point", 0.5, 1, 1), p("gamma", "Gamma", 0.3, 3, 1)],
    glsl: `vec4 effect(vec2 uv){ vec4 c = unpremul(src(uv)); c.rgb = clamp((c.rgb - p_black) / max(0.01, p_white - p_black), 0.0, 1.0); c.rgb = pow(c.rgb, vec3(1.0 / p_gamma)); return premul(c); }`,
  },
  {
    type: "vibrance",
    label: "Vibrance",
    category: "color",
    params: [amount(0.5, -1, 1)],
    glsl: `vec4 effect(vec2 uv){ vec4 c = unpremul(src(uv)); float mx = max(c.r, max(c.g, c.b)); float mn = min(c.r, min(c.g, c.b)); float s = mx - mn; float k = p_amount * (1.0 - s); c.rgb = clamp(mix(vec3(luma(c.rgb)), c.rgb, 1.0 + k), 0.0, 1.0); return premul(c); }`,
  },
  {
    type: "highlights-shadows",
    label: "Highlights & shadows",
    category: "color",
    params: [p("shadows", "Shadows", -1, 1, 0.3), p("highlights", "Highlights", -1, 1, -0.3)],
    glsl: `vec4 effect(vec2 uv){ vec4 c = unpremul(src(uv)); float l = luma(c.rgb); float sh = (1.0 - smoothstep(0.0, 0.5, l)) * p_shadows * 0.4; float hi = smoothstep(0.5, 1.0, l) * p_highlights * 0.4; c.rgb = clamp(c.rgb + sh + hi, 0.0, 1.0); return premul(c); }`,
  },
  {
    type: "split-tone",
    label: "Split tone",
    category: "color",
    params: [p("shadowHue", "Shadow hue", 0, 360, 210, 1), p("highHue", "Highlight hue", 0, 360, 35, 1), amount(0.5)],
    glsl: `vec4 effect(vec2 uv){ vec4 c = unpremul(src(uv)); float l = luma(c.rgb); vec3 a = hsv2rgb(vec3(p_shadowHue / 360.0, 1.0, 1.0)) - 0.5; vec3 b = hsv2rgb(vec3(p_highHue / 360.0, 1.0, 1.0)) - 0.5; c.rgb = clamp(c.rgb + (a * (1.0 - l) + b * l) * 0.2 * p_amount, 0.0, 1.0); return premul(c); }`,
  },
  {
    type: "gradient-map",
    label: "Gradient map",
    category: "color",
    params: [p("from", "Dark hue", 0, 360, 250, 1), p("to", "Light hue", 0, 360, 50, 1), amount(1)],
    glsl: `vec4 effect(vec2 uv){ vec4 c = unpremul(src(uv)); float l = luma(c.rgb); vec3 g = mix(hsv2rgb(vec3(p_from / 360.0, 0.9, 0.15)), hsv2rgb(vec3(p_to / 360.0, 0.5, 1.0)), l); c.rgb = mix(c.rgb, g, p_amount); return premul(c); }`,
  },
  {
    type: "channel-mixer",
    label: "Channel mixer",
    category: "color",
    params: [p("rr", "Red from red", 0, 2, 1), p("rg", "Red from green", -1, 1, 0), p("gg", "Green from green", 0, 2, 1), p("gb", "Green from blue", -1, 1, 0), p("bb", "Blue from blue", 0, 2, 1), p("br", "Blue from red", -1, 1, 0)],
    glsl: `vec4 effect(vec2 uv){ vec4 c = unpremul(src(uv)); vec3 o = vec3(c.r * p_rr + c.g * p_rg, c.g * p_gg + c.b * p_gb, c.b * p_bb + c.r * p_br); c.rgb = clamp(o, 0.0, 1.0); return premul(c); }`,
  },
  {
    type: "white-balance",
    label: "White balance",
    category: "color",
    params: [p("temp", "Temperature", -1, 1, 0), p("tint", "Tint", -1, 1, 0)],
    glsl: `vec4 effect(vec2 uv){ vec4 c = unpremul(src(uv)); vec3 k = vec3(1.0 + p_temp * 0.15, 1.0 - p_tint * 0.1, 1.0 - p_temp * 0.15); c.rgb = clamp(c.rgb * k, 0.0, 1.0); return premul(c); }`,
  },
  {
    type: "fade",
    label: "Fade",
    category: "color",
    params: [amount(0.3)],
    glsl: `vec4 effect(vec2 uv){ vec4 c = unpremul(src(uv)); c.rgb = mix(c.rgb, c.rgb * 0.8 + 0.12, p_amount); return premul(c); }`,
  },
  {
    type: "clarity",
    label: "Clarity",
    category: "color",
    params: [amount(0.5, -1, 1)],
    glsl: `vec4 effect(vec2 uv){ vec4 c = src(uv); vec4 b = vec4(0.0); for (int i = 0; i < 12; i++) { float a = float(i) * 0.5236; b += src(uv + vec2(cos(a) / aspect(), sin(a)) * 0.012); } b /= 12.0; vec3 o = c.rgb + (c.rgb - b.rgb) * p_amount * 1.5; return vec4(clamp(o, 0.0, c.a), c.a); }`,
  },
  {
    type: "dehaze",
    label: "Dehaze",
    category: "color",
    params: [amount(0.4, -1, 1)],
    glsl: `vec4 effect(vec2 uv){ vec4 c = unpremul(src(uv)); float mn = min(c.r, min(c.g, c.b)); c.rgb = clamp((c.rgb - mn * p_amount * 0.5) / (1.0 - mn * p_amount * 0.5), 0.0, 1.0); c.rgb = (c.rgb - 0.5) * (1.0 + p_amount * 0.2) + 0.5; return premul(clamp(c, 0.0, 1.0)); }`,
  },
  {
    type: "color-match",
    label: "Colour match",
    category: "color",
    params: [
      p("gainR", "Gain R", 0.3, 3, 1),
      p("gainG", "Gain G", 0.3, 3, 1),
      p("gainB", "Gain B", 0.3, 3, 1),
      p("offR", "Offset R", -1, 1, 0),
      p("offG", "Offset G", -1, 1, 0),
      p("offB", "Offset B", -1, 1, 0),
      amount(1),
    ],
    glsl: `vec4 effect(vec2 uv){ vec4 c = unpremul(src(uv)); vec3 o = c.rgb * vec3(p_gainR, p_gainG, p_gainB) + vec3(p_offR, p_offG, p_offB); c.rgb = mix(c.rgb, clamp(o, 0.0, 1.0), p_amount); return premul(c); }`,
  },
  {
    type: "lut",
    label: "LUT (.cube)",
    category: "color",
    params: [amount(1)],
    glsl: `vec4 effect(vec2 uv){ vec4 c = unpremul(src(uv)); vec3 s = (c.rgb * (uLutSize - 1.0) + 0.5) / uLutSize; vec3 l = uLutSize > 1.0 ? texture(uLut, s).rgb : c.rgb; c.rgb = mix(c.rgb, l, p_amount); return premul(c); }`,
  },
];

// ---------- Keying & masks ----------
const keying: EffectDef[] = [
  {
    type: "bg-remove",
    label: "Remove background (AI)",
    category: "key",
    params: [p("threshold", "Threshold", 0.05, 0.95, 0.5), p("feather", "Edge softness", 0, 0.3, 0.08), p("invert", "Keep background", 0, 1, 0, 1)],
    // Applied while drawing the source with the AI mask; this pass is a no-op.
    glsl: `vec4 effect(vec2 uv){ return src(uv); }`,
  },
  {
    type: "chroma-key",
    label: "Chroma key",
    category: "key",
    params: [
      p("hue", "Key hue", 0, 360, 120, 1),
      p("tolerance", "Tolerance", 0, 0.5, 0.15),
      p("softness", "Softness", 0, 0.5, 0.08),
      p("spill", "Spill removal", 0, 1, 0.6),
      p("minSat", "Min saturation", 0, 1, 0.2),
    ],
    glsl: `vec4 effect(vec2 uv){ vec4 c = unpremul(src(uv)); vec3 hsv = rgb2hsv(c.rgb); float d = abs(fract(hsv.x - p_hue / 360.0 + 0.5) - 0.5);
      float keyed = (1.0 - smoothstep(p_tolerance, p_tolerance + p_softness + 0.0001, d)) * smoothstep(p_minSat, p_minSat + 0.15, hsv.y) * smoothstep(0.08, 0.2, hsv.z);
      float alpha = c.a * (1.0 - keyed);
      // Spill: pull the key colour out of edges.
      vec3 key = hsv2rgb(vec3(p_hue / 360.0, 1.0, 1.0)); float kd = dot(normalize(c.rgb + 1e-4), normalize(key));
      float spill = smoothstep(0.75, 1.0, kd) * p_spill; vec3 rgb = mix(c.rgb, vec3(luma(c.rgb)), spill);
      return premul(vec4(rgb, alpha)); }`,
  },
  {
    type: "luma-key",
    label: "Luma key",
    category: "key",
    params: [p("threshold", "Threshold", 0, 1, 0.2), p("softness", "Softness", 0, 0.5, 0.1), p("invert", "Key bright (1) / dark (0)", 0, 1, 0, 1)],
    glsl: `vec4 effect(vec2 uv){ vec4 c = unpremul(src(uv)); float l = luma(c.rgb); float k = smoothstep(p_threshold, p_threshold + p_softness + 0.0001, l); if (p_invert > 0.5) k = 1.0 - k; return premul(vec4(c.rgb, c.a * k)); }`,
  },
  {
    type: "mask-rect",
    label: "Rectangle mask",
    category: "key",
    params: [p("x", "Centre X", 0, 1, 0.5), p("y", "Centre Y", 0, 1, 0.5), p("w", "Width", 0.01, 1, 0.6), p("h", "Height", 0.01, 1, 0.4), p("radius", "Corner", 0, 0.5, 0.05), p("feather", "Feather", 0, 0.3, 0.02), p("rot", "Rotation", -180, 180, 0, 1), p("invert", "Invert", 0, 1, 0, 1)],
    glsl: `vec4 effect(vec2 uv){ vec4 c = src(uv); vec2 q = (uv - vec2(p_x, p_y)) * vec2(aspect(), 1.0); q = rot2(q, radians(p_rot)); float r = min(p_radius, min(p_w * aspect(), p_h) * 0.5); float d = sdBox(q, vec2(p_w * aspect(), p_h) * 0.5 - r) - r; float m = 1.0 - smoothstep(-p_feather, p_feather + 0.0001, d); if (p_invert > 0.5) m = 1.0 - m; return c * m; }`,
  },
  {
    type: "mask-ellipse",
    label: "Ellipse mask",
    category: "key",
    params: [p("x", "Centre X", 0, 1, 0.5), p("y", "Centre Y", 0, 1, 0.5), p("w", "Width", 0.01, 1.5, 0.5), p("h", "Height", 0.01, 1.5, 0.5), p("feather", "Feather", 0, 0.5, 0.05), p("invert", "Invert", 0, 1, 0, 1)],
    glsl: `vec4 effect(vec2 uv){ vec4 c = src(uv); vec2 q = (uv - vec2(p_x, p_y)) / (vec2(p_w, p_h) * 0.5); float d = (length(q) - 1.0) * min(p_w, p_h) * 0.5; float m = 1.0 - smoothstep(-p_feather, p_feather + 0.0001, d); if (p_invert > 0.5) m = 1.0 - m; return c * m; }`,
  },
  {
    type: "mask-pen",
    label: "Pen mask",
    category: "key",
    params: [
      p("points", "Points", 3, 6, 5, 1),
      p("x1", "Point 1 X", 0, 1, 0.3), p("y1", "Point 1 Y", 0, 1, 0.25),
      p("x2", "Point 2 X", 0, 1, 0.7), p("y2", "Point 2 Y", 0, 1, 0.25),
      p("x3", "Point 3 X", 0, 1, 0.8), p("y3", "Point 3 Y", 0, 1, 0.6),
      p("x4", "Point 4 X", 0, 1, 0.5), p("y4", "Point 4 Y", 0, 1, 0.8),
      p("x5", "Point 5 X", 0, 1, 0.2), p("y5", "Point 5 Y", 0, 1, 0.6),
      p("x6", "Point 6 X", 0, 1, 0.25), p("y6", "Point 6 Y", 0, 1, 0.4),
      p("feather", "Feather", 0, 0.2, 0.02),
      p("invert", "Invert", 0, 1, 0, 1),
    ],
    glsl: `float sdPoly(vec2 q, vec2 v[6], int n) {
        float d = dot(q - v[0], q - v[0]); float s = 1.0;
        for (int i = 0; i < 6; i++) {
          if (i >= n) break;
          int j = i == 0 ? n - 1 : i - 1;
          vec2 vi = v[i]; vec2 vj = v[j];
          for (int k = 0; k < 6; k++) { if (k == j) vj = v[k]; }
          vec2 e = vj - vi; vec2 w = q - vi;
          vec2 b = w - e * clamp(dot(w, e) / max(dot(e, e), 1e-6), 0.0, 1.0);
          d = min(d, dot(b, b));
          bvec3 c = bvec3(q.y >= vi.y, q.y < vj.y, e.x * w.y > e.y * w.x);
          if (all(c) || all(not(c))) s *= -1.0;
        }
        return s * sqrt(d);
      }
      vec4 effect(vec2 uv){ vec2 a = vec2(aspect(), 1.0);
        vec2 v[6] = vec2[6](vec2(p_x1, p_y1) * a, vec2(p_x2, p_y2) * a, vec2(p_x3, p_y3) * a, vec2(p_x4, p_y4) * a, vec2(p_x5, p_y5) * a, vec2(p_x6, p_y6) * a);
        float d = sdPoly(uv * a, v, int(p_points + 0.5));
        float m = 1.0 - smoothstep(-p_feather, p_feather + 0.0001, d);
        if (p_invert > 0.5) m = 1.0 - m;
        return src(uv) * m; }`,
  },
  {
    // Face tracking uses these: blur or mosaic only inside a moving ellipse
    // (keyframe x, y, w, h to follow a face; CapCut-style face blur).
    type: "face-blur",
    label: "Face blur",
    category: "blur",
    params: [p("x", "Centre X", 0, 1, 0.5), p("y", "Centre Y", 0, 1, 0.4), p("w", "Width", 0.02, 1.5, 0.25), p("h", "Height", 0.02, 1.5, 0.3), p("amount", "Strength", 0, 1, 0.8), p("feather", "Feather", 0, 0.3, 0.04)],
    glsl: `vec4 effect(vec2 uv){ vec4 c = src(uv); vec2 q = (uv - vec2(p_x, p_y)) / (vec2(p_w, p_h) * 0.5); float d = (length(q) - 1.0) * min(p_w, p_h) * 0.5; float m = 1.0 - smoothstep(-p_feather, p_feather + 0.0001, d); if (m <= 0.0) return c;
      float r = (0.1 + p_amount * 0.4) * min(p_w, p_h); vec4 acc = vec4(0.0); float n = 0.0;
      for (int i = -3; i <= 3; i++) { for (int j = -3; j <= 3; j++) { vec2 o = vec2(float(i), float(j)) / 3.0 * r * vec2(1.0 / aspect(), 1.0); acc += src(uv + o); n += 1.0; } }
      return mix(c, acc / n, m); }`,
  },
  {
    // Blocks sized to the face (size = fraction of the face width), so features can't be read.
    type: "face-mosaic",
    label: "Face mosaic",
    category: "blur",
    params: [p("x", "Centre X", 0, 1, 0.5), p("y", "Centre Y", 0, 1, 0.4), p("w", "Width", 0.02, 1.5, 0.25), p("h", "Height", 0.02, 1.5, 0.3), p("size", "Block size", 0.05, 0.5, 0.2, 0.01), p("feather", "Feather", 0, 0.3, 0.02)],
    glsl: `vec4 effect(vec2 uv){ vec4 c = src(uv); vec2 q = (uv - vec2(p_x, p_y)) / (vec2(p_w, p_h) * 0.5); float d = (length(q) - 1.0) * min(p_w, p_h) * 0.5; float m = 1.0 - smoothstep(-p_feather, p_feather + 0.0001, d); if (m <= 0.0) return c;
      vec2 cell = vec2(p_size * p_w); cell.y *= aspect(); vec2 base = floor(uv / cell) * cell; vec4 acc = vec4(0.0);
      for (int i = 0; i < 4; i++) { for (int j = 0; j < 4; j++) { acc += src(base + (vec2(float(i), float(j)) + 0.5) / 4.0 * cell); } }
      return mix(c, acc / 16.0, m); }`,
  },
  {
    type: "mask-linear",
    label: "Linear mask",
    category: "key",
    params: [p("angle", "Angle", -180, 180, 90, 1), p("pos", "Position", 0, 1, 0.5), p("feather", "Feather", 0, 1, 0.2), p("invert", "Invert", 0, 1, 0, 1)],
    glsl: `vec4 effect(vec2 uv){ vec4 c = src(uv); vec2 dir = vec2(cos(radians(p_angle)), sin(radians(p_angle))); float d = dot(uv - 0.5, dir) + 0.5 - p_pos; float m = smoothstep(-p_feather * 0.5, p_feather * 0.5 + 0.0001, d); if (p_invert > 0.5) m = 1.0 - m; return c * m; }`,
  },
  {
    type: "mask-radial",
    label: "Spotlight",
    category: "key",
    params: [p("x", "Centre X", 0, 1, 0.5), p("y", "Centre Y", 0, 1, 0.45), p("radius", "Radius", 0.05, 1, 0.35), p("feather", "Feather", 0, 1, 0.3), p("dim", "Outside", 0, 1, 0.75)],
    glsl: `vec4 effect(vec2 uv){ vec4 c = src(uv); float d = length((uv - vec2(p_x, p_y)) * vec2(aspect(), 1.0)); float m = 1.0 - smoothstep(p_radius, p_radius + p_feather + 0.0001, d); return vec4(c.rgb * mix(1.0 - p_dim, 1.0, m), c.a); }`,
  },
];

// ---------- Blur ----------
const blurs: EffectDef[] = [
  {
    type: "radial-blur",
    label: "Radial blur",
    category: "blur",
    params: [amount(0.4), p("x", "Centre X", 0, 1, 0.5), p("y", "Centre Y", 0, 1, 0.5)],
    glsl: `vec4 effect(vec2 uv){ vec2 cnt = vec2(p_x, p_y); vec2 d = uv - cnt; float a = p_amount * 0.08; vec4 s = vec4(0.0); for (int i = 0; i < 16; i++) { float t = (float(i) / 15.0 - 0.5) * a; vec2 q = cnt + rot2(d * vec2(aspect(), 1.0), t) / vec2(aspect(), 1.0); s += src(q); } return s / 16.0; }`,
  },
  {
    type: "zoom-blur",
    label: "Zoom blur",
    category: "blur",
    params: [amount(0.4), p("x", "Centre X", 0, 1, 0.5), p("y", "Centre Y", 0, 1, 0.5)],
    glsl: `vec4 effect(vec2 uv){ vec2 cnt = vec2(p_x, p_y); vec4 s = vec4(0.0); for (int i = 0; i < 20; i++) { float k = 1.0 - p_amount * 0.25 * float(i) / 19.0; s += src(cnt + (uv - cnt) * k); } return s / 20.0; }`,
  },
  {
    type: "motion-blur",
    label: "Directional blur",
    category: "blur",
    params: [amount(0.4), p("angle", "Angle", 0, 360, 0, 1)],
    glsl: `vec4 effect(vec2 uv){ vec2 dir = vec2(cos(radians(p_angle)) / aspect(), sin(radians(p_angle))) * p_amount * 0.05; vec4 s = vec4(0.0); for (int i = 0; i < 17; i++) s += src(uv + dir * (float(i) / 16.0 - 0.5)); return s / 17.0; }`,
  },
  {
    type: "tilt-shift",
    label: "Tilt shift",
    category: "blur",
    params: [p("center", "Focus line", 0, 1, 0.55), p("width", "Focus width", 0, 0.5, 0.12), p("radius", "Blur", 0, 1, 0.5)],
    passes: 2,
    glsl: `vec4 effect(vec2 uv){ float k = smoothstep(p_width, p_width + 0.2, abs(uv.y - p_center)); float r = p_radius * 0.02 * k; vec2 dir = uPass == 0 ? vec2(r / aspect(), 0.0) : vec2(0.0, r); vec4 s = vec4(0.0); float w = 0.0; for (int i = -6; i <= 6; i++) { float x = float(i) / 6.0; float g = exp(-x * x * 2.5); s += src(uv + dir * x) * g; w += g; } return s / w; }`,
  },
  {
    type: "lens-blur",
    label: "Lens blur",
    category: "blur",
    params: [p("radius", "Radius", 0, 1, 0.4), p("bokeh", "Bokeh", 0, 1, 0.5)],
    glsl: `vec4 effect(vec2 uv){ vec4 s = vec4(0.0); float w = 0.0; float r = p_radius * 0.025; for (int i = 0; i < 40; i++) { float a = float(i) * 2.39996; float d = sqrt(float(i) / 40.0); vec4 c = src(uv + vec2(cos(a) / aspect(), sin(a)) * d * r); float g = 1.0 + pow(luma(c.rgb), 4.0) * p_bokeh * 8.0; s += c * g; w += g; } return s / w; }`,
  },
  {
    type: "box-blur",
    label: "Soft focus",
    category: "blur",
    params: [amount(0.5)],
    glsl: `vec4 effect(vec2 uv){ vec4 c = src(uv); vec4 b = vec4(0.0); for (int y = -2; y <= 2; y++) for (int x = -2; x <= 2; x++) b += src(uv + vec2(float(x) / aspect(), float(y)) * 0.004); b /= 25.0; return mix(c, max(c, b), p_amount); }`,
  },
  {
    type: "skin-smooth",
    label: "Smooth skin",
    category: "blur",
    params: [amount(0.5)],
    glsl: `vec4 effect(vec2 uv){ vec4 c = src(uv); vec4 s = vec4(0.0); float w = 0.0; for (int y = -3; y <= 3; y++) for (int x = -3; x <= 3; x++) { vec4 n = src(uv + vec2(float(x) / aspect(), float(y)) * 0.0025); float g = exp(-dot(n.rgb - c.rgb, n.rgb - c.rgb) * 60.0); s += n * g; w += g; } return mix(c, s / w, p_amount); }`,
  },
  {
    type: "unsharp",
    label: "Unsharp mask",
    category: "blur",
    params: [amount(0.6), p("radius", "Radius", 0.1, 1, 0.4)],
    glsl: `vec4 effect(vec2 uv){ vec4 c = src(uv); vec4 b = vec4(0.0); for (int i = 0; i < 8; i++) { float a = float(i) * 0.785; b += src(uv + vec2(cos(a) / aspect(), sin(a)) * p_radius * 0.006); } b /= 8.0; vec3 o = c.rgb + (c.rgb - b.rgb) * p_amount * 2.0; return vec4(clamp(o, 0.0, c.a), c.a); }`,
  },
  {
    type: "denoise",
    label: "Denoise",
    category: "blur",
    params: [amount(0.5)],
    glsl: `vec4 effect(vec2 uv){ vec2 px = 1.0 / uRes; vec4 c = src(uv); vec4 s = vec4(0.0); float w = 0.0; for (int y = -2; y <= 2; y++) for (int x = -2; x <= 2; x++) { vec4 n = src(uv + vec2(float(x), float(y)) * px); float g = exp(-dot(n.rgb - c.rgb, n.rgb - c.rgb) * 200.0); s += n * g; w += g; } return mix(c, s / w, p_amount); }`,
  },
];

// ---------- Distort ----------
const distort: EffectDef[] = [
  { type: "wave", label: "Wave", category: "distort", params: [amount(0.3), p("freq", "Waves", 1, 30, 8, 1), p("speed", "Speed", 0, 5, 1)], glsl: `vec4 effect(vec2 uv){ vec2 q = uv; q.x += sin(uv.y * p_freq * 6.283 + uTime * p_speed * 3.0) * p_amount * 0.03; return src(q); }` },
  { type: "ripple", label: "Ripple", category: "distort", params: [amount(0.3), p("freq", "Rings", 2, 40, 14, 1), p("speed", "Speed", 0, 5, 2)], glsl: `vec4 effect(vec2 uv){ vec2 d = (uv - 0.5) * vec2(aspect(), 1.0); float r = length(d); vec2 q = uv + normalize(d + 1e-5) / vec2(aspect(), 1.0) * sin(r * p_freq * 6.283 - uTime * p_speed * 4.0) * p_amount * 0.01; return src(q); }` },
  { type: "bulge", label: "Bulge", category: "distort", params: [amount(0.5, -1, 1), p("radius", "Radius", 0.05, 1, 0.4)], glsl: `vec4 effect(vec2 uv){ vec2 d = (uv - 0.5) * vec2(aspect(), 1.0); float r = length(d); float k = smoothstep(p_radius, 0.0, r); d *= 1.0 - p_amount * 0.5 * k * k; return src(d / vec2(aspect(), 1.0) + 0.5); }` },
  { type: "fisheye", label: "Fisheye", category: "distort", params: [amount(0.6)], glsl: `vec4 effect(vec2 uv){ vec2 d = (uv - 0.5) * 2.0; float r = length(d); float th = atan(r * p_amount * 2.0 + 1e-5) / atan(p_amount * 2.0 + 1e-5); vec2 q = r > 0.0 ? d / r * th * 0.5 + 0.5 : uv; return src(mix(uv, q, step(0.001, p_amount))); }` },
  { type: "tile", label: "Tile", category: "distort", params: [p("count", "Tiles", 1, 8, 2, 1), p("mirror", "Mirror", 0, 1, 1, 1)], glsl: `vec4 effect(vec2 uv){ vec2 q = uv * p_count; vec2 cell = floor(q); vec2 fq = fract(q); if (p_mirror > 0.5) { if (mod(cell.x, 2.0) > 0.5) fq.x = 1.0 - fq.x; if (mod(cell.y, 2.0) > 0.5) fq.y = 1.0 - fq.y; } return src(fq); }` },
  { type: "polar", label: "Tiny planet", category: "distort", params: [amount(1), p("zoom", "Zoom", 0.2, 3, 1)], glsl: `vec4 effect(vec2 uv){ vec2 d = (uv - 0.5) * vec2(aspect(), 1.0); float r = length(d) * 2.0 / p_zoom; float a = atan(d.y, d.x); vec2 q = vec2(fract(a / 6.283 + 0.5), 1.0 - clamp(r, 0.0, 1.0)); return src(mix(uv, q, p_amount)); }` },
  { type: "glass", label: "Frosted glass", category: "distort", params: [amount(0.5)], glsl: `vec4 effect(vec2 uv){ vec2 o = vec2(hash(uv * uRes) - 0.5, hash(uv * uRes + 7.0) - 0.5) * p_amount * 0.02; return src(uv + o); }` },
  { type: "heat-haze", label: "Heat haze", category: "distort", params: [amount(0.4)], glsl: `vec4 effect(vec2 uv){ vec2 o = vec2(fbm(uv * 8.0 + vec2(0.0, uTime * 1.5)) - 0.5, fbm(uv * 8.0 + vec2(3.0, uTime * 1.2)) - 0.5) * p_amount * 0.03; return src(uv + o); }` },
  { type: "water", label: "Underwater", category: "distort", params: [amount(0.5)], glsl: `vec4 effect(vec2 uv){ vec2 o = vec2(sin(uv.y * 20.0 + uTime * 2.0), cos(uv.x * 18.0 + uTime * 1.7)) * p_amount * 0.006; vec4 c = unpremul(src(uv + o)); c.rgb = mix(c.rgb, c.rgb * vec3(0.7, 0.95, 1.15), p_amount * 0.6); return premul(clamp(c, 0.0, 1.0)); }` },
  { type: "displace", label: "Noise displace", category: "distort", params: [amount(0.4), p("scale", "Scale", 1, 20, 6, 0.5)], glsl: `vec4 effect(vec2 uv){ vec2 o = vec2(fbm(uv * p_scale + uTime * 0.3), fbm(uv * p_scale + 5.2 + uTime * 0.3)) - 0.5; return src(uv + o * p_amount * 0.08); }` },
  { type: "stretch", label: "Stretch", category: "distort", params: [p("x", "Horizontal", 0.5, 2, 1), p("y", "Vertical", 0.5, 2, 1)], glsl: `vec4 effect(vec2 uv){ return src((uv - 0.5) / vec2(p_x, p_y) + 0.5); }` },
  { type: "perspective", label: "Perspective tilt", category: "distort", params: [p("tilt", "Tilt", -1, 1, 0.3), p("turn", "Turn", -1, 1, 0)], glsl: `vec4 effect(vec2 uv){ vec2 d = uv - 0.5; float w = 1.0 + d.y * p_tilt * 0.8 + d.x * p_turn * 0.8; vec2 q = d / w + 0.5; if (q.x < 0.0 || q.x > 1.0 || q.y < 0.0 || q.y > 1.0) return vec4(0.0); return src(q); }` },
  { type: "pinch", label: "Pinch", category: "distort", params: [amount(0.5), p("radius", "Radius", 0.05, 1, 0.4)], glsl: `vec4 effect(vec2 uv){ vec2 d = (uv - 0.5) * vec2(aspect(), 1.0); float r = length(d); float k = smoothstep(p_radius, 0.0, r); d *= 1.0 + p_amount * k; return src(d / vec2(aspect(), 1.0) + 0.5); }` },
  { type: "shatter", label: "Shards", category: "distort", params: [amount(0.4), p("cells", "Cells", 3, 30, 10, 1)], glsl: `vec4 effect(vec2 uv){ vec2 g = uv * p_cells * vec2(aspect(), 1.0); vec2 id = floor(g); vec2 o = vec2(hash(id), hash(id + 3.7)) - 0.5; return src(uv + o * p_amount * 0.04); }` },
  { type: "mirror-quad", label: "Quad mirror", category: "distort", params: [], glsl: `vec4 effect(vec2 uv){ vec2 q = abs(uv - 0.5) * 2.0; return src(q); }` },
];

// ---------- Stylize ----------
const stylize: EffectDef[] = [
  { type: "halftone", label: "Halftone", category: "stylize", params: [p("size", "Dot size", 0.003, 0.05, 0.012, 0.001), amount(1)], glsl: `vec4 effect(vec2 uv){ vec4 c = unpremul(src(uv)); vec2 g = uv * vec2(aspect(), 1.0) / p_size; g = rot2(g, 0.785); vec2 cell = fract(g) - 0.5; float l = luma(c.rgb); float dot1 = 1.0 - smoothstep(0.0, 0.08, length(cell) - (1.0 - l) * 0.6); vec3 o = vec3(dot1); c.rgb = mix(c.rgb, o, p_amount); return premul(c); }` },
  { type: "crosshatch", label: "Crosshatch", category: "stylize", params: [amount(1)], glsl: `vec4 effect(vec2 uv){ vec4 c = unpremul(src(uv)); float l = luma(c.rgb); vec2 px = uv * uRes; float h = 1.0; if (l < 0.8 && mod(px.x + px.y, 10.0) < 1.0) h = 0.0; if (l < 0.6 && mod(px.x - px.y, 10.0) < 1.0) h = 0.0; if (l < 0.4 && mod(px.x + px.y - 5.0, 10.0) < 1.0) h = 0.0; if (l < 0.2 && mod(px.x - px.y - 5.0, 10.0) < 1.0) h = 0.0; c.rgb = mix(c.rgb, vec3(h), p_amount); return premul(c); }` },
  { type: "oil-paint", label: "Oil paint", category: "stylize", params: [p("radius", "Brush", 0.5, 4, 2, 0.5)], glsl: `vec4 effect(vec2 uv){ vec2 px = p_radius / uRes; vec3 m0 = vec3(0.0), m1 = vec3(0.0), s0 = vec3(0.0), s1 = vec3(0.0); for (int y = -3; y <= 0; y++) for (int x = -3; x <= 0; x++) { vec3 c = src(uv + vec2(float(x), float(y)) * px).rgb; m0 += c; s0 += c * c; } for (int y = 0; y <= 3; y++) for (int x = 0; x <= 3; x++) { vec3 c = src(uv + vec2(float(x), float(y)) * px).rgb; m1 += c; s1 += c * c; } m0 /= 16.0; m1 /= 16.0; s0 = abs(s0 / 16.0 - m0 * m0); s1 = abs(s1 / 16.0 - m1 * m1); float a = src(uv).a; return vec4(dot(s0, vec3(1.0)) < dot(s1, vec3(1.0)) ? m0 : m1, a); }` },
  { type: "toon", label: "Cartoon", category: "stylize", params: [p("levels", "Colours", 2, 10, 5, 1), p("edges", "Edges", 0, 1, 0.7)], glsl: `vec4 effect(vec2 uv){ vec2 px = 1.0 / uRes; vec4 c = unpremul(src(uv)); float gx = luma(src(uv + vec2(px.x, 0.0)).rgb) - luma(src(uv - vec2(px.x, 0.0)).rgb); float gy = luma(src(uv + vec2(0.0, px.y)).rgb) - luma(src(uv - vec2(0.0, px.y)).rgb); float e = smoothstep(0.08, 0.2, length(vec2(gx, gy))); c.rgb = floor(c.rgb * p_levels + 0.5) / p_levels; c.rgb *= 1.0 - e * p_edges; return premul(c); }` },
  { type: "sketch", label: "Pencil sketch", category: "stylize", params: [amount(1)], glsl: `vec4 effect(vec2 uv){ vec2 px = 1.0 / uRes; float l = luma(src(uv).rgb); float b = 0.0; for (int i = 0; i < 8; i++) { float a = float(i) * 0.785; b += luma(src(uv + vec2(cos(a), sin(a)) * px * 3.0).rgb); } b /= 8.0; float s = clamp(l / max(0.01, b) , 0.0, 1.0); s = pow(s, 6.0); vec4 c = unpremul(src(uv)); c.rgb = mix(c.rgb, vec3(s), p_amount); return premul(c); }` },
  { type: "emboss", label: "Emboss", category: "stylize", params: [amount(1)], glsl: `vec4 effect(vec2 uv){ vec2 px = 1.5 / uRes; vec4 c = src(uv); float e = luma(src(uv - px).rgb) - luma(src(uv + px).rgb); vec3 o = vec3(0.5 + e * 2.0); return vec4(mix(c.rgb, o * c.a, p_amount), c.a); }` },
  { type: "neon-edges", label: "Neon edges", category: "stylize", params: [p("hue", "Hue", 0, 360, 300, 1), amount(1)], glsl: `vec4 effect(vec2 uv){ vec2 px = 1.0 / uRes; float gx = luma(src(uv + vec2(px.x, 0.0)).rgb) - luma(src(uv - vec2(px.x, 0.0)).rgb); float gy = luma(src(uv + vec2(0.0, px.y)).rgb) - luma(src(uv - vec2(0.0, px.y)).rgb); float e = clamp(length(vec2(gx, gy)) * 4.0, 0.0, 1.0); vec4 c = src(uv); vec3 neon = hsv2rgb(vec3(p_hue / 360.0 + uv.y * 0.2, 1.0, 1.0)) * e; return vec4(mix(c.rgb, neon * c.a, p_amount), c.a); }` },
  { type: "threshold", label: "Threshold", category: "stylize", params: [p("level", "Level", 0, 1, 0.5)], glsl: `vec4 effect(vec2 uv){ vec4 c = unpremul(src(uv)); c.rgb = vec3(step(p_level, luma(c.rgb))); return premul(c); }` },
  { type: "dither", label: "Dither", category: "stylize", params: [p("levels", "Levels", 2, 8, 2, 1)], glsl: `vec4 effect(vec2 uv){ vec4 c = unpremul(src(uv)); vec2 px = floor(uv * uRes); float b = mod(px.x, 4.0) * 4.0 + mod(px.y, 4.0); float t = fract(b * 0.6180339) - 0.5; c.rgb = floor(c.rgb * (p_levels - 1.0) + 0.5 + t) / (p_levels - 1.0); return premul(clamp(c, 0.0, 1.0)); }` },
  { type: "hex-mosaic", label: "Hex mosaic", category: "stylize", params: [p("size", "Size", 0.005, 0.08, 0.025, 0.001)], glsl: `vec4 effect(vec2 uv){ vec2 s = vec2(1.0, 1.732); vec2 p0 = uv * vec2(aspect(), 1.0) / p_size; vec2 a = mod(p0, s) - s * 0.5; vec2 b = mod(p0 - s * 0.5, s) - s * 0.5; vec2 g = dot(a, a) < dot(b, b) ? p0 - a : p0 - b; return src(g * p_size / vec2(aspect(), 1.0)); }` },
  { type: "stained-glass", label: "Stained glass", category: "stylize", params: [p("cells", "Cells", 4, 40, 14, 1)], glsl: `vec4 effect(vec2 uv){ vec2 g = uv * vec2(aspect(), 1.0) * p_cells; vec2 id = floor(g); float best = 9.0; float second = 9.0; vec2 bc = vec2(0.0); for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) { vec2 cell = id + vec2(float(x), float(y)); vec2 pt = cell + vec2(hash(cell), hash(cell + 1.3)); float d = length(g - pt); if (d < best) { second = best; best = d; bc = pt; } else if (d < second) second = d; } vec4 c = src(bc / p_cells / vec2(aspect(), 1.0)); float edge = smoothstep(0.0, 0.06, second - best); return vec4(c.rgb * edge, c.a); }` },
  { type: "comic", label: "Comic", category: "stylize", params: [amount(1)], glsl: `vec4 effect(vec2 uv){ vec4 c = unpremul(src(uv)); vec3 q = floor(c.rgb * 4.0 + 0.5) / 4.0; vec2 g = fract(uv * vec2(aspect(), 1.0) * 120.0) - 0.5; float dotm = step(length(g), 0.35 * (1.0 - luma(c.rgb))); vec3 o = q * (1.0 - dotm * 0.5); c.rgb = mix(c.rgb, o, p_amount); return premul(c); }` },
  { type: "painterly", label: "Watercolour", category: "stylize", params: [amount(0.8)], glsl: `vec4 effect(vec2 uv){ vec2 o = (vec2(fbm(uv * 30.0), fbm(uv * 30.0 + 4.0)) - 0.5) * 0.01; vec4 c = unpremul(src(uv + o)); c.rgb = floor(c.rgb * 6.0 + 0.5) / 6.0; float paper = 0.92 + fbm(uv * uRes / 40.0) * 0.12; c.rgb = mix(unpremul(src(uv)).rgb, c.rgb * paper, p_amount); return premul(clamp(c, 0.0, 1.0)); }` },
  { type: "led", label: "LED wall", category: "stylize", params: [p("size", "Size", 0.004, 0.04, 0.012, 0.001)], glsl: `vec4 effect(vec2 uv){ vec2 cell = vec2(p_size / aspect(), p_size); vec2 id = floor(uv / cell); vec4 c = src((id + 0.5) * cell); vec2 f0 = fract(uv / cell) - 0.5; float m = 1.0 - smoothstep(0.3, 0.45, length(f0)); return vec4(c.rgb * m, c.a); }` },
  { type: "posterize-color", label: "Pop art", category: "stylize", params: [p("hue", "Hue shift", 0, 360, 0, 1)], glsl: `vec4 effect(vec2 uv){ vec4 c = unpremul(src(uv)); float l = luma(c.rgb); vec3 o = l > 0.66 ? hsv2rgb(vec3(fract(0.15 + p_hue / 360.0), 0.9, 1.0)) : l > 0.33 ? hsv2rgb(vec3(fract(0.92 + p_hue / 360.0), 0.9, 0.9)) : hsv2rgb(vec3(fract(0.6 + p_hue / 360.0), 0.9, 0.35)); c.rgb = o; return premul(c); }` },
  { type: "night-vision", label: "Night vision", category: "stylize", params: [amount(1)], glsl: `vec4 effect(vec2 uv){ vec4 c = unpremul(src(uv)); float l = luma(c.rgb) * 1.6 + (hash(uv * uRes + uTime) - 0.5) * 0.15; vec3 o = vec3(0.1, 1.0, 0.2) * l; float v = 1.0 - smoothstep(0.35, 0.75, length(uv - 0.5)); c.rgb = mix(c.rgb, clamp(o * v, 0.0, 1.0), p_amount); return premul(c); }` },
  { type: "thermal", label: "Thermal", category: "stylize", params: [amount(1)], glsl: `vec4 effect(vec2 uv){ vec4 c = unpremul(src(uv)); float l = luma(c.rgb); vec3 o = hsv2rgb(vec3(0.7 - l * 0.7, 1.0, 0.4 + l * 0.6)); c.rgb = mix(c.rgb, o, p_amount); return premul(c); }` },
];

// ---------- Retro / film ----------
const retro: EffectDef[] = [
  { type: "old-film", label: "Old film", category: "retro", params: [amount(0.8)], glsl: `vec4 effect(vec2 uv){ float t = floor(uTime * 18.0); vec2 q = uv + vec2(0.0, (hash(vec2(t, 1.0)) - 0.5) * 0.004 * p_amount); vec4 c = unpremul(src(q)); float l = luma(c.rgb); vec3 o = vec3(l) * vec3(1.08, 0.98, 0.8); o *= 0.9 + 0.1 * hash(vec2(t, 2.0)); float scratch = step(0.997, hash(vec2(floor(uv.x * 300.0), t))) * 0.6; o += scratch; float v = 1.0 - smoothstep(0.4, 0.85, length(uv - 0.5)); c.rgb = mix(c.rgb, clamp(o * v, 0.0, 1.0), p_amount); return premul(c); }` },
  { type: "super8", label: "Super 8", category: "retro", params: [amount(0.8)], glsl: `vec4 effect(vec2 uv){ float t = floor(uTime * 18.0); vec2 q = uv + (vec2(hash(vec2(t, 3.0)), hash(vec2(t, 5.0))) - 0.5) * 0.006 * p_amount; vec4 c = unpremul(src(q)); c.rgb = grade(c.rgb, vec3(0.04, 0.03, 0.0), vec3(1.0), vec3(1.05, 1.0, 0.85), 0.85, 1.1, 0.2, vec3(0.0), vec3(0.03, 0.01, 0.0)); c.rgb += (hash(uv * uRes / 2.0 + t) - 0.5) * 0.12 * p_amount; return premul(clamp(c, 0.0, 1.0)); }` },
  { type: "crt", label: "CRT", category: "retro", params: [amount(0.7)], glsl: `vec4 effect(vec2 uv){ vec2 d = uv - 0.5; vec2 q = 0.5 + d * (1.0 + dot(d, d) * 0.25 * p_amount); if (q.x < 0.0 || q.x > 1.0 || q.y < 0.0 || q.y > 1.0) return vec4(0.0, 0.0, 0.0, 1.0); vec4 c = src(q); float scan = 0.8 + 0.2 * sin(q.y * uRes.y * 3.14159); vec3 mask = vec3(1.0); float m = mod(floor(q.x * uRes.x), 3.0); mask = m < 1.0 ? vec3(1.0, 0.7, 0.7) : m < 2.0 ? vec3(0.7, 1.0, 0.7) : vec3(0.7, 0.7, 1.0); c.rgb = mix(c.rgb, c.rgb * scan * mask * 1.2, p_amount); return c; }` },
  { type: "chromatic", label: "Chromatic aberration", category: "retro", params: [amount(0.5)], glsl: `vec4 effect(vec2 uv){ vec2 d = (uv - 0.5) * p_amount * 0.03; vec4 r = src(uv + d); vec4 g = src(uv); vec4 b = src(uv - d); return vec4(r.r, g.g, b.b, max(g.a, max(r.a, b.a))); }` },
  { type: "dust", label: "Dust & scratches", category: "retro", params: [amount(0.6)], glsl: `vec4 effect(vec2 uv){ vec4 c = src(uv); float t = floor(uTime * 12.0); float n = step(0.9985 - p_amount * 0.002, hash(floor(uv * uRes / 3.0) + t * 17.0)); float line = step(0.995, hash(vec2(floor(uv.x * 200.0), t))) * step(0.3, hash(vec2(t, 9.0))); vec3 o = c.rgb * (1.0 - n * 0.8) + line * 0.4 * c.a; return vec4(min(o, vec3(c.a)), c.a); }` },
  { type: "tv-static", label: "TV static", category: "retro", params: [amount(0.3)], glsl: `vec4 effect(vec2 uv){ vec4 c = src(uv); float n = hash(uv * uRes + fract(uTime * 30.0) * 100.0); return vec4(mix(c.rgb, vec3(n) * c.a, p_amount), c.a); }` },
  { type: "interlace", label: "Interlace", category: "retro", params: [amount(0.5)], glsl: `vec4 effect(vec2 uv){ float row = mod(floor(uv.y * uRes.y / 2.0), 2.0); vec2 q = uv + vec2(row * p_amount * 0.004 * sin(uTime * 20.0), 0.0); vec4 c = src(q); return vec4(c.rgb * (1.0 - row * p_amount * 0.3), c.a); }` },
  { type: "vhs-rewind", label: "VHS rewind", category: "retro", params: [amount(0.7)], glsl: `vec4 effect(vec2 uv){ float band = step(0.85, fract(uv.y * 3.0 - uTime * 2.0)); vec2 q = uv + vec2(band * p_amount * 0.05 * sin(uv.y * 80.0 + uTime * 30.0), 0.0); vec4 c = src(q); c.rgb += band * p_amount * 0.3 * hash(uv * uRes + uTime) * c.a; return vec4(min(c.rgb, vec3(c.a)), c.a); }` },
  { type: "color-bleed", label: "Colour bleed", category: "retro", params: [amount(0.5)], glsl: `vec4 effect(vec2 uv){ vec4 c = src(uv); vec4 s = vec4(0.0); for (int i = 0; i < 8; i++) s += src(uv - vec2(float(i) * 0.002 * p_amount, 0.0)); s /= 8.0; return vec4(mix(c.r, s.r, 0.7), c.g, mix(c.b, s.b, 0.7), c.a); }` },
  { type: "gameboy", label: "Pocket console", category: "retro", params: [p("size", "Pixel", 0.002, 0.02, 0.006, 0.001)], glsl: `vec4 effect(vec2 uv){ vec2 cell = vec2(p_size / aspect(), p_size); vec4 c = unpremul(src((floor(uv / cell) + 0.5) * cell)); float l = floor(luma(c.rgb) * 3.99) / 3.0; vec3 o = mix(vec3(0.06, 0.22, 0.06), vec3(0.6, 0.74, 0.06), l); c.rgb = o; return premul(c); }` },
  { type: "film-burn", label: "Film burn", category: "retro", params: [amount(0.6), p("speed", "Speed", 0, 2, 0.6)], glsl: `vec4 effect(vec2 uv){ vec4 c = src(uv); float n = fbm(uv * 3.0 + vec2(uTime * p_speed, 0.0)); float burn = smoothstep(0.55, 0.8, n + (uv.x - 0.5) * 0.3) * p_amount; vec3 col = mix(vec3(1.0, 0.35, 0.05), vec3(1.0, 0.9, 0.6), burn); return vec4(min(c.rgb + col * burn * c.a, vec3(1.0)), c.a); }` },
  { type: "prism", label: "Prism", category: "retro", params: [amount(0.5)], glsl: `vec4 effect(vec2 uv){ vec4 c = src(uv); vec4 a = src(uv + vec2(0.04, 0.0) * p_amount); vec4 b = src(uv - vec2(0.04, 0.0) * p_amount); return vec4(max(c.r, a.r * 0.6), c.g, max(c.b, b.b * 0.6), c.a); }` },
];

// ---------- Motion / time ----------
const motion: EffectDef[] = [
  { type: "strobe", label: "Strobe", category: "motion", params: [p("rate", "Flashes/s", 1, 20, 6, 1), amount(0.6)], glsl: `vec4 effect(vec2 uv){ vec4 c = src(uv); float on = step(0.5, fract(uTime * p_rate)); return vec4(min(c.rgb + on * p_amount * c.a, vec3(c.a)), c.a); }` },
  { type: "flicker", label: "Flicker", category: "motion", params: [amount(0.4)], glsl: `vec4 effect(vec2 uv){ vec4 c = src(uv); float n = hash(vec2(floor(uTime * 24.0), 1.0)); return vec4(c.rgb * (1.0 - n * p_amount * 0.5), c.a); }` },
  { type: "pulse", label: "Brightness pulse", category: "motion", params: [amount(0.4), p("speed", "Beats/s", 0.25, 4, 2, 0.25)], glsl: `vec4 effect(vec2 uv){ vec4 c = src(uv); float k = exp(-fract(uTime * p_speed) * 5.0) * p_amount; return vec4(min(c.rgb * (1.0 + k), vec3(c.a)), c.a); }` },
  { type: "earthquake", label: "Earthquake", category: "motion", params: [amount(0.6)], glsl: `vec4 effect(vec2 uv){ float t = uTime * 40.0; vec2 o = vec2(noise(vec2(t, 0.0)) - 0.5, noise(vec2(0.0, t)) - 0.5) * p_amount * 0.08; float z = 1.0 + p_amount * 0.09; return src((uv - 0.5) / z + 0.5 + o); }` },
  { type: "handheld", label: "Handheld", category: "motion", params: [amount(0.4)], glsl: `vec4 effect(vec2 uv){ float t = uTime * 0.8; vec2 o = vec2(fbm(vec2(t, 0.0)) - 0.5, fbm(vec2(0.0, t)) - 0.5) * p_amount * 0.05; float r = (fbm(vec2(t, t)) - 0.5) * p_amount * 0.05; float z = 1.0 + p_amount * 0.06; vec2 d = rot2((uv - 0.5) * vec2(aspect(), 1.0), r) / vec2(aspect(), 1.0); return src(d / z + 0.5 + o); }` },
  { type: "ken-burns-in", label: "Slow zoom in", category: "motion", params: [p("speed", "Zoom/s", 0, 0.3, 0.06)], glsl: `vec4 effect(vec2 uv){ float z = 1.0 + uTime * p_speed; return src((uv - 0.5) / z + 0.5); }` },
  { type: "ken-burns-out", label: "Slow zoom out", category: "motion", params: [p("speed", "Zoom/s", 0, 0.3, 0.06), p("start", "Start zoom", 1, 2, 1.3)], glsl: `vec4 effect(vec2 uv){ float z = max(1.0, p_start - uTime * p_speed); return src((uv - 0.5) / z + 0.5); }` },
  { type: "pan", label: "Slow pan", category: "motion", params: [p("speed", "Speed", -0.2, 0.2, 0.04), p("zoom", "Zoom", 1, 2, 1.2)], glsl: `vec4 effect(vec2 uv){ float room = (1.0 - 1.0 / p_zoom) * 0.5; float x = clamp(uTime * p_speed, -room, room); return src((uv - 0.5) / p_zoom + 0.5 + vec2(x, 0.0)); }` },
  { type: "spin", label: "Spin", category: "motion", params: [p("speed", "Turns/s", -2, 2, 0.25), p("zoom", "Zoom", 1, 2, 1.5)], glsl: `vec4 effect(vec2 uv){ vec2 d = rot2((uv - 0.5) * vec2(aspect(), 1.0), uTime * p_speed * 6.283) / vec2(aspect(), 1.0); return src(d / p_zoom + 0.5); }` },
  { type: "bounce", label: "Bounce", category: "motion", params: [amount(0.3), p("speed", "Bounces/s", 0.5, 4, 2, 0.5)], glsl: `vec4 effect(vec2 uv){ float b = abs(sin(uTime * p_speed * 3.14159)) * p_amount * 0.08; return src(uv + vec2(0.0, b - p_amount * 0.04)); }` },
  { type: "wobble", label: "Wobble", category: "motion", params: [amount(0.3), p("speed", "Speed", 0.5, 5, 2)], glsl: `vec4 effect(vec2 uv){ float a = sin(uTime * p_speed * 3.0) * p_amount * 0.1; float z = 1.0 + p_amount * 0.12; vec2 d = rot2((uv - 0.5) * vec2(aspect(), 1.0), a) / vec2(aspect(), 1.0); return src(d / z + 0.5); }` },
  { type: "rgb-shake", label: "RGB shake", category: "motion", params: [amount(0.5)], glsl: `vec4 effect(vec2 uv){ float t = uTime * 20.0; vec2 o = vec2(noise(vec2(t, 2.0)) - 0.5, noise(vec2(4.0, t)) - 0.5) * p_amount * 0.03; vec4 r = src(uv + o); vec4 g = src(uv); vec4 b = src(uv - o); return vec4(r.r, g.g, b.b, g.a); }` },
  { type: "echo", label: "Echo", category: "motion", params: [amount(0.5)], glsl: `vec4 effect(vec2 uv){ vec4 c = src(uv); vec4 e = vec4(0.0); for (int i = 1; i <= 4; i++) { float k = 1.0 + float(i) * 0.03 * p_amount; e += src((uv - 0.5) / k + 0.5) * (0.5 / float(i)); } return max(c, e * p_amount); }` },
];

// ---------- Light & weather ----------
const light: EffectDef[] = [
  { type: "bloom", label: "Bloom", category: "light", params: [amount(0.6), p("threshold", "Threshold", 0, 1, 0.7)], glsl: `vec4 effect(vec2 uv){ vec4 c = src(uv); vec3 acc = vec3(0.0); for (int i = 0; i < 32; i++) { float a = float(i) * 2.39996; float d = sqrt(float(i) / 32.0) * 0.06; vec4 s = unpremul(src(uv + vec2(cos(a) / aspect(), sin(a)) * d)); acc += max(s.rgb - p_threshold, 0.0) * s.a; } acc /= 32.0; return vec4(min(c.rgb + acc * p_amount * 6.0, vec3(1.0)), c.a); }` },
  { type: "god-rays", label: "Light rays", category: "light", params: [amount(0.6), p("x", "Source X", 0, 1, 0.5), p("y", "Source Y", 0, 1, 0.1)], glsl: `vec4 effect(vec2 uv){ vec4 c = src(uv); vec2 lp = vec2(p_x, p_y); vec2 d = (uv - lp) / 24.0; vec2 q = uv; float acc = 0.0; float decay = 1.0; for (int i = 0; i < 24; i++) { q -= d; acc += max(luma(src(q).rgb) - 0.6, 0.0) * decay; decay *= 0.93; } return vec4(min(c.rgb + vec3(1.0, 0.95, 0.85) * acc * p_amount * 0.5, vec3(1.0)), c.a); }` },
  { type: "lens-flare", label: "Lens flare", category: "light", params: [amount(0.6), p("x", "Source X", 0, 1, 0.3), p("y", "Source Y", 0, 1, 0.25)], glsl: `vec4 effect(vec2 uv){ vec4 c = src(uv); vec2 lp = vec2(p_x, p_y); vec2 a = vec2(aspect(), 1.0); float d = length((uv - lp) * a); vec3 f = vec3(1.0, 0.9, 0.7) * 0.02 / (d + 0.02); for (int i = 1; i <= 4; i++) { vec2 gp = lp + (vec2(0.5) - lp) * float(i) * 0.5; float gd = length((uv - gp) * a); f += hsv2rgb(vec3(float(i) * 0.2, 0.6, 1.0)) * smoothstep(0.05, 0.0, abs(gd - 0.03 * float(i))) * 0.3; } return vec4(min(c.rgb + f * p_amount, vec3(1.0)), c.a); }` },
  { type: "star-glare", label: "Star glare", category: "light", params: [amount(0.5), p("threshold", "Threshold", 0, 1, 0.8)], glsl: `vec4 effect(vec2 uv){ vec4 c = src(uv); vec3 acc = vec3(0.0); for (int k = 0; k < 4; k++) { vec2 dir = vec2(cos(float(k) * 0.785 + 0.39), sin(float(k) * 0.785 + 0.39)); for (int i = -10; i <= 10; i++) { vec4 s = unpremul(src(uv + dir * float(i) * 0.004 / vec2(aspect(), 1.0))); acc += max(s.rgb - p_threshold, 0.0) * (1.0 - abs(float(i)) / 11.0); } } return vec4(min(c.rgb + acc * p_amount * 0.15, vec3(1.0)), c.a); }` },
  { type: "rainbow", label: "Rainbow", category: "light", params: [amount(0.3)], glsl: `vec4 effect(vec2 uv){ vec4 c = src(uv); vec3 r = hsv2rgb(vec3(fract(uv.x * 0.8 + uv.y * 0.3 + uTime * 0.1), 0.8, 1.0)); return vec4(mix(c.rgb, c.rgb * r * 1.3, p_amount) , c.a); }` },
  { type: "sparkle", label: "Sparkles", category: "light", params: [amount(0.6), p("density", "Density", 0, 1, 0.4)], glsl: `vec4 effect(vec2 uv){ vec4 c = src(uv); vec2 g = uv * vec2(aspect(), 1.0) * 40.0; vec2 id = floor(g); float h = hash(id); float on = step(1.0 - p_density * 0.15, h); float tw = 0.5 + 0.5 * sin(uTime * 6.0 + h * 50.0); vec2 f0 = fract(g) - 0.5; float star = (0.004 / (abs(f0.x * f0.y) + 0.003)) * smoothstep(0.5, 0.0, length(f0)); return vec4(min(c.rgb + vec3(star * on * tw * p_amount), vec3(1.0)), max(c.a, min(1.0, star * on * tw * p_amount))); }` },
  { type: "snow", label: "Snow", category: "light", params: [amount(0.7), p("speed", "Speed", 0.1, 2, 0.6)], glsl: `vec4 effect(vec2 uv){ vec4 c = src(uv); float s = 0.0; for (int l = 0; l < 3; l++) { float sc = 20.0 + float(l) * 15.0; vec2 g = uv * vec2(aspect(), 1.0) * sc + vec2(sin(uTime + float(l)) * 0.5, -uTime * p_speed * (2.0 + float(l))); vec2 id = floor(g); vec2 f0 = fract(g) - 0.5 - (vec2(hash(id), hash(id + 2.0)) - 0.5) * 0.6; s += smoothstep(0.08, 0.0, length(f0)) * step(0.7, hash(id + 5.0)); } return vec4(min(c.rgb + s * p_amount, vec3(1.0)), max(c.a, min(1.0, s * p_amount))); }` },
  { type: "rain", label: "Rain", category: "light", params: [amount(0.6), p("speed", "Speed", 0.5, 3, 1.5)], glsl: `vec4 effect(vec2 uv){ vec4 c = src(uv); vec2 g = vec2(uv.x * 120.0, uv.y * 8.0 + uTime * p_speed * 6.0 + hash(vec2(floor(uv.x * 120.0), 1.0)) * 10.0); float drop = step(0.85, hash(floor(g))) * smoothstep(0.0, 0.6, fract(g.y)) * (1.0 - fract(g.y)); return vec4(mix(c.rgb * (1.0 - p_amount * 0.2), vec3(0.8, 0.85, 0.95) * c.a, drop * p_amount), c.a); }` },
  { type: "fog", label: "Fog", category: "light", params: [amount(0.5)], glsl: `vec4 effect(vec2 uv){ vec4 c = src(uv); float f = fbm(uv * 3.0 + vec2(uTime * 0.05, 0.0)); float k = f * p_amount * (0.5 + uv.y * 0.5); return vec4(mix(c.rgb, vec3(0.85) * c.a, k), c.a); }` },
  { type: "fire-glow", label: "Fire glow", category: "light", params: [amount(0.5)], glsl: `vec4 effect(vec2 uv){ vec4 c = src(uv); float f = fbm(vec2(uv.x * 6.0, uv.y * 4.0 - uTime * 1.5)); float k = smoothstep(0.4, 1.0, (1.0 - uv.y) * 1.2 * f + f * 0.4) * p_amount; vec3 col = mix(vec3(1.0, 0.2, 0.0), vec3(1.0, 0.8, 0.2), f); return vec4(min(c.rgb + col * k, vec3(1.0)), c.a); }` },
  { type: "sun-leak", label: "Sun leak", category: "light", params: [amount(0.5), p("corner", "Corner", 0, 3, 1, 1)], glsl: `vec4 effect(vec2 uv){ vec4 c = src(uv); vec2 cp = p_corner < 0.5 ? vec2(0.0) : p_corner < 1.5 ? vec2(1.0, 0.0) : p_corner < 2.5 ? vec2(1.0) : vec2(0.0, 1.0); float d = length((uv - cp) * vec2(aspect(), 1.0)); vec3 col = vec3(1.0, 0.7, 0.35) * exp(-d * 2.5) * (0.8 + 0.2 * sin(uTime)); return vec4(min(c.rgb + col * p_amount, vec3(1.0)), c.a); }` },
  { type: "vignette-color", label: "Colour vignette", category: "light", params: [amount(0.6), p("hue", "Hue", 0, 360, 280, 1)], glsl: `vec4 effect(vec2 uv){ vec4 c = src(uv); float v = smoothstep(0.3, 0.9, length((uv - 0.5) * vec2(aspect(), 1.0) / max(aspect(), 1.0)) * 1.4); vec3 col = hsv2rgb(vec3(p_hue / 360.0, 0.8, 0.6)); return vec4(mix(c.rgb, col * c.a, v * p_amount), c.a); }` },
];

export const LIBRARY_EFFECTS: readonly EffectDef[] = [
  ...lookEffects,
  ...colorTools,
  ...keying,
  ...blurs,
  ...distort,
  ...stylize,
  ...retro,
  ...motion,
  ...light,
];
