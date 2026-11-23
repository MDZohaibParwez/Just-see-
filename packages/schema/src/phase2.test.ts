import { describe, expect, it } from "vitest";
import {
  SPEED_CURVE_PRESETS,
  applyCommand,
  createHistory,
  createMediaClip,
  createProject,
  cubicBezier,
  curveIntegral,
  curveMean,
  execute,
  getMainTrack,
  getSequence,
  parseProject,
  sampleKeyframes,
  secondsToUs,
  sourceSpanUs,
  sourceTimeAt,
  undo,
  type Asset,
  type Command,
  type MediaClip,
  type Project,
} from "./index";

const S = secondsToUs;

function asset(id: string, seconds: number): Asset {
  return {
    id,
    kind: "video",
    name: id,
    mimeType: "video/mp4",
    sizeBytes: 1,
    durationUs: S(seconds),
    width: 1080,
    height: 1920,
    rotation: 0,
    fps: 30,
    hasAudio: true,
    storageKey: id,
    license: { kind: "user-upload", commercialUse: true },
    createdAt: 0,
  };
}

function run(p: Project, ...cmds: Command[]): Project {
  for (const c of cmds) p = applyCommand(p, c).project;
  return p;
}

function oneClip(seconds = 10): Project {
  const a = asset("a", seconds);
  return run(createProject({ id: "p" }), { type: "asset/add", payload: { asset: a } }, { type: "clip/add", payload: { clip: createMediaClip(a, { id: "c" }) } });
}

const main = (p: Project) => getMainTrack(getSequence(p)).clips as MediaClip[];

describe("keyframes", () => {
  it("samples with easing", () => {
    const kfs = [
      { t: 0, v: 0, ease: "linear" as const },
      { t: 1000, v: 10, ease: "hold" as const },
      { t: 2000, v: 20, ease: "linear" as const },
    ];
    expect(sampleKeyframes(kfs, -5, 99)).toBe(0);
    expect(sampleKeyframes(kfs, 500, 99)).toBe(5);
    expect(sampleKeyframes(kfs, 1500, 99)).toBe(10);
    expect(sampleKeyframes(kfs, 5000, 99)).toBe(20);
    expect(sampleKeyframes([], 5, 7)).toBe(7);
  });

  it("evaluates bezier easing", () => {
    expect(cubicBezier(0.42, 0, 0.58, 1, 0.5)).toBeCloseTo(0.5, 3);
    expect(cubicBezier(0.42, 0, 1, 1, 0.5)).toBeLessThan(0.5);
    expect(cubicBezier(0, 0, 0.58, 1, 0.5)).toBeGreaterThan(0.5);
  });

  it("adds, replaces, removes and splits keyframes", () => {
    let p = run(
      oneClip(),
      { type: "clip/setKeyframe", payload: { clipId: "c", prop: "x", t: 0, v: -0.5, ease: "linear" } },
      { type: "clip/setKeyframe", payload: { clipId: "c", prop: "x", t: S(4), v: 0.5, ease: "linear" } },
      { type: "clip/setKeyframe", payload: { clipId: "c", prop: "x", t: S(4), v: 0.3, ease: "linear" } },
    );
    expect(main(p)[0]?.keyframes.x).toHaveLength(2);
    p = run(p, { type: "clip/split", payload: { clipId: "c", atUs: S(2), newClipId: "r" } });
    const [l, r] = main(p);
    // Value at the cut is continuous (-0.5 → 0.3 over 4 s, at 2 s = -0.1).
    expect(sampleKeyframes(l!.keyframes.x, S(2), 0)).toBeCloseTo(-0.1);
    expect(sampleKeyframes(r!.keyframes.x, 0, 0)).toBeCloseTo(-0.1);
    expect(sampleKeyframes(r!.keyframes.x, S(2), 0)).toBeCloseTo(0.3);
    p = run(p, { type: "clip/clearKeyframes", payload: { clipId: "r" } });
    expect(main(p)[1]?.keyframes).toEqual({});
  });

  it("rejects keyframes for missing effects or outside the clip", () => {
    const p = oneClip();
    expect(() => applyCommand(p, { type: "clip/setKeyframe", payload: { clipId: "c", prop: "fx.nope.amount", t: 0, v: 1 } })).toThrow();
    expect(() => applyCommand(p, { type: "clip/setKeyframe", payload: { clipId: "c", prop: "x", t: S(20), v: 1 } })).toThrow();
  });

  it("shifts keyframes when the start is trimmed", () => {
    let p = run(oneClip(), { type: "clip/setKeyframe", payload: { clipId: "c", prop: "opacity", t: S(4), v: 0, ease: "linear" } });
    p = run(p, { type: "clip/trim", payload: { clipId: "c", edge: "start", timeUs: S(1) } });
    const k = main(p)[0]!.keyframes.opacity!;
    expect(k[k.length - 1]!.t).toBe(S(3));
  });
});

describe("reverse", () => {
  it("plays the source backwards and splits correctly", () => {
    let p = run(oneClip(), { type: "clip/update", payload: { clipId: "c", patch: { reverse: true } } });
    const c = main(p)[0]!;
    expect(sourceTimeAt(c, 0)).toBe(S(10));
    expect(sourceTimeAt(c, S(3))).toBe(S(7));
    p = run(p, { type: "clip/split", payload: { clipId: "c", atUs: S(4), newClipId: "r" } });
    const [l, r] = main(p);
    expect(sourceTimeAt(l!, 0)).toBe(S(10));
    expect(sourceTimeAt(l!, S(4) - 1)).toBeCloseTo(S(6), -1);
    expect(sourceTimeAt(r!, r!.startUs)).toBe(S(6));
    expect(sourceTimeAt(r!, r!.startUs + S(6))).toBe(0);
  });
});

describe("speed curves", () => {
  it("integrates piecewise-linear curves", () => {
    const curve = { preset: "x", points: [{ p: 0, s: 1 }, { p: 1, s: 3 }] };
    expect(curveIntegral(curve, 1)).toBeCloseTo(2);
    expect(curveMean(curve)).toBeCloseTo(2);
    expect(curveIntegral(curve, 0.5)).toBeCloseTo(0.75);
  });

  it("keeps the source span when a ramp is applied", () => {
    let p = oneClip(12);
    p = run(p, { type: "clip/setSpeedCurve", payload: { clipId: "c", curve: { preset: "montage", points: SPEED_CURVE_PRESETS.montage! } } });
    const c = main(p)[0]!;
    expect(sourceSpanUs(c)).toBeGreaterThan(S(11.9));
    expect(sourceSpanUs(c)).toBeLessThanOrEqual(S(12) + 10);
    expect(c.durationUs).toBeLessThan(S(12));
    expect(sourceTimeAt(c, c.durationUs)).toBeCloseTo(S(12), -4);
    // Removing the ramp restores the original length.
    p = run(p, { type: "clip/setSpeedCurve", payload: { clipId: "c", curve: null } });
    expect(main(p)[0]!.durationUs).toBeCloseTo(S(12), -4);
  });
});

describe("freeze frame", () => {
  it("inserts a still in the middle of a clip", () => {
    const p = run(oneClip(), { type: "clip/freeze", payload: { clipId: "c", atUs: S(4), newClipId: "f", tailClipId: "t", durationUs: S(2) } });
    const clips = main(p);
    expect(clips.map((c) => c.id)).toEqual(["c", "f", "t"]);
    expect(clips[1]).toMatchObject({ holdFrame: true, sourceInUs: S(4), durationUs: S(2), startUs: S(4) });
    expect(clips[2]).toMatchObject({ startUs: S(6), sourceInUs: S(4) });
    expect(sourceTimeAt(clips[1]!, S(5))).toBe(S(4));
    expect(() => applyCommand(p, { type: "clip/setSpeed", payload: { clipId: "f", speed: 2 } })).toThrow();
  });

  it("is undoable", () => {
    let h = createHistory(oneClip());
    h = execute(h, { type: "clip/freeze", payload: { clipId: "c", atUs: S(4), newClipId: "f", tailClipId: "t", durationUs: S(2) } });
    h = undo(h);
    expect(main(h.project)).toHaveLength(1);
  });
});

describe("crop, blend and background", () => {
  it("updates crop and blend mode", () => {
    const p = run(oneClip(), { type: "clip/update", payload: { clipId: "c", patch: { crop: { left: 0.1 }, blendMode: "screen" } } });
    expect(main(p)[0]).toMatchObject({ crop: { left: 0.1, top: 0, right: 0, bottom: 0 }, blendMode: "screen" });
  });

  it("sets a blur background", () => {
    const p = run(oneClip(), { type: "sequence/update", payload: { background: { kind: "blur", color: "#000000", blur: 0.8, assetId: null } } });
    expect(getSequence(p).background.kind).toBe("blur");
  });
});

describe("migration", () => {
  it("loads a Phase 1 project without the new fields", () => {
    const p = oneClip();
    const old = JSON.parse(JSON.stringify(p)) as Record<string, unknown>;
    const seq = (old.sequences as Record<string, unknown>[])[0]!;
    seq.background = { kind: "color", color: "#000000" };
    const clip = ((seq.tracks as Record<string, unknown>[])[0]!.clips as Record<string, unknown>[])[0]!;
    for (const k of ["crop", "blendMode", "keyframes", "reverse", "holdFrame", "speedCurve"]) delete clip[k];
    const parsed = parseProject(old);
    expect(main(parsed)[0]).toMatchObject({ blendMode: "normal", reverse: false, holdFrame: false, speedCurve: null, keyframes: {} });
    expect(getSequence(parsed).background).toMatchObject({ kind: "color", blur: 0.6, assetId: null });
  });
});
