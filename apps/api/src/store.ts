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
