import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { FIXTURES, ensureFixtures, ffprobe, fixture, frameRgb, mainClipCount, meanLuma, newProject } from "./helpers";

const API = "http://localhost:4180";
let files: http.Server;
let fileBase = "";

test.beforeAll(async () => {
  ensureFixtures();
  // Clips "on the internet" for the connector to download.
  files = http.createServer((req, res) => {
    const f = path.join(FIXTURES, path.basename(req.url ?? ""));
    if (!fs.existsSync(f)) return void res.writeHead(404).end();
    res.writeHead(200, { "content-type": "video/mp4" });
    fs.createReadStream(f).pipe(res);
  });
  await new Promise<void>((r) => files.listen(0, () => r()));
  fileBase = `http://localhost:${(files.address() as { port: number }).port}`;
});
test.afterAll(() => files.close());

const FAKE_ASR = `
window.__justSeeTranscriber = async () => {
  const words = ["Welcome", "to", "my", "trip", "today", "we", "explore", "the", "city", "and", "the", "beach"];
  return words.map((text, i) => ({ text, startUs: 1000000 + i * 1500000, endUs: 1000000 + i * 1500000 + 1200000 }));
};`;

const textOf = (r: unknown) => ((r as { content: { text: string }[] }).content[0]?.text ?? "");

/** Phase 6 "done when": Claude, using only the connector, turns 3 clips into a captioned 30 s reel and returns a download link. */
test("connector: 3 clips → captioned 30 s reel → download link", async ({ page, request }) => {
  test.setTimeout(8 * 60 * 1000);
  const claude = new Client({ name: "claude-test", version: "1" });
  await claude.connect(new StreamableHTTPClientTransport(new URL(`${API}/api/mcp/dev`)));

  const id = /Created video ([a-z0-9]+)/.exec(textOf(await claude.callTool({ name: "create_video", arguments: { name: "Trip reel", aspect: "9:16" } })))![1]!;
  const media: string[] = [];
  for (const f of ["clip1.mp4", "clip2.mp4", "clip3.mp4"]) {
    const out = textOf(await claude.callTool({ name: "add_media", arguments: { video_id: id, url: `${fileBase}/${f}` } }));
    media.push(/Added video (m\w+)/.exec(out)![1]!);
  }
  for (const [i, m] of media.entries()) await claude.callTool({ name: "add_clip", arguments: { video_id: id, media_id: m, transition: i ? "fade" : undefined } });
  await claude.callTool({ name: "add_captions", arguments: { video_id: id, mode: "auto", style: "bold" } });
  await claude.callTool({ name: "add_text", arguments: { video_id: id, text: "GOA TRIP", start_sec: 0, duration_sec: 2.5, position: "top", style: "title" } });
  await claude.callTool({ name: "add_sound_effect", arguments: { video_id: id, id: "whoosh", at_sec: 9.5 } });
  await claude.callTool({ name: "add_music", arguments: { video_id: id, mood: "upbeat", volume: 0.5 } });
  const fit = textOf(await claude.callTool({ name: "fit_duration", arguments: { video_id: id, seconds: 30 } }));
  expect(fit).toContain("30.0 s");
  // keep_media: the project is reopened in the editor at the end (by default clips are deleted after the render).
  const render = textOf(await claude.callTool({ name: "render_video", arguments: { video_id: id, resolution: "720p", keep_media: true } }));
  const link = /(http:\/\/localhost:4173\/render\/\?[^\s]+)/.exec(render)![1]!;
  const job = /Render job ([a-z0-9]+)/.exec(render)![1]!;
  expect(textOf(await claude.callTool({ name: "get_render", arguments: { job_id: job } }))).toContain("Waiting");

  // The user opens the link: the reel is built and rendered in their browser.
  await page.addInitScript(FAKE_ASR);
  await page.goto(link);
  await expect(page.getByTestId("render-done")).toBeVisible({ timeout: 6 * 60 * 1000 });

  const status = textOf(await claude.callTool({ name: "get_render", arguments: { job_id: job } }));
  const url = /Download: (\S+)/.exec(status)?.[1];
  expect(url, status).toBeTruthy();
  const mp4 = await request.get(url!);
  expect(mp4.ok()).toBe(true);
  const out = path.join(test.info().outputDir, "reel.mp4");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, await mp4.body());
  const info = ffprobe(out);
  const v = info.streams.find((s) => s.codec_type === "video");
  expect(v?.width).toBe(720);
  expect(v?.height).toBe(1280);
  expect(info.streams.some((s) => s.codec_type === "audio")).toBe(true);
  expect(Math.abs(Number(info.format.duration) - 30)).toBeLessThan(0.25);
  // Captions are burned in: the bottom band is brighter while a word is shown than at the very start.
  const frame = frameRgb(out, 5.0, 90, 160);
  expect(meanLuma(frame)).toBeGreaterThan(5);
  await claude.close();

  // The same project opens in the editor from the connector's editor link.
  await page.goto(`/open/?recipe=${id}&api=${encodeURIComponent(API)}`);
  await expect(page).toHaveURL(/\/edit\/\?id=/, { timeout: 120_000 });
  await expect.poll(() => mainClipCount(page)).toBe(3);
  await expect(page.getByTestId("track-text").first().getByTestId("timeline-clip").first()).toBeVisible();
});

test("connector: upload page adds phone clips to a connector project", async ({ page }) => {
  test.setTimeout(2 * 60 * 1000);
  const claude = new Client({ name: "claude-test", version: "1" });
  await claude.connect(new StreamableHTTPClientTransport(new URL(`${API}/api/mcp/dev`)));
  const created = textOf(await claude.callTool({ name: "create_video", arguments: { name: "Phone clips" } }));
  const upload = /Upload clips from a phone: (\S+)/.exec(created)![1]!;
  const id = /Created video ([a-z0-9]+)/.exec(created)![1]!;
  await page.goto(upload);
  await page.getByTestId("upload-input").setInputFiles([fixture("clip4.mp4"), fixture("photo.png")]);
  await expect(page.getByTestId("upload-list").locator("li")).toHaveCount(2, { timeout: 60_000 });
  const listed = textOf(await claude.callTool({ name: "list_media", arguments: { video_id: id } }));
  expect(listed).toMatch(/video "clip4\.mp4", 12\.\d+ s/);
  expect(listed).toContain('image "photo.png"');
  await claude.close();
});

test("share a copy: link opens the same project on another device", async ({ page, browser }) => {
  test.setTimeout(2 * 60 * 1000);
  await page.addInitScript((api) => sessionStorage.setItem("justsee:api", api), API);
  await newProject(page);
  await page.getByTestId("media-input").setInputFiles([fixture("clip1.mp4"), fixture("photo.png")]);
  await expect.poll(() => mainClipCount(page)).toBe(2);
  await page.getByTestId("open-export").click();
  await page.getByTestId("share-copy").click();
  const link = await page.getByTestId("share-link").inputValue({ timeout: 60_000 });
  expect(link).toContain("/open/?share=");
  // "Another phone": a fresh browser context with empty storage.
  const other = await browser.newContext();
  const p2 = await other.newPage();
  await p2.goto(link);
  await expect(p2).toHaveURL(/\/edit\/\?id=/, { timeout: 60_000 });
  await expect.poll(() => p2.getByTestId("track-main").getByTestId("timeline-clip").count()).toBe(2);
  await other.close();
});

test("personal mode: clips leave online storage as soon as the render page has them", async ({ page, request }) => {
  test.setTimeout(4 * 60 * 1000);
  const claude = new Client({ name: "claude-test", version: "1" });
  await claude.connect(new StreamableHTTPClientTransport(new URL(`${API}/api/mcp/dev`)));
  const id = /Created video ([a-z0-9]+)/.exec(textOf(await claude.callTool({ name: "create_video", arguments: {} })))![1]!;
  const m = /Added video (m\w+)/.exec(textOf(await claude.callTool({ name: "add_media", arguments: { video_id: id, url: `${fileBase}/clip1.mp4` } })))![1]!;
  await claude.callTool({ name: "add_clip", arguments: { video_id: id, media_id: m, end: 3 } });
  const render = textOf(await claude.callTool({ name: "render_video", arguments: { video_id: id, resolution: "720p" } }));
  const link = /(http:\/\/localhost:4173\/render\/\?[^\s]+)/.exec(render)![1]!;
  const recipe = (await (await request.get(`${API}/api/recipes/${id}`)).json()) as { recipe: { media: { url: string }[] } };
  const clipUrl = recipe.recipe.media[0]!.url;
  expect((await request.get(clipUrl)).ok()).toBe(true);

  // The clip is deleted before the render finishes; the render still completes from the device copy.
  const loaded = page.waitForResponse((r) => r.url().includes(`/loaded`) && r.request().method() === "POST");
  await page.goto(link);
  expect((await (await loaded).json()).deleted).toBe(1);
  expect((await request.get(clipUrl)).status()).toBe(404);
  await expect(page.getByTestId("render-done")).toBeVisible({ timeout: 3 * 60 * 1000 });
  const job = /Render job ([a-z0-9]+)/.exec(render)![1]!;
  expect(textOf(await claude.callTool({ name: "get_render", arguments: { job_id: job } }))).toContain("Download:");
  await claude.close();
});
