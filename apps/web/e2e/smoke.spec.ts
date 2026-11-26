import { expect, test } from "@playwright/test";

test("home page loads and offers new projects", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Just See" })).toBeVisible();
  await expect(page.getByTestId("new-9:16")).toBeVisible();
});

test("all effect and transition shaders compile", async ({ page }) => {
  await page.goto("/diagnostics/");
  const d = page.getByTestId("diagnostics");
  await expect(d).toBeVisible();
  const errors = await d.getAttribute("data-shader-errors");
  if (errors !== "0") console.log(await d.textContent());
  expect(errors).toBe("0");
  const renderErrors = await d.getAttribute("data-render-errors");
  if (renderErrors !== "0") console.log(await d.textContent());
  expect(renderErrors).toBe("0");
  expect(Number(await d.getAttribute("data-effects"))).toBeGreaterThanOrEqual(150);
  expect(Number(await d.getAttribute("data-transitions"))).toBeGreaterThanOrEqual(80);
});

test("Hindi UI switch", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Language" }).click();
  await expect(page.getByText("नया प्रोजेक्ट", { exact: false })).toBeVisible();
  await page.reload();
  await expect(page.getByText("नया प्रोजेक्ट", { exact: false })).toBeVisible();
});

test("PWA manifest and service worker are served", async ({ request }) => {
  const m = await request.get("/manifest.webmanifest");
  expect(m.ok()).toBe(true);
  const json = (await m.json()) as { display: string; icons: unknown[] };
  expect(json.display).toBe("standalone");
  expect(json.icons.length).toBeGreaterThan(1);
  expect((await request.get("/sw.js")).ok()).toBe(true);
});
