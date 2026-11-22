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
`;

export function effectFragment(paramKeys: readonly string[], body: string): string {
  return `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uTex;
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
