import { DSP_WASM_BASE64 } from "./dsp-wasm";

/** Typed wrapper around the Rust DSP module (packages/dsp). */
export interface DspModule {
  denoise(x: Float32Array, noise: Float32Array | null, strength: number): Float32Array;
  hpss(x: Float32Array): { harmonic: Float32Array; percussive: Float32Array };
  timeStretch(x: Float32Array, ratio: number): Float32Array;
  pitchShift(x: Float32Array, semitones: number): Float32Array;
}

interface Exports {
  memory: WebAssembly.Memory;
  js_alloc(len: number): number;
  js_free(ptr: number, len: number): void;
  dsp_denoise(x: number, len: number, noise: number, noiseLen: number, strength: number, out: number): void;
  dsp_hpss(x: number, len: number, harm: number, perc: number): void;
  dsp_time_stretch_len(len: number, ratio: number): number;
  dsp_time_stretch(x: number, len: number, ratio: number, out: number): void;
  dsp_pitch_shift(x: number, len: number, semitones: number, out: number): void;
}

function decodeBase64(b64: string): Uint8Array<ArrayBuffer> {
  if (typeof atob === "function") {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  const B = (globalThis as unknown as { Buffer: { from(s: string, enc: string): Uint8Array } }).Buffer;
  return new Uint8Array(B.from(b64, "base64"));
}

let loading: Promise<DspModule> | null = null;

/** Compile and instantiate the DSP module once (async: works on the main thread). */
export function loadDsp(): Promise<DspModule> {
  if (!loading) {
    loading = WebAssembly.instantiate(decodeBase64(DSP_WASM_BASE64), {}).then(({ instance }) => wrap(instance.exports as unknown as Exports));
  }
  return loading;
}

function wrap(e: Exports): DspModule {
  const put = (x: Float32Array) => {
    const p = e.js_alloc(x.length);
    new Float32Array(e.memory.buffer, p, x.length).set(x);
    return p;
  };
  const take = (p: number, len: number) => {
    const out = new Float32Array(len);
    out.set(new Float32Array(e.memory.buffer, p, len));
    e.js_free(p, len);
    return out;
  };
  return {
    denoise(x, noise, strength) {
      const px = put(x);
      const pn = noise && noise.length ? put(noise) : 0;
      const po = e.js_alloc(x.length);
      e.dsp_denoise(px, x.length, pn, noise?.length ?? 0, strength, po);
      e.js_free(px, x.length);
      if (pn) e.js_free(pn, noise!.length);
      return take(po, x.length);
    },
    hpss(x) {
      const px = put(x);
      const ph = e.js_alloc(x.length);
      const pp = e.js_alloc(x.length);
      e.dsp_hpss(px, x.length, ph, pp);
      e.js_free(px, x.length);
      return { harmonic: take(ph, x.length), percussive: take(pp, x.length) };
    },
    timeStretch(x, ratio) {
      const len = e.dsp_time_stretch_len(x.length, ratio);
      const px = put(x);
      const po = e.js_alloc(len);
      e.dsp_time_stretch(px, x.length, ratio, po);
      e.js_free(px, x.length);
      return take(po, len);
    },
    pitchShift(x, semitones) {
      const px = put(x);
      const po = e.js_alloc(x.length);
      e.dsp_pitch_shift(px, x.length, semitones, po);
      e.js_free(px, x.length);
      return take(po, x.length);
    },
  };
}
