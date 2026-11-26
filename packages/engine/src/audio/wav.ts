/** 16-bit or 32-bit float PCM WAV writer and a small reader (for tests and caching). */
export function encodeWav(channels: readonly Float32Array[], sampleRate: number, bits: 16 | 32 = 16): Uint8Array<ArrayBuffer> {
  const nCh = channels.length;
  const len = channels[0]?.length ?? 0;
  const bytes = bits / 8;
  const dataSize = len * nCh * bytes;
  const buf = new ArrayBuffer(44 + dataSize);
  const v = new DataView(buf);
  const str = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  str(0, "RIFF");
  v.setUint32(4, 36 + dataSize, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, bits === 32 ? 3 : 1, true);
  v.setUint16(22, nCh, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * nCh * bytes, true);
  v.setUint16(32, nCh * bytes, true);
  v.setUint16(34, bits, true);
  str(36, "data");
  v.setUint32(40, dataSize, true);
  let o = 44;
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < nCh; c++) {
      const s = Math.max(-1, Math.min(1, channels[c]![i]!));
      if (bits === 32) v.setFloat32(o, s, true);
      else v.setInt16(o, Math.round(s < 0 ? s * 0x8000 : s * 0x7fff), true);
      o += bytes;
    }
  }
  return new Uint8Array(buf);
}

export function decodeWav(data: Uint8Array): { sampleRate: number; channels: Float32Array[] } {
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let p = 12;
  let fmt = { format: 1, ch: 1, sr: 44100, bits: 16 };
  while (p + 8 <= data.length) {
    const id = String.fromCharCode(data[p]!, data[p + 1]!, data[p + 2]!, data[p + 3]!);
    const size = v.getUint32(p + 4, true);
    if (id === "fmt ") fmt = { format: v.getUint16(p + 8, true), ch: v.getUint16(p + 10, true), sr: v.getUint32(p + 12, true), bits: v.getUint16(p + 22, true) };
    if (id === "data") {
      const bytes = fmt.bits / 8;
      const frames = Math.floor(size / (bytes * fmt.ch));
      const channels = Array.from({ length: fmt.ch }, () => new Float32Array(frames));
      let o = p + 8;
      for (let i = 0; i < frames; i++)
        for (let c = 0; c < fmt.ch; c++) {
          channels[c]![i] = fmt.format === 3 ? v.getFloat32(o, true) : v.getInt16(o, true) / 0x8000;
          o += bytes;
        }
      return { sampleRate: fmt.sr, channels };
    }
    p += 8 + size + (size % 2);
  }
  throw new Error("No data chunk in WAV");
}
