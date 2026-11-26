import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { ensureFixtures, fixture, mainClipCount, newProject } from "./helpers";

test.beforeAll(() => ensureFixtures());

/** No real network in CI: Google Fonts and Openverse are mocked. */
async function mockNetwork(page: Page): Promise<void> {
  await page.route("https://fonts.googleapis.com/**", (r) => r.fulfill({ status: 200, contentType: "text/css", body: "/* mocked */" }));
  await page.route("https://api.openverse.org/**", (r) =>
    r.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify({
        results: [
          {
            id: "ov-1",
            title: "Heavy rain on roof",
            creator: "Field Recorder",
            url: "https://files.example.test/rain.mp3",
            duration: 8000,
            filetype: "mp3",
            license: "by",
            license_version: "4.0",
            license_url: "https://creativecommons.org/licenses/by/4.0/",
            foreign_landing_url: "https://freesound.example.test/s/1",
            attribution: '"Heavy rain on roof" by Field Recorder, CC BY 4.0',
            provider: "freesound",
          },
          { id: "ov-2", title: "Share-alike (must be filtered)", creator: "x", url: "https://files.example.test/x.mp3", license: "by-sa", provider: "freesound" },
        ],
      }),
    }),
  );
  await page.route("https://files.example.test/rain.mp3", async (r) =>
    r.fulfill({ status: 200, contentType: "audio/mpeg", headers: { "access-control-allow-origin": "*" }, body: fs.readFileSync(fixture("music.mp3")) }),
  );
}

/** Phase 5 "done when": one search covers fonts, music and SFX, and every asset carries licence data. */
test("library: one search for fonts, music and sounds; every asset has a licence", async ({ page }) => {
  test.setTimeout(4 * 60 * 1000);
  await mockNetwork(page);
  await newProject(page);
  await page.getByTestId("media-input").setInputFiles(fixture("photo.png"));
  await expect.poll(() => mainClipCount(page)).toBe(1);
  await page.keyboard.press("Home");

  // Text clip → Style → More fonts → Poppins.
  await page.getByTestId("tool-text").click();
  await page.getByTestId("sheet-done").click();
  await page.getByTestId("tool-style").click();
  await page.getByTestId("more-fonts").click();
  await expect(page.getByTestId("library")).toBeVisible();
  await page.getByTestId("library-search").fill("poppins");
  await expect(page.getByTestId("lib-item-font:Poppins")).toBeVisible();
  await page.getByTestId("lib-add-font:Poppins").click();
  await page.getByTestId("library-close").click();
  await expect(page.getByTestId("font-Poppins")).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("sheet-done").click();
  await page.locator("body").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("Escape");

  // One search box: sounds, music and fonts from the same place.
  await page.getByTestId("tool-library").click();
  await page.getByTestId("lib-tab-all").click();
  const search = page.getByTestId("library-search");
  await search.fill("rain");
  await expect(page.getByTestId("lib-item-sound:rain")).toBeVisible();
  await search.fill("barish"); // Hindi
  await expect(page.getByTestId("lib-item-sound:rain")).toBeVisible();
  await search.fill("lofi");
  await expect(page.getByTestId("lib-item-music:lofi")).toBeVisible();
  await search.fill("devanagari");
  await expect(page.getByTestId("lib-item-font:Kalam")).toBeVisible();
  await search.fill("lower third");
  await expect(page.getByTestId("lib-item-template:lower-third-clean")).toBeVisible();
  // Every card shows a licence.
  for (const l of await page.getByTestId("lib-license").allTextContents()) expect(l.trim().length).toBeGreaterThan(0);

  await search.fill("rain");
  await page.getByTestId("lib-add-sound:rain").click();
  await expect(page.getByTestId("track-audio").getByTestId("timeline-clip")).toHaveCount(1, { timeout: 20_000 });
  await search.fill("lofi");
  await page.getByTestId("lib-add-music:lofi").click();
  await expect(page.getByTestId("track-audio").getByTestId("timeline-clip")).toHaveCount(2, { timeout: 120_000 });

  // Free online sounds (CC BY only shown; share-alike filtered out).
  await search.fill("rain roof");
  await page.getByTestId("lib-tab-online").click();
  await expect(page.getByTestId("online-item")).toHaveCount(1);
  await expect(page.getByTestId("online-item")).toContainText("CC BY 4.0");
  await page.getByTestId("online-add").click();
  await expect(page.getByTestId("track-audio").getByTestId("timeline-clip")).toHaveCount(3, { timeout: 30_000 });

  // Licences page: every file and font with its licence.
  await page.getByTestId("lib-tab-licenses").click();
  const names = await page.getByTestId("license-name").allTextContents();
  console.log("licences", names);
  expect(names).toContain("Your own media"); // the photo
  expect(names).toContain("Built-in (free for any use)"); // rain sfx
  expect(names).toContain("Your own (made in Just See)"); // lo-fi bounce
  expect(names).toContain("CC BY 4.0"); // online sound
  expect(names).toContain("OFL 1.1"); // Poppins
  expect(names.every((n) => n.trim().length > 0)).toBe(true);
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByTestId("credits-download").click()]);
  const credits = fs.readFileSync((await dl.path())!, "utf8");
  expect(credits).toContain('"Heavy rain on roof" by Field Recorder, CC BY 4.0');
  expect(credits).toContain("Poppins");
});

test("backup: save a .justsee file and open it as a project", async ({ page }) => {
  test.setTimeout(3 * 60 * 1000);
  await newProject(page);
  await page.getByTestId("media-input").setInputFiles([fixture("clip1.mp4"), fixture("photo.png")]);
  await expect.poll(() => mainClipCount(page)).toBe(2);
  await page.getByTestId("tool-text").click();
  await page.getByTestId("sheet-done").click();
  await page.locator("body").click({ position: { x: 5, y: 5 } });
  await page.getByTestId("open-export").click();
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByTestId("backup-save").click()]);
  expect(dl.suggestedFilename()).toMatch(/\.justsee$/);
  const file = path.join(os.tmpdir(), `backup-${Date.now()}.justsee`);
  await dl.saveAs(file);
  expect(fs.statSync(file).size).toBeGreaterThan(fs.statSync(fixture("clip1.mp4")).size);

  await page.goto("/");
  await page.getByTestId("backup-open").setInputFiles(file);
  await expect(page).toHaveURL(/\/edit\/\?id=/);
  await expect.poll(() => mainClipCount(page)).toBe(2);
  await expect(page.getByTestId("track-text").getByTestId("timeline-clip")).toHaveCount(1);
  // Media really came back: thumbnails of the restored clips render.
  await expect(page.getByTestId("preview-canvas")).toBeVisible();
  await page.goto("/");
  await expect(page.getByText(/Untitled|बिना नाम/).first()).toBeVisible();
  fs.rmSync(file, { force: true });
});

test("my templates: save a motion comp and reuse it from the library", async ({ page }) => {
  test.setTimeout(2 * 60 * 1000);
  await newProject(page);
  await page.getByTestId("media-input").setInputFiles(fixture("photo.png"));
  await expect.poll(() => mainClipCount(page)).toBe(1);
  await page.getByTestId("tool-motion").click();
  await page.getByTestId("motion-blank").click();
  await page.getByTestId("motion-add-text").click();
  await page.getByTestId("motion-save-template").click();
  await page.getByTestId("motion-back").click();
  await page.getByTestId("motion-close").click();
  await page.getByTestId("tool-library").click();
  await page.getByTestId("lib-tab-template").click();
  await page.getByTestId("library-search").fill("composition");
  const mine = page.locator('[data-testid^="lib-item-mine:"]');
  await expect(mine).toHaveCount(1);
  await mine.locator('[data-testid^="lib-add-mine:"]').click();
  await page.getByTestId("library-close").click();
  await expect(page.getByTestId("track-text").getByTestId("timeline-clip")).toHaveCount(1);
});
