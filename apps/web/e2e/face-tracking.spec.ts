import { expect, test, type Page } from "@playwright/test";
import { ensureFixtures, fixture, mainClipCount, newProject } from "./helpers";

/**
 * Face tracking. The real face model downloads from Google, so the test uses
 * a stand-in detector that finds the moving white block
 * (face.mp4: it slides right and bobs up and down) and treats it as the face.
 */
test.beforeAll(() => ensureFixtures());

const STAND_IN = `
  window.__justSeeFaceDetector = (frame, w, h) => {
    const c = document.createElement("canvas"); c.width = 72; c.height = 128;
    const x = c.getContext("2d", { willReadFrequently: true }); x.drawImage(frame, 0, 0, 72, 128);
    const d = x.getImageData(0, 0, 72, 128).data;
    let minX = 99, minY = 999, maxX = -1, maxY = -1;
    for (let y = 0; y < 128; y++) for (let i = 0; i < 72; i++) {
      const p = (y * 72 + i) * 4;
      if (d[p] > 200 && d[p + 1] > 200 && d[p + 2] > 200) { minX = Math.min(minX, i); maxX = Math.max(maxX, i); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
    }
    if (maxX < 0) return [];
    return [{ cx: (minX + maxX + 1) / 2 / 72, cy: (minY + maxY + 1) / 2 / 128, w: (maxX - minX + 1) / 72, h: (maxY - minY + 1) / 128 }];
  };
`;

/** Centre and size of the white box in the rendered frame, as fractions of the frame. */
async function whiteBox(
  page: Page,
  us: number,
): Promise<{ cx: number; cy: number; w: number; n: number }> {
  return page.evaluate(async (t) => {
    const b64 = await (
      window as unknown as {
        __justSeePreview: {
          capture: (a: number, b: number, c: number) => Promise<string>;
        };
      }
    ).__justSeePreview.capture(t, 180, 320);
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = 180;
    c.height = 320;
    const x = c.getContext("2d")!;
    x.drawImage(img, 0, 0);
    const d = x.getImageData(0, 0, 180, 320).data;
    let sx = 0,
      sy = 0,
      n = 0,
      minX = 999,
      maxX = -1;
    for (let y = 0; y < 320; y++)
      for (let i = 0; i < 180; i++) {
        const p = (y * 180 + i) * 4;
        if (d[p]! > 200 && d[p + 1]! > 200 && d[p + 2]! > 200) {
          sx += i;
          sy += y;
          n++;
          minX = Math.min(minX, i);
          maxX = Math.max(maxX, i);
        }
      }
    return {
      cx: n ? sx / n / 180 : -1,
      cy: n ? sy / n / 320 : -1,
      w: n ? (maxX - minX + 1) / 180 : 0,
      n,
    };
  }, us);
}

async function setup(page: Page) {
  await page.addInitScript(STAND_IN);
  await newProject(page, "9:16");
  await page.getByTestId("media-input").setInputFiles([fixture("face.mp4")]);
  await expect.poll(() => mainClipCount(page)).toBe(1);
  await page
    .getByTestId("track-main")
    .getByTestId("timeline-clip")
    .first()
    .click();
  await page.getByTestId("tool-face").click();
}

test("follow face: the frame moves with the face and zooms in", async ({
  page,
}) => {
  await setup(page);
  // Without tracking the box drifts right.
  const before0 = await whiteBox(page, 300_000);
  const before3 = await whiteBox(page, 3_300_000);
  expect(before3.cx - before0.cx).toBeGreaterThan(0.1);

  await page.getByTestId("face-follow").click();
  await expect(page.getByText("Face tracked")).toBeVisible({ timeout: 60_000 });
  const a = await whiteBox(page, 300_000);
  const b = await whiteBox(page, 3_300_000);
  // The face stays centred while it moves, and is bigger (zoomed in).
  expect(Math.abs(a.cx - 0.5)).toBeLessThan(0.05);
  expect(Math.abs(b.cx - 0.5)).toBeLessThan(0.05);
  expect(a.w).toBeGreaterThan(before0.w * 1.15);
});

for (const mode of ["blur", "mosaic"] as const)
  test(`${mode} face: the face is hidden all along its path`, async ({
    page,
  }) => {
    await setup(page);
    const plain0 = await whiteBox(page, 500_000);
    const plain3 = await whiteBox(page, 3_000_000);
    await page.getByTestId(`face-${mode}`).click();
    await expect(page.getByText("Face tracked")).toBeVisible({
      timeout: 60_000,
    });
    // The face is mixed with what is around it: far fewer pure-white pixels, at both ends of its path.
    const m0 = await whiteBox(page, 500_000);
    const m3 = await whiteBox(page, 3_000_000);
    // Blur washes it out; mosaic turns a flat block into blocks, which only changes its edges.
    const limit = mode === "blur" ? 0.6 : 0.85;
    expect(m0.n).toBeLessThan(plain0.n * limit);
    expect(m3.n).toBeLessThan(plain3.n * limit);
  });

test("stick an emoji to the face: a new text clip follows the face", async ({
  page,
}) => {
  await setup(page);
  await page.getByTestId("face-sticker-👑").click();
  await page.getByTestId("face-stick").click();
  await expect(page.getByText("Face tracked")).toBeVisible({ timeout: 60_000 });
  await expect(
    page.getByTestId("track-text").getByTestId("timeline-clip"),
  ).toHaveCount(1);
  await expect(
    page.getByTestId("track-text").getByTestId("timeline-clip"),
  ).toContainText("👑");
});
