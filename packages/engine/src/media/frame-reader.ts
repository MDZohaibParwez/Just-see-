import { BlobReader, type DemuxedVideoTrack, type Mp4Demuxer, type SampleInfo } from "./demux";

/**
 * Frame-accurate video frame access with WebCodecs. Optimised for forward
 * access (export walks the timeline in order); a backwards or long jump
 * restarts decoding from the nearest keyframe.
 */
export class VideoFrameReader {
  private decoder: VideoDecoder | null = null;
  private track: DemuxedVideoTrack;
  private reader: BlobReader;
  private nextFeed = 0;
  private frames: VideoFrame[] = [];
  private waiters: (() => void)[] = [];
  private error: Error | null = null;
  private flushed = false;
  private config: VideoDecoderConfig;
  /** Samples sorted by presentation time, for lookups. */
  private byPts: SampleInfo[];

  constructor(private demuxer: Mp4Demuxer) {
    const track = demuxer.video;
    if (!track) throw new Error("File has no video track");
    this.track = track;
    this.reader = new BlobReader(demuxer.blob);
    this.byPts = [...track.samples].sort((a, b) => a.ptsUs - b.ptsUs);
    this.config = {
      codec: track.codec,
      codedWidth: track.codedWidth,
      codedHeight: track.codedHeight,
      description: track.description,
      optimizeForLatency: false,
    };
  }

  get rotation(): number {
    return this.track.rotation;
  }

  static async isSupported(demuxer: Mp4Demuxer): Promise<boolean> {
    const t = demuxer.video;
    if (!t || typeof VideoDecoder === "undefined") return false;
    try {
      const r = await VideoDecoder.isConfigSupported({
        codec: t.codec,
        codedWidth: t.codedWidth,
        codedHeight: t.codedHeight,
        description: t.description,
      });
      return r.supported === true;
    } catch {
      return false;
    }
  }

  private notify(): void {
    const w = this.waiters;
    this.waiters = [];
    for (const f of w) f();
  }

  private wait(): Promise<void> {
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  private createDecoder(): VideoDecoder {
    const d = new VideoDecoder({
      output: (frame) => {
        this.frames.push(frame);
        this.notify();
      },
      error: (e) => {
        this.error = e instanceof Error ? e : new Error(String(e));
        this.notify();
      },
    });
    d.ondequeue = () => this.notify();
    d.configure(this.config);
    return d;
  }

  private reset(fromDecodeIndex: number): void {
    for (const f of this.frames) f.close();
    this.frames = [];
    if (this.decoder && this.decoder.state !== "closed") this.decoder.close();
    this.decoder = this.createDecoder();
    this.nextFeed = fromDecodeIndex;
    this.flushed = false;
    this.error = null;
  }

  /** Decode-order index of the keyframe to start from for time `us`. */
  private keyframeFor(us: number): number {
    const samples = this.track.samples;
    let key = 0;
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i];
      if (!s) continue;
      if (s.isSync && s.ptsUs <= us) key = i;
      if (s.ptsUs > us && s.isSync) break;
    }
    return key;
  }

  /** Presentation time of the frame that should be visible at `us`. */
  private targetPts(us: number): number {
    const arr = this.byPts;
    let lo = 0;
    let hi = arr.length - 1;
    let best = arr[0]?.ptsUs ?? 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const s = arr[mid];
      if (!s) break;
      if (s.ptsUs <= us) {
        best = s.ptsUs;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return best;
  }

  private bestFrame(target: number): VideoFrame | undefined {
    let best: VideoFrame | undefined;
    for (const f of this.frames) if (f.timestamp <= target + 500 && (!best || f.timestamp > best.timestamp)) best = f;
    return best;
  }

  /**
   * Frame shown at source time `us`. The returned frame stays valid until the
   * next call or close(); callers must not close it.
   */
  async frameAt(us: number): Promise<VideoFrame | null> {
    const target = this.targetPts(us);
    const key = this.keyframeFor(target);
    const earliest = this.frames.reduce((m, f) => Math.min(m, f.timestamp), Number.POSITIVE_INFINITY);
    const needReset =
      !this.decoder ||
      this.decoder.state === "closed" ||
      this.error !== null ||
      // Jumped backwards past what we hold.
      (this.frames.length > 0 && target + 500 < earliest) ||
      // A keyframe lies between what we fed and the target: restart there.
      key > this.nextFeed;
    if (needReset) this.reset(key);

    const samples = this.track.samples;
    for (;;) {
      if (this.error) throw this.error;
      const done = this.frames.some((f) => f.timestamp > target + 500);
      if (done || (this.flushed && this.decoder?.decodeQueueSize === 0)) break;
      if (this.nextFeed < samples.length) {
        const d = this.decoder;
        if (!d) break;
        // Keep the decoder fed but bounded.
        if (d.decodeQueueSize > 8) {
          await this.wait();
          continue;
        }
        const s = samples[this.nextFeed];
        this.nextFeed++;
        if (!s) continue;
        const data = await this.reader.read(s.offset, s.size);
        d.decode(new EncodedVideoChunk({ type: s.isSync ? "key" : "delta", timestamp: s.ptsUs, duration: s.durationUs, data }));
        // Drop frames we will never need again to keep memory low.
        this.trim(target);
        if (this.frames.length > 0 && this.frames.some((f) => f.timestamp > target + 500)) break;
        continue;
      }
      if (!this.flushed) {
        this.flushed = true;
        await this.decoder?.flush().catch((e: unknown) => {
          this.error = e instanceof Error ? e : new Error(String(e));
        });
        continue;
      }
      break;
    }
    this.trim(target);
    return this.bestFrame(target) ?? this.frames[0] ?? null;
  }

  private trim(target: number): void {
    const best = this.bestFrame(target);
    if (!best) return;
    this.frames = this.frames.filter((f) => {
      if (f === best || f.timestamp > best.timestamp) return true;
      f.close();
      return false;
    });
  }

  close(): void {
    for (const f of this.frames) f.close();
    this.frames = [];
    if (this.decoder && this.decoder.state !== "closed") this.decoder.close();
    this.decoder = null;
    this.notify();
  }

  get durationUs(): number {
    return this.track.durationUs;
  }

  get demux(): Mp4Demuxer {
    return this.demuxer;
  }
}
