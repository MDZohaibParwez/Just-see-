import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import { parseProject, type Project } from "@just-see/schema";

export interface ProjectRecord {
  id: string;
  name: string;
  updatedAt: number;
  createdAt: number;
  durationUs: number;
  aspect: string;
  project: Project;
}

export interface VersionRecord {
  id?: number;
  projectId: string;
  at: number;
  label: string;
  project: Project;
}

export interface ThumbRecord {
  assetId: string;
  /** JPEG frames spread across the source, as blobs. */
  frames: { timeUs: number; blob: Blob }[];
}

export interface PeaksRecord {
  assetId: string;
  perSecond: number;
  peaks: Float32Array;
}

interface JustSeeDB extends DBSchema {
  projects: { key: string; value: ProjectRecord; indexes: { updatedAt: number } };
  versions: { key: number; value: VersionRecord; indexes: { projectId: string } };
  media: { key: string; value: Blob };
  thumbs: { key: string; value: ThumbRecord };
  peaks: { key: string; value: PeaksRecord };
  kv: { key: string; value: unknown };
}

export const DB_NAME = "just-see";
const DB_VERSION = 1;
/** Version snapshots kept per project. */
export const MAX_VERSIONS = 30;

let dbPromise: Promise<IDBPDatabase<JustSeeDB>> | null = null;

export function db(): Promise<IDBPDatabase<JustSeeDB>> {
  if (!dbPromise) {
    dbPromise = openDB<JustSeeDB>(DB_NAME, DB_VERSION, {
      upgrade(d) {
        const projects = d.createObjectStore("projects", { keyPath: "id" });
        projects.createIndex("updatedAt", "updatedAt");
        const versions = d.createObjectStore("versions", { keyPath: "id", autoIncrement: true });
        versions.createIndex("projectId", "projectId");
        d.createObjectStore("media");
        d.createObjectStore("thumbs", { keyPath: "assetId" });
        d.createObjectStore("peaks", { keyPath: "assetId" });
        d.createObjectStore("kv");
      },
    });
  }
  return dbPromise;
}

/** For tests: forget the cached connection. */
export function resetDbConnection(): void {
  dbPromise = null;
}

function aspectLabel(p: Project): string {
  const seq = p.sequences.find((s) => s.id === p.activeSequenceId) ?? p.sequences[0];
  if (!seq) return "";
  const g = (a: number, b: number): number => (b === 0 ? a : g(b, a % b));
  const d = g(seq.width, seq.height);
  return `${seq.width / d}:${seq.height / d}`;
}

function durationOf(p: Project): number {
  let end = 0;
  for (const s of p.sequences) for (const t of s.tracks) for (const c of t.clips) end = Math.max(end, c.startUs + c.durationUs);
  return end;
}

export async function saveProject(project: Project): Promise<void> {
  const d = await db();
  await d.put("projects", {
    id: project.id,
    name: project.name,
    updatedAt: project.updatedAt,
    createdAt: project.createdAt,
    durationUs: durationOf(project),
    aspect: aspectLabel(project),
    project,
  });
}

export async function loadProject(id: string): Promise<Project | undefined> {
  const d = await db();
  const rec = await d.get("projects", id);
  if (!rec) return undefined;
  return parseProject(rec.project);
}

export async function listProjects(): Promise<Omit<ProjectRecord, "project">[]> {
  const d = await db();
  const all = await d.getAllFromIndex("projects", "updatedAt");
  return all.reverse().map(({ project: _p, ...meta }) => meta);
}

export async function deleteProject(id: string): Promise<void> {
  const d = await db();
  const rec = await d.get("projects", id);
  const tx = d.transaction(["projects", "versions"], "readwrite");
  await tx.objectStore("projects").delete(id);
  const vs = await tx.objectStore("versions").index("projectId").getAllKeys(id);
  for (const k of vs) await tx.objectStore("versions").delete(k);
  await tx.done;
  // Remove media no other project uses.
  if (rec) {
    const others = await d.getAll("projects");
    const used = new Set(others.flatMap((o) => o.project.assets.map((a) => a.storageKey)));
    for (const a of rec.project.assets) {
      if (!used.has(a.storageKey)) {
        const { deleteMedia } = await import("./media-store");
        await deleteMedia(a.storageKey);
        await d.delete("thumbs", a.id);
        await d.delete("peaks", a.id);
      }
    }
  }
}

export async function addVersion(project: Project, label: string, at = Date.now()): Promise<void> {
  const d = await db();
  await d.add("versions", { projectId: project.id, at, label, project });
  const keys = await d.getAllKeysFromIndex("versions", "projectId", project.id);
  if (keys.length > MAX_VERSIONS) {
    const sorted = [...keys].sort((a, b) => a - b);
    for (const k of sorted.slice(0, keys.length - MAX_VERSIONS)) await d.delete("versions", k);
  }
}

export async function listVersions(projectId: string): Promise<VersionRecord[]> {
  const d = await db();
  const all = await d.getAllFromIndex("versions", "projectId", projectId);
  return all.sort((a, b) => b.at - a.at);
}

export async function getVersion(id: number): Promise<VersionRecord | undefined> {
  const d = await db();
  return d.get("versions", id);
}

export async function kvGet<T>(key: string): Promise<T | undefined> {
  const d = await db();
  return (await d.get("kv", key)) as T | undefined;
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  const d = await db();
  await d.put("kv", value, key);
}

export async function saveThumbs(rec: ThumbRecord): Promise<void> {
  await (await db()).put("thumbs", rec);
}

export async function loadThumbs(assetId: string): Promise<ThumbRecord | undefined> {
  return (await db()).get("thumbs", assetId);
}

export async function savePeaks(rec: PeaksRecord): Promise<void> {
  await (await db()).put("peaks", rec);
}

export async function loadPeaks(assetId: string): Promise<PeaksRecord | undefined> {
  return (await db()).get("peaks", assetId);
}
