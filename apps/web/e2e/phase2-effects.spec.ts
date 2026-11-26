import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { ensureFixtures, fixture, frameRgb, mainClipCount, meanAbsDiff, newProject } from "./helpers";

test.beforeAll(() => ensureFixtures());

async function exportAndSave(page: Page, name: string): Promise<string> {
  await page.getByTestId("open-export").click();
  await page.getByTestId("export-size-720p").click();
  await page.getByTestId("start-export").click();
  await expect(page.getByTestId("export-done")).toBeVisible({ timeout: 4 * 60 * 1000 });
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("download").click()]);
  const out = path.join(os.tmpdir(), `just-see-${name}-${Date.now()}.mp4`);
  await download.saveAs(out);
  return out;
}

test("a .cube LUT is applied in the export", async ({ page }) => {
  test.setTimeout(6 * 60 * 1000);
  await newProject(page, "9:16");
  await page.getByTestId("media-input").setInputFiles(fixture("clip1.mp4"));
  await expect.poll(() => mainClipCount(page)).toBe(1);
  // Keep the export short: trim to 2 s.
  await page.keyboard.press("Home");
  for (let i = 0; i < 60; i++) await page.keyboard.press("ArrowRight");
  await page.getByTestId("tool-split").click();
  await page.getByTestId("tool-delete").click();
  await page.getByTestId("track-main").getByTestId("timeline-clip").first().click();
  await page.getByTestId("tool-effects").click();
  await page.getByTestId("fxcat-color").click();
  await page.getByTestId("lut-input").setInputFiles(fixture("invert.cube"));
  await expect(page.getByText("· Invert")).toBeVisible();
  await page.getByTestId("sheet-done").click();
  const out = await exportAndSave(page, "lut");
  const got = frameRgb(out, 1, 72, 128);
  const src = frameRgb(fixture("clip1.mp4"), 1, 72, 128);
  const inverted = Buffer.from(src.map((v) => 255 - v));
  expect(meanAbsDiff(got, inverted), "export is the inverted source").toBeLessThan(14);
  expect(meanAbsDiff(got, src)).toBeGreaterThan(40);
  fs.rmSync(out, { force: true });
});

test("chroma key removes the green screen over a background clip", async ({ page }) => {
  test.setTimeout(6 * 60 * 1000);
  await newProject(page, "9:16");
  await page.getByTestId("media-input").setInputFiles(fixture("clip5.mp4"));
  await expect.poll(() => mainClipCount(page)).toBe(1);
  // Green screen clip goes on top: import it, then move it to an overlay by duplicating onto the main track is not
  // possible, so use the main track for the keyed clip and a blurred background of itself is not wanted either.
  // Instead: key the only clip and check the canvas background colour shows through.
  await page.getByTestId("media-input").setInputFiles(fixture("greenscreen.mp4"));
  await expect.poll(() => mainClipCount(page)).toBe(2);
  await page.getByTestId("track-main").getByTestId("timeline-clip").nth(1).click();
  await page.getByTestId("tool-effects").click();
  await page.getByTestId("effect-search").fill("chroma");
  await page.getByTestId("effect-chroma-key").click();
  await page.getByTestId("sheet-done").click();
  // Delete the first clip so the keyed clip starts at 0 and only it is exported.
  await page.getByTestId("tool-back").click();
  await page.getByTestId("track-main").getByTestId("timeline-clip").first().click();
  await page.getByTestId("tool-delete").click();
  await expect.poll(() => mainClipCount(page)).toBe(1);
  // Background colour white → keyed area becomes white, not green.
  await page.getByTestId("tool-canvas").click();
  await page.getByRole("button", { name: "Background colour #ff375f" }).click();
  await page.getByTestId("sheet-done").click();
  const out = await exportAndSave(page, "key");
  const frame = frameRgb(out, 1, 72, 128);
  // Top-left corner was pure green in the source; now it is the pink background.
  const px = (x: number, y: number) => [frame[(y * 72 + x) * 3]!, frame[(y * 72 + x) * 3 + 1]!, frame[(y * 72 + x) * 3 + 2]!];
  const [r, g, b] = px(4, 4);
  expect(g).toBeLessThan(120);
  expect(r).toBeGreaterThan(180);
  expect(b).toBeGreaterThan(40);
  fs.rmSync(out, { force: true });
});
