/** Minimal ZIP writer (stored, no compression) for PNG sequences. */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]!) & 255]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

interface Entry {
  name: Uint8Array<ArrayBuffer>;
  crc: number;
  size: number;
  offset: number;
}

export class ZipWriter {
  private parts: BlobPart[] = [];
  private entries: Entry[] = [];
  private offset = 0;

  add(name: string, data: Uint8Array<ArrayBuffer>): void {
    const nameBytes = new TextEncoder().encode(name);
    const crc = crc32(data);
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true);
    h.setUint16(4, 20, true);
    h.setUint16(6, 0x0800, true); // UTF-8 names
    h.setUint16(8, 0, true); // stored
    h.setUint32(14, crc, true);
    h.setUint32(18, data.length, true);
    h.setUint32(22, data.length, true);
    h.setUint16(26, nameBytes.length, true);
    this.parts.push(h.buffer, nameBytes, data);
    this.entries.push({ name: nameBytes, crc, size: data.length, offset: this.offset });
    this.offset += 30 + nameBytes.length + data.length;
  }

  finish(): Blob {
    const start = this.offset;
    let size = 0;
    for (const e of this.entries) {
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true);
      c.setUint16(4, 20, true);
      c.setUint16(6, 20, true);
      c.setUint16(8, 0x0800, true);
      c.setUint32(16, e.crc, true);
      c.setUint32(20, e.size, true);
      c.setUint32(24, e.size, true);
      c.setUint16(28, e.name.length, true);
      c.setUint32(42, e.offset, true);
      this.parts.push(c.buffer, e.name as Uint8Array<ArrayBuffer>);
      size += 46 + e.name.length;
    }
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, this.entries.length, true);
    end.setUint16(10, this.entries.length, true);
    end.setUint32(12, size, true);
    end.setUint32(16, start, true);
    this.parts.push(end.buffer);
    return new Blob(this.parts, { type: "application/zip" });
  }
}

/** Read a ZIP written with stored (uncompressed) entries, like ZipWriter's. */
export function readZip(data: Uint8Array): Map<string, Uint8Array> {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  // End of central directory: search backwards for its signature.
  let eocd = -1;
  for (let i = data.length - 22; i >= Math.max(0, data.length - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("Not a ZIP file");
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const out = new Map<string, Uint8Array>();
  const dec = new TextDecoder();
  for (let k = 0; k < count; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error("Broken ZIP directory");
    const method = dv.getUint16(p + 10, true);
    const size = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = dec.decode(data.subarray(p + 46, p + 46 + nameLen));
    if (method !== 0) throw new Error(`Compressed ZIP entries are not supported (${name})`);
    const lNameLen = dv.getUint16(local + 26, true);
    const lExtra = dv.getUint16(local + 28, true);
    const start = local + 30 + lNameLen + lExtra;
    const body = data.subarray(start, start + size);
    if (crc32(body) !== dv.getUint32(p + 16, true)) throw new Error(`ZIP entry is damaged (${name})`);
    out.set(name, body);
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}
