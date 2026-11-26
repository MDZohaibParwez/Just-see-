import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { ensureFixtures, ffprobe, fixture } from "./helpers";

/** Phase 7 budget: a new user finishes a first edit in under 60 seconds. */
test.beforeAll(() => ensureFixtures());

test("first edit: Quick reel finished in under 60 s, then saves a valid MP4", async ({ page }) => {
  test.setTimeout(5 * 60 * 1000);
  const t0 = Date.now();
  await page.goto("/");
  await page.getByTestId("quick-reel-input").setInputFiles(["clip1.mp4", "clip2.mp4", "clip5.mp4"].map(fixture));
  await expect(page).toHaveURL(/\/edit\/\?id=.*quick=1/);
  // The reel is built, music added and the Export sheet opens by itself.
  await expect(page.getByTestId("start-export")).toBeVisible({ timeout: 45_000 });
  await expect(page.getByTestId("track-main").getByTestId("timeline-clip")).toHaveCount(3);
  await expect(page.getByTestId("track-audio").getByTestId("timeline-clip")).toHaveCount(1);
  await expect(page.getByTestId("timecode")).toContainText("/ 0:30.0");
  const built = Date.now() - t0;
  // The edit is finished once the user can press Export. Encoding time after
  // that depends on the device's video encoder (this test box has none).
  await page.getByTestId("start-export").click();
  const editDone = Date.now() - t0;
  await expect(page.getByTestId("export-done")).toBeVisible({ timeout: 4 * 60 * 1000 });
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("download").click()]);
  const total = Date.now() - t0;
  const out = path.join(os.tmpdir(), `just-see-quick-${Date.now()}.mp4`);
  await download.saveAs(out);
  console.log(`ONBOARDING: reel ready ${built} ms, export started ${editDone} ms, saved MP4 after ${total} ms`);

  const probe = ffprobe(out);
  expect(probe.streams.some((s) => s.codec_type === "video")).toBe(true);
  expect(probe.streams.some((s) => s.codec_type === "audio")).toBe(true);
  expect(Number(probe.format.duration)).toBeGreaterThan(29.5);
  expect(Number(probe.format.duration)).toBeLessThan(30.5);
  fs.rmSync(out, { force: true });
  expect(editDone).toBeLessThan(60_000);
});

test("first-run tips show once and can be dismissed", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("new-9:16").click();
  const tip = page.getByTestId("first-run-tip");
  await expect(tip).toContainText("1/3");
  await page.getByTestId("tip-next").click();
  await expect(tip).toContainText("2/3");
  await page.getByTestId("tip-next").click();
  await page.getByTestId("tip-next").click();
  await expect(tip).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId("timeline")).toBeVisible();
  await expect(tip).toHaveCount(0);
});
