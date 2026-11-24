/** Vercel Function entry (Build Output API, Node launcher). */
import type { IncomingMessage, ServerResponse } from "node:http";
import { handle } from "./app";
import { storeFromEnv } from "./store";

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const host = (req.headers["x-forwarded-host"] as string | undefined) ?? req.headers.host ?? "localhost";
  const apiBase = process.env.PUBLIC_API_URL ?? `https://${host}`;
  const webBase = process.env.PUBLIC_WEB_URL ?? "https://just-see-one.vercel.app";
  const url = new URL(req.url ?? "/", apiBase);
  // Routes rewrite /api/<path> to /api?__path=<path>.
  const p = url.searchParams.get("__path");
  const pathname = p !== null ? `/api/${p}` : url.pathname;
  let store;
  try {
    store = storeFromEnv(apiBase);
  } catch (e) {
    res.statusCode = 503;
    res.setHeader("content-type", "application/json");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.end(JSON.stringify({ error: (e as Error).message }));
    return;
  }
  await handle(req, res, { store, webBase, apiBase }, pathname);
}
