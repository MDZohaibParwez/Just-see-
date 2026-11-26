// Copies browser runtime files of permissive-licensed packages into public/vendor
// so they are served from our own origin (works offline after first load).
import fs from "node:fs";
import path from "node:path";

const out = path.resolve("public/vendor");
const pkgDir = (name) => path.resolve("node_modules", name);

const copies = [
  // MediaPipe Tasks Vision (Apache-2.0): only the SIMD build, ~10 MB.
  { from: path.join(pkgDir("@mediapipe/tasks-vision"), "wasm"), to: path.join(out, "mediapipe"), files: ["vision_wasm_internal.js", "vision_wasm_internal.wasm"] },
];

for (const c of copies) {
  fs.mkdirSync(c.to, { recursive: true });
  for (const f of c.files) fs.copyFileSync(path.join(c.from, f), path.join(c.to, f));
}
console.log("vendor files copied to", out);
