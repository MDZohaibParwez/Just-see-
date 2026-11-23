// Bundles the API with esbuild into Vercel's Build Output API layout
// (.vercel/output) and, with --dev, a local server (dist/dev-server.mjs).
import { build } from "esbuild";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";

const dev = process.argv.includes("--dev");
const common = {
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  sourcemap: false,
  legalComments: "none",
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: "warning",
};

if (dev) {
  await build({ ...common, entryPoints: ["src/dev-server.ts"], outfile: "dist/dev-server.mjs" });
} else {
  rmSync(".vercel/output", { recursive: true, force: true });
  const fn = ".vercel/output/functions/api.func";
  mkdirSync(fn, { recursive: true });
  await build({ ...common, entryPoints: ["src/vercel.ts"], outfile: `${fn}/index.mjs` });
  writeFileSync(`${fn}/.vc-config.json`, JSON.stringify({ runtime: "nodejs22.x", handler: "index.mjs", launcherType: "Nodejs", shouldAddHelpers: false, maxDuration: 300, memory: 2048 }, null, 2));
  mkdirSync(".vercel/output/static", { recursive: true });
  writeFileSync(".vercel/output/static/index.html", "<!doctype html><meta charset=utf-8><title>Just See API</title><p>Just See API. Connector: /api/mcp/&lt;key&gt;</p>");
  writeFileSync(
    ".vercel/output/config.json",
    JSON.stringify({ version: 3, routes: [{ src: "^/api/?$", dest: "/api?__path=" }, { src: "^/api/(.*)$", dest: "/api?__path=$1" }] }, null, 2),
  );
}
console.log(dev ? "built dist/dev-server.mjs" : "built .vercel/output");
