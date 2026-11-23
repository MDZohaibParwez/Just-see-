import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { ensureFixtures, fixture, frameRgb, mainClipCount, meanAbsDiff, newProject } from "./helpers";

test.beforeAll(() => ensureFixtures());

/** Average change between neighbouring frames in the middle of the picture (shake shows up as big changes). */
function jitter(file: string, from: number, n: number, fps: number, crop = 0.25): number {
  const W = 120;
  const H = 214;
  const frames = Array.from({ length: n }, (_, i) => frameRgb(file, from + i / fps, W, H));
  const centre = (b: Buffer) => {
    const out: number[] = [];
    for (let y = Math.floor(H * crop); y < Math.floor(H * (1 - crop)); y++)
      for (let x = Math.floor(W * crop); x < Math.floor(W * (1 - crop)); x++) {
        const i = (y * W + x) * 3;
        out.push(b[i]!, b[i + 1]!, b[i + 2]!);
      }
    return Buffer.from(out);
  };
  let s = 0;
  for (let i = 1; i < frames.length; i++) s += meanAbsDiff(centre(frames[i - 1]!), centre(frames[i]!));
  return s / (frames.length - 1);
}

async function exportMp4(page: Page, name: string): Promise<string> {
  await page.getByTestId("open-export").click();
  await page.getByTestId("export-size-480p").click();
  await page.getByTestId("start-export").click();
  await expect(page.getByTestId("export-done")).toBeVisible({ timeout: 4 * 60 * 1000 });
  const [d] = await Promise.all([page.waitForEvent("download"), page.getByTestId("download").click()]);
  const out = path.join(os.tmpdir(), `${name}-${Date.now()}.mp4`);
  await d.saveAs(out);
  return out;
}

test("stabilise: removes camera shake from a handheld clip", async ({ page }) => {
  test.setTimeout(5 * 60 * 1000);
  await newProject(page);
  await page.getByTestId("media-input").setInputFiles(fixture("shaky.mp4"));
  await expect.poll(() => mainClipCount(page)).toBe(1);
  const before = await exportMp4(page, "shaky-before");
  await page.getByTestId("sheet-done").click();
  await page.getByTestId("track-main").getByTestId("timeline-clip").first().click();
  await page.getByTestId("tool-stabilize").click();
  await expect(page.getByText(/Stabilised|स्थिर हो गया/)).toBeVisible({ timeout: 120_000 });
  expect(await page.getByTestId("keyframe-marker").count()).toBeGreaterThan(10);
  await page.locator("body").click({ position: { x: 5, y: 5 } });
  const after = await exportMp4(page, "shaky-after");
  const j0 = jitter(before, 1, 16, 10);
  const j1 = jitter(after, 1, 16, 10);
  console.log("jitter before", j0.toFixed(2), "after", j1.toFixed(2));
  expect(j1).toBeLessThan(j0 * 0.6);
  fs.rmSync(before, { force: true });
  fs.rmSync(after, { force: true });
});

test("HD enhance, AI photo upscale and AI voice-over", async ({ page }) => {
  test.setTimeout(3 * 60 * 1000);
  // Stand-ins for the downloaded models (CI has no model hosting); the real path uses transformers.js.
  await page.addInitScript(() => {
    (window as unknown as Record<string, unknown>).__justSeeUpscaler = async (img: ImageBitmap) => {
      const c = new OffscreenCanvas(img.width * 2, img.height * 2);
      const ctx = c.getContext("2d")!;
      ctx.drawImage(img, 0, 0, c.width, c.height);
      const d = ctx.getImageData(0, 0, c.width, c.height);
      return { data: d.data, width: c.width, height: c.height, channels: 4 };
    };
    (window as unknown as Record<string, unknown>).__justSeeTts = async (text: string) => {
      const sr = 16000;
      const n = Math.round(sr * Math.max(0.5, text.length * 0.06));
      return { audio: Float32Array.from({ length: n }, (_, i) => 0.3 * Math.sin((2 * Math.PI * 220 * i) / sr)), sampling_rate: sr };
    };
  });
  await newProject(page);
  await page.getByTestId("media-input").setInputFiles(fixture("photo.png"));
  await expect.poll(() => mainClipCount(page)).toBe(1);
  await page.getByTestId("track-main").getByTestId("timeline-clip").first().click();
  await page.getByTestId("tool-enhance").click();
  await expect(page.getByText(/HD enhance added|HD बेहतर लगाया/)).toBeVisible();
  await page.getByTestId("tool-upscale").click();
  await expect(page.getByText(/Photo upscaled to \d+×\d+|फ़ोटो बड़ी हुई/)).toBeVisible({ timeout: 60_000 });
  await page.locator("body").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("Escape");
  await page.getByTestId("tool-ai-voice").click();
  await page.getByTestId("ai-voice-text").fill("Welcome to my channel. Today we go to Goa!");
  await page.getByTestId("ai-voice-make").click();
  await expect(page.getByTestId("track-audio").getByTestId("timeline-clip")).toHaveCount(1, { timeout: 60_000 });
});
