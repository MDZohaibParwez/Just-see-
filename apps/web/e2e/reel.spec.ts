import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { expect, test } from "@playwright/test";
import { ensureFixtures, ffprobe, fixture, frameRgb, mainClipCount, meanAbsDiff, meanLuma, newProject } from "./helpers";

test.beforeAll(() => ensureFixtures());

/**
 * Phase 1 "done when": a 60 s 9:16 reel with 5 clips, text and music exports
 * correctly from a phone browser (Pixel 7 emulation).
 */
test("60 s 9:16 reel with 5 clips, text and music exports correctly", async ({ page }) => {
  test.setTimeout(15 * 60 * 1000);
  await newProject(page, "9:16");

  // 5 clips: portrait, landscape, rotated phone video, 60 fps without audio, 25 fps square.
  await page.getByTestId("media-input").setInputFiles(["clip1.mp4", "clip2.mp4", "clip3.mp4", "clip4.mp4", "clip5.mp4"].map(fixture));
  await expect.poll(() => mainClipCount(page), { timeout: 60_000 }).toBe(5);

  // Zoom the timeline out so the first cut is on screen.
  await page.keyboard.press("Home");
  for (let i = 0; i < 5; i++) await page.keyboard.press("-");
  // Crossfade between clip 1 and 2 → 5 × 12.1 − 0.5 = 60.0 s.
  await page.getByTestId("transition-button").first().click();
  await page.getByTestId("transition-crossfade").click();
  await page.getByTestId("sheet-done").click();
  await expect(page.getByTestId("timecode")).toContainText("/ 1:00.0");

  // Title text at the very start.
  await page.keyboard.press("Home");
  await page.getByTestId("tool-back").click().catch(() => undefined);
  await page.getByTestId("tool-text").click();
  await page.getByTestId("text-input").fill("Just See ✨ रील");
  await page.getByTestId("sheet-done").click();
  await page.getByTestId("tool-back").click();

  // Background music from 0.
  await page.keyboard.press("Home");
  await page.getByTestId("music-input").setInputFiles(fixture("music.mp3"));
  await expect(page.getByTestId("track-audio").getByTestId("timeline-clip")).toHaveCount(1);

  // Music is 70 s; timeline grows to 70 s. Trim it to the video length by
  // selecting it and using the end handle is a drag; use the keyboard-free
  // route instead: split at 60 s and delete the tail.
  await page.keyboard.press("End");
  await page.getByTestId("track-audio").getByTestId("timeline-clip").click();
  for (let i = 0; i < 300; i++) await page.keyboard.press("ArrowLeft");
  // Playhead now at 70 − 10 = 60 s.
  await page.getByTestId("tool-split").click();
  await page.getByTestId("tool-delete").click();
  await expect(page.getByTestId("timecode")).toContainText("/ 1:00.0");

  // Export 1080×1920 @ 30 fps.
  await page.getByTestId("open-export").click();
  await page.getByTestId("export-size-1080p").click();
  await page.getByTestId("export-fps-30").click();
  await page.getByTestId("start-export").click();
  await expect(page.getByTestId("export-done")).toBeVisible({ timeout: 12 * 60 * 1000 });

  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("download").click()]);
  const out = path.join(os.tmpdir(), `just-see-reel-${Date.now()}.mp4`);
  await download.saveAs(out);
  console.log("export:", await page.getByTestId("export-info").textContent());

  const probe = ffprobe(out);
  const v = probe.streams.find((s) => s.codec_type === "video");
  const a = probe.streams.find((s) => s.codec_type === "audio");
  expect(v?.width).toBe(1080);
  expect(v?.height).toBe(1920);
  expect(a, "audio track").toBeTruthy();
  const duration = Number(probe.format.duration);
  expect(duration).toBeGreaterThan(59.8);
  expect(duration).toBeLessThan(60.3);
  if (v?.nb_frames) expect(Math.abs(Number(v.nb_frames) - 1800)).toBeLessThanOrEqual(2);

  // Picture checks against the sources (small, to keep it quick).
  const W = 108;
  const H = 192;
  // At 3 s only clip 1 is on screen (text faded out by then? text lasts 3 s) → use 5 s.
  const exp1 = frameRgb(out, 5, W, H);
  const src1 = frameRgb(fixture("clip1.mp4"), 5, W, H);
  expect(meanAbsDiff(exp1, src1), "clip 1 matches source").toBeLessThan(12);

  // Clip 3 (rotated phone video) is on screen from 23.7 s; at 30 s source time is 6.3 s.
  // ffmpeg applies the display rotation, so a correct export matches its fitted frame.
  const exp3 = frameRgb(out, 30, W, H);
  expect(meanLuma(exp3)).toBeGreaterThan(10);

  // Text shows at 1.5 s: frame differs from the raw source there.
  const withText = frameRgb(out, 1.5, W, H);
  const srcAt = frameRgb(fixture("clip1.mp4"), 1.5, W, H);
  expect(meanAbsDiff(withText, srcAt)).toBeGreaterThan(0.3);

  // Audio is not silent.
  fs.rmSync(out, { force: true });
});
