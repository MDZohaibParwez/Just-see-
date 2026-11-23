/** Shared GLSL snippets for the WebGL2 compositor. */

export const QUAD_VS = `#version 300 es
in vec2 aPos;
uniform mat3 uMatrix;
uniform mat3 uUvMatrix;
uniform vec2 uRes;
out vec2 vUv;
void main() {
  vec3 px = uMatrix * vec3(aPos, 1.0);
  vec2 ndc = px.xy / uRes * 2.0 - 1.0;
  gl_Position = vec4(ndc.x, -ndc.y, 0.0, 1.0);
  vUv = (uUvMatrix * vec3(aPos + 0.5, 1.0)).xy;
}`;

export const QUAD_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTex;
uniform float uOpacity;
out vec4 outColor;
void main() {
  if (vUv.x < 0.0 || vUv.x > 1.0 || vUv.y < 0.0 || vUv.y > 1.0) { outColor = vec4(0.0); return; }
  outColor = texture(uTex, vUv) * uOpacity;
}`;

/** Source draw with a person mask (background removal). */
export const QUAD_MASK_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTex;
uniform sampler2D uMask;
uniform float uOpacity;
uniform float uThreshold;
uniform float uFeather;
uniform float uInvert;
out vec4 outColor;
void main() {
  if (vUv.x < 0.0 || vUv.x > 1.0 || vUv.y < 0.0 || vUv.y > 1.0) { outColor = vec4(0.0); return; }
  float m = texture(uMask, vUv).r;
  float a = smoothstep(uThreshold - uFeather, uThreshold + uFeather + 0.0001, m);
  if (uInvert > 0.5) a = 1.0 - a;
  outColor = texture(uTex, vUv) * a * uOpacity;
}`;

/** Fullscreen pass: vUv in GL texture space (0,0 bottom-left). */
export const FULL_VS = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  gl_Position = vec4(aPos * 2.0, 0.0, 1.0);
  vUv = aPos + 0.5;
}`;

export const COMMON_GLSL = `
uniform vec2 uRes;
uniform float uTime;
uniform int uPass;
float aspect() { return uRes.x / uRes.y; }
vec4 unpremul(vec4 c) { return c.a > 0.0001 ? vec4(c.rgb / c.a, c.a) : vec4(0.0); }
vec4 premul(vec4 c) { return vec4(c.rgb * c.a, c.a); }
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
vec3 rgb2hsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + 1e-10)), d / (q.x + 1e-10), q.x);
}
vec3 hsv2rgb(vec3 c) {
  vec3 p = abs(fract(c.xxx + vec3(1.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
  return c.z * clamp(p - 1.0, 0.0, 1.0);
}
// Lift / gamma / gain grade with saturation, contrast, fade and split toning.
vec3 grade(vec3 c, vec3 lift, vec3 gam, vec3 gain, float sat, float con, float fade, vec3 shadowTint, vec3 highTint) {
  c = clamp(c * gain + lift * (1.0 - c), 0.0, 1.0);
  c = pow(c, 1.0 / max(gam, vec3(0.05)));
  c = (c - 0.5) * con + 0.5;
  float l = luma(c);
  c = mix(vec3(l), c, sat);
  c += shadowTint * (1.0 - smoothstep(0.0, 0.55, l)) + highTint * smoothstep(0.45, 1.0, l);
  c = mix(c, vec3(0.5) + (c - 0.5) * (1.0 - fade), fade > 0.0 ? 1.0 : 0.0);
  c = c * (1.0 - fade * 0.25) + fade * 0.12;
  return clamp(c, 0.0, 1.0);
}
float sdBox(vec2 p, vec2 b) { vec2 d = abs(p) - b; return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0); }
vec2 rot2(vec2 p, float a) { float s = sin(a), c = cos(a); return mat2(c, -s, s, c) * p; }
float fbm(vec2 p) { float v = 0.0; float a = 0.5; for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }
`;

export function effectFragment(paramKeys: readonly string[], body: string, lut = false): string {
  return `#version 300 es
precision highp float;
precision highp sampler3D;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uTex;
${lut ? "uniform sampler3D uLut;\nuniform float uLutSize;" : ""}
${COMMON_GLSL}
${paramKeys.map((k) => `uniform float p_${k};`).join("\n")}
vec4 src(vec2 uv) { return texture(uTex, vec2(uv.x, 1.0 - uv.y)); }
${body}
void main() { outColor = effect(vec2(vUv.x, 1.0 - vUv.y)); }`;
}

export function transitionFragment(body: string): string {
  return `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uFrom;
uniform sampler2D uTo;
uniform float progress;
${COMMON_GLSL}
vec4 getFrom(vec2 uv) { return texture(uFrom, vec2(uv.x, 1.0 - uv.y)); }
vec4 getTo(vec2 uv) { return texture(uTo, vec2(uv.x, 1.0 - uv.y)); }
${body}
void main() { outColor = transition(vec2(vUv.x, 1.0 - vUv.y)); }`;
}

export const BLEND_MODES = [
  "normal",
  "multiply",
  "screen",
  "overlay",
  "darken",
  "lighten",
  "add",
  "difference",
  "soft-light",
  "hard-light",
  "color-dodge",
  "color-burn",
] as const;

/** Separable blend modes (W3C compositing spec), premultiplied in and out. */
export const BLEND_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uBase;
uniform sampler2D uTop;
uniform float uOpacity;
uniform int uMode;
out vec4 outColor;
float softLight(float b, float s) {
  if (s <= 0.5) return b - (1.0 - 2.0 * s) * b * (1.0 - b);
  float d = b <= 0.25 ? ((16.0 * b - 12.0) * b + 4.0) * b : sqrt(b);
  return b + (2.0 * s - 1.0) * (d - b);
}
float hardLight(float b, float s) { return s <= 0.5 ? b * 2.0 * s : 1.0 - (1.0 - b) * (1.0 - (2.0 * s - 1.0)); }
float dodge(float b, float s) { return b == 0.0 ? 0.0 : (s >= 1.0 ? 1.0 : min(1.0, b / (1.0 - s))); }
float burn(float b, float s) { return b >= 1.0 ? 1.0 : (s <= 0.0 ? 0.0 : 1.0 - min(1.0, (1.0 - b) / s)); }
vec3 blendFn(vec3 b, vec3 s) {
  if (uMode == 1) return b * s;
  if (uMode == 2) return b + s - b * s;
  if (uMode == 3) return vec3(hardLight(s.r, b.r), hardLight(s.g, b.g), hardLight(s.b, b.b));
  if (uMode == 4) return min(b, s);
  if (uMode == 5) return max(b, s);
  if (uMode == 6) return min(vec3(1.0), b + s);
  if (uMode == 7) return abs(b - s);
  if (uMode == 8) return vec3(softLight(b.r, s.r), softLight(b.g, s.g), softLight(b.b, s.b));
  if (uMode == 9) return vec3(hardLight(b.r, s.r), hardLight(b.g, s.g), hardLight(b.b, s.b));
  if (uMode == 10) return vec3(dodge(b.r, s.r), dodge(b.g, s.g), dodge(b.b, s.b));
  if (uMode == 11) return vec3(burn(b.r, s.r), burn(b.g, s.g), burn(b.b, s.b));
  return s;
}
void main() {
  vec4 b = texture(uBase, vUv);
  vec4 s = texture(uTop, vUv) * uOpacity;
  vec3 cb = b.a > 0.0001 ? b.rgb / b.a : vec3(0.0);
  vec3 cs = s.a > 0.0001 ? s.rgb / s.a : vec3(0.0);
  vec3 mixed = (1.0 - b.a) * cs + b.a * blendFn(cb, cs);
  outColor = vec4(s.a * mixed + (1.0 - s.a) * b.rgb, s.a + b.a * (1.0 - s.a));
}`;
