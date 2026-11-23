/**
 * Small animated GIF encoder: fixed 252-colour palette (6×7×6 RGB cube) with
 * ordered dithering, and the standard GIF LZW. Written for this project.
 */

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

export function gifPalette(): Uint8Array {
  const pal = new Uint8Array(256 * 3);
  let i = 0;
  for (let r = 0; r < 6; r++)
    for (let g = 0; g < 7; g++)
      for (let b = 0; b < 6; b++) {
        pal[i * 3] = Math.round((r * 255) / 5);
        pal[i * 3 + 1] = Math.round((g * 255) / 6);
        pal[i * 3 + 2] = Math.round((b * 255) / 5);
        i++;
      }
  return pal;
}

/** Map RGBA pixels to palette indices with 4×4 ordered dithering. */
export function quantizeFrame(rgba: Uint8Array | Uint8ClampedArray, width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const d = (BAYER4[(y & 3) * 4 + (x & 3)]! / 16 - 0.5) * 0.9;
      const r = Math.min(5, Math.max(0, Math.round((rgba[i * 4]! / 255) * 5 + d)));
      const g = Math.min(6, Math.max(0, Math.round((rgba[i * 4 + 1]! / 255) * 6 + d)));
      const b = Math.min(5, Math.max(0, Math.round((rgba[i * 4 + 2]! / 255) * 5 + d)));
      out[i] = r * 42 + g * 6 + b;
    }
  }
  return out;
}

class ByteWriter {
  private buf = new Uint8Array(1 << 16);
  length = 0;
  byte(v: number): void {
    if (this.length >= this.buf.length) {
      const n = new Uint8Array(this.buf.length * 2);
      n.set(this.buf);
      this.buf = n;
    }
    this.buf[this.length++] = v & 255;
  }
  u16(v: number): void {
    this.byte(v);
    this.byte(v >> 8);
  }
  bytes(a: ArrayLike<number>): void {
    for (let i = 0; i < a.length; i++) this.byte(a[i]!);
  }
  str(s: string): void {
    for (let i = 0; i < s.length; i++) this.byte(s.charCodeAt(i));
  }
  result(): Uint8Array {
    return this.buf.slice(0, this.length);
  }
}

/** GIF LZW compression of 8-bit indices, written as data sub-blocks. */
export function lzwEncode(indices: Uint8Array, w: ByteWriter, minCodeSize = 8): void {
  const clear = 1 << minCodeSize;
  const eoi = clear + 1;
  let codeSize = minCodeSize + 1;
  let next = eoi + 1;
  const dict = new Map<number, number>();
  let block: number[] = [];
  let acc = 0;
  let bits = 0;
  const flushBlock = () => {
    if (!block.length) return;
    w.byte(block.length);
    w.bytes(block);
    block = [];
  };
  const emit = (code: number) => {
    acc |= code << bits;
    bits += codeSize;
    while (bits >= 8) {
      block.push(acc & 255);
      if (block.length === 255) flushBlock();
      acc >>>= 8;
      bits -= 8;
    }
  };
  w.byte(minCodeSize);
  emit(clear);
  let prefix = indices.length ? indices[0]! : 0;
  for (let i = 1; i < indices.length; i++) {
    const c = indices[i]!;
    const key = (prefix << 8) | c;
    const hit = dict.get(key);
    if (hit !== undefined) {
      prefix = hit;
      continue;
    }
    emit(prefix);
    if (next < 4096) {
      dict.set(key, next++);
      if (next > 1 << codeSize && codeSize < 12) codeSize++;
    } else {
      emit(clear);
      dict.clear();
      codeSize = minCodeSize + 1;
      next = eoi + 1;
    }
    prefix = c;
  }
  if (indices.length) emit(prefix);
  emit(eoi);
  if (bits > 0) block.push(acc & 255);
  flushBlock();
  w.byte(0);
}

export class GifEncoder {
  private w = new ByteWriter();
  constructor(private width: number, private height: number, loop = true) {
    const w = this.w;
    w.str("GIF89a");
    w.u16(width);
    w.u16(height);
    w.byte(0xf7); // global colour table, 8 bits, 256 entries
    w.byte(0);
    w.byte(0);
    w.bytes(gifPalette());
    if (loop) {
      w.bytes([0x21, 0xff, 0x0b]);
      w.str("NETSCAPE2.0");
      w.bytes([0x03, 0x01, 0x00, 0x00, 0x00]);
    }
  }

  /** Add a frame of RGBA pixels shown for `delayMs`. */
  addFrame(rgba: Uint8Array | Uint8ClampedArray, delayMs: number): void {
    const w = this.w;
    w.bytes([0x21, 0xf9, 0x04, 0x04]);
    w.u16(Math.max(2, Math.round(delayMs / 10)));
    w.bytes([0x00, 0x00]);
    w.byte(0x2c);
    w.u16(0);
    w.u16(0);
    w.u16(this.width);
    w.u16(this.height);
    w.byte(0);
    lzwEncode(quantizeFrame(rgba, this.width, this.height), w);
  }

  finish(): Uint8Array {
    this.w.byte(0x3b);
    return this.w.result();
  }
}
