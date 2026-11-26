import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { ensureFixtures, ffprobe, fixture, frameRgb, mainClipCount, meanAbsDiff, newProject } from "./helpers";

test.beforeAll(() => ensureFixtures());

async function selectMain(page: Page, n: number) {
  await page.getByTestId("track-main").getByTestId("timeline-clip").nth(n).click();
}

test("keyframes, freeze frame, reverse, speed ramp, crop and blend", async ({ page }) => {
  await newProject(page);
  await page.getByTestId("media-input").setInputFiles(fixture("clip2.mp4"));
  await expect.poll(() => mainClipCount(page)).toBe(1);
  await page.keyboard.press("Home");
  await selectMain(page, 0);

  // Keyframes: add at 0, move to 2 s, change X → keyframe added there.
  await page.getByTestId("tool-adjust").click();
  await page.getByTestId("keyframe-toggle").click();
  await expect(page.getByTestId("keyframe-toggle")).toHaveAttribute("aria-pressed", "true");
  for (let i = 0; i < 60; i++) await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("keyframe-toggle")).toHaveAttribute("aria-pressed", "false");
  await page.getByTestId("adjust-x").fill("0.4");
  await expect(page.getByTestId("keyframe-toggle")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("keyframe-marker")).toHaveCount(2);
  await page.getByTestId("blend-screen").click();
  await page.getByTestId("sheet-done").click();

  // Freeze at 2 s → 3 clips, +3 s.
  await page.getByTestId("tool-freeze").click();
  await expect.poll(() => mainClipCount(page)).toBe(3);
  await expect(page.getByTestId("timecode")).toContainText("/ 0:15.1");

  // Reverse + ramp on the last clip.
  await page.getByTestId("tool-back").click();
  for (let i = 0; i < 6 * 30; i++) await page.keyboard.press("ArrowRight");
  await selectMain(page, 2);
  await page.getByTestId("tool-speed").click();
  await page.getByTestId("reverse").click();
  await expect(page.getByTestId("reverse")).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("speed-curve-tab").click();
  await page.getByTestId("curve-montage").click();
  await page.getByTestId("sheet-done").click();
  await expect(page.getByTestId("timecode")).not.toContainText("/ 0:15.1");

  // Crop to 1:1.
  await page.getByTestId("tool-crop").click();
  await page.getByTestId("crop-1:1").click();
  await page.getByTestId("sheet-done").click();

  // 7 edits after the import: undo them all, then step back through one.
  for (let i = 0; i < 7; i++) await page.getByTestId("undo").click();
  await expect.poll(() => mainClipCount(page)).toBe(1);
  await expect(page.getByTestId("keyframe-marker")).toHaveCount(0);
  for (let i = 0; i < 4; i++) await page.getByTestId("redo").click();
  await expect.poll(() => mainClipCount(page)).toBe(3);
});

test("blur background fills the frame in the export", async ({ page }) => {
  test.setTimeout(5 * 60 * 1000);
  await newProject(page, "9:16");
  await page.getByTestId("media-input").setInputFiles(fixture("clip2.mp4"));
  await expect.poll(() => mainClipCount(page)).toBe(1);
  await page.getByTestId("tool-canvas").click();
  await page.getByTestId("bg-blur").click();
  await page.getByTestId("sheet-done").click();
  await page.getByTestId("open-export").click();
  await page.getByTestId("export-size-720p").click();
  await page.getByTestId("start-export").click();
  await expect(page.getByTestId("export-done")).toBeVisible({ timeout: 4 * 60 * 1000 });
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("download").click()]);
  const out = path.join(os.tmpdir(), `just-see-blur-${Date.now()}.mp4`);
  await download.saveAs(out);
  const v = ffprobe(out).streams.find((s) => s.codec_type === "video");
  expect(v?.width).toBe(720);
  expect(v?.height).toBe(1280);
  // Top band is no longer black: it shows the blurred video.
  const frame = frameRgb(out, 2, 72, 128);
  const topBand = frame.subarray(0, 72 * 20 * 3);
  const black = Buffer.alloc(topBand.length);
  expect(meanAbsDiff(topBand, black)).toBeGreaterThan(15);
  fs.rmSync(out, { force: true });
});
