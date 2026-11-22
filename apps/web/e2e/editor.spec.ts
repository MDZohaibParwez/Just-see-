import { expect, test } from "@playwright/test";
import { ensureFixtures, fixture, mainClipCount, newProject } from "./helpers";

test.beforeAll(() => ensureFixtures());

test("import, split, undo/redo, speed, text, delete and autosave", async ({ page }) => {
  await newProject(page);
  await page.getByTestId("media-input").setInputFiles([fixture("clip1.mp4"), fixture("photo.png")]);
  await expect.poll(() => mainClipCount(page)).toBe(2);
  await expect(page.getByTestId("timecode")).toContainText("/ 0:15.1");

  // Split clip 1 at 0:05 via the toolbar.
  await page.keyboard.press("Home");
  for (let i = 0; i < 150; i++) await page.keyboard.press("ArrowRight");
  await page.getByTestId("tool-split").click();
  await expect.poll(() => mainClipCount(page)).toBe(3);

  await page.getByTestId("undo").click();
  await expect.poll(() => mainClipCount(page)).toBe(2);
  await page.getByTestId("redo").click();
  await expect.poll(() => mainClipCount(page)).toBe(3);

  // Selected clip after split: change speed to 2x.
  await page.getByTestId("tool-speed").click();
  await page.getByTestId("speed-2").click();
  await page.getByTestId("sheet-done").click();
  // 5 + 7.1/2 + 3 = 11.55 s
  await expect(page.getByTestId("timecode")).toContainText("/ 0:11.5");

  // Add a text clip.
  await page.getByTestId("tool-back").click();
  await page.getByTestId("tool-text").click();
  await page.getByTestId("text-input").fill("नमस्ते Hello");
  await page.getByTestId("sheet-done").click();
  await expect(page.getByTestId("track-text").getByTestId("timeline-clip")).toHaveCount(1);

  // Delete it.
  await page.getByTestId("tool-delete").click();
  await expect(page.getByTestId("track-text")).toHaveCount(0);

  // Autosave + crash recovery: reload and everything is still there.
  await expect(page.getByTestId("save-state")).toHaveText("Saved");
  await page.reload();
  await expect.poll(() => mainClipCount(page)).toBe(3);
  await expect(page.getByTestId("timecode")).toContainText("/ 0:11.5");
});

test("transition between clips shortens the timeline", async ({ page }) => {
  await newProject(page);
  await page.getByTestId("media-input").setInputFiles([fixture("clip2.mp4"), fixture("clip5.mp4")]);
  await expect.poll(() => mainClipCount(page)).toBe(2);
  await page.getByTestId("transition-button").first().click();
  await page.getByTestId("transition-crossfade").click();
  await page.getByTestId("sheet-done").click();
  // 12.1 + 12.1 - 0.5
  await expect(page.getByTestId("timecode")).toContainText("/ 0:23.7");
});

test("desktop layout shows the side panel @desktop", async ({ page }) => {
  await newProject(page);
  await page.getByTestId("tool-canvas").click();
  await expect(page.getByTestId("sheet")).toBeVisible();
  await page.getByTestId("aspect-16:9").click();
  await expect(page.getByTestId("aspect-16:9")).toHaveAttribute("aria-pressed", "true");
});
