"use client";

import { ZipWriter, readZip } from "@just-see/engine";
import { createId, parseProject, type Project } from "@just-see/schema";
import { getMedia, putMedia } from "./storage/media-store";
import { loadProject, saveProject } from "./storage/db";

/**
 * Backups (.justsee): one file with the project and all its media, so a
 * project can move to another device without any server.
 */
export async function backupBlob(project: Project, onProgress?: (done: number, total: number) => void): Promise<Blob> {
  const zip = new ZipWriter();
  zip.add("project.json", new TextEncoder().encode(JSON.stringify(project)));
  const media: Record<string, string> = {};
  let i = 0;
  for (const a of project.assets) {
    const blob = await getMedia(a.storageKey);
    if (blob) {
      const path = `media/${a.id}`;
      zip.add(path, new Uint8Array(await blob.arrayBuffer()));
      media[a.id] = path;
    }
    onProgress?.(++i, project.assets.length);
  }
  zip.add("manifest.json", new TextEncoder().encode(JSON.stringify({ app: "just-see", version: 1, media, createdAt: Date.now() })));
  return zip.finish();
}

export async function downloadBackup(project: Project): Promise<void> {
  const blob = await backupBlob(project);
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${project.name.replace(/[\\/:*?"<>|]+/g, " ").trim() || "project"}.justsee`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 30000);
}

/** Restore a backup as a project on this device. Returns the project id. */
export async function restoreBackup(file: File): Promise<string> {
  const files = readZip(new Uint8Array(await file.arrayBuffer()));
  const pj = files.get("project.json");
  if (!pj) throw new Error("This is not a Just See backup");
  const manifest = JSON.parse(new TextDecoder().decode(files.get("manifest.json") ?? new TextEncoder().encode("{}"))) as { media?: Record<string, string> };
  const project = parseProject(JSON.parse(new TextDecoder().decode(pj)));
  // Keep the id unless a different project with that id is already here.
  if (await loadProject(project.id)) project.id = createId("p_");
  for (const a of project.assets) {
    const data = files.get(manifest.media?.[a.id] ?? `media/${a.id}`);
    if (!data) continue;
    a.storageKey = `media/${a.id}`;
    await putMedia(a.storageKey, new Blob([data as Uint8Array<ArrayBuffer>], { type: a.mimeType }));
  }
  project.updatedAt = Date.now();
  await saveProject(project);
  return project.id;
}
