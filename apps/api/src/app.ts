/**
 * HTTP routes for the Just See API. Plain Node handlers so the same code runs
 * as one Vercel Function and as a local dev/test server.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { RenderJobSchema, type RenderJob } from "@just-see/schema";
import { addMediaBytes, buildMcpServer, links, loadRecipe, newId, saveRecipe, type Ctx } from "./mcp";
import { FsStore, assertSafePath, maybeCleanup } from "./store";

const MAX_JSON = 1024 * 1024;

function cors(res: ServerResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type,authorization,mcp-session-id,mcp-protocol-version,x-content-type");
  res.setHeader("Access-Control-Expose-Headers", "mcp-session-id");
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let n = 0;
  for await (const c of req) {
    const b = c as Buffer;
    n += b.length;
    if (n > limit) throw Object.assign(new Error("Body too large"), { status: 413 });
    chunks.push(b);
  }
  return Buffer.concat(chunks);
}

async function readJson<T>(req: IncomingMessage): Promise<T> {
  // Vercel may have parsed the body already.
  const pre = (req as IncomingMessage & { body?: unknown }).body;
  if (pre !== undefined && pre !== null && typeof pre === "object" && !Buffer.isBuffer(pre)) return pre as T;
  const raw = Buffer.isBuffer(pre) ? pre : typeof pre === "string" ? Buffer.from(pre) : await readBody(req, MAX_JSON);
  return (raw.length ? JSON.parse(raw.toString("utf8")) : {}) as T;
}

/** Media uploaded by the web app must live in our own store. */
function isOurUrl(ctx: Ctx, url: string): boolean {
  return url.startsWith(ctx.store.urlOf("x").slice(0, -1));
}

export async function handle(req: IncomingMessage, res: ServerResponse, ctx: Ctx, pathname: string): Promise<void> {
  cors(res);
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }
  try {
    const parts = pathname.replace(/^\/+|\/+$/g, "").split("/");
    // /files/* — local store only (dev and tests).
    if (parts[0] === "files" && ctx.store instanceof FsStore) {
      const p = assertSafePath(parts.slice(1).join("/"));
      if (req.method === "PUT") {
        if (!/^(uploads|renders|shares)\//.test(p)) return send(res, 403, { error: "Not allowed" });
        await ctx.store.putBytes(p, await readBody(req, 2 * 1024 * 1024 * 1024));
        return send(res, 200, { url: ctx.store.urlOf(p) });
      }
      const data = await ctx.store.readFile(p);
      if (!data) return send(res, 404, { error: "Not found" });
      const ext = p.split(".").pop() ?? "";
      const type = { mp4: "video/mp4", json: "application/json", png: "image/png", jpg: "image/jpeg", mp3: "audio/mpeg", wav: "audio/wav", justsee: "application/zip" }[ext] ?? "application/octet-stream";
      res.setHeader("content-type", type);
      res.setHeader("content-length", String(data.length));
      res.end(data);
      return;
    }
    if (parts[0] !== "api") return send(res, 404, { error: "Not found" });
    const [, route, id, sub] = parts;

    if (route === undefined || route === "" || route === "config") {
      return send(res, 200, { app: "just-see-api", version: "0.6.0", storage: ctx.store.mode, web: ctx.webBase });
    }

    // Direct browser uploads: Vercel Blob client tokens, or a PUT URL in local mode.
    if (route === "upload" && req.method === "POST") {
      // New files are coming in: first drop ones older than 30 days.
      await maybeCleanup(ctx.store);
      const body = await readJson<Record<string, unknown>>(req);
      if (ctx.store.mode === "fs") {
        const name = String(body.pathname ?? "");
        if (!/^(uploads|renders|shares)\/[a-z0-9][a-z0-9/_\-.]{0,200}$/i.test(name)) return send(res, 400, { error: "Bad pathname" });
        return send(res, 200, { putUrl: ctx.store.urlOf(name).replace("/files/", "/files/"), url: ctx.store.urlOf(name) });
      }
      const { handleUpload } = await import("@vercel/blob/client");
      const json = await handleUpload({
        body: body as unknown as Parameters<typeof handleUpload>[0]["body"],
        request: req as unknown as Request,
        onBeforeGenerateToken: async (pathname) => {
          if (!/^(uploads|renders|shares)\//.test(pathname)) throw new Error("Bad pathname");
          return { maximumSizeInBytes: 1024 * 1024 * 1024, addRandomSuffix: true, allowedContentTypes: ["video/*", "audio/*", "image/*", "application/zip", "application/octet-stream", "application/json"] };
        },
        onUploadCompleted: async () => undefined,
      });
      return send(res, 200, json);
    }

    // Crash report the user chose to send (kept 30 days like everything else).
    if (route === "report" && req.method === "POST" && !id) {
      const b = await readJson<Record<string, unknown>>(req);
      const str = (k: string, n: number) => String(b[k] ?? "").slice(0, n);
      if (!str("message", 500)) return send(res, 400, { error: "Empty report" });
      const rid = newId(10);
      await ctx.store.putJson(`reports/${rid}.json`, {
        id: rid,
        receivedAt: Date.now(),
        message: str("message", 500),
        stack: str("stack", 4000),
        where: str("where", 200),
        version: str("version", 20),
        browser: str("browser", 200),
        note: str("note", 1000),
      });
      return send(res, 200, { id: rid });
    }

    // Share links: a backup file stored online.
    if (route === "share") {
      if (req.method === "POST" && !id) {
        const b = await readJson<{ url?: string; name?: string; kind?: string }>(req);
        if (!b.url || !isOurUrl(ctx, b.url)) return send(res, 400, { error: "Upload the file first" });
        const sid = newId(12);
        await ctx.store.putJson(`share-index/${sid}.json`, { id: sid, url: b.url, name: String(b.name ?? "Project").slice(0, 200), kind: b.kind === "live" ? "live" : "copy", createdAt: Date.now() });
        return send(res, 200, { id: sid, link: `${ctx.webBase}/open/?share=${sid}&api=${encodeURIComponent(ctx.apiBase)}` });
      }
      if (req.method === "GET" && id && /^[a-z0-9]{4,40}$/.test(id)) {
        const s = await ctx.store.getJson(`share-index/${id}.json`);
        return s ? send(res, 200, s) : send(res, 404, { error: "Link not found or expired" });
      }
    }

    // Recipes made by the connector.
    if (route === "recipes" && id) {
      const r = await loadRecipe(ctx.store, id);
      if (!r) return send(res, 404, { error: "Not found" });
      if (req.method === "GET" && !sub) return send(res, 200, { recipe: r, links: links(ctx, r.id) });
      if (req.method === "POST" && sub === "media") {
        const b = await readJson<{ url?: string; name?: string; kind?: string; contentType?: string }>(req);
        if (!b.url || !isOurUrl(ctx, b.url)) return send(res, 400, { error: "Upload the file first" });
        const f = await fetch(b.url);
        if (!f.ok) return send(res, 400, { error: "Uploaded file not found" });
        const bytes = new Uint8Array(await f.arrayBuffer());
        const m = await addMediaBytes(ctx, r, bytes, b.contentType ?? f.headers.get("content-type") ?? "", String(b.name ?? "clip"), b.kind);
        await saveRecipe(ctx.store, r);
        return send(res, 200, { media: m });
      }
    }

    // Render jobs.
    if (route === "jobs" && id && /^[a-z0-9]{4,40}$/.test(id)) {
      const job = await ctx.store.getJson<RenderJob>(`jobs/${id}.json`);
      if (!job) return send(res, 404, { error: "Not found" });
      if (req.method === "GET" && !sub) {
        const { token: _t, ...pub } = job;
        void _t;
        return send(res, 200, pub);
      }
      if (req.method === "POST" && sub === "status") {
        const b = await readJson<{ key?: string; status?: string; url?: string; error?: string }>(req);
        if (b.key !== job.token) return send(res, 403, { error: "Wrong key" });
        if (b.url && !isOurUrl(ctx, b.url)) return send(res, 400, { error: "Bad output url" });
        const next = RenderJobSchema.parse({ ...job, status: b.status ?? job.status, outputUrl: b.url ?? job.outputUrl, error: b.error ?? null, updatedAt: Date.now() });
        await ctx.store.putJson(`jobs/${id}.json`, next);
        return send(res, 200, { ok: true });
      }
    }

    // MCP connector: /api/mcp/<key>
    if (route === "mcp") {
      const key = process.env.MCP_KEY;
      if (key && id !== key) return send(res, 401, { error: "Wrong connector link" });
      if (req.method !== "POST") return send(res, 405, { jsonrpc: "2.0", error: { code: -32000, message: "Use POST" }, id: null });
      const body = await readJson<unknown>(req);
      const server = buildMcpServer(ctx);
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      res.on("close", () => {
        void transport.close();
        void server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
      return;
    }

    return send(res, 404, { error: "Not found" });
  } catch (e) {
    const status = (e as { status?: number }).status ?? 500;
    if (!res.headersSent) send(res, status, { error: e instanceof Error ? e.message : String(e) });
  }
}
