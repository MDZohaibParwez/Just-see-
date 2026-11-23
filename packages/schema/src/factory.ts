import {
  DEFAULT_TRANSFORM,
  NO_CROP,
  SCHEMA_VERSION,
  type Asset,
  type MediaClip,
  type Project,
  type Sequence,
  type TextClip,
  type TextStyle,
  type Track,
  type TrackType,
} from "./model";
import { secondsToUs } from "./time";

let counter = 0;

/** Short random id. Uses crypto when available. */
export function createId(prefix = ""): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c && typeof c.randomUUID === "function") {
    return prefix + c.randomUUID().replace(/-/g, "").slice(0, 16);
  }
  counter += 1;
  return `${prefix}${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export const ASPECT_PRESETS = {
  "9:16": { width: 1080, height: 1920 },
  "16:9": { width: 1920, height: 1080 },
  "1:1": { width: 1080, height: 1080 },
  "4:5": { width: 1080, height: 1350 },
} as const;
export type AspectPreset = keyof typeof ASPECT_PRESETS;

export function createTrack(type: TrackType, id = createId("t_"), name?: string): Track {
  const defaultNames: Record<TrackType, string> = {
    main: "Main",
    video: "Overlay",
    text: "Text",
    audio: "Audio",
  };
  return { id, type, name: name ?? defaultNames[type], muted: false, hidden: false, locked: false, clips: [] };
}

export function createSequence(opts: {
  id?: string;
  width: number;
  height: number;
  fps?: number;
  name?: string;
}): Sequence {
  return {
    id: opts.id ?? createId("s_"),
    name: opts.name ?? "Sequence 1",
    width: opts.width,
    height: opts.height,
    fps: opts.fps ?? 30,
    background: { kind: "color", color: "#000000", blur: 0.6, assetId: null },
    tracks: [createTrack("main")],
  };
}

export function createProject(opts: {
  id?: string;
  name?: string;
  aspect?: AspectPreset;
  width?: number;
  height?: number;
  fps?: number;
  now?: number;
}): Project {
  const preset = ASPECT_PRESETS[opts.aspect ?? "9:16"];
  const now = opts.now ?? Date.now();
  const sequence = createSequence({
    width: opts.width ?? preset.width,
    height: opts.height ?? preset.height,
    fps: opts.fps ?? 30,
  });
  return {
    schemaVersion: SCHEMA_VERSION,
    id: opts.id ?? createId("p_"),
    name: opts.name ?? "Untitled project",
    createdAt: now,
    updatedAt: now,
    assets: [],
    sequences: [sequence],
    activeSequenceId: sequence.id,
  };
}

/** Default still-image length on the timeline. */
export const DEFAULT_IMAGE_DURATION_US = secondsToUs(3);
export const DEFAULT_TEXT_DURATION_US = secondsToUs(3);

export function createMediaClip(asset: Asset, opts: { id?: string; startUs?: number; durationUs?: number } = {}): MediaClip {
  if (asset.kind === "lut") throw new Error("A LUT cannot be placed on the timeline");
  const duration =
    opts.durationUs ?? (asset.kind === "image" ? DEFAULT_IMAGE_DURATION_US : asset.durationUs);
  return {
    id: opts.id ?? createId("c_"),
    kind: asset.kind as MediaClip["kind"],
    assetId: asset.id,
    startUs: opts.startUs ?? 0,
    durationUs: duration,
    sourceInUs: 0,
    speed: 1,
    volume: 1,
    muted: false,
    transform: { ...DEFAULT_TRANSFORM },
    effects: [],
    transitionIn: null,
    fadeInUs: 0,
    fadeOutUs: 0,
    crop: { ...NO_CROP },
    blendMode: "normal",
    keyframes: {},
    reverse: false,
    holdFrame: false,
    speedCurve: null,
  };
}

export const DEFAULT_TEXT_STYLE: TextStyle = {
  fontFamily: "system-ui, 'Noto Sans', 'Noto Sans Devanagari', 'Noto Nastaliq Urdu', 'Noto Sans Gujarati', sans-serif",
  fontSize: 0.05,
  fontWeight: 700,
  italic: false,
  color: "#ffffff",
  align: "center",
  strokeColor: "#000000",
  strokeWidth: 0,
  backgroundColor: "#000000",
  backgroundOpacity: 0,
  shadow: true,
  lineHeight: 1.2,
  letterSpacing: 0,
  highlightColor: "#ffd60a",
};

export function createTextClip(opts: { id?: string; text?: string; startUs?: number; durationUs?: number } = {}): TextClip {
  return {
    id: opts.id ?? createId("c_"),
    kind: "text",
    startUs: opts.startUs ?? 0,
    durationUs: opts.durationUs ?? DEFAULT_TEXT_DURATION_US,
    text: opts.text ?? "Your text",
    style: { ...DEFAULT_TEXT_STYLE },
    transform: { ...DEFAULT_TRANSFORM },
    animationIn: "fade",
    animationOut: "fade",
    animationDurationUs: secondsToUs(0.4),
    effects: [],
    blendMode: "normal",
    keyframes: {},
    words: [],
    captionGroup: null,
  };
}
