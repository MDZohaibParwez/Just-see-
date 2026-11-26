import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { ensureFixtures, ffprobe, fixture, mainClipCount, newProject } from "./helpers";

test.beforeAll(() => ensureFixtures());

async function runExport(page: Page, format: string, name: string): Promise<string> {
  await page.getByTestId("open-export").click();
  await page.getByTestId(`format-${format}`).click();
  if (format !== "gif") await page.getByTestId("export-size-480p").click();
  await page.getByTestId("start-export").click();
  await expect(page.getByTestId("export-done")).toBeVisible({ timeout: 4 * 60 * 1000 });
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("download").click()]);
  const out = path.join(os.tmpdir(), `just-see-${name}-${Date.now()}${path.extname(download.suggestedFilename())}`);
  await download.saveAs(out);
  await page.getByTestId("sheet-done").click();
  return out;
}

test("beat markers and cut-to-beat", async ({ page }) => {
  await newProject(page);
  await page.getByTestId("media-input").setInputFiles([fixture("clip1.mp4"), fixture("clip2.mp4")]);
  await expect.poll(() => mainClipCount(page)).toBe(2);
  await page.keyboard.press("Home");
  await page.getByTestId("music-input").setInputFiles(fixture("beat.mp3"));
  await page.getByTestId("track-audio").getByTestId("timeline-clip").click();
  await page.getByTestId("tool-beats").click();
  await expect.poll(() => page.getByTestId("beat-marker").count(), { timeout: 30_000 }).toBeGreaterThan(15);
  await page.getByTestId("tool-back").click();
  await page.getByTestId("tool-cut-to-beat").click();
  // Clip 1 (12.1 s) now ends on a beat at 12.25 s or 11.75 s; total changes from 24.2 s.
  await expect(page.getByTestId("timecode")).not.toContainText("/ 0:24.2");
});

test("remove silence cuts the quiet middle", async ({ page }) => {
  await newProject(page);
  await page.getByTestId("music-input").setInputFiles(fixture("gap.mp3"));
  await expect(page.getByTestId("track-audio").getByTestId("timeline-clip")).toHaveCount(1);
  await page.getByTestId("track-audio").getByTestId("timeline-clip").click();
  await page.getByTestId("tool-silence").click();
  // One gap removed → the audio track now has two clips.
  await expect(page.getByTestId("track-audio").getByTestId("timeline-clip")).toHaveCount(2, { timeout: 30_000 });
});

test("GIF, WebM and transparent PNG sequence exports", async ({ page }) => {
  test.setTimeout(8 * 60 * 1000);
  await newProject(page);
  await page.getByTestId("media-input").setInputFiles(fixture("clip5.mp4"));
  await expect.poll(() => mainClipCount(page)).toBe(1);
  // Trim to 1.5 s to keep it quick.
  await page.keyboard.press("Home");
  for (let i = 0; i < 45; i++) await page.keyboard.press("ArrowRight");
  await page.getByTestId("tool-split").click();
  await page.getByTestId("tool-delete").click();

  const gif = await runExport(page, "gif", "gif");
  expect(fs.readFileSync(gif).subarray(0, 6).toString()).toBe("GIF89a");
  const gp = ffprobe(gif);
  expect(gp.streams[0]?.codec_name).toBe("gif");
  expect(gp.streams[0]?.width).toBe(480);

  const webm = await runExport(page, "webm", "webm");
  const wp = ffprobe(webm);
  expect(wp.streams.find((s) => s.codec_type === "video")?.codec_name).toMatch(/vp9|av1/);
  expect(wp.streams.find((s) => s.codec_type === "audio")?.codec_name).toBe("opus");

  const zip = await runExport(page, "png-zip", "png");
  const list = execFileSync("python3", ["-c", "import zipfile,sys; z=zipfile.ZipFile(sys.argv[1]); print(len(z.namelist())); z.extract(z.namelist()[0], sys.argv[2])", zip, os.tmpdir()]).toString();
  expect(Number(list.trim())).toBeGreaterThan(40);
  fs.rmSync(gif);
  fs.rmSync(webm);
  fs.rmSync(zip);
});
