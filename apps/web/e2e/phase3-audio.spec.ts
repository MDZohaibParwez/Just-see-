import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { ensureFixtures, fixture, mainClipCount, newProject } from "./helpers";

test.beforeAll(() => ensureFixtures());

function measure(file: string): { lufs: number; peak: number } {
  const res = spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-i", file, "-af", "ebur128=peak=true", "-f", "null", "-"], { encoding: "utf8" });
  const text = String(res.stderr);
  const summary = text.slice(text.lastIndexOf("Summary:"));
  return { lufs: Number(/I:\s+(-?[\d.]+) LUFS/.exec(summary)?.[1]), peak: Number(/Peak:\s+(-?[\d.]+) dBFS/.exec(summary)?.[1]) };
}

/** Phase 3 "done when", part 1: a noisy phone recording → clean -14 LUFS in one tap. */
test("Studio voice: one tap turns a noisy recording into -14 LUFS", async ({ page }) => {
  test.setTimeout(6 * 60 * 1000);
  const before = measure(fixture("noisy-voice.mp4"));
  await newProject(page);
  await page.getByTestId("media-input").setInputFiles(fixture("noisy-voice.mp4"));
  await expect.poll(() => mainClipCount(page)).toBe(1);
  await page.getByTestId("track-main").getByTestId("timeline-clip").first().click();
  await page.getByTestId("tool-audio-fx").click();
  await page.getByTestId("studio-voice").click();
  await expect(page.getByTestId("audio-fx-item")).toHaveCount(1);
  await page.getByTestId("sheet-done").click();
  await page.getByTestId("open-export").click();
  await page.getByTestId("export-size-480p").click();
  await page.getByTestId("start-export").click();
  await expect(page.getByTestId("export-done")).toBeVisible({ timeout: 4 * 60 * 1000 });
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("download").click()]);
  const out = path.join(os.tmpdir(), `just-see-voice-${Date.now()}.mp4`);
  await download.saveAs(out);
  const after = measure(out);
  console.log("before", before, "after", after);
  expect(after.lufs).toBeGreaterThan(-15);
  expect(after.lufs).toBeLessThan(-13);
  expect(after.peak).toBeLessThan(-0.5);
  expect(before.lufs).toBeLessThan(-18);
  fs.rmSync(out, { force: true });
});

test("built-in sound effects and auto duck", async ({ page }) => {
  test.setTimeout(3 * 60 * 1000);
  await newProject(page);
  await page.getByTestId("media-input").setInputFiles(fixture("noisy-voice.mp4"));
  await expect.poll(() => mainClipCount(page)).toBe(1);
  await page.keyboard.press("Home");
  await page.getByTestId("music-input").setInputFiles(fixture("music.mp3"));
  await expect(page.getByTestId("track-audio").getByTestId("timeline-clip")).toHaveCount(1);
  await page.getByTestId("tool-sfx").click();
  await page.getByTestId("add-sfx-whoosh").click();
  await page.getByTestId("sfxcat-impact").click();
  await page.getByTestId("add-sfx-boom").click();
  await expect.poll(() => page.getByTestId("track-audio").getByTestId("timeline-clip").count()).toBe(3);
  await page.getByTestId("sheet-done").click();
  await page.getByTestId("tool-auto-duck").click();
  await expect.poll(() => page.getByTestId("keyframe-marker").count(), { timeout: 60_000 }).toBeGreaterThan(4);
});
