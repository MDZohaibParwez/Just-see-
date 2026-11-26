import { expect, test } from "@playwright/test";
import { ensureFixtures, fixture, mainClipCount, newProject } from "./helpers";

test.beforeAll(() => ensureFixtures());

/** Two devices edit the same project at the same time (direct WebRTC, local broker in tests). */
test("live editing: host and guest see each other's edits and media", async ({ page, browser }) => {
  test.setTimeout(3 * 60 * 1000);
  await page.addInitScript(() => sessionStorage.setItem("justsee:peer", "127.0.0.1:9000"));
  await newProject(page);
  await page.getByTestId("media-input").setInputFiles(fixture("clip1.mp4"));
  await expect.poll(() => mainClipCount(page)).toBe(1);
  await page.getByTestId("open-export").click();
  await page.getByTestId("share-live").click();
  await page.getByTestId("live-start").click();
  await expect(page.getByTestId("live-link")).toHaveValue(/live=/, { timeout: 20_000 });
  const link = await page.getByTestId("live-link").inputValue();
  expect(link).toMatch(/\/edit\/\?live=[a-z0-9]+&peer=127.0.0.1%3A9000/);
  await page.getByTestId("live-close").click();

  // Another device (empty storage) joins.
  const other = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true });
  const guest = await other.newPage();
  await guest.goto(link);
  await expect(guest.getByTestId("timeline")).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => guest.getByTestId("track-main").getByTestId("timeline-clip").count()).toBe(1);
  // The video file arrived over the direct connection.
  await expect(guest.getByTestId("live-badge")).not.toContainText("⇣", { timeout: 60_000 });
  await expect(page.getByTestId("live-badge")).toContainText("2");

  // Guest adds text → host sees it.
  await guest.getByTestId("tool-text").click();
  await expect(page.getByTestId("track-text").getByTestId("timeline-clip")).toHaveCount(1, { timeout: 15_000 });

  // Host adds a clip → guest gets the clip and its media.
  await page.locator("body").click({ position: { x: 5, y: 5 } });
  await page.getByTestId("media-input").setInputFiles(fixture("clip2.mp4"));
  await expect.poll(() => guest.getByTestId("track-main").getByTestId("timeline-clip").count(), { timeout: 30_000 }).toBe(2);
  await expect(guest.getByTestId("live-badge")).not.toContainText("⇣", { timeout: 60_000 });

  // Undo on the host is shared too.
  await page.keyboard.press("Control+z");
  await expect.poll(() => guest.getByTestId("track-main").getByTestId("timeline-clip").count(), { timeout: 15_000 }).toBe(1);

  await guest.waitForTimeout(1000);
  // Guest's preview really draws the video (not black).
  const lum = await guest.getByTestId("preview-canvas").evaluate((c) => {
    const cv = c as HTMLCanvasElement;
    const tmp = document.createElement("canvas");
    tmp.width = 32;
    tmp.height = 32;
    const ctx = tmp.getContext("2d")!;
    ctx.drawImage(cv, 0, 0, 32, 32);
    const d = ctx.getImageData(0, 0, 32, 32).data;
    let s = 0;
    for (let i = 0; i < d.length; i += 4) s += d[i]! + d[i + 1]! + d[i + 2]!;
    return s / (d.length / 4) / 3;
  });
  expect(lum).toBeGreaterThan(10);
  await other.close();
});
