import { describe, expect, it } from "vitest";
import { applyCommand, createMediaClip, createProject, secondsToUs, type Asset, type Command, type Project } from "@just-see/schema";
import { mixSegments, resolveAudio, resolveFrame, type Pcm } from "./index";

const S = secondsToUs;

function asset(id: string, seconds: number): Asset {
  return {
    id,
    kind: "video",
    name: id,
    mimeType: "video/mp4",
    sizeBytes: 1,
    durationUs: S(seconds),
    width: 1920,
    height: 1080,
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

function one(): Project {
  const a = asset("a", 10);
  return run(createProject({ id: "p" }), { type: "asset/add", payload: { asset: a } }, { type: "clip/add", payload: { clip: createMediaClip(a, { id: "c" }) } });
}

describe("phase 2 rendering", () => {
  it("applies keyframed position and effect params", () => {
    let p = run(
      one(),
      { type: "clip/addEffect", payload: { clipId: "c", effect: { id: "e", type: "blur", enabled: true, params: { radius: 0 } } } },
      { type: "clip/setKeyframe", payload: { clipId: "c", prop: "x", t: 0, v: 0, ease: "linear" } },
      { type: "clip/setKeyframe", payload: { clipId: "c", prop: "x", t: S(2), v: 0.5, ease: "linear" } },
      { type: "clip/setKeyframe", payload: { clipId: "c", prop: "fx.e.radius", t: 0, v: 0, ease: "linear" } },
      { type: "clip/setKeyframe", payload: { clipId: "c", prop: "fx.e.radius", t: S(2), v: 1, ease: "linear" } },
    );
    const l = resolveFrame(p, S(1)).layers[0];
    expect(l?.kind).toBe("visual");
    if (l?.kind === "visual") {
      expect(l.transform.x).toBeCloseTo(0.25);
      expect(l.effects[0]?.params.radius).toBeCloseTo(0.5);
    }
    p = run(p, { type: "clip/update", payload: { clipId: "c", patch: { blendMode: "screen", crop: { left: 0.2 } } } });
    const l2 = resolveFrame(p, S(1)).layers[0];
    if (l2?.kind === "visual") {
      expect(l2.blendMode).toBe("screen");
      expect(l2.crop.left).toBe(0.2);
    }
  });

  it("adds a blurred cover background", () => {
    const p = run(one(), { type: "sequence/update", payload: { background: { kind: "blur", color: "#000000", blur: 0.5, assetId: null } } });
    const plan = resolveFrame(p, S(1));
    expect(plan.layers).toHaveLength(2);
    const bg = plan.layers[0];
    if (bg?.kind === "visual") {
      expect(bg.trackId).toBe("background");
      expect(bg.effects.some((e) => e.type === "blur")).toBe(true);
      // Landscape into portrait: cover scale much larger than fit.
      expect(bg.transform.scale).toBeGreaterThan(3);
      if (bg.source.kind !== "text") expect(bg.source.clipId).toBe("c");
    }
  });

  it("reverses source time for video and audio", () => {
    const p = run(one(), { type: "clip/update", payload: { clipId: "c", patch: { reverse: true } } });
    const l = resolveFrame(p, S(1)).layers[0];
    if (l?.kind === "visual" && l.source.kind !== "text" && l.source.kind !== "motion") expect(l.source.sourceTimeUs).toBe(S(9));
    const segs = resolveAudio(p);
    const sr = 1000;
    const ramp = new Float32Array(10_000).map((_, i) => i / 10_000);
    const pcm: Pcm = { sampleRate: sr, channels: [ramp], startUs: 0 };
    const [left] = mixSegments(segs, new Map([["c", pcm]]), S(10), sr);
    // At 1 s the reversed clip plays source 9 s → ramp ≈ 0.9.
    expect(left[1000]).toBeCloseTo(0.9, 2);
  });

  it("uses volume keyframes in the mix", () => {
    const p = run(
      one(),
      { type: "clip/setKeyframe", payload: { clipId: "c", prop: "volume", t: 0, v: 0, ease: "linear" } },
      { type: "clip/setKeyframe", payload: { clipId: "c", prop: "volume", t: S(2), v: 1, ease: "linear" } },
    );
    const segs = resolveAudio(p);
    const pcm: Pcm = { sampleRate: 1000, channels: [new Float32Array(10_000).fill(0.5)], startUs: 0 };
    const [left] = mixSegments(segs, new Map([["c", pcm]]), S(10), 1000);
    expect(left[1000]).toBeCloseTo(0.25, 2);
    expect(left[3000]).toBeCloseTo(0.5, 2);
  });

  it("freeze frames show one source frame and are silent", () => {
    const p = run(one(), { type: "clip/freeze", payload: { clipId: "c", atUs: S(3), newClipId: "f", tailClipId: "t", durationUs: S(2) } });
    const a = resolveFrame(p, S(3.5)).layers[0];
    const b = resolveFrame(p, S(4.5)).layers[0];
    if (a?.kind === "visual" && b?.kind === "visual" && a.source.kind !== "text" && b.source.kind !== "text" && a.source.kind !== "motion" && b.source.kind !== "motion") {
      expect(a.source.sourceTimeUs).toBe(S(3));
      expect(b.source.sourceTimeUs).toBe(S(3));
    }
    expect(resolveAudio(p).some((s) => s.clipId === "f")).toBe(false);
  });
});
