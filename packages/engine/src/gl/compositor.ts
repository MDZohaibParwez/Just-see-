import { EFFECTS_BY_TYPE, resolveParams, type EffectDef } from "../effects/catalog";
import { TRANSITIONS_BY_TYPE } from "../transitions/catalog";
import { identity, placementMatrix, scaling, uvRotationMatrix, multiply, translation, type Mat3 } from "../layout";
import type { FramePlan, MediaSource, MotionSource, TextSource, VisualLayer } from "../resolve";
import { renderMotion, type Ctx2D } from "../motion/render";
import type { Lut3D } from "../media/lut";
import { drawText, textRasterKey, type Canvas2D } from "../text/raster";
import { BLEND_FS, BLEND_MODES, FULL_VS, QUAD_FS, QUAD_MASK_FS, QUAD_VS, effectFragment, transitionFragment } from "./shaders";

export type GLCanvas = HTMLCanvasElement | OffscreenCanvas;

export interface ResolvedImage {
  image: TexImageSource;
  /** Rotation (degrees) the compositor still has to apply to the pixels. */
  rotation: number;
  /** Changes whenever the pixels change; used to skip re-uploads. */
  version: number | string;
}

/** Supplies decoded pixels for media sources. */
export interface SourceProvider {
  getImage(source: MediaSource): ResolvedImage | null;
  /** Parsed 3D LUT for a LUT asset, when available. */
  getLut?(assetId: string): Lut3D | null;
  /** Person mask for a clip's current frame (background removal). */
  getMask?(clipId: string): ResolvedImage | null;
}

interface Program {
  prog: WebGLProgram;
  uniforms: Map<string, WebGLUniformLocation | null>;
}

interface Target {
  fbo: WebGLFramebuffer;
  tex: WebGLTexture;
}

interface CachedTexture {
  tex: WebGLTexture;
  version: number | string;
}

function parseColor(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m || !m[1]) return [0, 0, 0];
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/**
 * WebGL2 compositor. Renders a FramePlan into its canvas. The same code runs
 * for preview and export so both produce identical pixels.
 */
export class Compositor {
  readonly canvas: GLCanvas;
  private gl: WebGL2RenderingContext;
  private vao: WebGLVertexArrayObject;
  private quadProg: Program;
  private blendProg: Program | null = null;
  private maskProg: Program | null = null;
  private effectProgs = new Map<string, Program>();
  private transitionProgs = new Map<string, Program>();
  private targets: Target[] = [];
  private targetW = 0;
  private targetH = 0;
  private textures = new Map<string, CachedTexture>();
  private motionCanvases = new Map<string, { canvas: GLCanvas; ctx: Ctx2D; key: string }>();
  private compVersions = new WeakMap<object, number>();
  private compCounter = 0;
  private textCanvases = new Map<string, { canvas: GLCanvas; ctx: Canvas2D; key: string }>();
  private usedThisFrame = new Set<string>();
  private luts = new Map<string, { tex: WebGLTexture; size: number }>();
  private dummyLut: WebGLTexture | null = null;

  private transparent: boolean;

  constructor(canvas: GLCanvas, opts: { preserveDrawingBuffer?: boolean; transparent?: boolean } = {}) {
    this.canvas = canvas;
    this.transparent = opts.transparent ?? false;
    const gl = canvas.getContext("webgl2", {
      alpha: this.transparent,
      antialias: false,
      premultipliedAlpha: true,
      preserveDrawingBuffer: opts.preserveDrawingBuffer ?? false,
      powerPreference: "high-performance",
    }) as WebGL2RenderingContext | null;
    if (!gl) throw new Error("WebGL2 is not available in this browser");
    this.gl = gl;
    const vao = gl.createVertexArray();
    const buf = gl.createBuffer();
    if (!vao || !buf) throw new Error("Could not create WebGL buffers");
    this.vao = vao;
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, 0.5]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    this.quadProg = this.compile(QUAD_VS, QUAD_FS);
  }

  get width(): number {
    return this.canvas.width;
  }

  get height(): number {
    return this.canvas.height;
  }

  resize(width: number, height: number): void {
    const w = Math.max(2, Math.round(width));
    const h = Math.max(2, Math.round(height));
    if (this.canvas.width !== w) this.canvas.width = w;
    if (this.canvas.height !== h) this.canvas.height = h;
  }

  private compile(vs: string, fs: string): Program {
    const gl = this.gl;
    const make = (type: number, srcText: string) => {
      const sh = gl.createShader(type);
      if (!sh) throw new Error("Could not create shader");
      gl.shaderSource(sh, srcText);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(sh);
        gl.deleteShader(sh);
        throw new Error(`Shader compile failed: ${log ?? "unknown"}`);
      }
      return sh;
    };
    const v = make(gl.VERTEX_SHADER, vs);
    const f = make(gl.FRAGMENT_SHADER, fs);
    const prog = gl.createProgram();
    if (!prog) throw new Error("Could not create program");
    gl.attachShader(prog, v);
    gl.attachShader(prog, f);
    gl.bindAttribLocation(prog, 0, "aPos");
    gl.linkProgram(prog);
    gl.deleteShader(v);
    gl.deleteShader(f);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error(`Program link failed: ${gl.getProgramInfoLog(prog) ?? "unknown"}`);
    }
    return { prog, uniforms: new Map() };
  }

  private loc(p: Program, name: string): WebGLUniformLocation | null {
    if (!p.uniforms.has(name)) p.uniforms.set(name, this.gl.getUniformLocation(p.prog, name));
    return p.uniforms.get(name) ?? null;
  }

  private effectProgram(def: EffectDef): Program {
    let p = this.effectProgs.get(def.type);
    if (!p) {
      p = this.compile(FULL_VS, effectFragment(def.params.map((x) => x.key), def.glsl, def.lut === true));
      this.effectProgs.set(def.type, p);
    }
    return p;
  }

  private transitionProgram(type: string): Program | undefined {
    const def = TRANSITIONS_BY_TYPE.get(type) ?? TRANSITIONS_BY_TYPE.get("crossfade");
    if (!def) return undefined;
    let p = this.transitionProgs.get(def.type);
    if (!p) {
      p = this.compile(FULL_VS, transitionFragment(def.glsl));
      this.transitionProgs.set(def.type, p);
    }
    return p;
  }

  /** Compile every effect and transition; returns failures (for tests). */
  compileAll(effectTypes: readonly string[], transitionTypes: readonly string[]): string[] {
    const errors: string[] = [];
    for (const t of effectTypes) {
      const def = EFFECTS_BY_TYPE.get(t);
      try {
        if (!def) throw new Error("unknown");
        this.effectProgram(def);
      } catch (e) {
        errors.push(`effect ${t}: ${(e as Error).message}`);
      }
    }
    try {
      if (!this.maskProg) this.maskProg = this.compile(QUAD_VS, QUAD_MASK_FS);
    } catch (e) {
      errors.push(`mask: ${(e as Error).message}`);
    }
    try {
      if (!this.blendProg) this.blendProg = this.compile(FULL_VS, BLEND_FS);
    } catch (e) {
      errors.push(`blend: ${(e as Error).message}`);
    }
    for (const t of transitionTypes) {
      try {
        if (!TRANSITIONS_BY_TYPE.has(t)) throw new Error("unknown");
        this.transitionProgram(t);
      } catch (e) {
        errors.push(`transition ${t}: ${(e as Error).message}`);
      }
    }
    return errors;
  }

  private newTexture(): WebGLTexture {
    const gl = this.gl;
    const tex = gl.createTexture();
    if (!tex) throw new Error("Could not create texture");
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  private ensureTargets(w: number, h: number): void {
    if (this.targetW === w && this.targetH === h && this.targets.length) return;
    const gl = this.gl;
    for (const t of this.targets) {
      gl.deleteFramebuffer(t.fbo);
      gl.deleteTexture(t.tex);
    }
    this.targets = [];
    for (let i = 0; i < 5; i++) {
      const tex = this.newTexture();
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      const fbo = gl.createFramebuffer();
      if (!fbo) throw new Error("Could not create framebuffer");
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      this.targets.push({ fbo, tex });
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.targetW = w;
    this.targetH = h;
  }

  private target(i: number): Target {
    const t = this.targets[i];
    if (!t) throw new Error("Render target missing");
    return t;
  }

  private upload(key: string, image: TexImageSource, version: number | string): WebGLTexture {
    const gl = this.gl;
    this.usedThisFrame.add(key);
    let cached = this.textures.get(key);
    if (cached && cached.version === version) return cached.tex;
    if (!cached) {
      cached = { tex: this.newTexture(), version: -1 };
      this.textures.set(key, cached);
    }
    gl.bindTexture(gl.TEXTURE_2D, cached.tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    cached.version = version;
    return cached.tex;
  }

  private textTexture(src: TextSource, w: number, h: number): WebGLTexture {
    let entry = this.textCanvases.get(src.clipId);
    if (!entry) {
      const canvas: GLCanvas =
        typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(w, h) : Object.assign(document.createElement("canvas"), { width: w, height: h });
      const ctx = canvas.getContext("2d") as Canvas2D | null;
      if (!ctx) throw new Error("2D canvas is not available");
      entry = { canvas, ctx, key: "" };
      this.textCanvases.set(src.clipId, entry);
    }
    const key = textRasterKey(src.clip, src.anim, w, h, src.localUs);
    if (entry.key !== key) {
      if (entry.canvas.width !== w) entry.canvas.width = w;
      if (entry.canvas.height !== h) entry.canvas.height = h;
      drawText(entry.ctx, src.clip, src.anim, w, h, src.localUs);
      entry.key = key;
    }
    return this.upload(`text:${src.clipId}`, entry.canvas, key);
  }

  /** Render a motion comp to a canvas (cached per comp version and time). */
  private motionTexture(src: MotionSource, layer: VisualLayer, provider: SourceProvider, w: number, h: number): { tex: WebGLTexture; cw: number; ch: number } {
    const comp = src.comp;
    // Pixels per comp pixel: enough for the comp's size on screen, capped for memory.
    const fit = Math.min(w / comp.width, h / comp.height) * Math.max(1, Math.abs(layer.transform.scale));
    const scale = Math.min(fit, 4096 / Math.max(comp.width, comp.height));
    const cw = Math.max(1, Math.round(comp.width * scale));
    const ch = Math.max(1, Math.round(comp.height * scale));
    let entry = this.motionCanvases.get(src.clipId);
    if (!entry) {
      const canvas: GLCanvas = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(cw, ch) : Object.assign(document.createElement("canvas"), { width: cw, height: ch });
      const ctx = canvas.getContext("2d") as Ctx2D | null;
      if (!ctx) throw new Error("2D canvas is not available");
      entry = { canvas, ctx, key: "" };
      this.motionCanvases.set(src.clipId, entry);
    }
    let ver = this.compVersions.get(comp);
    if (ver === undefined) {
      ver = ++this.compCounter;
      this.compVersions.set(comp, ver);
    }
    const images = new Map<string, CanvasImageSource>();
    const imgVersions: (string | number)[] = [];
    for (const m of src.images) {
      const r = provider.getImage(m);
      if (r) {
        images.set(m.assetId, r.image as CanvasImageSource);
        imgVersions.push(r.version);
      } else imgVersions.push("-");
    }
    const key = `${ver}:${src.tUs}:${cw}x${ch}:${imgVersions.join(",")}`;
    if (entry.key !== key) {
      if (entry.canvas.width !== cw) entry.canvas.width = cw;
      if (entry.canvas.height !== ch) entry.canvas.height = ch;
      renderMotion(entry.ctx, comp, src.tUs, { scale, images });
      entry.key = key;
    }
    return { tex: this.upload(`motion:${src.clipId}`, entry.canvas, key), cw: comp.width, ch: comp.height };
  }

  private drawQuad(p: Program, tex: WebGLTexture, matrix: Mat3, uv: Mat3, opacity: number, w: number, h: number): void {
    const gl = this.gl;
    gl.useProgram(p.prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(this.loc(p, "uTex"), 0);
    gl.uniformMatrix3fv(this.loc(p, "uMatrix"), false, matrix);
    gl.uniformMatrix3fv(this.loc(p, "uUvMatrix"), false, uv);
    gl.uniform2f(this.loc(p, "uRes"), w, h);
    gl.uniform1f(this.loc(p, "uOpacity"), opacity);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  private fullscreen(w: number, h: number): Mat3 {
    return multiply(translation(w / 2, h / 2), scaling(w, h));
  }

  /** UV matrix for sampling an FBO (stored bottom-up) with top-down coordinates. */
  private fboUv(): Mat3 {
    return [1, 0, 0, 0, -1, 0, 0, 1, 1];
  }

  /**
   * Draw one visual layer (source + effects) into a render target at full
   * opacity. Returns the index of the target holding the result.
   */
  private renderLayer(layer: VisualLayer, provider: SourceProvider, w: number, h: number, free: [number, number]): number | null {
    const gl = this.gl;
    let tex: WebGLTexture;
    let matrix: Mat3;
    let uv: Mat3 = identity();
    const src = layer.source;
    if (src.kind === "text") {
      tex = this.textTexture(src, w, h);
      matrix = this.fullscreen(w, h);
    } else if (src.kind === "motion") {
      const m = this.motionTexture(src, layer, provider, w, h);
      tex = m.tex;
      matrix = placementMatrix(layer.transform, m.cw, m.ch, w, h);
    } else {
      const img = provider.getImage(src);
      if (!img) return null;
      tex = this.upload(src.kind === "image" ? `img:${src.assetId}` : `vid:${src.clipId}`, img.image, img.version);
      const c = layer.crop;
      const cw = Math.max(0.05, 1 - c.left - c.right);
      const ch = Math.max(0.05, 1 - c.top - c.bottom);
      matrix = placementMatrix(layer.transform, src.width * cw, src.height * ch, w, h);
      const cropUv: Mat3 = multiply(translation(c.left, c.top), scaling(cw, ch));
      uv = img.rotation % 360 !== 0 ? multiply(uvRotationMatrix(img.rotation), cropUv) : cropUv;
    }
    let [a, b] = free;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.target(a).fbo);
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.disable(gl.BLEND);
    const bgFx = src.kind !== "text" ? layer.effects.find((e) => e.type === "bg-remove") : undefined;
    const mask = bgFx && src.kind !== "text" ? provider.getMask?.(src.clipId) : null;
    if (bgFx && mask) {
      if (!this.maskProg) this.maskProg = this.compile(QUAD_VS, QUAD_MASK_FS);
      const mp = this.maskProg;
      const mtex = this.upload(`mask:${src.kind === "text" ? "" : src.clipId}`, mask.image, mask.version);
      gl.useProgram(mp.prog);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, mtex);
      gl.uniform1i(this.loc(mp, "uMask"), 1);
      const prm = bgFx.params;
      gl.uniform1f(this.loc(mp, "uThreshold"), prm.threshold ?? 0.5);
      gl.uniform1f(this.loc(mp, "uFeather"), prm.feather ?? 0.08);
      gl.uniform1f(this.loc(mp, "uInvert"), prm.invert ?? 0);
      gl.activeTexture(gl.TEXTURE0);
      this.drawQuad(mp, tex, matrix, uv, 1, w, h);
    } else {
      this.drawQuad(this.quadProg, tex, matrix, uv, 1, w, h);
    }
    for (const fx of layer.effects) {
      if (fx.type === "bg-remove") continue;
      const def = EFFECTS_BY_TYPE.get(fx.type);
      if (!def) continue;
      const prog = this.effectProgram(def);
      const params = resolveParams(def, fx.params);
      const passes = def.passes ?? 1;
      for (let pass = 0; pass < passes; pass++) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.target(b).fbo);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.useProgram(prog.prog);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.target(a).tex);
        gl.uniform1i(this.loc(prog, "uTex"), 0);
        gl.uniform2f(this.loc(prog, "uRes"), w, h);
        gl.uniform1f(this.loc(prog, "uTime"), layer.localTime);
        gl.uniform1i(this.loc(prog, "uPass"), pass);
        for (const [k, v] of Object.entries(params)) gl.uniform1f(this.loc(prog, `p_${k}`), v);
        if (def.lut) {
          const lut = this.lutTexture(fx.assetId ?? null, provider);
          gl.activeTexture(gl.TEXTURE1);
          gl.bindTexture(gl.TEXTURE_3D, lut.tex);
          gl.uniform1i(this.loc(prog, "uLut"), 1);
          gl.uniform1f(this.loc(prog, "uLutSize"), lut.size);
          gl.activeTexture(gl.TEXTURE0);
        }
        gl.bindVertexArray(this.vao);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        [a, b] = [b, a];
      }
    }
    return a;
  }

  private lutTexture(assetId: string | null, provider: SourceProvider): { tex: WebGLTexture; size: number } {
    const gl = this.gl;
    // 3D uploads from typed arrays must not flip or premultiply.
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    if (assetId) {
      const hit = this.luts.get(assetId);
      if (hit) return hit;
      const lut = provider.getLut?.(assetId);
      if (lut) {
        const tex = gl.createTexture();
        if (tex) {
          gl.bindTexture(gl.TEXTURE_3D, tex);
          gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
          gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGB8, lut.size, lut.size, lut.size, 0, gl.RGB, gl.UNSIGNED_BYTE, lut.data);
          gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
          for (const pname of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R]) gl.texParameteri(gl.TEXTURE_3D, pname, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
          const entry = { tex, size: lut.size };
          this.luts.set(assetId, entry);
          return entry;
        }
      }
    }
    if (!this.dummyLut) {
      const tex = gl.createTexture();
      if (!tex) throw new Error("Could not create texture");
      gl.bindTexture(gl.TEXTURE_3D, tex);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGB8, 1, 1, 1, 0, gl.RGB, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0]));
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      this.dummyLut = tex;
    }
    // Size 1 makes the shader pass colours through unchanged.
    return { tex: this.dummyLut, size: 1 };
  }

  private compositeOnto(accum: number, from: number, opacity: number, w: number, h: number, mode: string = "normal"): void {
    const gl = this.gl;
    const modeIndex = BLEND_MODES.indexOf(mode as (typeof BLEND_MODES)[number]);
    if (modeIndex > 0) {
      // Copy the frame so far, then blend the layer over it in a shader.
      const scratch = from === 3 ? 2 : 3;
      this.copy(accum, scratch, w, h);
      if (!this.blendProg) this.blendProg = this.compile(FULL_VS, BLEND_FS);
      const p = this.blendProg;
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.target(accum).fbo);
      gl.viewport(0, 0, w, h);
      gl.disable(gl.BLEND);
      gl.useProgram(p.prog);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.target(scratch).tex);
      gl.uniform1i(this.loc(p, "uBase"), 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.target(from).tex);
      gl.uniform1i(this.loc(p, "uTop"), 1);
      gl.uniform1f(this.loc(p, "uOpacity"), opacity);
      gl.uniform1i(this.loc(p, "uMode"), modeIndex);
      gl.bindVertexArray(this.vao);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.activeTexture(gl.TEXTURE0);
      return;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.target(accum).fbo);
    gl.viewport(0, 0, w, h);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    this.drawQuad(this.quadProg, this.target(from).tex, this.fullscreen(w, h), this.fboUv(), opacity, w, h);
    gl.disable(gl.BLEND);
  }

  /** Render a frame plan into the canvas. */
  render(plan: FramePlan, provider: SourceProvider): void {
    const gl = this.gl;
    const w = this.canvas.width;
    const h = this.canvas.height;
    this.ensureTargets(w, h);
    this.usedThisFrame.clear();
    // Target 0 accumulates the frame; 1-4 are scratch.
    const ACC = 0;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.target(ACC).fbo);
    gl.viewport(0, 0, w, h);
    const [r, g, bl] = parseColor(plan.background);
    if (this.transparent) gl.clearColor(0, 0, 0, 0);
    else gl.clearColor(r, g, bl, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    for (const layer of plan.layers) {
      if (layer.kind === "visual") {
        const out = this.renderLayer(layer, provider, w, h, [1, 2]);
        if (out !== null) this.compositeOnto(ACC, out, layer.opacity, w, h, layer.blendMode);
        continue;
      }
      // Transition: render both sides, then mix.
      const fromOut = this.renderLayer(layer.from, provider, w, h, [1, 2]);
      const fromIdx = fromOut ?? 1;
      if (fromOut === null) this.clearTarget(1, w, h);
      // Keep the "from" result safe in target 3.
      this.copy(fromIdx, 3, w, h);
      const toOut = this.renderLayer(layer.to, provider, w, h, [1, 2]);
      const toIdx = toOut ?? 1;
      if (toOut === null) this.clearTarget(1, w, h);
      const prog = this.transitionProgram(layer.type);
      if (!prog) continue;
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.target(4).fbo);
      gl.viewport(0, 0, w, h);
      gl.disable(gl.BLEND);
      gl.useProgram(prog.prog);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.target(3).tex);
      gl.uniform1i(this.loc(prog, "uFrom"), 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.target(toIdx).tex);
      gl.uniform1i(this.loc(prog, "uTo"), 1);
      gl.uniform2f(this.loc(prog, "uRes"), w, h);
      gl.uniform1f(this.loc(prog, "uTime"), layer.to.localTime);
      gl.uniform1f(this.loc(prog, "progress"), layer.progress);
      gl.bindVertexArray(this.vao);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.activeTexture(gl.TEXTURE0);
      const opacity = layer.from.opacity * (1 - layer.progress) + layer.to.opacity * layer.progress;
      this.compositeOnto(ACC, 4, opacity, w, h, layer.to.blendMode);
    }

    // Present.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, w, h);
    gl.disable(gl.BLEND);
    this.drawQuad(this.quadProg, this.target(ACC).tex, this.fullscreen(w, h), this.fboUv(), 1, w, h);
    this.evictUnused();
  }

  private clearTarget(i: number, w: number, h: number): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.target(i).fbo);
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  private copy(from: number, to: number, w: number, h: number): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.target(to).fbo);
    gl.viewport(0, 0, w, h);
    gl.disable(gl.BLEND);
    this.drawQuad(this.quadProg, this.target(from).tex, this.fullscreen(w, h), this.fboUv(), 1, w, h);
  }

  /** Free textures for clips that left the screen, so memory stays flat. */
  private evictUnused(): void {
    if (this.textures.size < 24) return;
    for (const [key, t] of this.textures) {
      if (!this.usedThisFrame.has(key)) {
        this.gl.deleteTexture(t.tex);
        this.textures.delete(key);
      }
    }
  }

  /** Last WebGL error code (0 = none). For diagnostics. */
  glError(): number {
    return this.gl.getError();
  }

  /** Read back the current frame as RGBA (top row first). For tests. */
  readPixels(): Uint8Array {
    const gl = this.gl;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const out = new Uint8Array(w * h * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.target(0).fbo);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, out);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    // Flip rows: the FBO is stored bottom-up.
    const row = w * 4;
    const flipped = new Uint8Array(out.length);
    for (let y = 0; y < h; y++) flipped.set(out.subarray((h - 1 - y) * row, (h - y) * row), y * row);
    return flipped;
  }

  dispose(): void {
    const gl = this.gl;
    for (const t of this.textures.values()) gl.deleteTexture(t.tex);
    for (const t of this.targets) {
      gl.deleteFramebuffer(t.fbo);
      gl.deleteTexture(t.tex);
    }
    for (const p of [...this.effectProgs.values(), ...this.transitionProgs.values(), this.quadProg]) gl.deleteProgram(p.prog);
    if (this.blendProg) gl.deleteProgram(this.blendProg.prog);
    if (this.maskProg) gl.deleteProgram(this.maskProg.prog);
    for (const l of this.luts.values()) gl.deleteTexture(l.tex);
    if (this.dummyLut) gl.deleteTexture(this.dummyLut);
    this.luts.clear();
    this.textures.clear();
    this.targets = [];
    this.effectProgs.clear();
    this.transitionProgs.clear();
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  }
}
