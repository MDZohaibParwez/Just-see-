import fs from "node:fs";
import { expect, test } from "@playwright/test";
import { ensureFixtures, fixture, mainClipCount, newProject } from "./helpers";

test.beforeAll(() => ensureFixtures());

test("reel styles: lyric card and POV story apply their look and overlays", async ({ page }) => {
  test.setTimeout(3 * 60 * 1000);
  await newProject(page);
  await page.getByTestId("media-input").setInputFiles([fixture("clip1.mp4"), fixture("photo.png")]);
  await expect.poll(() => mainClipCount(page)).toBe(2);
  await page.keyboard.press("Home");
  await page.getByTestId("tool-library").click();
  await page.getByTestId("lib-tab-style").click();
  await page.getByTestId("lib-add-style:pov-story").click();
  await expect(page.getByTestId("style-dialog")).toBeVisible();
  await page.getByTestId("style-field-pov").fill("POV :- He remembered your order");
  await page.getByTestId("style-field-message").fill("I'm outside 🙂");
  await page.getByTestId("style-field-handle").fill("@aman.edits");
  await page.getByTestId("style-apply").click();
  await expect(page.getByTestId("library")).toHaveCount(0, { timeout: 120_000 });
  // Header (whole video) + notification + end card on the text tracks, music on an audio track.
  await expect.poll(async () => page.getByTestId("track-text").getByTestId("timeline-clip").count(), { timeout: 60_000 }).toBe(3);
  await expect(page.getByTestId("track-audio").getByTestId("timeline-clip")).toHaveCount(1, { timeout: 120_000 });
  await page.waitForTimeout(800);
  const png = await page.evaluate(() => (window as unknown as { __justSeePreview: { capture: (us: number, w: number, h: number) => Promise<string> } }).__justSeePreview.capture(4_500_000, 540, 960));
  fs.mkdirSync(test.info().outputDir, { recursive: true });
  fs.writeFileSync(`${test.info().outputDir}/pov-4.5s.png`, Buffer.from(png, "base64"));
  expect(png.length).toBeGreaterThan(10_000);
});
