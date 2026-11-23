import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { ensureFixtures, ffprobe, fixture, frameRgb, mainClipCount, meanAbsDiff, newProject } from "./helpers";

test.beforeAll(() => ensureFixtures());

const W = 240;
const H = 426;

/** Crop an RGB24 frame to a region given in fractions of the frame. */
function region(buf: Buffer, x0: number, y0: number, x1: number, y1: number): Buffer {
  const out: number[] = [];
  for (let y = Math.floor(y0 * H); y < Math.floor(y1 * H); y++) {
    for (let x = Math.floor(x0 * W); x < Math.floor(x1 * W); x++) {
      const i = (y * W + x) * 3;
      out.push(buf[i]!, buf[i + 1]!, buf[i + 2]!);
    }
  }
  return Buffer.from(out);
}

async function photoProject(page: Page): Promise<void> {
  await newProject(page);
  await page.getByTestId("media-input").setInputFiles(fixture("photo.png"));
  await expect.poll(() => mainClipCount(page)).toBe(1);
  await page.keyboard.press("Home");
}

async function exportVideo(page: Page, name: string): Promise<string> {
  await page.getByTestId("open-export").click();
  await page.getByTestId("export-size-480p").click();
  await page.getByTestId("start-export").click();
  await expect(page.getByTestId("export-done")).toBeVisible({ timeout: 4 * 60 * 1000 });
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("download").click()]);
  const out = path.join(os.tmpdir(), `just-see-${name}-${Date.now()}.mp4`);
  await download.saveAs(out);
  return out;
}

/** Phase 4 "done when", part 1: an animated lower third built from a template and dropped into a video. */
test("motion: animated lower third goes into the video and animates in the export", async ({ page }) => {
  test.setTimeout(5 * 60 * 1000);
  await photoProject(page);
  await page.getByTestId("tool-motion").click();
  await page.getByTestId("motion-template-lower-third-clean").click();
  await expect(page.getByTestId("motion-canvas")).toBeVisible();
  await page.getByTestId("motion-tab-props").click();
  await page.getByTestId("quick-Name").fill("Aman Khan");
  await page.getByTestId("quick-Title").fill("Travel vlogger");
  // Scrub to 2 s: the bar and text are in.
  await page.getByTestId("motion-time").fill("2000000");
  await expect(page.getByTestId("motion-time-label")).toHaveText("2.00s");
  await page.getByTestId("motion-add-to-video").click();
  await expect(page.getByTestId("motion")).toHaveCount(0);
  await expect(page.getByTestId("track-text").getByTestId("timeline-clip")).toHaveCount(1);

  const out = await exportVideo(page, "lower-third");
  expect(ffprobe(out).streams.find((s) => s.codec_type === "video")?.height).toBe(854);
  const early = frameRgb(out, 0.03, W, H);
  const late = frameRgb(out, 2.0, W, H);
  // Lower-left area changes a lot (dark bar + white text); the top of the frame stays the same.
  const lt = meanAbsDiff(region(early, 0.05, 0.72, 0.6, 0.88), region(late, 0.05, 0.72, 0.6, 0.88));
  const top = meanAbsDiff(region(early, 0, 0, 1, 0.4), region(late, 0, 0, 1, 0.4));
  console.log("lower third diff", lt, "top diff", top);
  expect(lt).toBeGreaterThan(25);
  expect(top).toBeLessThan(3);
  fs.rmSync(out, { force: true });
});

/** Phase 4 "done when", part 2: a logo reveal with the user's logo, dropped into a video. */
test("motion: logo reveal with an uploaded logo exports animated", async ({ page }) => {
  test.setTimeout(5 * 60 * 1000);
  await newProject(page);
  await page.getByTestId("media-input").setInputFiles(fixture("clip1.mp4"));
  await expect.poll(() => mainClipCount(page)).toBe(1);
  await page.keyboard.press("Home");
  await page.getByTestId("tool-motion").click();
  await page.getByTestId("motion-logo-input").setInputFiles(fixture("photo.png"));
  await page.getByTestId("motion-template-logo-reveal-glow").click();
  await page.getByTestId("motion-tab-layers").click();
  await expect(page.getByTestId("motion-layer-Logo")).toBeVisible();
  await page.getByTestId("motion-add-to-video").click();
  await expect(page.getByTestId("track-text").getByTestId("timeline-clip")).toHaveCount(1);

  const out = await exportVideo(page, "logo");
  const before = frameRgb(out, 0.2, W, H);
  const after = frameRgb(out, 2.5, W, H);
  const centre = meanAbsDiff(region(before, 0.3, 0.4, 0.7, 0.6), region(after, 0.3, 0.4, 0.7, 0.6));
  console.log("logo centre diff", centre);
  expect(centre).toBeGreaterThan(20);
  fs.rmSync(out, { force: true });
});

test("motion: build an animation from scratch with keyframes, graph easing and live update", async ({ page }) => {
  test.setTimeout(3 * 60 * 1000);
  await photoProject(page);
  await page.getByTestId("tool-motion").click();
  await page.getByTestId("motion-blank").click();
  await page.getByTestId("motion-add-rect").click();
  await page.getByTestId("motion-tab-props").click();
  // Keyframe X at 0 s and 1 s.
  await page.getByTestId("kf-x").click();
  await expect(page.getByTestId("kf-x")).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("motion-time").fill("1000000");
  await page.getByTestId("prop-x").fill("200");
  await page.getByTestId("prop-x").press("Enter");
  await expect(page.getByTestId("kf-x")).toHaveAttribute("aria-pressed", "true");
  // Canvas differs between 0 s and 1 s.
  const snap = () => page.getByTestId("motion-canvas").evaluate((c) => (c as HTMLCanvasElement).toDataURL());
  const at1 = await snap();
  await page.getByTestId("motion-time").fill("0");
  await expect(page.getByTestId("motion-time-label")).toHaveText("0.00s");
  const at0 = await snap();
  expect(at0).not.toBe(at1);
  // Graph editor: two keyframes, overshoot easing.
  await page.getByTestId("motion-tab-graph").click();
  await page.getByTestId("graph-prop-x").click();
  await expect(page.getByTestId("graph-kf-1")).toBeVisible();
  await page.getByTestId("graph-kf-0").click();
  await page.getByTestId("ease-back").click();
  await expect(page.getByTestId("ease-back")).toHaveAttribute("aria-pressed", "true");
  // Lottie export.
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByTestId("motion-lottie-export").click()]);
  const file = path.join(os.tmpdir(), `just-see-lottie-${Date.now()}.json`);
  await dl.saveAs(file);
  const json = JSON.parse(fs.readFileSync(file, "utf8")) as { layers: { ty: number }[]; w: number };
  expect(json.layers.length).toBe(1);
  expect(json.layers[0]!.ty).toBe(4);
  fs.rmSync(file, { force: true });

  // Into the video, then change the colour: the video preview updates.
  await page.getByTestId("motion-add-to-video").click();
  await expect(page.getByTestId("track-text").getByTestId("timeline-clip")).toHaveCount(1);
  const previewSnap = () => page.getByTestId("preview-canvas").evaluate((c) => (c as HTMLCanvasElement).toDataURL());
  await page.waitForTimeout(500);
  const p1 = await previewSnap();
  await page.getByTestId("track-text").getByTestId("timeline-clip").click();
  await page.getByTestId("tool-edit-motion").click();
  await page.getByTestId("motion-tab-props").click();
  await page.getByTestId("motion-tab-layers").click();
  await page.getByTestId("motion-layer-Shape").click();
  await page.getByTestId("motion-tab-props").click();
  await page.getByTestId("motion-fill").fill("#ff0000");
  await page.getByTestId("motion-back").click();
  await page.getByTestId("motion-close").click();
  await expect.poll(previewSnap, { timeout: 10_000 }).not.toBe(p1);
});
