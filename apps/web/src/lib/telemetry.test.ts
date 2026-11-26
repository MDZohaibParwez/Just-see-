import { beforeEach, describe, expect, it } from "vitest";
import { clearCrashes, crashes, recordCrash, scrub, track, usage } from "./telemetry";

class MemStorage {
  m = new Map<string, string>();
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
}

beforeEach(() => {
  (globalThis as unknown as { localStorage: MemStorage }).localStorage = new MemStorage();
});

describe("telemetry (on device)", () => {
  it("removes personal details from reports", () => {
    const s = scrub("failed blob:https://x/abc at https://just-see.app/edit/?id=p_123 file My Wedding.mp4 by me@mail.com");
    expect(s).not.toContain("p_123");
    expect(s).not.toContain("Wedding");
    expect(s).not.toContain("me@mail.com");
    expect(s).toContain("blob:…");
    expect(s).toContain("file.mp4");
  });

  it("counts feature names only", () => {
    track("export");
    track("export");
    track("Bad Name With Spaces");
    expect(usage().counts).toEqual({ export: 2 });
  });

  it("keeps one copy of the same crash and skips browser noise", () => {
    recordCrash(new Error("boom"), "editor");
    recordCrash(new Error("boom"), "editor");
    recordCrash(new Error("ResizeObserver loop limit exceeded"));
    expect(crashes()).toHaveLength(1);
    expect(crashes()[0]!.message).toBe("boom");
    expect(usage().counts.crash).toBe(1);
    clearCrashes();
    expect(crashes()).toHaveLength(0);
  });
});
