import { z } from "zod";
import {
  AssetSchema,
  BackgroundSchema,
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
  sourceSpanUs,
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
    }),
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
  "clip/duplicate": z.object({ clipId: IdSchema, newClipId: IdSchema, newTrackId: IdSchema.optional() }),
  "internal/restore": z.object({
    name: z.string().optional(),
    activeSequenceId: z.string().optional(),
    assets: z.array(AssetSchema).optional(),
    sequenceOrder: z.array(IdSchema).optional(),
    sequences: z.record(z.string(), SequenceSchema.nullable()).optional(),
  }),
} as const;

export type CommandType = keyof typeof CommandPayloads | "batch";
export type PayloadOf<T extends keyof typeof CommandPayloads> = z.infer<(typeof CommandPayloads)[T]>;

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

function dropIfEmpty(seq: Sequence, track: Track): void {
  if (track.type !== "main" && track.clips.length === 0) seq.tracks = seq.tracks.filter((t) => t !== track);
}

type Handler<K extends keyof typeof CommandPayloads> = (draft: Project, payload: PayloadOf<K>) => void;

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
    const clip = loc.clip;
    if (findClip(d, p.newClipId)) fail(`Clip id already exists: ${p.newClipId}`);
    const offset = p.atUs - clip.startUs;
    if (offset < MIN_CLIP_DURATION_US || clip.durationUs - offset < MIN_CLIP_DURATION_US) {
      fail("Split point is too close to the clip edge");
    }
    const right = structuredClone(clip);
    right.id = p.newClipId;
    right.startUs = p.atUs;
    right.durationUs = clip.durationUs - offset;
    clip.durationUs = offset;
    if (isMediaClip(right) && isMediaClip(clip)) {
      right.sourceInUs = clip.sourceInUs + Math.round(offset * clip.speed);
      right.transitionIn = null;
      right.fadeInUs = 0;
      clip.fadeOutUs = 0;
    }
    for (const e of right.effects) e.id = `${e.id}_${p.newClipId}`.slice(0, 64);
    loc.track.clips.splice(loc.index + 1, 0, right);
  },

  "clip/trim": (d, p) => {
    const loc = requireClip(d, p.clipId);
    const clip = loc.clip;
    if (p.edge === "end") {
      clip.durationUs = p.timeUs - clip.startUs;
      clampMediaClip(d, clip);
      if (loc.track.type !== "main") {
        // Do not run into the next clip.
        const next = loc.track.clips.find((c) => c.id !== clip.id && c.startUs >= clip.startUs);
        if (next) clip.durationUs = Math.min(clip.durationUs, next.startUs - clip.startUs);
      }
      return;
    }
    // Start edge.
    let delta = p.timeUs - clip.startUs;
    const end = clipEndUs(clip);
    delta = Math.min(delta, clip.durationUs - MIN_CLIP_DURATION_US);
    if (isMediaClip(clip) && clip.kind !== "image") {
      // Cannot extend before the start of the source.
      delta = Math.max(delta, -Math.floor(clip.sourceInUs / clip.speed));
    }
    if (loc.track.type !== "main") {
      delta = Math.max(delta, -clip.startUs);
      const prev = [...loc.track.clips].reverse().find((c) => c.id !== clip.id && clipEndUs(c) <= clip.startUs);
      if (prev) delta = Math.max(delta, clipEndUs(prev) - clip.startUs);
    }
    if (isMediaClip(clip) && clip.kind !== "image") {
      clip.sourceInUs = Math.max(0, clip.sourceInUs + Math.round(delta * clip.speed));
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
    loc.track.clips.splice(loc.index, 1);
    clip.startUs = p.startUs;
    if (isMediaClip(clip)) clip.transitionIn = null;
    placeOnFreeTrack(seq, target, clip, p.newTrackId);
    if (loc.track !== target) dropIfEmpty(seq, loc.track);
  },

  "clip/update": (d, p) => {
    const { clip } = requireClip(d, p.clipId);
    const patch = p.patch;
    if (patch.transform) clip.transform = { ...clip.transform, ...patch.transform };
    if (patch.durationUs !== undefined) clip.durationUs = patch.durationUs;
    if (isMediaClip(clip)) {
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
    }
    clampMediaClip(d, clip);
  },

  "clip/setSpeed": (d, p) => {
    const { clip } = requireClip(d, p.clipId);
    if (!isMediaClip(clip) || clip.kind === "image") fail("Only video and audio clips have speed");
    const span = sourceSpanUs(clip);
    clip.speed = p.speed;
    clip.durationUs = Math.round(span / p.speed);
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

  "internal/restore": (d, p) => {
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
  const payload: PayloadOf<"internal/restore"> = {};
  if (before.name !== after.name) payload.name = before.name;
  if (before.activeSequenceId !== after.activeSequenceId) payload.activeSequenceId = before.activeSequenceId;
  if (JSON.stringify(before.assets) !== JSON.stringify(after.assets)) payload.assets = structuredClone(before.assets);
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
    "clip/duplicate": "Duplicate",
    "internal/restore": "Restore",
  };
  return labels[command.type] ?? command.type;
}
