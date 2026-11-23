"use client";

import type { License } from "@just-see/schema";

/**
 * Free online media through Openverse (openverse.org), which indexes openly
 * licensed audio and images. We only ask for licences that allow commercial
 * use without share-alike: CC0, Public Domain Mark and CC BY (credit needed).
 */
export interface OnlineItem {
  id: string;
  kind: "audio" | "image";
  title: string;
  creator: string;
  url: string;
  thumbnail?: string;
  durationMs?: number;
  filetype?: string;
  license: License;
}

const API = "https://api.openverse.org/v1";

interface OvResult {
  id: string;
  title?: string;
  creator?: string;
  url: string;
  thumbnail?: string;
  duration?: number;
  filetype?: string;
  license: string;
  license_version?: string;
  license_url?: string;
  foreign_landing_url?: string;
  attribution?: string;
  provider?: string;
  source?: string;
}

export function licenseFromOpenverse(r: OvResult): License {
  const code = r.license.toLowerCase();
  const name = code === "cc0" ? "CC0 1.0" : code === "pdm" ? "Public Domain Mark" : `CC ${code.toUpperCase()} ${r.license_version ?? ""}`.trim();
  return {
    kind: "library",
    name: r.title?.slice(0, 200) || "Untitled",
    author: r.creator?.slice(0, 300),
    licenseName: name,
    licenseUrl: r.license_url,
    sourceUrl: r.foreign_landing_url,
    attribution: code === "cc0" || code === "pdm" ? undefined : (r.attribution ?? `"${r.title ?? "Untitled"}" by ${r.creator ?? "unknown"}, ${name}`).slice(0, 1000),
    source: `openverse:${r.provider ?? r.source ?? "unknown"}`,
    commercialUse: true,
  };
}

export async function searchOpenverse(q: string, kind: "audio" | "image", signal?: AbortSignal): Promise<OnlineItem[]> {
  const params = new URLSearchParams({ q, license: "cc0,pdm,by", page_size: "20", mature: "false" });
  const res = await fetch(`${API}/${kind === "audio" ? "audio" : "images"}/?${params}`, { signal });
  if (!res.ok) throw new Error(`Online search failed (${res.status})`);
  const json = (await res.json()) as { results?: OvResult[] };
  return (json.results ?? [])
    .filter((r) => r.url && ["cc0", "pdm", "by"].includes(r.license.toLowerCase()))
    .map((r) => ({
      id: r.id,
      kind,
      title: r.title || "Untitled",
      creator: r.creator || "unknown",
      url: r.url,
      thumbnail: r.thumbnail,
      durationMs: r.duration,
      filetype: r.filetype,
      license: licenseFromOpenverse(r),
    }));
}

/** Download the file. Some hosts block downloads from other sites (CORS); then we say so. */
export async function downloadOnline(item: OnlineItem): Promise<File> {
  let res: Response;
  try {
    res = await fetch(item.url);
  } catch {
    throw new Error("This file's website does not allow direct download. Open its page and download it there.");
  }
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  const blob = await res.blob();
  const ext = item.filetype || (item.kind === "audio" ? (blob.type.includes("wav") ? "wav" : blob.type.includes("ogg") ? "ogg" : "mp3") : blob.type.includes("png") ? "png" : "jpg");
  const type = blob.type && blob.type !== "application/octet-stream" ? blob.type : item.kind === "audio" ? `audio/${ext === "mp3" ? "mpeg" : ext}` : `image/${ext === "jpg" ? "jpeg" : ext}`;
  return new File([blob], `${item.title.replace(/[\\/:*?"<>|]+/g, " ").slice(0, 80)}.${ext}`, { type });
}
