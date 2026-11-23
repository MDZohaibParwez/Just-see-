/** Local API server for development and E2E tests (stores files in a folder). */
import http from "node:http";
import { handle } from "./app";
import { FsStore } from "./store";

const port = Number(process.env.PORT ?? 4180);
const apiBase = `http://localhost:${port}`;
const webBase = process.env.PUBLIC_WEB_URL ?? "http://localhost:4173";
const store = new FsStore(process.env.JUST_SEE_STORE_DIR ?? ".store", apiBase);

http
  .createServer((req, res) => {
    const url = new URL(req.url ?? "/", apiBase);
    void handle(req, res, { store, webBase, apiBase }, url.pathname);
  })
  .listen(port, () => console.log(`Just See API on ${apiBase}`));
