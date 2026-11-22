export type MuxVideoCodec = "avc" | "hevc" | "vp9" | "av1";
export type MuxAudioCodec = "aac" | "opus";

export interface VideoCodecChoice {
  mux: MuxVideoCodec;
  codec: string;
  label: string;
}

export interface AudioCodecChoice {
  mux: MuxAudioCodec;
  codec: string;
  label: string;
}

/** H.264 level able to hold this size and frame rate (macroblocks per second). */
export function avcLevel(width: number, height: number, fps: number): string {
  const mbs = Math.ceil(width / 16) * Math.ceil(height / 16);
  const mbps = mbs * fps;
  const levels: [number, number, string][] = [
    [1620, 40500, "1f"], // 3.1
    [3600, 108000, "20"], // 3.2
    [8192, 245760, "28"], // 4.0
    [8704, 522240, "2a"], // 4.2
    [22080, 589824, "32"], // 5.0
    [36864, 983040, "33"], // 5.1
    [36864, 2073600, "34"], // 5.2
  ];
  for (const [maxFs, maxMbps, hex] of levels) if (mbs <= maxFs && mbps <= maxMbps) return hex;
  return "3c"; // 6.0
}

/** Candidates in order of preference for an MP4 export. */
export function videoCodecCandidates(width: number, height: number, fps: number): VideoCodecChoice[] {
  const lvl = avcLevel(width, height, fps);
  return [
    { mux: "avc", codec: `avc1.6400${lvl}`, label: "H.264 High" },
    { mux: "avc", codec: `avc1.4d00${lvl}`, label: "H.264 Main" },
    { mux: "avc", codec: `avc1.4200${lvl}`, label: "H.264 Baseline" },
    { mux: "vp9", codec: "vp09.00.50.08", label: "VP9" },
    { mux: "av1", codec: "av01.0.12M.08", label: "AV1" },
  ];
}

export const AUDIO_CODEC_CANDIDATES: AudioCodecChoice[] = [
  { mux: "aac", codec: "mp4a.40.2", label: "AAC" },
  { mux: "opus", codec: "opus", label: "Opus" },
];

/** Reasonable bitrate for social uploads. */
export function defaultVideoBitrate(width: number, height: number, fps: number): number {
  const pixels = width * height;
  const base = pixels >= 3840 * 2160 ? 40e6 : pixels >= 1920 * 1080 ? 12e6 : pixels >= 1280 * 720 ? 6e6 : 3e6;
  return Math.round(base * (fps > 30 ? 1.5 : 1));
}

export async function pickVideoCodec(width: number, height: number, fps: number, bitrate: number): Promise<VideoCodecChoice & { config: VideoEncoderConfig }> {
  for (const c of videoCodecCandidates(width, height, fps)) {
    const config: VideoEncoderConfig = {
      codec: c.codec,
      width,
      height,
      bitrate,
      framerate: fps,
      latencyMode: "quality",
      ...(c.mux === "avc" ? { avc: { format: "avc" as const } } : {}),
    };
    try {
      const r = await VideoEncoder.isConfigSupported(config);
      if (r.supported) return { ...c, config };
    } catch {
      // try next
    }
    // Retry without hardware preference quirks.
    try {
      const r = await VideoEncoder.isConfigSupported({ ...config, hardwareAcceleration: "prefer-software" });
      if (r.supported) return { ...c, config: { ...config, hardwareAcceleration: "prefer-software" } };
    } catch {
      // try next
    }
  }
  throw new Error("This browser cannot encode video. Try Chrome on Android or desktop.");
}

export async function pickAudioCodec(sampleRate: number, channels: number, bitrate: number): Promise<(AudioCodecChoice & { config: AudioEncoderConfig }) | null> {
  if (typeof AudioEncoder === "undefined") return null;
  for (const c of AUDIO_CODEC_CANDIDATES) {
    const config: AudioEncoderConfig = { codec: c.codec, sampleRate, numberOfChannels: channels, bitrate };
    try {
      const r = await AudioEncoder.isConfigSupported(config);
      if (r.supported) return { ...c, config };
    } catch {
      // next
    }
  }
  return null;
}
