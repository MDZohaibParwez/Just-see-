"use client";

/** Client for the free Just See API (share links, connector recipes, render jobs). */

const DEFAULT_API = process.env.NEXT_PUBLIC_API_URL ?? "https://just-see-api.vercel.app";

/** API base: ?api= on the page (links from the connector carry it), then saved value, then default. */
export function apiBase(): string {
  if (typeof window === "undefined") return DEFAULT_API;
  const q = new URLSearchParams(window.location.search).get("api");
  if (q && /^https?:\/\//.test(q)) {
    try {
      sessionStorage.setItem("justsee:api", q);
    } catch {
      // private mode
    }
    return q.replace(/\/+$/, "");
  }
  try {
    const saved = sessionStorage.getItem("justsee:api") ?? localStorage.getItem("justsee:api");
    if (saved) return saved;
  } catch {
    // ignore
  }
  return DEFAULT_API;
}

let configJob: Promise<{ storage: "blob" | "fs" }> | null = null;
export function apiConfig(): Promise<{ storage: "blob" | "fs" }> {
  configJob ??= fetch(`${apiBase()}/api/config`).then((r) => {
    if (!r.ok) throw new Error("The online service is not reachable");
    return r.json() as Promise<{ storage: "blob" | "fs" }>;
  });
  configJob.catch(() => (configJob = null));
  return configJob;
}

export async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${apiBase()}${path}`, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body;
}

/** Upload a file to the free online store. Returns its public URL. */
export async function uploadFile(pathname: string, body: Blob, onProgress?: (p: number) => void): Promise<string> {
  const cfg = await apiConfig();
  if (cfg.storage === "fs") {
    const { putUrl } = await apiJson<{ putUrl: string }>("/api/upload", { method: "POST", body: JSON.stringify({ pathname }) });
    const res = await fetch(putUrl, { method: "PUT", body });
    if (!res.ok) throw new Error(`Upload failed (${res.status})`);
    onProgress?.(1);
    return ((await res.json()) as { url: string }).url;
  }
  const { upload } = await import("@vercel/blob/client");
  const r = await upload(pathname, body, {
    access: "public",
    handleUploadUrl: `${apiBase()}/api/upload`,
    multipart: body.size > 8 * 1024 * 1024,
    contentType: body.type || "application/octet-stream",
    onUploadProgress: (e) => onProgress?.(e.percentage / 100),
  });
  return r.url;
}
