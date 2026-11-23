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

/** Phase 3 "done when", part 2: a 16-bar beat with sequencer, piano roll and mixer, exported. */
test("audio studio: build a 16-bar beat, mix it, export WAV and send to video", async ({ page }) => {
  test.setTimeout(5 * 60 * 1000);
  await newProject(page);
  await page.getByTestId("tool-studio").click();
  await page.getByTestId("studio-new").click();
  await expect(page.getByTestId("studio-play")).toBeVisible();
  await page.getByTestId("studio-bars").selectOption("16");
  await page.getByTestId("studio-bpm").fill("96");

  // Step sequencer: add a snare ghost note and an open hat.
  await page.getByTestId("step-snare-10").click();
  await page.getByTestId("step-open-hat-14").click();
  await expect(page.getByTestId("step-open-hat-14")).toHaveAttribute("aria-pressed", "true");

  // Piano roll: a pluck track with chords.
  await page.getByTestId("studio-add-track").click();
  await page.getByTestId("add-track-pluck").click();
  await page.getByTestId("studio-tab-piano").click();
  await page.getByTestId("pr-chord").click();
  // Key A minor (root 9): A4 = 69 at step 0, C5 = 72 at step 16, D5 = 74 at step 32, E5 = 76 at step 48.
  for (const [pitch, step] of [[69, 0], [72, 16], [74, 32], [76, 48]] as const) await page.getByTestId(`pr-${pitch}-${step}`).click();
  await expect(page.getByTestId("pr-69-0")).toHaveAttribute("aria-pressed", "true");

  // 808 bass line.
  await page.getByTestId("studio-add-track").click();
  await page.getByTestId("add-track-808").click();
  await page.getByTestId("pr-chord").click(); // chords off for bass
  for (const step of [0, 6, 16, 22, 32, 38, 48, 54]) await page.getByTestId(`pr-45-${step}`).click();

  // Mixer: reverb on the pluck, mute nothing, check loudness.
  await page.getByTestId("studio-tab-mixer").click();
  const rev = page.getByTestId("rev-Pluck");
  await rev.focus();
  for (let i = 0; i < 6; i++) await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("mixer-Pluck")).toContainText("30%");
  await page.getByTestId("studio-lufs").click();
  await expect(page.getByTestId("studio-lufs")).toContainText("LUFS", { timeout: 90_000 });

  // Export WAV and check its length: 16 bars at 96 BPM = 40 s (+ reverb tail).
  const [download] = await Promise.all([page.waitForEvent("download", { timeout: 120_000 }), page.getByTestId("studio-wav").click()]);
  const out = path.join(os.tmpdir(), `just-see-beat-${Date.now()}.wav`);
  await download.saveAs(out);
  const probe = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", out], { encoding: "utf8" });
  const dur = Number(String(probe.stdout).trim());
  expect(dur).toBeGreaterThan(39.9);
  expect(dur).toBeLessThan(44);
  const m = measure(out);
  expect(m.lufs).toBeGreaterThan(-30);
  expect(m.peak).toBeLessThan(0.1);
  fs.rmSync(out, { force: true });

  // Send to the video timeline.
  await page.getByTestId("studio-send").click();
  await page.getByTestId("studio-back").click();
  await page.getByTestId("studio-close").click();
  await expect(page.getByTestId("track-audio").getByTestId("timeline-clip")).toHaveCount(1, { timeout: 120_000 });
});

test("mood music templates and sound search", async ({ page }) => {
  test.setTimeout(3 * 60 * 1000);
  await newProject(page);
  await page.getByTestId("tool-studio").click();
  await page.getByTestId("mood-lofi").click();
  await expect(page.getByTestId("studio-track-Keys")).toBeVisible();
  await page.getByTestId("studio-send").click();
  await expect(page.getByTestId("studio-send")).toHaveText(/./, { timeout: 120_000 });
  await page.getByTestId("studio-back").click();
  await page.getByTestId("studio-close").click();
  await expect(page.getByTestId("track-audio").getByTestId("timeline-clip")).toHaveCount(1, { timeout: 120_000 });
  await page.getByTestId("tool-sfx").click();
  await page.getByTestId("sfx-search").fill("ba-dum");
  await page.getByTestId("add-sfx-ba-dum-tss").click();
  await page.getByTestId("sfx-search").fill("taali");
  await page.getByTestId("add-sfx-applause").click();
  await expect.poll(() => page.getByTestId("track-audio").getByTestId("timeline-clip").count()).toBe(3);
});
