import { expect, test, type Page } from "@playwright/test";
import { ensureFixtures, fixture, mainClipCount, newProject } from "./helpers";

test.beforeAll(() => ensureFixtures());

async function dragClip(page: Page, nth: number, dx: number) {
  const clip = page.getByTestId("track-main").getByTestId("timeline-clip").nth(nth);
  const box = (await clip.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(x + (dx * i) / 10, y);
  await page.mouse.up();
}

test("roll, slip and slide edit modes keep the timeline length", async ({ page }) => {
  await newProject(page);
  await page.getByTestId("media-input").setInputFiles([fixture("clip1.mp4"), fixture("clip2.mp4"), fixture("clip5.mp4")]);
  await expect.poll(() => mainClipCount(page)).toBe(3);
  for (let i = 0; i < 6; i++) await page.keyboard.press("-");
  await page.keyboard.press("Home");
  // Shorten clip 2 so it has source to spare on both sides.
  await page.getByTestId("track-main").getByTestId("timeline-clip").nth(1).click();
  await page.getByTestId("edit-mode-trim").click();
  const total = async () => (await page.getByTestId("timecode").textContent())?.split("/")[1]?.trim();
  for (const mode of ["slip", "slide"] as const) {
    const before = await total();
    await page.getByTestId(`edit-mode-${mode}`).click();
    await dragClip(page, 1, 30);
    expect(await total()).toBe(before);
  }
});

test("multi-select, group and delete", async ({ page }) => {
  await newProject(page);
  await page.getByTestId("media-input").setInputFiles([fixture("clip1.mp4"), fixture("clip2.mp4"), fixture("clip5.mp4")]);
  await expect.poll(() => mainClipCount(page)).toBe(3);
  for (let i = 0; i < 6; i++) await page.keyboard.press("-");
  await page.getByTestId("track-main").getByTestId("timeline-clip").nth(0).click();
  await page.getByTestId("tool-select-more").click();
  await page.getByTestId("track-main").getByTestId("timeline-clip").nth(2).click();
  await page.getByTestId("tool-multi-delete").click();
  await expect.poll(() => mainClipCount(page)).toBe(1);
  await page.getByTestId("undo").click();
  await expect.poll(() => mainClipCount(page)).toBe(3);
});

test("transition easing, text templates and pen mask", async ({ page }) => {
  await newProject(page);
  await page.getByTestId("media-input").setInputFiles([fixture("clip1.mp4"), fixture("clip2.mp4")]);
  await expect.poll(() => mainClipCount(page)).toBe(2);
  for (let i = 0; i < 6; i++) await page.keyboard.press("-");
  await page.getByTestId("transition-button").first().click();
  await page.getByTestId("trcat-wipe").click();
  await page.getByTestId("transition-heart-open").click();
  await page.getByTestId("tr-ease-linear").click();
  await expect(page.getByTestId("tr-ease-linear")).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("sheet-done").click();

  await page.getByTestId("tool-back").click();
  await page.getByTestId("tool-text").click();
  await page.getByTestId("text-tpl-lower-third").click();
  await page.getByTestId("text-input").fill("Zohaib · Creator");
  await page.getByTestId("sheet-done").click();
  await page.getByTestId("tool-back").click();

  await page.getByTestId("track-main").getByTestId("timeline-clip").first().click();
  await page.getByTestId("tool-effects").click();
  await page.getByTestId("effect-search").fill("pen");
  await page.getByTestId("effect-mask-pen").click();
  await expect(page.getByText("Point 6 Y")).toBeVisible();
});

test("auto reframe adds follow keyframes for a wide clip in 9:16", async ({ page }) => {
  test.setTimeout(3 * 60 * 1000);
  await newProject(page, "9:16");
  await page.getByTestId("media-input").setInputFiles(fixture("clip2.mp4"));
  await expect.poll(() => mainClipCount(page)).toBe(1);
  await page.getByTestId("track-main").getByTestId("timeline-clip").first().click();
  await page.getByTestId("tool-reframe").click();
  await expect.poll(() => page.getByTestId("keyframe-marker").count(), { timeout: 120_000 }).toBeGreaterThan(10);
});
