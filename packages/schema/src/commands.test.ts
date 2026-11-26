import { describe, expect, it } from "vitest";
import {
  CommandError,
  applyCommand,
  canRedo,
  canUndo,
  createHistory,
  createMediaClip,
  createProject,
  createTextClip,
  execute,
  getMainTrack,
  getSequence,
  parseProject,
  redo,
  secondsToUs,
  sequenceDurationUs,
  undo,
  type Asset,
  type Command,
  type MediaClip,
  type Project,
} from "./index";

const S = secondsToUs;

function videoAsset(id: string, seconds: number): Asset {
  return {
    id,
    kind: "video",
    name: `${id}.mp4`,
    mimeType: "video/mp4",
    sizeBytes: 1000,
    durationUs: S(seconds),
    width: 1080,
    height: 1920,
    rotation: 0,
    fps: 30,
    hasAudio: true,
    storageKey: `media/${id}`,
    license: { kind: "user-upload", commercialUse: true },
    createdAt: 0,
  };
}

function audioAsset(id: string, seconds: number): Asset {
  return { ...videoAsset(id, seconds), kind: "audio", mimeType: "audio/mpeg", width: 0, height: 0, fps: 0 };
}

function run(project: Project, ...commands: Command[]): Project {
  let p = project;
  for (const c of commands) p = applyCommand(p, c, { now: 1 }).project;
  return p;
}

function withClips(seconds: number[]): Project {
  let p = createProject({ id: "p1", now: 0 });
  seconds.forEach((s, i) => {
    const asset = videoAsset(`a${i}`, s);
    p = run(
      p,
      { type: "asset/add", payload: { asset } },
      { type: "clip/add", payload: { clip: createMediaClip(asset, { id: `c${i}` }) } },
    );
  });
  return p;
}

function main(p: Project): MediaClip[] {
  return getMainTrack(getSequence(p)).clips as MediaClip[];
}

describe("clip/add", () => {
  it("places media back to back on the magnetic main track", () => {
    const p = withClips([5, 3, 4]);
    expect(main(p).map((c) => [c.startUs, c.durationUs])).toEqual([
      [0, S(5)],
      [S(5), S(3)],
      [S(8), S(4)],
    ]);
    expect(sequenceDurationUs(getSequence(p))).toBe(S(12));
  });

  it("inserts at an index", () => {
    let p = withClips([5, 3]);
    const asset = videoAsset("x", 2);
    p = run(
      p,
      { type: "asset/add", payload: { asset } },
      { type: "clip/add", payload: { clip: createMediaClip(asset, { id: "cx" }), index: 1 } },
    );
    expect(main(p).map((c) => c.id)).toEqual(["c0", "cx", "c1"]);
    expect(main(p)[2]?.startUs).toBe(S(7));
  });

  it("rejects a clip for a missing asset and leaves the project untouched", () => {
    const p = withClips([5]);
    const ghost = createMediaClip(videoAsset("ghost", 1), { id: "g" });
    expect(() => applyCommand(p, { type: "clip/add", payload: { clip: ghost } })).toThrow(CommandError);
    expect(main(p)).toHaveLength(1);
  });

  it("puts text on a text track and moves overlapping text to a new track", () => {
    let p = withClips([10]);
    p = run(
      p,
      { type: "clip/add", payload: { clip: createTextClip({ id: "t1", startUs: 0 }), newTrackId: "tt1" } },
      { type: "clip/add", payload: { clip: createTextClip({ id: "t2", startUs: S(1) }), newTrackId: "tt2" } },
    );
    const textTracks = getSequence(p).tracks.filter((t) => t.type === "text");
    expect(textTracks.map((t) => t.clips.map((c) => c.id))).toEqual([["t1"], ["t2"]]);
  });

  it("caps duration at the source length", () => {
    let p = createProject({ id: "p" });
    const asset = videoAsset("a", 4);
    p = run(
      p,
      { type: "asset/add", payload: { asset } },
      { type: "clip/add", payload: { clip: createMediaClip(asset, { id: "c", durationUs: S(10) }) } },
    );
    expect(main(p)[0]?.durationUs).toBe(S(4));
  });
});

describe("clip/split", () => {
  it("splits into two clips that continue the source", () => {
    const p = run(withClips([10]), { type: "clip/split", payload: { clipId: "c0", atUs: S(4), newClipId: "c0b" } });
    const [a, b] = main(p);
    expect(a).toMatchObject({ startUs: 0, durationUs: S(4), sourceInUs: 0 });
    expect(b).toMatchObject({ id: "c0b", startUs: S(4), durationUs: S(6), sourceInUs: S(4) });
  });

  it("accounts for speed when computing the source in-point", () => {
    let p = withClips([10]);
    p = run(p, { type: "clip/setSpeed", payload: { clipId: "c0", speed: 2 } });
    expect(main(p)[0]?.durationUs).toBe(S(5));
    p = run(p, { type: "clip/split", payload: { clipId: "c0", atUs: S(2), newClipId: "n" } });
    expect(main(p)[1]).toMatchObject({ startUs: S(2), durationUs: S(3), sourceInUs: S(4) });
  });

  it("refuses to split at the edge", () => {
    expect(() =>
      applyCommand(withClips([10]), { type: "clip/split", payload: { clipId: "c0", atUs: 10, newClipId: "n" } }),
    ).toThrow(/too close/);
  });
});

describe("clip/trim", () => {
  it("trims the end and ripples the main track", () => {
    const p = run(withClips([5, 5]), { type: "clip/trim", payload: { clipId: "c0", edge: "end", timeUs: S(3) } });
    expect(main(p).map((c) => [c.startUs, c.durationUs])).toEqual([
      [0, S(3)],
      [S(3), S(5)],
    ]);
  });

  it("trims the start by moving the source in-point", () => {
    const p = run(withClips([5, 5]), { type: "clip/trim", payload: { clipId: "c1", edge: "start", timeUs: S(6) } });
    expect(main(p)[1]).toMatchObject({ startUs: S(5), durationUs: S(4), sourceInUs: S(1) });
  });

  it("cannot extend past the source", () => {
    let p = run(withClips([5]), { type: "clip/trim", payload: { clipId: "c0", edge: "end", timeUs: S(20) } });
    expect(main(p)[0]?.durationUs).toBe(S(5));
    p = run(p, { type: "clip/trim", payload: { clipId: "c0", edge: "start", timeUs: -S(3) } });
    expect(main(p)[0]).toMatchObject({ sourceInUs: 0, durationUs: S(5) });
  });

  it("keeps a minimum length", () => {
    const p = run(withClips([5]), { type: "clip/trim", payload: { clipId: "c0", edge: "start", timeUs: S(5) } });
    expect(main(p)[0]?.durationUs).toBe(100_000);
  });
});

describe("clip/delete and clip/move", () => {
  it("ripple-deletes on the main track", () => {
    const p = run(withClips([2, 3, 4]), { type: "clip/delete", payload: { clipId: "c1" } });
    expect(main(p).map((c) => [c.id, c.startUs])).toEqual([
      ["c0", 0],
      ["c2", S(2)],
    ]);
  });

  it("reorders on the main track by drop time", () => {
    const start = withClips([2, 3, 4]);
    const p = run(start, {
      type: "clip/move",
      payload: { clipId: "c0", trackId: getMainTrack(getSequence(start)).id, startUs: S(8) },
    });
    expect(main(p).map((c) => c.id)).toEqual(["c1", "c2", "c0"]);
  });

  it("moves text freely and removes an emptied track", () => {
    let p = run(withClips([10]), {
      type: "clip/add",
      payload: { clip: createTextClip({ id: "t1" }), newTrackId: "tt" },
    });
    p = run(p, { type: "clip/move", payload: { clipId: "t1", trackId: "tt", startUs: S(4) } });
    expect(getSequence(p).tracks.find((t) => t.id === "tt")?.clips[0]?.startUs).toBe(S(4));
    p = run(p, { type: "clip/delete", payload: { clipId: "t1" } });
    expect(getSequence(p).tracks.some((t) => t.id === "tt")).toBe(false);
  });
});

describe("transitions", () => {
  it("overlaps neighbours by the transition length", () => {
    const p = run(withClips([4, 4]), {
      type: "clip/setTransition",
      payload: { clipId: "c1", transition: { type: "crossfade", durationUs: S(1) } },
    });
    expect(main(p)[1]?.startUs).toBe(S(3));
    expect(sequenceDurationUs(getSequence(p))).toBe(S(7));
  });

  it("clamps to half the shorter clip and drops on the first clip", () => {
    let p = run(withClips([2, 6]), {
      type: "clip/setTransition",
      payload: { clipId: "c1", transition: { type: "crossfade", durationUs: S(5) } },
    });
    expect(main(p)[1]?.transitionIn?.durationUs).toBe(S(1));
    p = run(p, { type: "clip/delete", payload: { clipId: "c0" } });
    expect(main(p)[0]?.transitionIn).toBeNull();
    expect(() =>
      applyCommand(p, { type: "clip/setTransition", payload: { clipId: "c1", transition: { type: "x", durationUs: S(1) } } }),
    ).toThrow();
  });
});

describe("effects", () => {
  it("adds, updates and removes effects", () => {
    let p = run(withClips([3]), {
      type: "clip/addEffect",
      payload: { clipId: "c0", effect: { id: "e1", type: "blur", enabled: true, params: { amount: 0.5 } } },
    });
    p = run(p, { type: "clip/updateEffect", payload: { clipId: "c0", effectId: "e1", params: { amount: 0.8 } } });
    expect(main(p)[0]?.effects[0]?.params.amount).toBe(0.8);
    p = run(p, { type: "clip/removeEffect", payload: { clipId: "c0", effectId: "e1" } });
    expect(main(p)[0]?.effects).toHaveLength(0);
  });
});

describe("audio", () => {
  it("places music on an audio track", () => {
    let p = withClips([10]);
    const music = audioAsset("m", 120);
    p = run(
      p,
      { type: "asset/add", payload: { asset: music } },
      { type: "clip/add", payload: { clip: createMediaClip(music, { id: "mc", durationUs: S(10) }), newTrackId: "at" } },
    );
    const at = getSequence(p).tracks.find((t) => t.type === "audio");
    expect(at?.clips[0]).toMatchObject({ id: "mc", durationUs: S(10) });
  });
});

describe("history", () => {
  it("undoes and redoes any sequence of commands exactly", () => {
    const start = withClips([5, 5, 5]);
    const commands: Command[] = [
      { type: "clip/split", payload: { clipId: "c1", atUs: S(7), newClipId: "s1" } },
      { type: "clip/setSpeed", payload: { clipId: "c0", speed: 0.5 } },
      { type: "clip/setTransition", payload: { clipId: "c2", transition: { type: "crossfade", durationUs: S(1) } } },
      { type: "clip/addEffect", payload: { clipId: "c2", effect: { id: "e", type: "glow", enabled: true, params: {} } } },
      { type: "clip/add", payload: { clip: createTextClip({ id: "t" }), newTrackId: "tt" } },
      { type: "clip/delete", payload: { clipId: "c0" } },
      { type: "project/rename", payload: { name: "Reel" } },
      { type: "sequence/update", payload: { width: 1080, height: 1080 } },
    ];
    let h = createHistory(start);
    const snapshots = [h.project];
    for (const c of commands) {
      h = execute(h, c, 1);
      snapshots.push(h.project);
    }
    for (let i = commands.length - 1; i >= 0; i--) {
      h = undo(h, 1);
      expect(strip(h.project)).toEqual(strip(snapshots[i]!));
    }
    expect(canUndo(h)).toBe(false);
    for (let i = 1; i <= commands.length; i++) {
      h = redo(h, 1);
      expect(strip(h.project)).toEqual(strip(snapshots[i]!));
    }
    expect(canRedo(h)).toBe(false);
  });

  it("clears redo after a new edit", () => {
    let h = createHistory(withClips([5]));
    h = execute(h, { type: "project/rename", payload: { name: "A" } });
    h = undo(h);
    h = execute(h, { type: "project/rename", payload: { name: "B" } });
    expect(canRedo(h)).toBe(false);
  });

  it("does not record no-op commands", () => {
    const p = withClips([5]);
    const h = execute(createHistory(p), { type: "project/rename", payload: { name: p.name } });
    expect(h.past).toHaveLength(0);
  });

  it("batches several commands into one undo step", () => {
    let h = createHistory(withClips([10]));
    h = execute(h, {
      type: "batch",
      payload: {
        label: "Split twice",
        commands: [
          { type: "clip/split", payload: { clipId: "c0", atUs: S(3), newClipId: "x" } },
          { type: "clip/split", payload: { clipId: "x", atUs: S(6), newClipId: "y" } },
        ],
      },
    });
    expect(main(h.project)).toHaveLength(3);
    h = undo(h);
    expect(main(h.project)).toHaveLength(1);
  });
});

describe("validation", () => {
  it("round-trips through the Zod schema", () => {
    let p = withClips([3, 4]);
    p = run(p, { type: "clip/add", payload: { clip: createTextClip({ id: "t" }), newTrackId: "tt" } });
    const parsed = parseProject(JSON.parse(JSON.stringify(p)));
    expect(parsed).toEqual(p);
  });

  it("rejects bad payloads", () => {
    expect(() =>
      applyCommand(withClips([3]), { type: "clip/setSpeed", payload: { clipId: "c0", speed: 0 } }),
    ).toThrow(/Invalid payload/);
  });
});

function strip(p: Project): Omit<Project, "updatedAt"> {
  const { updatedAt: _u, ...rest } = p;
  return rest;
}
