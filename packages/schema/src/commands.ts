import { z } from "zod";
import {
  AssetSchema,
  ProjectFontSchema,
  type ProjectFont,
  BackgroundSchema,
  BlendModeSchema,
  CropSchema,
  MarkerSchema,
  EasingSchema,
  SpeedCurveSchema,
  ClipSchema,
  EffectInstanceSchema,
  IdSchema,
  MicrosSchema,
  SequenceSchema,
  TextAnimationSchema,
  TextStyleSchema,
  TrackTypeSchema,
  TransformSchema,
  TransitionSchema,
  isMediaClip,
  isTextClip,
  type Asset,
  type Clip,
  type Project,
  type Sequence,
  type Track,
  type TrackType,
} from "./model";
import { createTrack } from "./factory";
import { AudioSessionSchema, type AudioSession } from "./session";
import { MotionCompSchema, type MotionComp } from "./motion";
import { removeKeyframeAt, shiftKeyframes, splitKeyframes, subCurve, upsertKeyframe } from "./keyframes";
import {
  MIN_CLIP_DURATION_US,
  clipEndUs,
  findClip,
  getAsset,
  getMainTrack,
  getSequence,
  mainTrackInsertIndex,
  maxClipDurationUs,
  normalizeMainTrack,
  overlapsOnTrack,
  sortTrack,
  sourceOffsetAt,
  sourceSpanUs,
  curveSpeedAt,
} from "./timeline";

/**
 * Every edit is a command. Commands are plain JSON so they can be stored,
 * sent over the network (MCP connector) and replayed.
 */

const SeqRef = { sequenceId: IdSchema.optional() };

export const CommandPayloads = {
  "project/rename": z.object({ name: z.string().min(1).max(200) }),
  "sequence/update": z.object({
    ...SeqRef,
    width: z.number().int().min(16).max(7680).optional(),
    height: z.number().int().min(16).max(7680).optional(),
    fps: z.number().min(1).max(120).optional(),
    background: BackgroundSchema.optional(),
  }),
  "asset/add": z.object({ asset: AssetSchema }),
  "asset/remove": z.object({ assetId: IdSchema }),
  "track/add": z.object({ ...SeqRef, trackId: IdSchema, type: TrackTypeSchema, index: z.number().int().optional() }),
  "track/update": z.object({
    trackId: IdSchema,
    name: z.string().max(200).optional(),
    muted: z.boolean().optional(),
    hidden: z.boolean().optional(),
    locked: z.boolean().optional(),
  }),
  "track/remove": z.object({ trackId: IdSchema }),
  "clip/add": z.object({
    ...SeqRef,
    clip: ClipSchema,
    /** Explicit target track. */
    trackId: IdSchema.optional(),
    /** Or a track type; the first track of that type is used (created if needed). */
    trackType: TrackTypeSchema.optional(),
    /** Main track only: insert position. Defaults to the end. */
    index: z.number().int().nonnegative().optional(),
    /** Id to use if a new track must be created to avoid overlap. */
    newTrackId: IdSchema.optional(),
  }),
  "clip/delete": z.object({ clipId: IdSchema }),
  "clip/split": z.object({ clipId: IdSchema, atUs: MicrosSchema, newClipId: IdSchema }),
  "clip/trim": z.object({ clipId: IdSchema, edge: z.enum(["start", "end"]), timeUs: z.number().int() }),
  "clip/move": z.object({
    clipId: IdSchema,
    trackId: IdSchema,
    startUs: MicrosSchema,
    newTrackId: IdSchema.optional(),
  }),
  "clip/update": z.object({
    clipId: IdSchema,
    patch: z.object({
      volume: z.number().min(0).max(2).optional(),
      muted: z.boolean().optional(),
      transform: TransformSchema.partial().optional(),
      fadeInUs: MicrosSchema.optional(),
      fadeOutUs: MicrosSchema.optional(),
      text: z.string().max(5000).optional(),
      style: TextStyleSchema.partial().optional(),
      animationIn: TextAnimationSchema.optional(),
      animationOut: TextAnimationSchema.optional(),
      animationDurationUs: MicrosSchema.optional(),
      durationUs: MicrosSchema.optional(),
      crop: CropSchema.partial().optional(),
      blendMode: BlendModeSchema.optional(),
      reverse: z.boolean().optional(),
      words: z.array(z.object({ text: z.string().max(200), startUs: MicrosSchema, endUs: MicrosSchema })).max(2000).optional(),
    }),
  }),
  /** Slip: change what part of the source plays, keeping position and length. */
  "clip/slip": z.object({ clipId: IdSchema, deltaUs: z.number().int() }),
  /** Roll: move the cut between a main-track clip and the one before it. */
  "clip/roll": z.object({ clipId: IdSchema, deltaUs: z.number().int() }),
  /** Slide: move a main-track clip between its neighbours, which give and take time. */
  "clip/slide": z.object({ clipId: IdSchema, deltaUs: z.number().int() }),
  "clip/group": z.object({ clipIds: z.array(IdSchema).min(2).max(200), groupId: IdSchema }),
  "clip/ungroup": z.object({ groupId: IdSchema }),
  "clip/deleteMany": z.object({ clipIds: z.array(IdSchema).min(1).max(500) }),
  "clip/setSpeedCurve": z.object({ clipId: IdSchema, curve: SpeedCurveSchema.nullable() }),
  "clip/setKeyframe": z.object({
    clipId: IdSchema,
    prop: z.string().min(1).max(120),
    /** Clip-local time in µs. */
    t: MicrosSchema,
    v: z.number(),
    ease: EasingSchema.optional(),
    bezier: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
  }),
  "clip/removeKeyframe": z.object({ clipId: IdSchema, prop: z.string().min(1).max(120), t: MicrosSchema }),
  "clip/clearKeyframes": z.object({ clipId: IdSchema, prop: z.string().max(120).optional() }),
  "clip/freeze": z.object({
    clipId: IdSchema,
    /** Timeline time of the frame to freeze. */
    atUs: MicrosSchema,
    /** Id of the still clip that is inserted. */
    newClipId: IdSchema,
    /** Id of the part after the freeze (when the freeze is inside the clip). */
    tailClipId: IdSchema,
    durationUs: MicrosSchema,
  }),
  "clip/setSpeed": z.object({ clipId: IdSchema, speed: z.number().min(0.1).max(100) }),
  "clip/setTransition": z.object({ clipId: IdSchema, transition: TransitionSchema.nullable() }),
  "clip/addEffect": z.object({ clipId: IdSchema, effect: EffectInstanceSchema }),
  "clip/updateEffect": z.object({
    clipId: IdSchema,
    effectId: IdSchema,
    params: z.record(z.string(), z.number()).optional(),
    enabled: z.boolean().optional(),
  }),
  "clip/removeEffect": z.object({ clipId: IdSchema, effectId: IdSchema }),
  "clip/addAudioFx": z.object({ clipId: IdSchema, effect: EffectInstanceSchema }),
  "clip/updateAudioFx": z.object({ clipId: IdSchema, effectId: IdSchema, params: z.record(z.string(), z.number()).optional(), enabled: z.boolean().optional() }),
  "clip/removeAudioFx": z.object({ clipId: IdSchema, effectId: IdSchema }),
  "clip/duplicate": z.object({ clipId: IdSchema, newClipId: IdSchema, newTrackId: IdSchema.optional() }),
  /** Remove a time range from every track and close the gap (transcript edits, filler removal). */
  "timeline/rippleDelete": z.object({
    ...SeqRef,
    startUs: MicrosSchema,
    endUs: MicrosSchema,
    /** Prefix for ids of clips created by cutting. */
    idSeed: z.string().min(1).max(40),
  }),
  "marker/add": z.object({ ...SeqRef, marker: MarkerSchema }),
  "marker/remove": z.object({ ...SeqRef, markerId: IdSchema }),
  "marker/setBeats": z.object({ ...SeqRef, timesUs: z.array(MicrosSchema).max(5000), idPrefix: z.string().min(1).max(40) }),
  "session/put": z.object({ session: AudioSessionSchema }),
  "session/delete": z.object({ sessionId: IdSchema }),
  "motion/put": z.object({ comp: MotionCompSchema }),
  "motion/delete": z.object({ compId: IdSchema }),
  "font/add": z.object({ font: ProjectFontSchema }),
  "asset/update": z.object({
    assetId: IdSchema,
    patch: z.object({ storageKey: z.string().max(500).optional(), durationUs: MicrosSchema.optional(), sizeBytes: z.number().int().nonnegative().optional(), name: z.string().max(500).optional() }),
  }),
  "internal/restore": z.object({
    fonts: z.array(ProjectFontSchema).optional(),
    motionComps: z.array(MotionCompSchema).optional(),
    audioSessions: z.array(AudioSessionSchema).optional(),
    name: z.string().optional(),
    activeSequenceId: z.string().optional(),
    assets: z.array(AssetSchema).optional(),
    sequenceOrder: z.array(IdSchema).optional(),
    sequences: z.record(z.string(), SequenceSchema.nullable()).optional(),
  }),
} as const;

export type CommandType = keyof typeof CommandPayloads | "batch";
/** What callers send: fields with defaults may be left out. */
export type PayloadOf<T extends keyof typeof CommandPayloads> = z.input<(typeof CommandPayloads)[T]>;
/** What handlers receive after validation. */
type ParsedPayload<T extends keyof typeof CommandPayloads> = z.output<(typeof CommandPayloads)[T]>;

export type SimpleCommand = {
  [K in keyof typeof CommandPayloads]: { type: K; payload: PayloadOf<K> };
}[keyof typeof CommandPayloads];

export type Command = SimpleCommand | { type: "batch"; payload: { label?: string; commands: Command[] } };

export class CommandError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CommandError";
  }
}

function fail(message: string): never {
  throw new CommandError(message);
}

function requireClip(project: Project, clipId: string) {
  return findClip(project, clipId) ?? fail(`Clip not found: ${clipId}`);
}

function trackAccepts(type: TrackType, clip: Clip): boolean {
  switch (type) {
    case "main":
    case "video":
      return clip.kind === "video" || clip.kind === "image";
    case "text":
      return clip.kind === "text";
    case "audio":
      return clip.kind === "audio";
  }
}

function defaultTrackTypeFor(clip: Clip): TrackType {
  if (clip.kind === "text") return "text";
  if (clip.kind === "audio") return "audio";
  return "main";
}

/** Insert a new track of `type` right above `afterIndex`. */
function insertTrack(seq: Sequence, type: TrackType, id: string, afterIndex?: number): Track {
  if (type === "main") fail("A sequence can only have one main track");
  if (seq.tracks.some((t) => t.id === id)) fail(`Track id already exists: ${id}`);
  const track = createTrack(type, id);
  if (afterIndex === undefined) {
    // Audio tracks sit at the bottom of the list after the main track; visuals above.
    seq.tracks.push(track);
  } else {
    seq.tracks.splice(afterIndex + 1, 0, track);
  }
  return track;
}

function placeOnFreeTrack(seq: Sequence, track: Track, clip: Clip, newTrackId: string | undefined): Track {
  if (!overlapsOnTrack(track, clip.startUs, clip.durationUs, clip.id)) {
    track.clips.push(clip);
    sortTrack(track);
    return track;
  }
  // Find another track of the same type with room.
  for (const other of seq.tracks) {
    if (other.type === track.type && other.id !== track.id && !overlapsOnTrack(other, clip.startUs, clip.durationUs, clip.id)) {
      other.clips.push(clip);
      sortTrack(other);
      return other;
    }
  }
  if (!newTrackId) fail("Clip overlaps another clip on the track");
  const created = insertTrack(seq, track.type, newTrackId, seq.tracks.indexOf(track));
  created.clips.push(clip);
  return created;
}

function clampMediaClip(project: Project, clip: Clip): void {
  if (!isMediaClip(clip)) {
    clip.durationUs = Math.max(MIN_CLIP_DURATION_US, clip.durationUs);
    return;
  }
  const asset = getAsset(project, clip.assetId);
  const max = maxClipDurationUs(clip, asset);
  clip.durationUs = Math.max(MIN_CLIP_DURATION_US, Math.min(clip.durationUs, max));
  const half = Math.floor(clip.durationUs / 2);
  clip.fadeInUs = Math.min(clip.fadeInUs, half);
  clip.fadeOutUs = Math.min(clip.fadeOutUs, half);
}

/**
 * Cut a clip at a clip-local offset. Mutates `clip` into the left part and
 * returns the right part. Handles speed curves, reverse and keyframes.
 */
function splitClipAt(clip: Clip, offset: number, newId: string): Clip {
  const right = structuredClone(clip);
  right.id = newId;
  right.startUs = clip.startUs + offset;
  right.durationUs = clip.durationUs - offset;
  const [kl, kr] = splitKeyframes(clip.keyframes, offset);
  right.keyframes = kr;
  if (isMediaClip(right) && isMediaClip(clip)) {
    const d = clip.durationUs;
    const pSplit = offset / d;
    const forward = { ...clip, reverse: false };
    const fwdAtSplit = sourceOffsetAt(forward, offset);
    const span = sourceSpanUs(clip);
    if (!clip.holdFrame) {
      if (clip.reverse) {
        // Left part shows the end of the source range, right part the start.
        right.sourceInUs = clip.sourceInUs;
        clip.sourceInUs = clip.sourceInUs + Math.max(0, span - fwdAtSplit);
      } else {
        right.sourceInUs = clip.sourceInUs + fwdAtSplit;
      }
    }
    const curve = clip.speedCurve;
    clip.speedCurve = subCurve(curve, 0, pSplit, (q) => curveSpeedAt(curve, q));
    right.speedCurve = subCurve(curve, pSplit, 1, (q) => curveSpeedAt(curve, q));
    right.transitionIn = null;
    right.fadeInUs = 0;
    clip.fadeOutUs = 0;
  }
  if (isTextClip(right) && isTextClip(clip)) {
    right.words = clip.words.filter((w) => w.endUs > offset).map((w) => ({ ...w, startUs: Math.max(0, w.startUs - offset), endUs: w.endUs - offset }));
    clip.words = clip.words.filter((w) => w.startUs < offset).map((w) => ({ ...w, endUs: Math.min(w.endUs, offset) }));
  }
  clip.durationUs = offset;
  clip.keyframes = kl;
  for (const e of right.effects) e.id = `${e.id}_${newId}`.slice(0, 64);
  // Effect ids changed on the right part: rename their keyframe keys too.
  const renamed: typeof right.keyframes = {};
  for (const [k, v] of Object.entries(right.keyframes)) {
    const m = /^fx\.([^.]+)\.(.+)$/.exec(k);
    renamed[m ? `fx.${`${m[1]}_${newId}`.slice(0, 64)}.${m[2]}` : k] = v;
  }
  right.keyframes = renamed;
  return right;
}

function dropIfEmpty(seq: Sequence, track: Track): void {
  if (track.type !== "main" && track.clips.length === 0) seq.tracks = seq.tracks.filter((t) => t !== track);
}

type Handler<K extends keyof typeof CommandPayloads> = (draft: Project, payload: ParsedPayload<K>) => void;

const handlers: { [K in keyof typeof CommandPayloads]: Handler<K> } = {
  "project/rename": (d, p) => {
    d.name = p.name;
  },

  "sequence/update": (d, p) => {
    const seq = getSequence(d, p.sequenceId);
    if (p.width !== undefined) seq.width = p.width;
    if (p.height !== undefined) seq.height = p.height;
    if (p.fps !== undefined) seq.fps = p.fps;
    if (p.background !== undefined) seq.background = p.background;
  },

  "asset/add": (d, p) => {
    if (d.assets.some((a) => a.id === p.asset.id)) fail(`Asset already exists: ${p.asset.id}`);
    d.assets.push(p.asset as Asset);
  },

  "asset/remove": (d, p) => {
    if (!d.assets.some((a) => a.id === p.assetId)) fail(`Asset not found: ${p.assetId}`);
    d.assets = d.assets.filter((a) => a.id !== p.assetId);
    for (const seq of d.sequences) {
      for (const t of seq.tracks) t.clips = t.clips.filter((c) => !(isMediaClip(c) && c.assetId === p.assetId));
    }
  },

  "track/add": (d, p) => {
    const seq = getSequence(d, p.sequenceId);
    insertTrack(seq, p.type, p.trackId, p.index === undefined ? undefined : p.index - 1);
  },

  "track/update": (d, p) => {
    for (const seq of d.sequences) {
      const t = seq.tracks.find((x) => x.id === p.trackId);
      if (t) {
        if (p.name !== undefined) t.name = p.name;
        if (p.muted !== undefined) t.muted = p.muted;
        if (p.hidden !== undefined) t.hidden = p.hidden;
        if (p.locked !== undefined) t.locked = p.locked;
        return;
      }
    }
    fail(`Track not found: ${p.trackId}`);
  },

  "track/remove": (d, p) => {
    for (const seq of d.sequences) {
      const t = seq.tracks.find((x) => x.id === p.trackId);
      if (t) {
        if (t.type === "main") fail("The main track cannot be removed");
        seq.tracks = seq.tracks.filter((x) => x.id !== p.trackId);
        return;
      }
    }
    fail(`Track not found: ${p.trackId}`);
  },

  "clip/add": (d, p) => {
    const seq = getSequence(d, p.sequenceId);
    const clip = structuredClone(p.clip) as Clip;
    if (findClip(d, clip.id)) fail(`Clip id already exists: ${clip.id}`);
    if (isMediaClip(clip)) {
      const asset = getAsset(d, clip.assetId) ?? fail(`Asset not found: ${clip.assetId}`);
      if (asset.kind !== clip.kind) fail(`Clip kind ${clip.kind} does not match asset kind ${asset.kind}`);
    }
    let track: Track | undefined;
    if (p.trackId) {
      track = seq.tracks.find((t) => t.id === p.trackId) ?? fail(`Track not found: ${p.trackId}`);
    } else {
      const type = p.trackType ?? defaultTrackTypeFor(clip);
      track = seq.tracks.find((t) => t.type === type);
      if (!track) track = insertTrack(seq, type, p.newTrackId ?? fail("newTrackId is required to create a track"));
    }
    if (!trackAccepts(track.type, clip)) fail(`A ${track.type} track cannot hold a ${clip.kind} clip`);
    clampMediaClip(d, clip);
    if (track.type === "main") {
      const index = Math.min(p.index ?? track.clips.length, track.clips.length);
      track.clips.splice(index, 0, clip);
    } else {
      placeOnFreeTrack(seq, track, clip, p.newTrackId);
    }
  },

  "clip/delete": (d, p) => {
    const loc = requireClip(d, p.clipId);
    loc.track.clips.splice(loc.index, 1);
    dropIfEmpty(loc.sequence, loc.track);
  },

  "clip/split": (d, p) => {
    const loc = requireClip(d, p.clipId);
    if (findClip(d, p.newClipId)) fail(`Clip id already exists: ${p.newClipId}`);
    const offset = p.atUs - loc.clip.startUs;
    if (offset < MIN_CLIP_DURATION_US || loc.clip.durationUs - offset < MIN_CLIP_DURATION_US) {
      fail("Split point is too close to the clip edge");
    }
    const right = splitClipAt(loc.clip, offset, p.newClipId);
    loc.track.clips.splice(loc.index + 1, 0, right);
  },

  "clip/trim": (d, p) => {
    const loc = requireClip(d, p.clipId);
    const clip = loc.clip;
    const oldD = clip.durationUs;
    if (p.edge === "end") {
      clip.durationUs = p.timeUs - clip.startUs;
      if (isMediaClip(clip) && clip.reverse && !clip.holdFrame) {
        // A reversed clip ends on the earliest source frame: move the in-point.
        const ext = clip.durationUs - oldD;
        const shift = Math.round(ext * clip.speed);
        if (shift > clip.sourceInUs) clip.durationUs = oldD + Math.floor(clip.sourceInUs / clip.speed);
        clip.sourceInUs = Math.max(0, clip.sourceInUs - Math.round((clip.durationUs - oldD) * clip.speed));
      }
      clampMediaClip(d, clip);
      if (loc.track.type !== "main") {
        // Do not run into the next clip.
        const next = loc.track.clips.find((c) => c.id !== clip.id && c.startUs >= clip.startUs);
        if (next) clip.durationUs = Math.min(clip.durationUs, next.startUs - clip.startUs);
      }
      if (isMediaClip(clip) && clip.speedCurve && clip.durationUs < oldD) {
        const curve = clip.speedCurve;
        clip.speedCurve = subCurve(curve, 0, clip.durationUs / oldD, (q) => curveSpeedAt(curve, q));
      }
      return;
    }
    // Start edge.
    let delta = p.timeUs - clip.startUs;
    const end = clipEndUs(clip);
    delta = Math.min(delta, clip.durationUs - MIN_CLIP_DURATION_US);
    if (isMediaClip(clip) && clip.kind !== "image" && !clip.holdFrame) {
      // Cannot extend before the start of the source (reverse clips extend from the end).
      delta = clip.reverse ? Math.max(delta, 0) : Math.max(delta, -Math.floor(clip.sourceInUs / clip.speed));
    }
    if (loc.track.type !== "main") {
      delta = Math.max(delta, -clip.startUs);
      const prev = [...loc.track.clips].reverse().find((c) => c.id !== clip.id && clipEndUs(c) <= clip.startUs);
      if (prev) delta = Math.max(delta, clipEndUs(prev) - clip.startUs);
    }
    if (isMediaClip(clip) && clip.kind !== "image" && !clip.holdFrame && !clip.reverse) {
      // Move the in-point by the source time the trimmed part covered.
      const moved = delta >= 0 ? sourceOffsetAt(clip, delta) : Math.round(delta * clip.speed);
      clip.sourceInUs = Math.max(0, clip.sourceInUs + moved);
    }
    clip.keyframes = shiftKeyframes(clip.keyframes, delta);
    if (isMediaClip(clip) && clip.speedCurve && delta > 0) {
      const curve = clip.speedCurve;
      clip.speedCurve = subCurve(curve, delta / oldD, 1, (q) => curveSpeedAt(curve, q));
    }
    if (isTextClip(clip)) {
      clip.words = clip.words
        .map((w) => ({ ...w, startUs: w.startUs - delta, endUs: w.endUs - delta }))
        .filter((w) => w.endUs > 0)
        .map((w) => ({ ...w, startUs: Math.max(0, w.startUs) }));
    }
    if (loc.track.type === "main") {
      clip.durationUs = clip.durationUs - delta;
    } else {
      clip.startUs = clip.startUs + delta;
      clip.durationUs = end - clip.startUs;
    }
    clampMediaClip(d, clip);
  },

  "clip/move": (d, p) => {
    const loc = requireClip(d, p.clipId);
    const seq = loc.sequence;
    const target = seq.tracks.find((t) => t.id === p.trackId) ?? fail(`Track not found: ${p.trackId}`);
    if (!trackAccepts(target.type, loc.clip)) fail(`A ${target.type} track cannot hold a ${loc.clip.kind} clip`);
    if (target.locked) fail("Track is locked");
    const clip = loc.clip;
    if (target.type === "main") {
      const index = mainTrackInsertIndex(target, p.startUs, clip.id);
      loc.track.clips.splice(loc.index, 1);
      if (isMediaClip(clip) && loc.track !== target) clip.transitionIn = null;
      target.clips.splice(index, 0, clip);
      dropIfEmpty(seq, loc.track);
      return;
    }
    const delta = p.startUs - clip.startUs;
    loc.track.clips.splice(loc.index, 1);
    clip.startUs = p.startUs;
    if (isMediaClip(clip)) clip.transitionIn = null;
    placeOnFreeTrack(seq, target, clip, p.newTrackId);
    if (loc.track !== target) dropIfEmpty(seq, loc.track);
    // Grouped clips on free tracks follow by the same amount.
    if (clip.groupId && delta !== 0) {
      for (const t of seq.tracks) {
        if (t.type === "main") continue;
        for (const c of t.clips) if (c.id !== clip.id && c.groupId === clip.groupId) c.startUs = Math.max(0, c.startUs + delta);
        sortTrack(t);
      }
    }
  },

  "clip/update": (d, p) => {
    const { clip } = requireClip(d, p.clipId);
    const patch = p.patch;
    if (patch.transform) clip.transform = { ...clip.transform, ...patch.transform };
    if (patch.durationUs !== undefined) clip.durationUs = patch.durationUs;
    if (patch.blendMode !== undefined) clip.blendMode = patch.blendMode;
    if (isMediaClip(clip)) {
      if (patch.crop) clip.crop = { ...clip.crop, ...patch.crop };
      if (patch.reverse !== undefined) {
        if (clip.kind === "image") fail("Photos cannot be reversed");
        clip.reverse = patch.reverse;
      }
      if (patch.volume !== undefined) clip.volume = patch.volume;
      if (patch.muted !== undefined) clip.muted = patch.muted;
      if (patch.fadeInUs !== undefined) clip.fadeInUs = patch.fadeInUs;
      if (patch.fadeOutUs !== undefined) clip.fadeOutUs = patch.fadeOutUs;
    }
    if (isTextClip(clip)) {
      if (patch.text !== undefined) clip.text = patch.text;
      if (patch.style) clip.style = { ...clip.style, ...patch.style };
      if (patch.animationIn !== undefined) clip.animationIn = patch.animationIn;
      if (patch.animationOut !== undefined) clip.animationOut = patch.animationOut;
      if (patch.animationDurationUs !== undefined) clip.animationDurationUs = patch.animationDurationUs;
      if (patch.words !== undefined) clip.words = patch.words;
    }
    clampMediaClip(d, clip);
  },

  "clip/setSpeed": (d, p) => {
    const { clip } = requireClip(d, p.clipId);
    if (!isMediaClip(clip) || clip.kind === "image") fail("Only video and audio clips have speed");
    if (clip.holdFrame) fail("A freeze frame has no speed");
    const span = sourceSpanUs(clip);
    const mean = span / Math.max(1, clip.durationUs * clip.speed);
    clip.speed = p.speed;
    clip.durationUs = Math.round(span / (p.speed * (mean || 1)));
    clampMediaClip(d, clip);
  },

  "clip/setTransition": (d, p) => {
    const loc = requireClip(d, p.clipId);
    if (loc.track.type !== "main") fail("Transitions are only allowed on the main track");
    if (!isMediaClip(loc.clip)) fail("Transitions need a media clip");
    if (loc.index === 0 && p.transition) fail("The first clip has no previous clip to transition from");
    loc.clip.transitionIn = p.transition ? { ...p.transition } : null;
  },

  "clip/addEffect": (d, p) => {
    const { clip } = requireClip(d, p.clipId);
    if (clip.kind === "audio") fail("Audio clips have no visual effects");
    if (clip.effects.some((e) => e.id === p.effect.id)) fail(`Effect id already exists: ${p.effect.id}`);
    if (clip.effects.length >= 32) fail("Too many effects on one clip");
    clip.effects.push({ ...p.effect, params: { ...p.effect.params } });
  },

  "clip/updateEffect": (d, p) => {
    const { clip } = requireClip(d, p.clipId);
    const effect = clip.effects.find((e) => e.id === p.effectId) ?? fail(`Effect not found: ${p.effectId}`);
    if (p.params) effect.params = { ...effect.params, ...p.params };
    if (p.enabled !== undefined) effect.enabled = p.enabled;
  },

  "clip/removeEffect": (d, p) => {
    const { clip } = requireClip(d, p.clipId);
    if (!clip.effects.some((e) => e.id === p.effectId)) fail(`Effect not found: ${p.effectId}`);
    clip.effects = clip.effects.filter((e) => e.id !== p.effectId);
  },

  "clip/addAudioFx": (d, p) => {
    const { clip } = requireClip(d, p.clipId);
    if (!isMediaClip(clip) || clip.kind === "image") fail("Only clips with sound take audio effects");
    if (clip.audioFx.some((e) => e.id === p.effect.id)) fail(`Effect id already exists: ${p.effect.id}`);
    if (clip.audioFx.length >= 16) fail("Too many audio effects on one clip");
    clip.audioFx = [...clip.audioFx, { ...p.effect, params: { ...p.effect.params } }];
  },

  "clip/updateAudioFx": (d, p) => {
    const { clip } = requireClip(d, p.clipId);
    if (!isMediaClip(clip)) fail("Not a media clip");
    const fx = clip.audioFx.find((e) => e.id === p.effectId) ?? fail(`Effect not found: ${p.effectId}`);
    if (p.params) fx.params = { ...fx.params, ...p.params };
    if (p.enabled !== undefined) fx.enabled = p.enabled;
  },

  "clip/removeAudioFx": (d, p) => {
    const { clip } = requireClip(d, p.clipId);
    if (!isMediaClip(clip) || !clip.audioFx.some((e) => e.id === p.effectId)) fail(`Effect not found: ${p.effectId}`);
    clip.audioFx = clip.audioFx.filter((e) => e.id !== p.effectId);
  },

  "clip/duplicate": (d, p) => {
    const loc = requireClip(d, p.clipId);
    if (findClip(d, p.newClipId)) fail(`Clip id already exists: ${p.newClipId}`);
    const copy = structuredClone(loc.clip);
    copy.id = p.newClipId;
    copy.effects.forEach((e, i) => (e.id = `${p.newClipId}_e${i}`.slice(0, 64)));
    if (loc.track.type === "main") {
      if (isMediaClip(copy)) copy.transitionIn = null;
      loc.track.clips.splice(loc.index + 1, 0, copy);
      return;
    }
    copy.startUs = clipEndUs(loc.clip);
    placeOnFreeTrack(loc.sequence, loc.track, copy, p.newTrackId);
  },

  "clip/slip": (d, p) => {
    const { clip } = requireClip(d, p.clipId);
    if (!isMediaClip(clip) || clip.kind === "image" || clip.holdFrame) fail("Only video and audio clips can slip");
    const asset = getAsset(d, clip.assetId) ?? fail("Asset not found");
    const span = sourceSpanUs(clip);
    const maxIn = Math.max(0, asset.durationUs - span);
    clip.sourceInUs = Math.min(maxIn, Math.max(0, clip.sourceInUs + Math.round(p.deltaUs * clip.speed)));
  },

  "clip/roll": (d, p) => {
    const loc = requireClip(d, p.clipId);
    if (loc.track.type !== "main" || loc.index === 0) fail("Roll needs a main-track clip with a clip before it");
    const right = loc.clip;
    const left = loc.track.clips[loc.index - 1]!;
    let delta = p.deltaUs;
    // Left may grow only as far as its source allows; right shrinks the same amount.
    if (isMediaClip(left)) delta = Math.min(delta, maxClipDurationUs(left, getAsset(d, left.assetId)) - left.durationUs);
    delta = Math.min(delta, right.durationUs - MIN_CLIP_DURATION_US);
    delta = Math.max(delta, -(left.durationUs - MIN_CLIP_DURATION_US));
    if (isMediaClip(right) && right.kind !== "image" && !right.holdFrame) {
      delta = Math.max(delta, -Math.floor(right.sourceInUs / right.speed));
      right.sourceInUs = Math.max(0, right.sourceInUs + Math.round(delta * right.speed));
    }
    left.durationUs += delta;
    right.durationUs -= delta;
  },

  "clip/slide": (d, p) => {
    const loc = requireClip(d, p.clipId);
    if (loc.track.type !== "main") fail("Slide works on the main track");
    const prev = loc.track.clips[loc.index - 1];
    const next = loc.track.clips[loc.index + 1];
    if (!prev || !next) fail("Slide needs clips on both sides");
    let delta = p.deltaUs;
    // Prev grows/shrinks by delta, next loses/gains the same at its start.
    if (isMediaClip(prev)) delta = Math.min(delta, maxClipDurationUs(prev, getAsset(d, prev.assetId)) - prev.durationUs);
    delta = Math.min(delta, next.durationUs - MIN_CLIP_DURATION_US);
    delta = Math.max(delta, -(prev.durationUs - MIN_CLIP_DURATION_US));
    if (isMediaClip(next) && next.kind !== "image" && !next.holdFrame) {
      delta = Math.max(delta, -Math.floor(next.sourceInUs / next.speed));
      next.sourceInUs = Math.max(0, next.sourceInUs + Math.round(delta * next.speed));
    }
    prev.durationUs += delta;
    next.durationUs -= delta;
  },

  "clip/group": (d, p) => {
    for (const id of p.clipIds) requireClip(d, id).clip.groupId = p.groupId;
  },

  "clip/ungroup": (d, p) => {
    let found = false;
    for (const seq of d.sequences)
      for (const t of seq.tracks)
        for (const c of t.clips)
          if (c.groupId === p.groupId) {
            c.groupId = null;
            found = true;
          }
    if (!found) fail(`Group not found: ${p.groupId}`);
  },

  "clip/deleteMany": (d, p) => {
    for (const id of p.clipIds) {
      const loc = requireClip(d, id);
      loc.track.clips.splice(loc.index, 1);
      dropIfEmpty(loc.sequence, loc.track);
    }
  },

  "clip/setSpeedCurve": (d, p) => {
    const { clip } = requireClip(d, p.clipId);
    if (!isMediaClip(clip) || clip.kind === "image" || clip.holdFrame) fail("Only video and audio clips have speed");
    const span = sourceSpanUs(clip);
    const curve = p.curve ? { preset: p.curve.preset, points: [...p.curve.points].sort((a, b) => a.p - b.p) } : null;
    clip.speedCurve = curve;
    clip.durationUs = Math.round(span / Math.max(0.01, sourceSpanUs({ ...clip, durationUs: 1_000_000 }) / 1_000_000));
    clampMediaClip(d, clip);
  },

  "clip/setKeyframe": (d, p) => {
    const { clip } = requireClip(d, p.clipId);
    if (p.t > clip.durationUs) fail("Keyframe is outside the clip");
    if (p.prop.startsWith("fx.")) {
      const effectId = p.prop.split(".")[1];
      if (!clip.effects.some((e) => e.id === effectId)) fail(`Effect not found: ${effectId ?? ""}`);
    }
    clip.keyframes = { ...clip.keyframes, [p.prop]: upsertKeyframe(clip.keyframes[p.prop], { t: p.t, v: p.v, ease: p.ease ?? "ease-in-out", bezier: p.bezier }) };
  },

  "clip/removeKeyframe": (d, p) => {
    const { clip } = requireClip(d, p.clipId);
    const next = removeKeyframeAt(clip.keyframes[p.prop], p.t);
    const all = { ...clip.keyframes };
    if (next.length) all[p.prop] = next;
    else delete all[p.prop];
    clip.keyframes = all;
  },

  "clip/clearKeyframes": (d, p) => {
    const { clip } = requireClip(d, p.clipId);
    if (p.prop === undefined) clip.keyframes = {};
    else {
      const all = { ...clip.keyframes };
      delete all[p.prop];
      clip.keyframes = all;
    }
  },

  "clip/freeze": (d, p) => {
    const loc = requireClip(d, p.clipId);
    const clip = loc.clip;
    if (!isMediaClip(clip) || clip.kind !== "video") fail("Freeze frame needs a video clip");
    for (const id of [p.newClipId, p.tailClipId]) if (findClip(d, id)) fail(`Clip id already exists: ${id}`);
    const offset = Math.min(Math.max(0, p.atUs - clip.startUs), clip.durationUs);
    const frameSource = clip.sourceInUs + sourceOffsetAt(clip, offset);
    const still = structuredClone(clip);
    still.id = p.newClipId;
    still.holdFrame = true;
    still.reverse = false;
    still.speedCurve = null;
    still.sourceInUs = frameSource;
    still.durationUs = Math.max(MIN_CLIP_DURATION_US, p.durationUs);
    still.transitionIn = null;
    still.fadeInUs = 0;
    still.fadeOutUs = 0;
    still.muted = true;
    still.keyframes = {};
    still.effects.forEach((e, i) => (e.id = `${p.newClipId}_e${i}`.slice(0, 64)));
    let insertAt = loc.index + 1;
    if (offset > MIN_CLIP_DURATION_US && clip.durationUs - offset > MIN_CLIP_DURATION_US) {
      const tail = splitClipAt(clip, offset, p.tailClipId);
      loc.track.clips.splice(loc.index + 1, 0, tail);
    } else if (offset <= MIN_CLIP_DURATION_US) {
      insertAt = loc.index;
    }
    if (loc.track.type === "main") {
      loc.track.clips.splice(insertAt, 0, still);
    } else {
      still.startUs = clip.startUs + (insertAt === loc.index ? 0 : clip.durationUs);
      // Push later clips on this track to make room.
      for (const c of loc.track.clips) if (c.startUs >= still.startUs) c.startUs += still.durationUs;
      loc.track.clips.push(still);
      sortTrack(loc.track);
    }
  },

  "timeline/rippleDelete": (d, p) => {
    const seq = getSequence(d, p.sequenceId);
    const s0 = p.startUs;
    const e0 = p.endUs;
    if (e0 - s0 < 1000) fail("Range is too short");
    const gap = e0 - s0;
    let n = 0;
    for (const track of seq.tracks) {
      const out: Clip[] = [];
      for (const clip of track.clips) {
        const cs = clip.startUs;
        const ce = clipEndUs(clip);
        if (ce <= s0) {
          out.push(clip);
          continue;
        }
        if (cs >= e0) {
          if (track.type !== "main") clip.startUs -= gap;
          out.push(clip);
          continue;
        }
        // Overlaps the range: keep the part before and/or after it.
        const keepLeft = s0 - cs >= MIN_CLIP_DURATION_US;
        const keepRight = ce - e0 >= MIN_CLIP_DURATION_US;
        let right: Clip | null = null;
        if (keepRight) {
          right = splitClipAt(clip, e0 - cs, `${p.idSeed}_${n++}`.slice(0, 64));
        }
        if (keepLeft) {
          const tail = splitClipAt(clip, s0 - cs, `${p.idSeed}_${n++}`.slice(0, 64));
          void tail; // the middle part is dropped
          out.push(clip);
        }
        if (right) {
          if (isMediaClip(right)) right.transitionIn = null;
          if (track.type !== "main") right.startUs = s0;
          out.push(right);
        }
      }
      track.clips = out;
    }
    seq.markers = seq.markers
      .filter((m) => m.timeUs < s0 || m.timeUs >= e0)
      .map((m) => (m.timeUs >= e0 ? { ...m, timeUs: m.timeUs - gap } : m));
    for (const t of [...seq.tracks]) dropIfEmpty(seq, t);
  },

  "marker/add": (d, p) => {
    const seq = getSequence(d, p.sequenceId);
    if (seq.markers.some((m) => m.id === p.marker.id)) fail(`Marker id already exists: ${p.marker.id}`);
    seq.markers = [...seq.markers, p.marker].sort((a, b) => a.timeUs - b.timeUs);
  },

  "marker/remove": (d, p) => {
    const seq = getSequence(d, p.sequenceId);
    if (!seq.markers.some((m) => m.id === p.markerId)) fail(`Marker not found: ${p.markerId}`);
    seq.markers = seq.markers.filter((m) => m.id !== p.markerId);
  },

  "marker/setBeats": (d, p) => {
    const seq = getSequence(d, p.sequenceId);
    const beats = [...new Set(p.timesUs)].sort((a, b) => a - b).map((t, i) => ({
      id: `${p.idPrefix}${i}`.slice(0, 64),
      timeUs: t,
      label: "",
      color: "#ffd60a",
      kind: "beat" as const,
    }));
    seq.markers = [...seq.markers.filter((m) => m.kind !== "beat"), ...beats].sort((a, b) => a.timeUs - b.timeUs);
  },

  "session/put": (d, p) => {
    const sessions = d.audioSessions ?? [];
    const i = sessions.findIndex((x) => x.id === p.session.id);
    const next = structuredClone(p.session) as AudioSession;
    if (i >= 0) sessions[i] = next;
    else sessions.push(next);
    d.audioSessions = sessions;
  },

  "session/delete": (d, p) => {
    if (!(d.audioSessions ?? []).some((x) => x.id === p.sessionId)) fail(`Session not found: ${p.sessionId}`);
    d.audioSessions = d.audioSessions.filter((x) => x.id !== p.sessionId);
  },

  "motion/put": (d, p) => {
    const comps = d.motionComps ?? [];
    const i = comps.findIndex((x) => x.id === p.comp.id);
    const next = structuredClone(p.comp) as MotionComp;
    if (i >= 0) comps[i] = next;
    else comps.push(next);
    d.motionComps = comps;
  },

  "motion/delete": (d, p) => {
    if (!(d.motionComps ?? []).some((x) => x.id === p.compId)) fail(`Composition not found: ${p.compId}`);
    d.motionComps = d.motionComps.filter((x) => x.id !== p.compId);
  },

  "font/add": (d, p) => {
    const fonts = d.fonts ?? [];
    const i = fonts.findIndex((f) => f.family === p.font.family);
    if (i >= 0) {
      const merged = [...new Set([...fonts[i]!.weights, ...p.font.weights])].sort((a, b) => a - b);
      fonts[i] = { ...fonts[i]!, weights: merged };
    } else fonts.push(structuredClone(p.font) as ProjectFont);
    d.fonts = fonts;
  },

  "asset/update": (d, p) => {
    const a = d.assets.find((x) => x.id === p.assetId) ?? fail(`Asset not found: ${p.assetId}`);
    Object.assign(a, Object.fromEntries(Object.entries(p.patch).filter(([, v]) => v !== undefined)));
  },

  "internal/restore": (d, p) => {
    if (p.audioSessions !== undefined) d.audioSessions = structuredClone(p.audioSessions) as AudioSession[];
    if (p.fonts !== undefined) d.fonts = structuredClone(p.fonts) as ProjectFont[];
    if (p.motionComps !== undefined) d.motionComps = structuredClone(p.motionComps) as MotionComp[];
    if (p.name !== undefined) d.name = p.name;
    if (p.activeSequenceId !== undefined) d.activeSequenceId = p.activeSequenceId;
    if (p.assets !== undefined) d.assets = structuredClone(p.assets) as Asset[];
    if (p.sequences) {
      for (const [id, value] of Object.entries(p.sequences)) {
        const i = d.sequences.findIndex((s) => s.id === id);
        if (value === null) {
          if (i >= 0) d.sequences.splice(i, 1);
        } else if (i >= 0) {
          d.sequences[i] = structuredClone(value) as Sequence;
        } else {
          d.sequences.push(structuredClone(value) as Sequence);
        }
      }
    }
    if (p.sequenceOrder) {
      const order = p.sequenceOrder;
      d.sequences.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
    }
  },
};

function finalize(draft: Project): void {
  for (const seq of draft.sequences) {
    for (const t of seq.tracks) {
      if (t.type === "main") normalizeMainTrack(t);
      else sortTrack(t);
    }
  }
  // Guarantee a main track exists.
  for (const seq of draft.sequences) getMainTrack(seq);
}

function runOne(draft: Project, command: Command): void {
  if (command.type === "batch") {
    for (const c of command.payload.commands) runOne(draft, c);
    return;
  }
  const schema = CommandPayloads[command.type] as z.ZodType;
  const parsed = schema.safeParse(command.payload);
  if (!parsed.success) {
    fail(`Invalid payload for ${command.type}: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
  }
  const handler = handlers[command.type] as (d: Project, p: unknown) => void;
  handler(draft, parsed.data);
  finalize(draft);
}

/** Build the command that restores `before` from `after`, touching only what changed. */
function buildInverse(before: Project, after: Project): Command {
  const payload: ParsedPayload<"internal/restore"> = {};
  if (before.name !== after.name) payload.name = before.name;
  if (before.activeSequenceId !== after.activeSequenceId) payload.activeSequenceId = before.activeSequenceId;
  if (JSON.stringify(before.assets) !== JSON.stringify(after.assets)) payload.assets = structuredClone(before.assets);
  if (JSON.stringify(before.audioSessions ?? []) !== JSON.stringify(after.audioSessions ?? [])) payload.audioSessions = structuredClone(before.audioSessions ?? []);
  if (JSON.stringify(before.fonts ?? []) !== JSON.stringify(after.fonts ?? [])) payload.fonts = structuredClone(before.fonts ?? []);
  if (JSON.stringify(before.motionComps ?? []) !== JSON.stringify(after.motionComps ?? [])) payload.motionComps = structuredClone(before.motionComps ?? []);
  const seqs: Record<string, Sequence | null> = {};
  let changed = false;
  for (const s of before.sequences) {
    const a = after.sequences.find((x) => x.id === s.id);
    if (!a || JSON.stringify(a) !== JSON.stringify(s)) {
      seqs[s.id] = structuredClone(s);
      changed = true;
    }
  }
  for (const a of after.sequences) {
    if (!before.sequences.some((s) => s.id === a.id)) {
      seqs[a.id] = null;
      changed = true;
    }
  }
  if (changed) payload.sequences = seqs;
  const beforeOrder = before.sequences.map((s) => s.id);
  if (beforeOrder.join() !== after.sequences.map((s) => s.id).join()) payload.sequenceOrder = beforeOrder;
  return { type: "internal/restore", payload };
}

export interface ApplyResult {
  project: Project;
  inverse: Command;
  /** False when the command produced no change. */
  changed: boolean;
}

/**
 * Apply a command to a project. Pure: the input project is not modified.
 * Throws CommandError for invalid commands; the project is then unchanged.
 */
export function applyCommand(project: Project, command: Command, opts: { now?: number } = {}): ApplyResult {
  const draft = structuredClone(project);
  runOne(draft, command);
  const inverse = buildInverse(project, draft);
  const changed = Object.keys(inverse.payload).length > 0;
  if (changed) draft.updatedAt = opts.now ?? Date.now();
  return { project: changed ? draft : project, inverse, changed };
}

/** Human-readable label for history lists. */
export function describeCommand(command: Command): string {
  if (command.type === "batch") return command.payload.label ?? "Multiple edits";
  const labels: Record<string, string> = {
    "project/rename": "Rename project",
    "sequence/update": "Canvas settings",
    "asset/add": "Import media",
    "asset/remove": "Remove media",
    "track/add": "Add track",
    "track/update": "Track settings",
    "track/remove": "Remove track",
    "clip/add": "Add clip",
    "clip/delete": "Delete clip",
    "clip/split": "Split",
    "clip/trim": "Trim",
    "clip/move": "Move clip",
    "clip/update": "Edit clip",
    "clip/setSpeed": "Speed",
    "clip/setTransition": "Transition",
    "clip/addEffect": "Add effect",
    "clip/updateEffect": "Edit effect",
    "clip/removeEffect": "Remove effect",
    "clip/addAudioFx": "Add audio effect",
    "clip/updateAudioFx": "Edit audio effect",
    "clip/removeAudioFx": "Remove audio effect",
    "clip/duplicate": "Duplicate",
    "clip/setSpeedCurve": "Speed ramp",
    "clip/slip": "Slip",
    "clip/roll": "Roll",
    "clip/slide": "Slide",
    "clip/group": "Group",
    "clip/ungroup": "Ungroup",
    "clip/deleteMany": "Delete clips",
    "clip/setKeyframe": "Keyframe",
    "clip/removeKeyframe": "Remove keyframe",
    "clip/clearKeyframes": "Clear keyframes",
    "clip/freeze": "Freeze frame",
    "timeline/rippleDelete": "Cut range",
    "session/put": "Studio edit",
    "session/delete": "Delete session",
    "motion/put": "Motion edit",
    "motion/delete": "Delete composition",
    "font/add": "Add font",
    "asset/update": "Update media",
    "marker/add": "Add marker",
    "marker/remove": "Remove marker",
    "marker/setBeats": "Beat markers",
    "internal/restore": "Restore",
  };
  return labels[command.type] ?? command.type;
}
