import type { AudioSegment } from "../resolve";
import type { Mp4Demuxer } from "./demux";

/** Decoded PCM, planar float32. `startUs` is the source time of sample 0. */
export interface Pcm {
  sampleRate: number;
  channels: Float32Array[];
  startUs: number;
}

export function pcmDurationUs(p: Pcm): number {
  const len = p.channels[0]?.length ?? 0;
  return (len / p.sampleRate) * 1e6;
}

/** Decode the audio between two source times using WebCodecs. */
export async function decodeMp4Audio(demuxer: Mp4Demuxer, startUs: number, endUs: number): Promise<Pcm> {
  const track = demuxer.audio;
  if (!track) throw new Error("No audio track");
  const pad = 200_000;
  const chunks: { ts: number; planes: Float32Array[]; frames: number }[] = [];
  let err: Error | null = null;
  const decoder = new AudioDecoder({
    output: (data) => {
      const frames = data.numberOfFrames;
      const planes: Float32Array[] = [];
      for (let c = 0; c < data.numberOfChannels; c++) {
        const plane = new Float32Array(frames);
        data.copyTo(plane, { planeIndex: c, format: "f32-planar" });
        planes.push(plane);
      }
      chunks.push({ ts: data.timestamp, planes, frames });
      data.close();
    },
    error: (e) => {
      err = e instanceof Error ? e : new Error(String(e));
    },
  });
  decoder.configure({
    codec: track.codec,
    sampleRate: track.sampleRate,
    numberOfChannels: track.channels,
    description: track.description,
  });
  for (const s of track.samples) {
    if (s.ptsUs + s.durationUs < startUs - pad || s.ptsUs > endUs + pad) continue;
    const data = await demuxer.readAudioSample(s);
    decoder.decode(new EncodedAudioChunk({ type: "key", timestamp: s.ptsUs, duration: s.durationUs, data }));
    if (decoder.decodeQueueSize > 32) await new Promise((r) => setTimeout(r, 0));
    if (err) break;
  }
  await decoder.flush();
  decoder.close();
  if (err) throw err;
  return assemble(chunks, track.sampleRate);
}

function assemble(chunks: { ts: number; planes: Float32Array[]; frames: number }[], sampleRate: number): Pcm {
  chunks.sort((a, b) => a.ts - b.ts);
  const first = chunks[0];
  if (!first) return { sampleRate, channels: [new Float32Array(0)], startUs: 0 };
  const channelCount = Math.max(...chunks.map((c) => c.planes.length));
  const last = chunks[chunks.length - 1]!;
  const total = Math.ceil(((last.ts - first.ts) / 1e6) * sampleRate) + last.frames;
  const channels = Array.from({ length: channelCount }, () => new Float32Array(total));
  for (const c of chunks) {
    const at = Math.round(((c.ts - first.ts) / 1e6) * sampleRate);
    for (let ch = 0; ch < channelCount; ch++) {
      const plane = c.planes[ch] ?? c.planes[0];
      const dst = channels[ch];
      if (!plane || !dst) continue;
      dst.set(plane.subarray(0, Math.max(0, Math.min(plane.length, total - at))), at);
    }
  }
  return { sampleRate, channels, startUs: first.ts };
}

/** Fallback decoder for MP3/WAV/OGG/WebM via the Web Audio API. */
export async function decodeWithWebAudio(blob: Blob): Promise<Pcm> {
  const Ctx =
    (globalThis as { OfflineAudioContext?: typeof OfflineAudioContext }).OfflineAudioContext;
  if (!Ctx) throw new Error("Web Audio is not available");
  const ctx = new Ctx(2, 1, 48000);
  const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
  const channels: Float32Array[] = [];
  for (let c = 0; c < buf.numberOfChannels; c++) channels.push(new Float32Array(buf.getChannelData(c)));
  return { sampleRate: buf.sampleRate, channels, startUs: 0 };
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * Mix audio segments into stereo PCM. Pure JS so it runs anywhere and is
 * unit-testable. Speed changes resample (pitch follows speed, as in preview).
 */
export function mixSegments(
  segments: readonly AudioSegment[],
  sources: ReadonlyMap<string, Pcm>,
  totalUs: number,
  sampleRate = 48000,
): [Float32Array, Float32Array] {
  const length = Math.ceil((totalUs / 1e6) * sampleRate);
  const left = new Float32Array(length);
  const right = new Float32Array(length);
  for (const seg of segments) {
    const pcm = sources.get(seg.clipId);
    if (!pcm) continue;
    const l = pcm.channels[0];
    const r = pcm.channels[1] ?? pcm.channels[0];
    if (!l || !r) continue;
    const srcLen = l.length;
    const startN = Math.max(0, Math.round((seg.timelineStartUs / 1e6) * sampleRate));
    const endN = Math.min(length, Math.round(((seg.timelineStartUs + seg.durationUs) / 1e6) * sampleRate));
    const ratio = (seg.speed * pcm.sampleRate) / sampleRate;
    const srcOffset = ((seg.sourceInUs - pcm.startUs) / 1e6) * pcm.sampleRate;
    for (let n = startN; n < endN; n++) {
      const localUs = ((n - startN) / sampleRate) * 1e6;
      let g = seg.gain;
      if (seg.fadeInUs > 0) g *= clamp01(localUs / seg.fadeInUs);
      if (seg.fadeOutUs > 0) g *= clamp01((seg.durationUs - localUs) / seg.fadeOutUs);
      if (g === 0) continue;
      const pos = srcOffset + (n - startN) * ratio;
      const i = Math.floor(pos);
      if (i < 0 || i >= srcLen) continue;
      const f = pos - i;
      const j = i + 1 < srcLen ? i + 1 : i;
      left[n]! += (l[i]! * (1 - f) + l[j]! * f) * g;
      right[n]! += (r[i]! * (1 - f) + r[j]! * f) * g;
    }
  }
  // Soft clip to avoid harsh distortion when tracks stack up.
  for (let n = 0; n < length; n++) {
    left[n] = softClip(left[n]!);
    right[n] = softClip(right[n]!);
  }
  return [left, right];
}

function softClip(x: number): number {
  if (x > 1 || x < -1) return Math.tanh(x);
  return x;
}

/** Downsample PCM to min/max peaks for waveform drawing. */
export function computePeaks(channel: Float32Array, buckets: number): Float32Array {
  const out = new Float32Array(buckets * 2);
  const per = channel.length / buckets;
  for (let b = 0; b < buckets; b++) {
    let min = 0;
    let max = 0;
    const s = Math.floor(b * per);
    const e = Math.min(channel.length, Math.floor((b + 1) * per));
    for (let i = s; i < e; i++) {
      const v = channel[i]!;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    out[b * 2] = min;
    out[b * 2 + 1] = max;
  }
  return out;
}
