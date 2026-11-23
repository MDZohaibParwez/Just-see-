import { describe, expect, it } from "vitest";
import {
  applyCommand,
  createMediaClip,
  createProject,
  createTextClip,
  secondsToUs,
  type Asset,
  type Command,
  type Project,
} from "@just-see/schema";
import {
  EFFECTS,
  TRANSITIONS,
  apply,
  avcLevel,
  computePeaks,
  defaultParams,
  exportSizes,
  hitTest,
  mixSegments,
  placementMatrix,
  resolveAudio,
  resolveFrame,
  resolveParams,
  rotationFromMatrix,
  segmentGainAt,
  textAnimState,
  uvRotationMatrix,
  videoCodecCandidates,
  visibleLines,
  hexToRgba,
  type Pcm,
} from "./index";

const S = secondsToUs;

function asset(id: string, kind: Asset["kind"], seconds: number, w = 1080, h = 1920): Asset {
  return {
    id,
    kind,
    name: id,
    mimeType: kind === "audio" ? "audio/mpeg" : kind === "image" ? "image/png" : "video/mp4",
    sizeBytes: 1,
    durationUs: kind === "image" ? 0 : S(seconds),
    width: kind === "audio" ? 0 : w,
    height: kind === "audio" ? 0 : h,
    rotation: 0,
    fps: 30,
    hasAudio: kind !== "image",
    storageKey: id,
    license: { kind: "user-upload", commercialUse: true },
    createdAt: 0,
  };
}

function run(p: Project, ...cmds: Command[]): Project {
  for (const c of cmds) p = applyCommand(p, c).project;
  return p;
}

function reel(): Project {
  let p = createProject({ id: "p" });
  const a = asset("a", "video", 4);
  const b = asset("b", "video", 4);
  p = run(
    p,
    { type: "asset/add", payload: { asset: a } },
    { type: "asset/add", payload: { asset: b } },
    { type: "clip/add", payload: { clip: createMediaClip(a, { id: "ca" }) } },
    { type: "clip/add", payload: { clip: createMediaClip(b, { id: "cb" }) } },
    { type: "clip/setTransition", payload: { clipId: "cb", transition: { type: "crossfade", durationUs: S(1) } } },
    { type: "clip/add", payload: { clip: createTextClip({ id: "t", startUs: S(1), durationUs: S(2) }), newTrackId: "tt" } },
  );
  return p;
}

describe("resolveFrame", () => {
  it("shows the main clip with the right source time", () => {
    const plan = resolveFrame(reel(), S(0.5));
    expect(plan.layers).toHaveLength(1);
    const l = plan.layers[0];
    expect(l?.kind).toBe("visual");
    if (l?.kind === "visual" && l.source.kind !== "text") expect(l.source.sourceTimeUs).toBe(S(0.5));
  });

  it("builds a transition layer during the overlap", () => {
    const plan = resolveFrame(reel(), S(3.5));
    const tr = plan.layers.find((l) => l.kind === "transition");
    expect(tr?.kind).toBe("transition");
    if (tr?.kind === "transition") {
      expect(tr.progress).toBeCloseTo(0.5, 5);
      expect(tr.from.clipId).toBe("ca");
      expect(tr.to.clipId).toBe("cb");
      if (tr.to.source.kind !== "text") expect(tr.to.source.sourceTimeUs).toBe(S(0.5));
    }
  });

  it("stacks text above video and respects hidden tracks", () => {
    let p = reel();
    let plan = resolveFrame(p, S(2));
    expect(plan.layers.map((l) => (l.kind === "visual" ? l.source.kind : "transition"))).toEqual(["video", "text"]);
    p = run(p, { type: "track/update", payload: { trackId: "tt", hidden: true } });
    plan = resolveFrame(p, S(2));
    expect(plan.layers).toHaveLength(1);
  });

  it("applies speed to source time", () => {
    let p = reel();
    p = run(p, { type: "clip/setSpeed", payload: { clipId: "ca", speed: 2 } });
    const l = resolveFrame(p, S(1)).layers[0];
    if (l?.kind === "visual" && l.source.kind !== "text") expect(l.source.sourceTimeUs).toBe(S(2));
  });

  it("is empty past the end", () => {
    expect(resolveFrame(reel(), S(60)).layers).toHaveLength(0);
  });
});

describe("text animation", () => {
  it("fades in and out", () => {
    const clip = createTextClip({ durationUs: S(2) });
    expect(textAnimState(clip, 0).opacity).toBe(0);
    expect(textAnimState(clip, S(1)).opacity).toBe(1);
    expect(textAnimState(clip, S(2)).opacity).toBe(0);
  });

  it("typewriter reveals graphemes", () => {
    const clip = { ...createTextClip({ durationUs: S(4) }), animationIn: "typewriter" as const, animationOut: "none" as const, animationDurationUs: S(1) };
    expect(textAnimState(clip, S(0.5)).visible).toBeCloseTo(0.5);
    // Devanagari conjuncts stay whole.
    expect(visibleLines("नमस्ते", 1)).toEqual(["नमस्ते"]);
    expect(visibleLines("a\nb", 1)).toEqual(["a", "b"]);
  });

  it("converts colours", () => {
    expect(hexToRgba("#ff0080", 0.5)).toBe("rgba(255,0,128,0.5)");
    expect(hexToRgba("#fff")).toBe("rgba(255,255,255,1)");
  });
});

describe("audio", () => {
  it("includes video audio and music, with transition crossfades", () => {
    let p = reel();
    const m = asset("m", "audio", 30);
    p = run(
      p,
      { type: "asset/add", payload: { asset: m } },
      { type: "clip/add", payload: { clip: createMediaClip(m, { id: "cm", durationUs: S(7) }), newTrackId: "at" } },
    );
    const segs = resolveAudio(p);
    expect(segs.map((s) => s.clipId).sort()).toEqual(["ca", "cb", "cm"]);
    const ca = segs.find((s) => s.clipId === "ca")!;
    const cb = segs.find((s) => s.clipId === "cb")!;
    expect(ca.fadeOutUs).toBe(S(1));
    expect(cb.fadeInUs).toBe(S(1));
    expect(segmentGainAt(cb, cb.timelineStartUs + S(0.5))).toBeCloseTo(0.5);
  });

  it("mixes with gain, offset and speed", () => {
    const sr = 1000;
    const ramp = new Float32Array(10_000).map((_, i) => i / 10_000);
    const pcm: Pcm = { sampleRate: sr, channels: [ramp], startUs: 0 };
    const seg = { clipId: "c", assetId: "a", timelineStartUs: S(1), durationUs: S(1), sourceInUs: S(2), speed: 2, gain: 0.5, fadeInUs: 0, fadeOutUs: 0 };
    const [l, r] = mixSegments([seg], new Map([["c", pcm]]), S(3), sr);
    expect(l.length).toBe(3000);
    expect(l[500]).toBe(0);
    // At timeline 1.5 s: source = 2 + 0.5*2 = 3 s → ramp 0.3, gain 0.5.
    expect(l[1500]).toBeCloseTo(0.15, 3);
    expect(r[1500]).toBeCloseTo(0.15, 3);
    expect(l[2500]).toBe(0);
  });

  it("computes peaks", () => {
    const peaks = computePeaks(new Float32Array([0.1, -0.5, 0.9, 0.2]), 2);
    expect(Array.from(peaks)).toEqual([expect.closeTo(-0.5), expect.closeTo(0.1), 0, expect.closeTo(0.9)]);
  });
});

describe("layout", () => {
  it("fits landscape media inside a portrait canvas", () => {
    const m = placementMatrix({ x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, flipH: false, flipV: false }, 1920, 1080, 1080, 1920);
    expect(apply(m, -0.5, -0.5)).toEqual([0, expect.closeTo(960 - 303.75)]);
    expect(apply(m, 0.5, 0.5)).toEqual([1080, expect.closeTo(960 + 303.75)]);
    expect(hitTest(m, 540, 960)).toBe(true);
    expect(hitTest(m, 540, 100)).toBe(false);
  });

  it("moves, scales and rotates around the centre", () => {
    const m = placementMatrix({ x: 0.25, y: 0, scale: 0.5, rotation: 90, opacity: 1, flipH: false, flipV: false }, 100, 100, 1000, 1000);
    const [x, y] = apply(m, 0.5, 0);
    expect(x).toBeCloseTo(750);
    expect(y).toBeCloseTo(750);
  });

  it("maps display UV to stored UV for rotated video", () => {
    const m = uvRotationMatrix(90);
    const [u, v] = apply(m, 0, 0);
    expect(u).toBeCloseTo(0);
    expect(v).toBeCloseTo(1);
  });

  it("reads rotation from display matrices", () => {
    expect(rotationFromMatrix([0, 65536, 0, -65536, 0, 0, 0, 0, 1073741824])).toBe(90);
    expect(rotationFromMatrix([0, -65536, 0, 65536, 0, 0, 0, 0, 1073741824])).toBe(270);
    expect(rotationFromMatrix([65536, 0, 0, 0, 65536, 0, 0, 0, 1073741824])).toBe(0);
  });
});

describe("catalogs", () => {
  it("has 150+ effects and 80+ transitions with unique ids", () => {
    expect(EFFECTS.length).toBeGreaterThanOrEqual(150);
    expect(TRANSITIONS.length).toBeGreaterThanOrEqual(80);
    expect(new Set(EFFECTS.map((e) => e.type)).size).toBe(EFFECTS.length);
    expect(new Set(TRANSITIONS.map((t) => t.type)).size).toBe(TRANSITIONS.length);
  });

  it("has defaults inside each param range", () => {
    for (const e of EFFECTS) {
      for (const prm of e.params) {
        expect(prm.default, `${e.type}.${prm.key}`).toBeGreaterThanOrEqual(prm.min);
        expect(prm.default, `${e.type}.${prm.key}`).toBeLessThanOrEqual(prm.max);
      }
      expect(e.glsl).toContain("vec4 effect(vec2 uv)");
    }
    for (const t of TRANSITIONS) expect(t.glsl).toContain("vec4 transition(vec2 uv)");
  });

  it("clamps params and fills defaults", () => {
    const blur = EFFECTS.find((e) => e.type === "blur")!;
    expect(resolveParams(blur, { radius: 5 })).toEqual({ radius: 1 });
    expect(resolveParams(blur, {})).toEqual(defaultParams(blur));
  });
});

describe("export settings", () => {
  it("picks an H.264 level that fits", () => {
    expect(avcLevel(1080, 1920, 30)).toBe("28");
    expect(avcLevel(1080, 1920, 60)).toBe("2a");
    expect(avcLevel(2160, 3840, 30)).toBe("33");
    expect(videoCodecCandidates(1080, 1920, 30)[0]?.codec).toBe("avc1.640028");
  });

  it("offers even export sizes", () => {
    const sizes = exportSizes(1080, 1920);
    expect(sizes.find((s) => s.label === "720p")).toEqual({ label: "720p", width: 720, height: 1280 });
    expect(sizes.find((s) => s.label === "4K")).toEqual({ label: "4K", width: 2160, height: 3840 });
  });
});
