import { devices, expect, test } from "@playwright/test";
import { newProject } from "./helpers";

test("data safety: backup reminder, free cloud backup link, restore on another device", async ({ page, browser }) => {
  test.setTimeout(2 * 60 * 1000);
  await page.addInitScript(() => sessionStorage.setItem("justsee:api", "http://localhost:4180"));
  await newProject(page);
  await page.goto("/");
  await expect(page.getByTestId("backup-reminder")).toBeVisible();
  await page.getByTestId("cloud-backup").click();
  await expect(page.getByTestId("cloud-backups")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("backup-reminder")).toHaveCount(0);
  await page.getByTestId("cloud-backups").locator("summary").click();
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.getByTestId("cloud-backups").getByRole("button").first().click();
  const link = await page.evaluate(() => navigator.clipboard.readText());
  expect(link).toContain("/open/?share=");
  const other = await browser.newContext();
  const p2 = await other.newPage();
  await p2.goto(link);
  await expect(p2).toHaveURL(/\/edit\/\?id=/, { timeout: 60_000 });
  await other.close();
});

test("data safety: iPhone users see how to add the app to the Home Screen", async ({ browser }) => {
  const ctx = await browser.newContext({ ...devices["iPhone 13"], defaultBrowserType: undefined } as Parameters<typeof browser.newContext>[0]);
  const page = await ctx.newPage();
  await page.goto("/");
  await expect(page.getByTestId("ios-guide")).toBeVisible();
  await page.getByTestId("ios-guide").getByRole("button").click();
  await expect(page.getByTestId("ios-guide")).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId("ios-guide")).toHaveCount(0);
  await ctx.close();
});
