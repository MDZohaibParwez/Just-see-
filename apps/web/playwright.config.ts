import { defineConfig, devices } from "@playwright/test";

const PORT = 4173;

export default defineConfig({
  testDir: "./e2e",
  timeout: 10 * 60 * 1000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "off",
    acceptDownloads: true,
  },
  projects: [
    { name: "phone", use: { ...devices["Pixel 7"] } },
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } }, grep: /@desktop/ },
  ],
  webServer: [
    {
      command: `node scripts/serve.mjs out ${PORT}`,
      port: PORT,
      reuseExistingServer: true,
    },
    {
      // Local copy of the free API (files stored in a temp folder instead of Vercel Blob).
      command: "node build.mjs --dev >/dev/null && node dist/dev-server.mjs",
      cwd: "../api",
      port: 4180,
      reuseExistingServer: true,
      env: { PORT: "4180", PUBLIC_WEB_URL: `http://localhost:${PORT}`, JUST_SEE_STORE_DIR: "/tmp/just-see-e2e-store" },
    },
    {
      // Local PeerJS broker for live-editing tests (production uses the free PeerJS cloud).
      command: "node node_modules/peer/dist/bin/peerjs.js --host 127.0.0.1 --port 9000 --path /",
      port: 9000,
      reuseExistingServer: true,
    },
  ],
});
