/**
 * Storage for the API: Vercel Blob in production (free Hobby tier), a local
 * folder for development and tests. Only small JSON documents and media
 * files are stored; nothing is processed on the server.
 */
import { promises as fs } from "node:fs";
import path from "node:path";

export interface Store {
  mode: "blob" | "fs";
  putJson(pathname: string, data: unknown): Promise<string>;
  getJson<T>(pathname: string): Promise<T | null>;
  putBytes(pathname: string, body: Uint8Array | ReadableStream<Uint8Array>, contentType: string): Promise<string>;
  /** Public URL of a stored file. */
  urlOf(pathname: string): string;
  /** Bytes start..end-1 of a stored file. */
  readRange(pathname: string, start: number, end: number): Promise<Uint8Array>;
  /** Size of a stored file in bytes. */
  sizeOf(pathname: string): Promise<number>;
  /** Total bytes stored. */
  usage(): Promise<number>;
  /** Delete every file under a folder (e.g. "media/abc/"). Returns how many were deleted. */
  deletePrefix(prefix: string): Promise<number>;
  /** Delete files older than maxAgeMs (except meta/), optionally only under a prefix. Returns how many were deleted. */
  cleanup(maxAgeMs: number, now?: number, prefix?: string): Promise<number>;
}

/** Files are kept this long, so the free 1 GB Blob limit does not fill up. */
export const KEEP_MS = 30 * 24 * 60 * 60 * 1000;
/** Source clips of projects that were never rendered are removed sooner. */
export const MEDIA_KEEP_MS = 2 * 24 * 60 * 60 * 1000;
/** Keep total storage under the free 1 GB, with room to spare. */
export const STORAGE_LIMIT = 950 * 1024 * 1024;
const CLEANUP_EVERY_MS = 12 * 60 * 60 * 1000;
const MARKER = "meta/last-cleanup.json";

/**
 * Run cleanup at most every 12 hours. Called from normal requests, so no
 * scheduler is needed. Never throws: a failed cleanup must not break uploads.
 */
export async function maybeCleanup(store: Store, now = Date.now()): Promise<number> {
  try {
    const last = await store.getJson<{ at: number }>(MARKER);
    if (last && now - last.at < CLEANUP_EVERY_MS) return 0;
    await store.putJson(MARKER, { at: now });
    return (await store.cleanup(KEEP_MS, now)) + (await store.cleanup(MEDIA_KEEP_MS, now, "media/")) + (await store.cleanup(MEDIA_KEEP_MS, now, "uploads/"));
  } catch {
    return 0;
  }
}

const SAFE = /^[a-zA-Z0-9][a-zA-Z0-9/_\-.]{0,300}$/;
export function assertSafePath(p: string): string {
  if (!SAFE.test(p) || p.includes("..")) throw new Error("Bad path");
  return p;
}

export class FsStore implements Store {
  mode = "fs" as const;
  constructor(
    private dir: string,
    private publicBase: string,
  ) {}
  private file(p: string) {
    return path.join(this.dir, assertSafePath(p));
  }
  urlOf(p: string): string {
    return `${this.publicBase}/files/${assertSafePath(p)}`;
  }
  async putJson(p: string, data: unknown): Promise<string> {
    const f = this.file(p);
    await fs.mkdir(path.dirname(f), { recursive: true });
    await fs.writeFile(f, JSON.stringify(data));
    return this.urlOf(p);
  }
  async getJson<T>(p: string): Promise<T | null> {
    try {
      return JSON.parse(await fs.readFile(this.file(p), "utf8")) as T;
    } catch {
      return null;
    }
  }
  async putBytes(p: string, body: Uint8Array | ReadableStream<Uint8Array>): Promise<string> {
    const f = this.file(p);
    await fs.mkdir(path.dirname(f), { recursive: true });
    if (body instanceof Uint8Array) await fs.writeFile(f, body);
    else {
      const chunks: Uint8Array[] = [];
      const reader = body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }
      await fs.writeFile(f, Buffer.concat(chunks));
    }
    return this.urlOf(p);
  }
  async deletePrefix(prefix: string): Promise<number> {
    const dir = this.file(prefix.replace(/\/+$/, ""));
    let n = 0;
    try {
      if ((await fs.stat(dir)).isFile()) {
        await fs.rm(dir, { force: true });
        return 1;
      }
      const walk = async (d: string): Promise<void> => {
        for (const e of await fs.readdir(d, { withFileTypes: true })) {
          const f = path.join(d, e.name);
          if (e.isDirectory()) await walk(f);
          else n++;
        }
      };
      await walk(dir);
      await fs.rm(dir, { recursive: true, force: true });
    } catch {
      return 0;
    }
    return n;
  }
  async readRange(p: string, start: number, end: number): Promise<Uint8Array> {
    const fh = await fs.open(this.file(p), "r");
    try {
      const buf = Buffer.alloc(Math.max(0, end - start));
      const { bytesRead } = await fh.read(buf, 0, buf.length, start);
      return new Uint8Array(buf.buffer, buf.byteOffset, bytesRead);
    } finally {
      await fh.close();
    }
  }
  async sizeOf(p: string): Promise<number> {
    return (await fs.stat(this.file(p))).size;
  }
  async usage(): Promise<number> {
    let total = 0;
    const walk = async (d: string): Promise<void> => {
      let entries: import("node:fs").Dirent[];
      try {
        entries = await fs.readdir(d, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const f = path.join(d, e.name);
        if (e.isDirectory()) await walk(f);
        else total += (await fs.stat(f)).size;
      }
    };
    await walk(this.dir);
    return total;
  }
  async cleanup(maxAgeMs: number, now = Date.now(), prefix = ""): Promise<number> {
    let n = 0;
    const walk = async (dir: string): Promise<void> => {
      let entries: import("node:fs").Dirent[];
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const f = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (path.relative(this.dir, f) !== "meta") await walk(f);
        } else if (path.relative(this.dir, f).startsWith(prefix) && now - (await fs.stat(f)).mtimeMs > maxAgeMs) {
          await fs.rm(f, { force: true });
          n++;
        }
      }
    };
    await walk(this.dir);
    return n;
  }
  async readFile(p: string): Promise<Buffer | null> {
    try {
      return await fs.readFile(this.file(p));
    } catch {
      return null;
    }
  }
}

export class BlobStore implements Store {
  mode = "blob" as const;
  private base: string;
  constructor(private token: string) {
    // Token format: vercel_blob_rw_<storeId>_<secret>
    const storeId = token.split("_")[3] ?? "";
    this.base = `https://${storeId.toLowerCase()}.public.blob.vercel-storage.com`;
  }
  urlOf(p: string): string {
    return `${this.base}/${assertSafePath(p)}`;
  }
  async putJson(p: string, data: unknown): Promise<string> {
    const { put } = await import("@vercel/blob");
    const r = await put(assertSafePath(p), JSON.stringify(data), { access: "public", addRandomSuffix: false, allowOverwrite: true, contentType: "application/json", cacheControlMaxAge: 60, token: this.token });
    return r.url;
  }
  async getJson<T>(p: string): Promise<T | null> {
    const res = await fetch(`${this.urlOf(p)}?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as T;
  }
  async putBytes(p: string, body: Uint8Array | ReadableStream<Uint8Array>, contentType: string): Promise<string> {
    const { put } = await import("@vercel/blob");
    const r = await put(assertSafePath(p), body instanceof Uint8Array ? Buffer.from(body) : body, { access: "public", addRandomSuffix: false, allowOverwrite: true, contentType, token: this.token, multipart: true });
    return r.url;
  }
  async deletePrefix(prefix: string): Promise<number> {
    const { list, del } = await import("@vercel/blob");
    let cursor: string | undefined;
    let n = 0;
    do {
      const page = await list({ token: this.token, prefix: assertSafePath(prefix), cursor, limit: 1000 });
      if (page.blobs.length) {
        await del(page.blobs.map((b) => b.url), { token: this.token });
        n += page.blobs.length;
      }
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
    return n;
  }
  async readRange(p: string, start: number, end: number): Promise<Uint8Array> {
    const res = await fetch(this.urlOf(p), { headers: { range: `bytes=${start}-${end - 1}` } });
    if (!res.ok) throw new Error(`Could not read stored file (${res.status})`);
    return new Uint8Array(await res.arrayBuffer());
  }
  async sizeOf(p: string): Promise<number> {
    const { head } = await import("@vercel/blob");
    return (await head(this.urlOf(p), { token: this.token })).size;
  }
  async usage(): Promise<number> {
    const { list } = await import("@vercel/blob");
    let cursor: string | undefined;
    let total = 0;
    do {
      const page = await list({ token: this.token, cursor, limit: 1000 });
      for (const b of page.blobs) total += b.size;
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
    return total;
  }
  async cleanup(maxAgeMs: number, now = Date.now(), prefix?: string): Promise<number> {
    const { list, del } = await import("@vercel/blob");
    let cursor: string | undefined;
    let n = 0;
    do {
      const page = await list({ token: this.token, cursor, limit: 1000, ...(prefix ? { prefix } : {}) });
      const old = page.blobs.filter((b) => !b.pathname.startsWith("meta/") && now - new Date(b.uploadedAt).getTime() > maxAgeMs).map((b) => b.url);
      if (old.length) {
        await del(old, { token: this.token });
        n += old.length;
      }
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
    return n;
  }
}

export class StorageNotConfigured extends Error {
  status = 503;
  constructor() {
    super("Online storage is not set up yet (connect a Vercel Blob store to the API project). Editing on the device still works.");
  }
}

export function storeFromEnv(publicBase: string): Store {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (token) return new BlobStore(token);
  // On Vercel the disk is read-only: without Blob there is nowhere to keep files.
  if (process.env.VERCEL) throw new StorageNotConfigured();
  return new FsStore(process.env.JUST_SEE_STORE_DIR ?? path.join(process.cwd(), ".store"), publicBase);
}
