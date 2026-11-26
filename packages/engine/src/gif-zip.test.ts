import { describe, expect, it } from "vitest";
import { GifEncoder, ZipWriter, crc32, quantizeFrame } from "./index";

/** Minimal GIF LZW decoder for the test (first image only). */
function decodeFirstFrame(gif: Uint8Array): number[] {
  let p = 13 + 768;
  // Skip extensions.
  while (gif[p] === 0x21) {
    p += 2;
    while (gif[p] !== 0) p += gif[p]! + 1;
    p++;
  }
  expect(gif[p]).toBe(0x2c);
  p += 10;
  const minCode = gif[p++]!;
  const data: number[] = [];
  while (gif[p] !== 0) {
    const n = gif[p++]!;
    for (let i = 0; i < n; i++) data.push(gif[p++]!);
  }
  const clear = 1 << minCode;
  const eoi = clear + 1;
  let size = minCode + 1;
  let dict: number[][] = [];
  const reset = () => {
    dict = [];
    for (let i = 0; i < clear; i++) dict[i] = [i];
    dict[clear] = [];
    dict[eoi] = [];
    size = minCode + 1;
  };
  reset();
  const out: number[] = [];
  let bitPos = 0;
  const read = () => {
    let v = 0;
    for (let i = 0; i < size; i++) {
      const bit = (data[(bitPos + i) >> 3]! >> ((bitPos + i) & 7)) & 1;
      v |= bit << i;
    }
    bitPos += size;
    return v;
  };
  let prev: number[] | null = null;
  for (;;) {
    const code = read();
    if (code === clear) {
      reset();
      prev = null;
      continue;
    }
    if (code === eoi) break;
    let entry: number[];
    if (dict[code]) entry = dict[code]!;
    else if (prev) entry = [...prev, prev[0]!];
    else throw new Error("bad code");
    out.push(...entry);
    if (prev) {
      dict.push([...prev, entry[0]!]);
      if (dict.length === 1 << size && size < 12) size++;
    }
    prev = entry;
  }
  return out;
}

describe("GIF encoder", () => {
  it("writes a valid GIF whose pixels decode back", () => {
    const w = 37;
    const h = 23;
    const rgba = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      rgba[i * 4] = (i * 7) % 256;
      rgba[i * 4 + 1] = (i * 13) % 256;
      rgba[i * 4 + 2] = (i * 3) % 256;
      rgba[i * 4 + 3] = 255;
    }
    const enc = new GifEncoder(w, h);
    enc.addFrame(rgba, 100);
    enc.addFrame(rgba, 100);
    const gif = enc.finish();
    expect(new TextDecoder().decode(gif.slice(0, 6))).toBe("GIF89a");
    expect(gif[gif.length - 1]).toBe(0x3b);
    expect(decodeFirstFrame(gif)).toEqual(Array.from(quantizeFrame(rgba, w, h)));
  });

  it("survives dictionary resets on large noisy frames", () => {
    const w = 200;
    const h = 200;
    let seed = 7;
    const rgba = new Uint8Array(w * h * 4).map(() => ((seed = (seed * 16807) % 2147483647) % 256));
    const enc = new GifEncoder(w, h);
    enc.addFrame(rgba, 50);
    expect(decodeFirstFrame(enc.finish())).toEqual(Array.from(quantizeFrame(rgba, w, h)));
  });
});

describe("ZIP writer", () => {
  it("computes standard CRC-32", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });

  it("writes local headers and a central directory", async () => {
    const z = new ZipWriter();
    z.add("a.txt", new TextEncoder().encode("hello"));
    z.add("b.txt", new TextEncoder().encode("world!"));
    const bytes = new Uint8Array(await z.finish().arrayBuffer());
    const view = new DataView(bytes.buffer);
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    const end = bytes.length - 22;
    expect(view.getUint32(end, true)).toBe(0x06054b50);
    expect(view.getUint16(end + 10, true)).toBe(2);
  });
});
