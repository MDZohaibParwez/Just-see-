import { db } from "./db";

/**
 * Original media files live on the device: OPFS when the browser supports
 * writing to it, IndexedDB otherwise. Keys look like "media/<assetId>".
 */

type WritableDir = FileSystemDirectoryHandle & {
  getFileHandle(name: string, opts?: { create?: boolean }): Promise<FileSystemFileHandle>;
};

async function opfsDir(): Promise<WritableDir | null> {
  try {
    if (typeof navigator === "undefined" || !navigator.storage?.getDirectory) return null;
    const root = await navigator.storage.getDirectory();
    return (await root.getDirectoryHandle("media", { create: true })) as WritableDir;
  } catch {
    return null;
  }
}

function fileName(key: string): string {
  return key.replace(/[^a-zA-Z0-9_.-]/g, "_");
}

export async function putMedia(key: string, blob: Blob): Promise<"opfs" | "idb"> {
  const dir = await opfsDir();
  if (dir) {
    try {
      const handle = await dir.getFileHandle(fileName(key), { create: true });
      const writable = await (handle as FileSystemFileHandle & { createWritable?: () => Promise<FileSystemWritableFileStream> }).createWritable?.();
      if (writable) {
        await writable.write(blob);
        await writable.close();
        return "opfs";
      }
    } catch {
      // fall through to IndexedDB
    }
  }
  await (await db()).put("media", blob, key);
  return "idb";
}

export async function getMedia(key: string): Promise<Blob | undefined> {
  const dir = await opfsDir();
  if (dir) {
    try {
      const handle = await dir.getFileHandle(fileName(key));
      const file = await handle.getFile();
      if (file.size > 0) return file;
    } catch {
      // not in OPFS
    }
  }
  return (await (await db()).get("media", key)) ?? undefined;
}

export async function deleteMedia(key: string): Promise<void> {
  const dir = await opfsDir();
  if (dir) {
    try {
      await dir.removeEntry(fileName(key));
    } catch {
      // ignore
    }
  }
  await (await db()).delete("media", key);
}

/** Ask the browser not to evict our storage. */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}
