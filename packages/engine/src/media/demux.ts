import { createFile, DataStream, Endianness, MP4BoxBuffer, type Movie, type Track } from "mp4box";

/** One encoded sample, with times in microseconds (presentation order). */
export interface SampleInfo {
  index: number;
  ptsUs: number;
  durationUs: number;
  isSync: boolean;
  offset: number;
  size: number;
}

export interface DemuxedVideoTrack {
  codec: string;
  codedWidth: number;
  codedHeight: number;
  description?: Uint8Array;
  /** Clockwise rotation the player must apply (0/90/180/270). */
  rotation: number;
  /** Samples in decode order. */
  samples: SampleInfo[];
  durationUs: number;
  fps: number;
}

export interface DemuxedAudioTrack {
  codec: string;
  sampleRate: number;
  channels: number;
  description?: Uint8Array;
  samples: SampleInfo[];
  durationUs: number;
}

// Minimal structural types for the boxes we read; mp4box's own types are very wide.
interface WritableBox {
  write(stream: DataStream): void;
}
interface DescNode {
  tag?: number;
  data?: Uint8Array;
  descs?: DescNode[];
}
interface SampleEntryLike {
  avcC?: WritableBox;
  hvcC?: WritableBox;
  vpcC?: WritableBox;
  av1C?: WritableBox;
  esds?: { esd?: DescNode };
}
interface TrakLike {
  mdia?: { minf?: { stbl?: { stsd?: { entries?: SampleEntryLike[] } } } };
  edts?: { elst?: { entries?: { media_time: number }[] } };
}

function boxPayload(box: WritableBox): Uint8Array {
  const stream = new DataStream(undefined, 0, Endianness.BIG_ENDIAN);
  box.write(stream);
  // Skip the 8-byte box header (size + type).
  return new Uint8Array(stream.buffer, 8);
}

function findDesc(node: DescNode | undefined, tag: number): DescNode | undefined {
  if (!node) return undefined;
  if (node.tag === tag) return node;
  for (const d of node.descs ?? []) {
    const f = findDesc(d, tag);
    if (f) return f;
  }
  return undefined;
}

/** Clockwise rotation from a track's display matrix. */
export function rotationFromMatrix(m: ArrayLike<number> | undefined): number {
  if (!m || m.length < 2) return 0;
  const a = m[0] ?? 65536;
  const b = m[1] ?? 0;
  const deg = Math.round((Math.atan2(b, a) * 180) / Math.PI);
  return (((Math.round(deg / 90) * 90) % 360) + 360) % 360;
}

function samplesFor(
  file: ReturnType<typeof createFile>,
  track: Track,
  mediaTimeOffset: number,
): SampleInfo[] {
  const raw = file.getTrackSamplesInfo(track.id);
  const ts = track.timescale;
  return raw.map((s, index) => ({
    index,
    ptsUs: Math.round(((s.cts - mediaTimeOffset) * 1e6) / ts),
    durationUs: Math.round((s.duration * 1e6) / ts),
    isSync: s.is_sync,
    offset: s.offset,
    size: s.size,
  }));
}

function editOffset(trak: TrakLike, fallback: number): number {
  const entries = trak.edts?.elst?.entries ?? [];
  const first = entries.find((e) => e.media_time >= 0);
  return first ? first.media_time : fallback;
}

/** Reads sample bytes from a Blob with a small read-ahead window. */
export class BlobReader {
  private winStart = 0;
  private win: Uint8Array = new Uint8Array(0);
  constructor(private blob: Blob, private windowSize = 4 * 1024 * 1024) {}

  async read(offset: number, size: number): Promise<Uint8Array> {
    if (offset >= this.winStart && offset + size <= this.winStart + this.win.length) {
      return this.win.subarray(offset - this.winStart, offset - this.winStart + size);
    }
    const len = Math.max(size, this.windowSize);
    const buf = await this.blob.slice(offset, Math.min(this.blob.size, offset + len)).arrayBuffer();
    this.winStart = offset;
    this.win = new Uint8Array(buf);
    return this.win.subarray(0, size);
  }
}

/** MP4/MOV demuxer that reads only the boxes it needs from a Blob. */
export class Mp4Demuxer {
  video?: DemuxedVideoTrack;
  audio?: DemuxedAudioTrack;
  private videoReader: BlobReader;
  private audioReader: BlobReader;

  private constructor(readonly blob: Blob) {
    this.videoReader = new BlobReader(blob);
    this.audioReader = new BlobReader(blob, 512 * 1024);
  }

  static async open(blob: Blob): Promise<Mp4Demuxer> {
    const d = new Mp4Demuxer(blob);
    await d.parse();
    return d;
  }

  private async parse(): Promise<void> {
    const file = createFile();
    let info: Movie | undefined;
    let error: string | undefined;
    file.onReady = (i: Movie) => {
      info = i;
    };
    file.onError = (_m: string, msg: string) => {
      error = msg;
    };
    let pos = 0;
    const chunk = 1024 * 1024;
    let guard = 0;
    while (!info && !error && pos < this.blob.size && guard++ < 100000) {
      const ab = await this.blob.slice(pos, pos + chunk).arrayBuffer();
      const next = file.appendBuffer(MP4BoxBuffer.fromArrayBuffer(ab, pos), pos + ab.byteLength >= this.blob.size);
      pos = typeof next === "number" && next > pos ? next : pos + ab.byteLength;
    }
    if (!info) {
      file.flush();
    }
    if (!info) throw new Error(error ?? "Not a readable MP4/MOV file");

    const vt = info.videoTracks[0];
    if (vt) {
      const trak = file.getTrackById(vt.id) as unknown as TrakLike;
      const entry = trak.mdia?.minf?.stbl?.stsd?.entries?.[0];
      const descBox = entry?.avcC ?? entry?.hvcC ?? entry?.vpcC ?? entry?.av1C;
      const raw = file.getTrackSamplesInfo(vt.id);
      const minCts = raw.reduce((m, s) => Math.min(m, s.cts), Number.POSITIVE_INFINITY);
      const samples = samplesFor(file, vt, editOffset(trak, Number.isFinite(minCts) ? minCts : 0));
      const durationUs = Math.round((vt.samples_duration * 1e6) / vt.timescale) || Math.round((vt.duration * 1e6) / vt.timescale);
      this.video = {
        codec: vt.codec,
        codedWidth: vt.video?.width ?? vt.track_width,
        codedHeight: vt.video?.height ?? vt.track_height,
        description: descBox ? boxPayload(descBox) : undefined,
        rotation: rotationFromMatrix(vt.matrix),
        samples,
        durationUs,
        fps: durationUs > 0 ? Math.round((samples.length * 1e6 * 100) / durationUs) / 100 : 30,
      };
    }
    const at = info.audioTracks[0];
    if (at) {
      const trak = file.getTrackById(at.id) as unknown as TrakLike;
      const entry = trak.mdia?.minf?.stbl?.stsd?.entries?.[0];
      const dsi = findDesc(entry?.esds?.esd, 5);
      const samples = samplesFor(file, at, editOffset(trak, 0));
      this.audio = {
        codec: at.codec,
        sampleRate: at.audio?.sample_rate ?? 48000,
        channels: at.audio?.channel_count ?? 2,
        description: dsi?.data ? new Uint8Array(dsi.data) : undefined,
        samples,
        durationUs: Math.round((at.samples_duration * 1e6) / at.timescale),
      };
    }
  }

  readVideoSample(s: SampleInfo): Promise<Uint8Array> {
    return this.videoReader.read(s.offset, s.size);
  }

  readAudioSample(s: SampleInfo): Promise<Uint8Array> {
    return this.audioReader.read(s.offset, s.size);
  }
}

/** True for containers mp4box can read. */
export function isMp4Like(mimeType: string, name: string): boolean {
  return /mp4|quicktime|m4a|m4v|3gpp/i.test(mimeType) || /\.(mp4|m4v|mov|m4a|3gp)$/i.test(name);
}
