import { expect, test } from "@playwright/test";

const API = "http://localhost:4180";

/** Phase 7: crashes are recorded on the device and sent only when the user asks. */
test("an error is recorded, shown on /diagnostics and can be sent", async ({ page }) => {
  const sent: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/report")) sent.push(r.url());
  });
  await page.goto("/");
  await expect(page.getByTestId("home-ready")).toBeAttached();
  // An uncaught error somewhere in the app.
  await page.evaluate(() => setTimeout(() => {
    throw new Error("Test crash in clip My Holiday.mp4");
  }, 0));
  await page.waitForTimeout(300);
  expect(sent).toHaveLength(0);

  await page.goto(`/diagnostics/?api=${encodeURIComponent(API)}`);
  const item = page.getByTestId("crash-item");
  await expect(item).toHaveCount(1);
  await expect(item).toContainText("file.mp4");
  await expect(item).not.toContainText("Holiday");
  await page.getByTestId("crash-send").click();
  await expect(page.getByTestId("crash-msg")).toContainText("Sent. Report id:");
  expect(sent).toHaveLength(1);
  await expect(page.getByTestId("usage")).toContainText("crash");

  await page.getByTestId("crash-clear").click();
  await expect(page.getByTestId("no-crashes")).toBeVisible();
});
