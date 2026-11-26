import { mkdtemp, utimes, writeFile, mkdir, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FsStore, KEEP_MS, maybeCleanup } from "../src/store";

describe("30-day cleanup", () => {
  it("deletes old files, keeps new ones, runs at most every 12 hours", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "js-clean-"));
    const store = new FsStore(dir, "http://x");
    await mkdir(path.join(dir, "uploads"), { recursive: true });
    const oldF = path.join(dir, "uploads/old.mp4");
    const newF = path.join(dir, "uploads/new.mp4");
    await writeFile(oldF, "a");
    await writeFile(newF, "b");
    const now = Date.now();
    const past = new Date(now - KEEP_MS - 60_000);
    await utimes(oldF, past, past);

    expect(await maybeCleanup(store, now)).toBe(1);
    expect(await readdir(path.join(dir, "uploads"))).toEqual(["new.mp4"]);
    // The marker in meta/ is never deleted, and a second run soon after is skipped.
    await utimes(newF, past, past);
    expect(await maybeCleanup(store, now + 60_000)).toBe(0);
    expect(await maybeCleanup(store, now + 13 * 60 * 60 * 1000)).toBe(1);
    expect(await readdir(path.join(dir, "meta"))).toEqual(["last-cleanup.json"]);
  });
});
