// Tiny static server for the exported site (used by `pnpm start` and E2E tests).
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const root = path.resolve(process.argv[2] ?? "out");
const port = Number(process.argv[3] ?? 3000);
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".txt": "text/plain",
  ".woff2": "font/woff2",
};

http
  .createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    let file = path.join(root, decodeURIComponent(url.pathname));
    if (!file.startsWith(root)) {
      res.writeHead(403).end();
      return;
    }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
    if (!fs.existsSync(file)) file = path.join(root, "404.html");
    const ext = path.extname(file);
    // Compress text like Vercel does, so load-time tests measure real transfer sizes.
    const gzip = [".html", ".js", ".css", ".json", ".svg", ".txt", ".webmanifest"].includes(ext) && /gzip/.test(String(req.headers["accept-encoding"] ?? ""));
    res.writeHead(fs.existsSync(file) ? (file.endsWith("404.html") ? 404 : 200) : 404, {
      "Content-Type": types[ext] ?? "application/octet-stream",
      // Hashed build files never change, like on Vercel.
      "Cache-Control": url.pathname.startsWith("/_next/static/") ? "public, max-age=31536000, immutable" : "no-cache",
      ...(gzip ? { "Content-Encoding": "gzip", Vary: "Accept-Encoding" } : {}),
    });
    const stream = fs.createReadStream(file);
    if (gzip) stream.pipe(zlib.createGzip({ level: 6 })).pipe(res);
    else stream.pipe(res);
  })
  .listen(port, () => console.log(`Serving ${root} on http://localhost:${port}`));
