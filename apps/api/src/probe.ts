/** Small header probes so the connector can tell Claude how long clips are. */
import { createFile, MP4BoxBuffer, type Movie } from "mp4box";

export interface Probe {
  kind: "video" | "image" | "audio" | null;
  durationSec: number | null;
  width: number | null;
  height: number | null;
}

export function sniffKind(bytes: Uint8Array, contentType = "", name = ""): Probe["kind"] {
  const ct = contentType.toLowerCase();
  if (ct.startsWith("video/")) return "video";
  if (ct.startsWith("image/")) return "image";
  if (ct.startsWith("audio/")) return "audio";
  const ascii = (o: number, n: number) => String.fromCharCode(...bytes.subarray(o, o + n));
  if (ascii(4, 4) === "ftyp") return /m4a|mp4a/i.test(ascii(8, 4)) ? "audio" : "video";
  if (bytes[0] === 0x89 && ascii(1, 3) === "PNG") return "image";
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image";
  if (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") return "image";
  if (ascii(0, 3) === "ID3" || (bytes[0] === 0xff && ((bytes[1] ?? 0) & 0xe0) === 0xe0)) return "audio";
  if (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WAVE") return "audio";
  if (ascii(0, 4) === "OggS") return "audio";
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return "video";
  if (/\.(mp4|mov|m4v|webm)$/i.test(name)) return "video";
  if (/\.(png|jpe?g|webp|gif)$/i.test(name)) return "image";
  if (/\.(mp3|m4a|wav|ogg|aac|flac)$/i.test(name)) return "audio";
  return null;
}

function mp4Info(bytes: Uint8Array): Promise<Movie | null> {
  return new Promise((resolve) => {
    const f = createFile();
    let done = false;
    f.onReady = (info: Movie) => {
      done = true;
      resolve(info);
    };
    f.onError = () => resolve(null);
    const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    f.appendBuffer(MP4BoxBuffer.fromArrayBuffer(ab, 0), true);
    f.flush();
    if (!done) resolve(null);
  });
}

function imageSize(b: Uint8Array): [number, number] | null {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (b[0] === 0x89 && b[1] === 0x50) return [dv.getUint32(16), dv.getUint32(20)];
  if (b[0] === 0xff && b[1] === 0xd8) {
    let p = 2;
    while (p + 9 < b.length) {
      if (b[p] !== 0xff) return null;
      const m = b[p + 1]!;
      const len = dv.getUint16(p + 2);
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return [dv.getUint16(p + 7), dv.getUint16(p + 5)];
      p += 2 + len;
    }
  }
  return null;
}

export async function probe(bytes: Uint8Array, contentType = "", name = ""): Promise<Probe> {
  const kind = sniffKind(bytes, contentType, name);
  const out: Probe = { kind, durationSec: null, width: null, height: null };
  if (kind === "image") {
    const s = imageSize(bytes);
    if (s) [out.width, out.height] = s;
    out.durationSec = 0;
  } else if (kind === "video" || (kind === "audio" && String.fromCharCode(...bytes.subarray(4, 8)) === "ftyp")) {
    const info = await mp4Info(bytes).catch(() => null);
    if (info) {
      out.durationSec = info.timescale ? Math.round((info.duration / info.timescale) * 1000) / 1000 : null;
      const v = info.videoTracks?.[0];
      if (v) {
        out.width = v.video?.width ?? v.track_width ?? null;
        out.height = v.video?.height ?? v.track_height ?? null;
      }
    }
  }
  return out;
}

/**
 * Probe a big stored MP4/MOV without loading it: read 1 MB pieces where the
 * parser asks for them. mp4box skips the media data box, so only the start
 * and the "moov" index are read (phone videos often keep it at the end).
 */
export async function probeStored(read: (start: number, end: number) => Promise<Uint8Array>, size: number, head: Uint8Array, contentType = "", name = ""): Promise<Probe> {
  const kind = sniffKind(head, contentType, name);
  const out: Probe = { kind, durationSec: null, width: null, height: null };
  if (kind !== "video" && !(kind === "audio" && String.fromCharCode(...head.subarray(4, 8)) === "ftyp")) return out;
  const info = await new Promise<Movie | null>((resolve) => {
    const f = createFile();
    let result: Movie | null = null;
    f.onReady = (i: Movie) => {
      result = i;
    };
    f.onError = () => undefined;
    void (async () => {
      let pos = 0;
      const chunk = 1024 * 1024;
      for (let guard = 0; !result && pos < size && guard < 400; guard++) {
        const bytes = await read(pos, Math.min(size, pos + chunk));
        if (!bytes.length) break;
        const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
        const next = f.appendBuffer(MP4BoxBuffer.fromArrayBuffer(ab, pos), pos + bytes.length >= size);
        pos = typeof next === "number" && next > pos ? next : pos + bytes.length;
      }
      if (!result) f.flush();
      resolve(result);
    })().catch(() => resolve(null));
  });
  if (info) {
    out.durationSec = info.timescale ? Math.round((info.duration / info.timescale) * 1000) / 1000 : null;
    const v = info.videoTracks?.[0];
    if (v) {
      out.width = v.video?.width ?? v.track_width ?? null;
      out.height = v.video?.height ?? v.track_height ?? null;
    }
  }
  return out;
}
