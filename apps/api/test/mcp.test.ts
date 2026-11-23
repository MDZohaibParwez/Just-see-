import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { handle } from "../src/app";
import { FsStore } from "../src/store";

const FIX = path.resolve(__dirname, "../../web/e2e/fixtures");
let api: http.Server;
let files: http.Server;
let apiBase = "";
let fileBase = "";
let dir = "";

function listen(s: http.Server): Promise<string> {
  return new Promise((r) => s.listen(0, () => r(`http://localhost:${(s.address() as { port: number }).port}`)));
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "jsapi-"));
  files = http.createServer((req, res) => {
    const f = path.join(FIX, path.basename(req.url ?? ""));
    if (!fs.existsSync(f)) return void res.writeHead(404).end();
    res.writeHead(200, { "content-type": f.endsWith(".mp4") ? "video/mp4" : f.endsWith(".png") ? "image/png" : "audio/mpeg" });
    fs.createReadStream(f).pipe(res);
  });
  fileBase = await listen(files);
  let store: FsStore;
  api = http.createServer((req, res) => void handle(req, res, { store, webBase: "http://web.test", apiBase }, new URL(req.url ?? "/", "http://x").pathname));
  apiBase = await listen(api);
  store = new FsStore(dir, apiBase);
});
afterAll(() => {
  api.close();
  files.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

async function client(): Promise<Client> {
  const c = new Client({ name: "test", version: "1" });
  await c.connect(new StreamableHTTPClientTransport(new URL(`${apiBase}/api/mcp/dev`)));
  return c;
}
const textOf = (r: unknown) => ((r as { content: { text: string }[] }).content[0]?.text ?? "");

describe("connector (MCP)", () => {
  it("lists tools", async () => {
    const c = await client();
    const names = (await c.listTools()).tools.map((t) => t.name);
    for (const n of ["create_video", "add_media", "add_clip", "add_captions", "add_music", "render_video", "get_render", "list_options"]) expect(names).toContain(n);
    await c.close();
  });

  it("turns 3 clips into a captioned 30 s reel plan and a render job", async () => {
    const c = await client();
    const created = textOf(await c.callTool({ name: "create_video", arguments: { name: "Trip reel", aspect: "9:16" } }));
    const id = /Created video ([a-z0-9]+)/.exec(created)![1]!;
    expect(created).toContain("http://web.test/upload/?recipe=");
    const ids: string[] = [];
    for (const f of ["clip1.mp4", "clip2.mp4", "clip3.mp4"]) {
      const out = textOf(await c.callTool({ name: "add_media", arguments: { video_id: id, url: `${fileBase}/${f}` } }));
      expect(out).toMatch(/Added video m\w+ .*\(\d+(\.\d+)? s\)/);
      ids.push(/Added video (m\w+)/.exec(out)![1]!);
    }
    for (const m of ids) await c.callTool({ name: "add_clip", arguments: { video_id: id, media_id: m, transition: "fade" } });
    expect(textOf(await c.callTool({ name: "add_captions", arguments: { video_id: id, mode: "auto" } }))).toContain("captions");
    await c.callTool({ name: "add_music", arguments: { video_id: id, mood: "upbeat" } });
    const fit = textOf(await c.callTool({ name: "fit_duration", arguments: { video_id: id, seconds: 30 } }));
    expect(fit).toContain("30.0 s");
    const bad = await c.callTool({ name: "add_clip", arguments: { video_id: id, media_id: "nope" } });
    expect((bad as { isError?: boolean }).isError).toBe(true);
    const plan = textOf(await c.callTool({ name: "get_video", arguments: { video_id: id } }));
    expect(plan).toContain("Media (3)");
    const render = textOf(await c.callTool({ name: "render_video", arguments: { video_id: id } }));
    const job = /Render job ([a-z0-9]+)/.exec(render)![1]!;
    expect(render).toContain(`http://web.test/render/?job=${job}&key=`);
    expect(textOf(await c.callTool({ name: "get_render", arguments: { job_id: job } }))).toContain("Waiting");
    // Render page reports a result with the key.
    const key = /key=([A-Za-z0-9_-]+)/.exec(render)![1]!;
    const wrong = await fetch(`${apiBase}/api/jobs/${job}/status`, { method: "POST", body: JSON.stringify({ key: "x", status: "done" }) });
    expect(wrong.status).toBe(403);
    const ok = await fetch(`${apiBase}/api/jobs/${job}/status`, { method: "POST", body: JSON.stringify({ key, status: "done", url: `${apiBase}/files/renders/${job}.mp4` }) });
    expect(ok.status).toBe(200);
    expect(textOf(await c.callTool({ name: "get_render", arguments: { job_id: job } }))).toContain(`Download: ${apiBase}/files/renders/${job}.mp4`);
    await c.close();
  }, 60_000);

  it("lists reel styles, explains them and applies one", async () => {
    const c = await client();
    const list = textOf(await c.callTool({ name: "list_styles", arguments: {} }));
    for (const id of ["anime-dialogue", "pov-story", "talking-head", "lyric-card", "scenic-lyric"]) expect(list).toContain(id);
    expect(textOf(await c.callTool({ name: "get_style_guide", arguments: { style: "pov-story" } }))).toContain("Hook:");
    const id = /Created video ([a-z0-9]+)/.exec(textOf(await c.callTool({ name: "create_video", arguments: {} })))![1]!;
    const ok = textOf(await c.callTool({ name: "apply_style", arguments: { video_id: id, style: "lyric-card", fields: { hook: "If she sends you this" } } }));
    expect(ok).toContain("style");
    const bad = await c.callTool({ name: "apply_style", arguments: { video_id: id, style: "nope" } });
    expect((bad as { isError?: boolean }).isError).toBe(true);
    await c.close();
  });

  it("share links only accept files in our store", async () => {
    const bad = await fetch(`${apiBase}/api/share`, { method: "POST", body: JSON.stringify({ url: "https://evil.test/x" }) });
    expect(bad.status).toBe(400);
    const put = await fetch(`${apiBase}/files/shares/abc.justsee`, { method: "PUT", body: "zip" });
    expect(put.status).toBe(200);
    const s = await (await fetch(`${apiBase}/api/share`, { method: "POST", body: JSON.stringify({ url: `${apiBase}/files/shares/abc.justsee`, name: "P" }) })).json() as { id: string; link: string };
    expect(s.link).toContain(`/open/?share=${s.id}`);
    const got = await (await fetch(`${apiBase}/api/share/${s.id}`)).json() as { url: string };
    expect(got.url).toBe(`${apiBase}/files/shares/abc.justsee`);
    const traversal = await fetch(`${apiBase}/files/../package.json`);
    expect(traversal.status).not.toBe(200);
  });
});
