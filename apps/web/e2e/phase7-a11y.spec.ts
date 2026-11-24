import { expect, test, type Page } from "@playwright/test";
import { audit, type A11yIssue } from "./a11y";
import { ensureFixtures, fixture, mainClipCount, newProject } from "./helpers";

/** Phase 7: WCAG AA contrast and a name on every control, on every main screen, in both themes. */
test.beforeAll(() => ensureFixtures());

async function check(page: Page, screen: string, all: string[]): Promise<void> {
  await page.waitForTimeout(300);
  const issues: A11yIssue[] = await audit(page);
  for (const i of issues) all.push(`${screen}: ${i.rule} ${i.what}${i.detail ? ` ${i.detail}` : ""}`);
}

for (const theme of ["dark", "light"] as const) {
  test(`every screen passes the audit (${theme})`, async ({ page }) => {
    await page.addInitScript((t) => localStorage.setItem("js.theme", t), theme);
    const all: string[] = [];
    await page.goto("/");
    await expect(page.getByTestId("new-9:16")).toBeVisible();
    await check(page, "home", all);

    await newProject(page);
    await check(page, "editor empty", all);
    await page.getByTestId("media-input").setInputFiles([fixture("clip1.mp4"), fixture("photo.png")]);
    await expect.poll(() => mainClipCount(page)).toBe(2);
    await check(page, "editor", all);

    await page.getByTestId("track-main").getByTestId("timeline-clip").first().click();
    await check(page, "clip tools", all);
    for (const tool of ["speed", "effects", "adjust", "crop", "volume"]) {
      await page.getByTestId(`tool-${tool}`).click();
      await check(page, `panel ${tool}`, all);
      await page.keyboard.press("Escape");
    }
    await page.keyboard.press("Escape");
    for (const tool of ["captions", "sfx", "canvas", "ai-voice"]) {
      await page.getByTestId(`tool-${tool}`).click();
      await check(page, `panel ${tool}`, all);
      await page.keyboard.press("Escape");
    }
    await page.getByTestId("tool-text").click();
    await check(page, "text", all);
    await page.getByTestId("sheet-done").click();
    await page.getByTestId("tool-back").click();

    await page.getByTestId("tool-library").click();
    await check(page, "library", all);
    await page.keyboard.press("Escape");
    await page.getByTestId("tool-studio").click();
    await check(page, "studio", all);
    await page.keyboard.press("Escape");
    await page.getByTestId("tool-motion").click();
    await check(page, "motion", all);
    await page.keyboard.press("Escape");

    await page.goto("/diagnostics/");
    await expect(page.getByTestId("diagnostics")).toBeVisible();
    await check(page, "diagnostics", all);

    console.log(all.join("\n"));
    expect(all).toEqual([]);
  });
}

test("keyboard: Tab reaches controls and focus is visible", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("new-9:16")).toBeVisible();
  const seen: string[] = [];
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press("Tab");
    const r = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      const cs = getComputedStyle(el);
      const ring = (cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0) || (cs.boxShadow && cs.boxShadow !== "none");
      return { tag: el.tagName, ring };
    });
    if (r) {
      seen.push(r.tag);
      expect(r.ring, `focus ring on ${r.tag}`).toBe(true);
    }
  }
  expect(seen.length).toBeGreaterThan(3);
});
