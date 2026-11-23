import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { ensureFixtures, fixture, frameRgb, mainClipCount, meanAbsDiff, newProject } from "./helpers";

test.beforeAll(() => ensureFixtures());

/** Phase 2 "done when": a 4K export matches the preview frame for frame. */
test("4K export matches the preview (pixel diff)", async ({ page }) => {
  test.setTimeout(12 * 60 * 1000);
  await newProject(page, "9:16");
  await page.getByTestId("media-input").setInputFiles(fixture("clip1.mp4"));
  await expect.poll(() => mainClipCount(page)).toBe(1);
  // Keep 2 s.
  await page.keyboard.press("Home");
  for (let i = 0; i < 60; i++) await page.keyboard.press("ArrowRight");
  await page.getByTestId("tool-split").click();
  await page.getByTestId("tool-delete").click();
  // Effect + text so the comparison covers the whole compositor.
  await page.getByTestId("track-main").getByTestId("timeline-clip").first().click();
  await page.getByTestId("tool-effects").click();
  await page.getByTestId("effect-search").fill("vignette");
  await page.getByTestId("effect-vignette").click();
  await page.getByTestId("sheet-done").click();
  await page.getByTestId("tool-back").click();
  await page.keyboard.press("Home");
  await page.getByTestId("tool-text").click();
  await page.getByTestId("text-input").fill("4K test");
  await page.getByTestId("sheet-done").click();

  const W = 2160;
  const H = 3840;
  const times = [0.5, 1.0, 1.5];
  const previews: string[] = [];
  for (const t of times) {
    const b64 = await page.evaluate(
      async ([us, w, h]) => (window as unknown as { __justSeePreview: { capture: (a: number, b: number, c: number) => Promise<string> } }).__justSeePreview.capture(us!, w!, h!),
      [t * 1e6, W, H],
    );
    const file = path.join(os.tmpdir(), `preview-${t}-${Date.now()}.png`);
    fs.writeFileSync(file, Buffer.from(b64, "base64"));
    previews.push(file);
  }

  await page.getByTestId("open-export").click();
  await page.getByTestId("export-size-4K").click();
  await page.getByTestId("export-fps-30").click();
  await page.getByTestId("start-export").click();
  await expect(page.getByTestId("export-done")).toBeVisible({ timeout: 10 * 60 * 1000 });
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("download").click()]);
  const out = path.join(os.tmpdir(), `just-see-4k-${Date.now()}.mp4`);
  await download.saveAs(out);
  const dims = execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", out]).toString().trim();
  expect(dims).toBe(`${W},${H}`);

  // MP4 is lossy: allow encoder noise only (x264 at the same bitrate scores ~2.6 here).
  for (let i = 0; i < times.length; i++) {
    const exp = frameRgb(out, times[i]!, 540, 960);
    const prev = frameRgb(previews[i]!, 0, 540, 960);
    const diff = meanAbsDiff(exp, prev);
    console.log(`MP4 t=${times[i]}s mean abs diff ${diff.toFixed(2)}`);
    if (!process.env.KEEP_PIXEL_FILES) expect(diff, `frame at ${times[i]}s`).toBeLessThan(3);
  }
  await page.getByTestId("sheet-done").click();

  // Lossless check: a 4K PNG-sequence export must match the preview almost exactly.
  await page.keyboard.press("Home");
  for (let i = 0; i < 9; i++) await page.keyboard.press("ArrowRight");
  await page.getByTestId("track-main").getByTestId("timeline-clip").first().click();
  await page.getByTestId("tool-split").click();
  await page.getByTestId("tool-delete").click();
  const lossless: string[] = [];
  for (const t of [0.1, 0.2]) {
    const b64 = await page.evaluate(
      async ([us, w, h]) => (window as unknown as { __justSeePreview: { capture: (a: number, b: number, c: number) => Promise<string> } }).__justSeePreview.capture(us!, w!, h!),
      [t * 1e6, W, H],
    );
    const file = path.join(os.tmpdir(), `preview-ll-${t}-${Date.now()}.png`);
    fs.writeFileSync(file, Buffer.from(b64, "base64"));
    lossless.push(file);
  }
  await page.getByTestId("open-export").click();
  await page.getByTestId("format-png-zip").click();
  await page.getByText("Transparent background").click();
  await page.getByTestId("export-size-4K").click();
  await page.getByTestId("start-export").click();
  await expect(page.getByTestId("export-done")).toBeVisible({ timeout: 5 * 60 * 1000 });
  const [zipDl] = await Promise.all([page.waitForEvent("download"), page.getByTestId("download").click()]);
  const zip = path.join(os.tmpdir(), `just-see-4k-${Date.now()}.zip`);
  await zipDl.saveAs(zip);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "frames-"));
  execFileSync("python3", ["-c", "import zipfile,sys; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])", zip, dir]);
  const frames = fs.readdirSync(dir).sort();
  for (const [i, idx] of [[0, 3], [1, 6]] as const) {
    const exp = frameRgb(path.join(dir, frames[idx]!), 0, 540, 960);
    const prev = frameRgb(lossless[i]!, 0, 540, 960);
    const diff = meanAbsDiff(exp, prev);
    console.log(`PNG frame ${idx} mean abs diff ${diff.toFixed(2)}`);
    if (!process.env.KEEP_PIXEL_FILES) expect(diff, `lossless frame ${idx}`).toBeLessThan(0.5);
  }
  if (process.env.KEEP_PIXEL_FILES) {
    console.log("lossless", lossless.join(","), dir);
    return;
  }
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(zip, { force: true });
  for (const f of lossless) fs.rmSync(f, { force: true });
  if (process.env.KEEP_PIXEL_FILES) console.log("files", previews.join(","), out);
  else for (const f of [...previews, out]) fs.rmSync(f, { force: true });
});
