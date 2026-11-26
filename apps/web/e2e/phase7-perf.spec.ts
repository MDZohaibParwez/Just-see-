import { expect, test, type Page } from "@playwright/test";
import { ensureFixtures, fixture, mainClipCount, newProject } from "./helpers";

/**
 * Phase 7 performance budgets (README "Performance targets"), measured in the
 * real app. Numbers are printed so the phase status doc can quote them.
 */
test.beforeAll(() => ensureFixtures());

type Stats = { frames: number; fps: number; renderP95Ms: number; seekP95Ms: number; seekMaxMs: number; droppedPct: number; quality: number };
const stats = (page: Page) => page.evaluate(() => (window as unknown as { __justSeePreview: { stats(): Stats } }).__justSeePreview.stats());
const reset = (page: Page) => page.evaluate(() => (window as unknown as { __justSeePreview: { resetStats(): void } }).__justSeePreview.resetStats());

/** Frame gaps of the page's own animation loop over `ms`. */
async function uiFrames(page: Page, ms: number, during: () => Promise<void>): Promise<{ fps: number; p95: number }> {
  await page.evaluate((ms) => {
    const w = window as unknown as { __gaps: number[] };
    w.__gaps = [];
    let last = performance.now();
    const end = last + ms;
    const tick = (now: number) => {
      w.__gaps.push(now - last);
      last = now;
      if (now < end) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, ms);
  await during();
  await page.waitForTimeout(ms + 100);
  return page.evaluate(() => {
    const g = (window as unknown as { __gaps: number[] }).__gaps.slice(1);
    const s = [...g].sort((a, b) => a - b);
    return { fps: (g.length * 1000) / g.reduce((a, b) => a + b, 0), p95: s[Math.floor(s.length * 0.95)] ?? 0 };
  });
}

test("app shell loads in under 3 s on a slow 4G phone", async ({ page, context }) => {
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  // Lighthouse "slow 4G": 1.6 Mbps, 150 ms RTT, 4× slower CPU.
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 150, downloadThroughput: 1.6e6 / 8, uploadThroughput: 750e3 / 8 });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  const t0 = Date.now();
  await page.goto("/");
  // Interactive: React has hydrated and the new-project button works.
  await page.waitForFunction(() => document.querySelector('[data-testid="home-ready"]') !== null);
  const home = Date.now() - t0;
  const t1 = Date.now();
  await page.getByTestId("new-9:16").click();
  await expect(page.getByTestId("timeline")).toBeVisible();
  const editor = Date.now() - t1;
  console.log(`PERF shell: home interactive ${home} ms, editor ready ${editor} ms (slow 4G, 4× CPU)`);
  expect(home).toBeLessThan(3000);
  expect(editor).toBeLessThan(3000);
});

test("1080p preview with 3 video layers + effects plays at 30 fps; scrub under 100 ms", async ({ page }) => {
  await newProject(page);
  await page.getByTestId("media-input").setInputFiles([fixture("clip1.mp4")]);
  await expect.poll(() => mainClipCount(page)).toBe(1);
  // Two picture-in-picture layers on top.
  await page.keyboard.press("Home");
  await page.getByTestId("overlay-input").setInputFiles([fixture("clip2.mp4")]);
  await expect(page.getByTestId("track-video")).toHaveCount(1);
  await page.getByTestId("overlay-input").setInputFiles([fixture("clip4.mp4")]);
  await expect(page.getByTestId("track-video")).toHaveCount(2);
  // An effect on the main clip.
  await page.getByTestId("track-main").getByTestId("timeline-clip").first().click();
  await page.getByTestId("tool-effects").click();
  await page.getByTestId("fxcat-color").click();
  await page.getByTestId("effect-brightness").click();
  await page.getByTestId("sheet-done").click();
  await page.keyboard.press("Escape");
  await page.waitForTimeout(1500);

  // Warm-up run (videos buffer, shaders compile), then the measured run.
  await page.keyboard.press("Home");
  await page.getByTestId("play").click();
  await page.waitForTimeout(3000);
  await page.getByTestId("play").click();
  await page.keyboard.press("Home");
  await page.waitForTimeout(1000);
  await reset(page);
  await page.getByTestId("play").click();
  await page.waitForTimeout(5000);
  await page.getByTestId("play").click();
  const play = await stats(page);
  console.log(`PERF playback 3 layers: ${play.fps.toFixed(1)} fps, render p95 ${play.renderP95Ms.toFixed(1)} ms, dropped ${play.droppedPct.toFixed(1)} %`);
  // This container has no GPU (SwiftShader draws on the CPU): the 30 fps budget
  // is checked on real phones with the Speed test on /diagnostics; here we
  // guard against regressions with a software floor.
  const gpu = await page.evaluate(() => {
    const gl = document.createElement("canvas").getContext("webgl2");
    const ext = gl?.getExtension("WEBGL_debug_renderer_info");
    return ext && gl ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : "";
  });
  const software = /swiftshader|llvmpipe|software/i.test(gpu);
  console.log(`PERF renderer: ${gpu} (${software ? "software" : "hardware"}), preview quality ${play.quality}`);
  expect(play.fps).toBeGreaterThanOrEqual(software ? 10 : 30);
  if (!software) expect(play.droppedPct).toBeLessThan(5);

  // Scrubbing: drag across the timeline ruler, one frame per move.
  await reset(page);
  const tl = await page.getByTestId("timeline").boundingBox();
  if (!tl) throw new Error("no timeline");
  const y = tl.y + 12;
  await page.mouse.move(tl.x + 40, y);
  await page.mouse.down();
  for (let i = 0; i < 40; i++) {
    await page.mouse.move(tl.x + 40 + i * 6, y);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
  await page.waitForTimeout(300);
  const scrub = await stats(page);
  console.log(`PERF scrub: p95 ${scrub.seekP95Ms.toFixed(1)} ms, max ${scrub.seekMaxMs.toFixed(1)} ms`);
  expect(scrub.seekP95Ms).toBeGreaterThan(0);
  expect(scrub.seekP95Ms).toBeLessThan(100);
});

test("50+ tracks stay smooth @desktop", async ({ page }) => {
  await newProject(page, "16:9");
  await page.getByTestId("media-input").setInputFiles([fixture("clip1.mp4")]);
  await expect.poll(() => mainClipCount(page)).toBe(1);
  // 52 text tracks, added with the keyboard shortcut.
  const addText = async () => {
    await page.keyboard.press("t");
    await page.getByTestId("sheet-done").click();
    await page.getByTestId("tool-back").click();
  };
  for (let i = 0; i < 52; i++) await addText();
  await expect(page.getByTestId("track-text")).toHaveCount(52);

  // One more edit with 53 tracks: from the key press to the next painted frame.
  const editMs = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const start = performance.now();
        const obs = new MutationObserver(() => {
          if (document.querySelectorAll('[data-testid="track-text"]').length === 53) {
            obs.disconnect();
            // The next painted frame shows the new track.
            requestAnimationFrame(() => resolve(performance.now() - start));
          }
        });
        obs.observe(document.body, { subtree: true, childList: true });
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "t" }));
      }),
  );
  await page.getByTestId("sheet-done").click();

  // Drag the tracks up and down (vertical scroll) while measuring UI frames.
  const box = await page.getByTestId("timeline").boundingBox();
  if (!box) throw new Error("no timeline");
  const scroll = await uiFrames(page, 2000, async () => {
    const x = box.x + box.width - 20;
    await page.mouse.move(x, box.y + box.height - 10);
    await page.mouse.down();
    for (let i = 0; i < 40; i++) {
      await page.mouse.move(x, box.y + box.height - 10 - ((i % 20) < 10 ? i % 20 : 20 - (i % 20)) * 8);
      await page.waitForTimeout(30);
    }
    await page.mouse.up();
  });
  console.log(`PERF 53 tracks: edit ${editMs.toFixed(0)} ms, scroll ${scroll.fps.toFixed(1)} fps, frame p95 ${scroll.p95.toFixed(1)} ms`);
  expect(editMs).toBeLessThan(100);
  expect(scroll.fps).toBeGreaterThan(50);
  expect(scroll.p95).toBeLessThan(34);
});

test("UI animation runs at 60 fps when opening panels", async ({ page }) => {
  await newProject(page);
  await page.getByTestId("media-input").setInputFiles([fixture("clip1.mp4")]);
  await expect.poll(() => mainClipCount(page)).toBe(1);
  const r = await uiFrames(page, 2500, async () => {
    for (const id of ["captions", "sfx", "canvas"]) {
      await page.getByTestId(`tool-${id}`).click();
      await page.waitForTimeout(250);
      await page.keyboard.press("Escape");
      await page.waitForTimeout(250);
    }
  });
  console.log(`PERF UI: ${r.fps.toFixed(1)} fps, frame p95 ${r.p95.toFixed(1)} ms`);
  expect(r.fps).toBeGreaterThan(50);
});

test("device speed test on /diagnostics reports fps", async ({ page }) => {
  await page.goto("/diagnostics/");
  await page.getByTestId("speed-run").click();
  const res = page.getByTestId("speed-result");
  await expect(res).toBeVisible({ timeout: 30_000 });
  const fps = Number(await res.getAttribute("data-fps"));
  console.log(`PERF speed test: ${await res.textContent()}`);
  expect(fps).toBeGreaterThan(5);
});
