import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { ensureFixtures, fixture, frameRgb, mainClipCount, newProject } from "./helpers";

test.beforeAll(() => ensureFixtures());

/**
 * The real Whisper model downloads from Hugging Face, which CI cannot reach,
 * so these tests plug in a deterministic transcriber through the test hook.
 * Everything after recognition (grouping, karaoke clips, Hinglish, transcript
 * editing, filler removal) is the real code path.
 */
const FAKE = `
window.__justSeeTranscriber = async (pcm, sr, lang) => {
  const words = ["नमस्ते", "दोस्तों", "um", "आज", "हम", "खाना", "बनाएंगे", "matlab", "बहुत", "आसान"];
  return words.map((text, i) => ({ text, startUs: 500000 + i * 700000, endUs: 500000 + i * 700000 + 600000 }));
};`;

test("auto captions in Hinglish, transcript cut and filler removal", async ({ page }) => {
  await page.addInitScript(FAKE);
  await newProject(page);
  await page.getByTestId("media-input").setInputFiles(fixture("clip1.mp4"));
  await expect.poll(() => mainClipCount(page)).toBe(1);
  await page.getByTestId("tool-captions").click();
  await page.getByTestId("cap-lang-hinglish").click();
  await page.getByTestId("cap-style-box").click();
  await page.getByTestId("generate-captions").click();
  await expect(page.getByTestId("caption-status")).toContainText("Caption lines added", { timeout: 60_000 });
  const words = page.getByTestId("transcript-words").getByRole("button");
  await expect(words).toHaveCount(10);
  await expect(words.first()).toHaveText("namaste");
  await expect(page.getByTestId("track-text").first().getByTestId("timeline-clip").first()).toBeVisible();

  // Remove fillers: "um" and "matlab" are cut from video and captions.
  await page.getByTestId("remove-fillers").click();
  await expect(words).toHaveCount(8);
  // 12.1 s − 2 × 0.6 s
  await expect(page.getByTestId("timecode")).toContainText("/ 0:10.9");

  // Select one word and cut it.
  await words.nth(2).click();
  await page.getByTestId("cut-selected-words").click();
  await expect(words).toHaveCount(7);
  await expect(page.getByTestId("timecode")).toContainText("/ 0:10.3");

  // Undo restores the word.
  await page.getByTestId("undo").click();
  await expect(words).toHaveCount(8);
});

test("AI background removal makes the scene transparent over the canvas colour", async ({ page }) => {
  test.setTimeout(6 * 60 * 1000);
  await newProject(page);
  await page.getByTestId("media-input").setInputFiles(fixture("clip2.mp4"));
  await expect.poll(() => mainClipCount(page)).toBe(1);
  // 1 s is enough.
  await page.keyboard.press("Home");
  for (let i = 0; i < 30; i++) await page.keyboard.press("ArrowRight");
  await page.getByTestId("tool-split").click();
  await page.getByTestId("tool-delete").click();
  await page.getByTestId("track-main").getByTestId("timeline-clip").first().click();
  await page.getByTestId("tool-remove-bg").click();
  await page.getByTestId("tool-back").click();
  await page.getByTestId("tool-canvas").click();
  await page.getByRole("button", { name: "Background colour #ff375f" }).click();
  await page.getByTestId("sheet-done").click();
  await page.getByTestId("open-export").click();
  await page.getByTestId("export-size-480p").click();
  await page.getByTestId("start-export").click();
  await expect(page.getByTestId("export-done")).toBeVisible({ timeout: 4 * 60 * 1000 });
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("download").click()]);
  const out = path.join(os.tmpdir(), `just-see-bg-${Date.now()}.mp4`);
  await download.saveAs(out);
  // Colour bars contain no person, so nearly everything is removed: the
  // centre of the frame shows the pink canvas instead of the bars.
  const f = frameRgb(out, 0.5, 48, 85);
  let pinkish = 0;
  for (let i = 0; i < f.length; i += 3) if (f[i]! > 200 && f[i + 1]! < 110 && f[i + 2]! > 50 && f[i + 2]! < 160) pinkish++;
  expect(pinkish / (f.length / 3)).toBeGreaterThan(0.6);
  fs.rmSync(out, { force: true });
});
