/**
 * Cloud usage meter: how much of the free Vercel plan each video used, so the
 * connector can say it in its replies. Numbers are our own count (bytes we
 * store and serve, time our function runs), not Vercel's bill, so they are
 * close but not exact. Claude's own credits are not visible to a connector.
 *
 * Stored in meta/ (never auto-deleted): one file per video and one per month.
 * Only big events are counted (not every request), so the meter itself uses
 * very few storage operations.
 */
import type { Store } from "./store";

export interface Usage {
  /** Bytes downloaded from links (Drive etc.) by the server. */
  downloaded: number;
  /** Bytes written to online storage (clips, uploads, renders). */
  stored: number;
  /** Bytes sent from online storage to a browser (render page, MP4 download). */
  served: number;
  /** Server time in milliseconds. */
  serverMs: number;
  /** Metered events (downloads, uploads, renders). */
  calls: number;
  /** Size of the video's clips, counted as "sent to browser" when the render page loads them. */
  mediaBytes: number;
}

const ZERO: Usage = { downloaded: 0, stored: 0, served: 0, serverMs: 0, calls: 0, mediaBytes: 0 };

/**
 * Free Hobby allowances used for the "% of free plan" line. They change from
 * time to time, so they live here in one place; check Vercel → Usage for the
 * exact numbers on the account.
 */
export const FREE_PLAN = {
  /** Blob data transfer per month. */
  blobTransferBytes: 10 * 1024 ** 3,
  /** Blob storage at any time. */
  blobStorageBytes: 1024 ** 3,
};

const MB = 1024 * 1024;

export function monthKey(now = Date.now()): string {
  return new Date(now).toISOString().slice(0, 7);
}

function add(a: Usage, b: Partial<Usage>): Usage {
  return {
    downloaded: a.downloaded + (b.downloaded ?? 0),
    stored: a.stored + (b.stored ?? 0),
    served: a.served + (b.served ?? 0),
    serverMs: a.serverMs + (b.serverMs ?? 0),
    calls: a.calls + (b.calls ?? 0),
    mediaBytes: a.mediaBytes + (b.mediaBytes ?? 0),
  };
}

/** Add to a video's count (when known) and to this month's count. Never throws. */
export async function recordUsage(store: Store, recipeId: string | null, delta: Partial<Usage>, now = Date.now()): Promise<void> {
  try {
    const keys = [`meta/usage-${monthKey(now)}.json`];
    if (recipeId && /^[a-z0-9]{4,40}$/.test(recipeId)) keys.push(`meta/usage/${recipeId}.json`);
    for (const k of keys) {
      const cur = (await store.getJson<Usage>(k)) ?? ZERO;
      await store.putJson(k, add({ ...ZERO, ...cur }, delta));
    }
  } catch {
    // A meter must never break editing.
  }
}

export async function videoUsage(store: Store, recipeId: string): Promise<Usage> {
  return { ...ZERO, ...((await store.getJson<Usage>(`meta/usage/${recipeId}.json`)) ?? {}) };
}

export async function monthUsage(store: Store, now = Date.now()): Promise<Usage> {
  return { ...ZERO, ...((await store.getJson<Usage>(`meta/usage-${monthKey(now)}.json`)) ?? {}) };
}

export function fmtBytes(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2)} GB`;
  if (n >= MB) return `${(n / MB).toFixed(n >= 100 * MB ? 0 : 1)} MB`;
  return `${Math.max(0, Math.round(n / 1024))} KB`;
}

function fmtTime(ms: number): string {
  const s = ms / 1000;
  return s >= 90 ? `${(s / 60).toFixed(1)} min` : `${s.toFixed(1)} s`;
}

/** Short report for connector replies. */
export function usageReport(video: Usage | null, month: Usage, storageUsed: number | null): string {
  const lines = ["Cloud use (Just See's free Vercel plan; Claude's own credits are shown in Claude → Settings → Usage):"];
  if (video) {
    lines.push(
      `  This video: downloaded ${fmtBytes(video.downloaded)}, stored ${fmtBytes(video.stored)}, sent to browser ${fmtBytes(video.served)}, server time ${fmtTime(video.serverMs)}.`,
    );
  }
  const pct = (a: number, b: number) => `${Math.min(999, Math.round((a / b) * 100))}%`;
  lines.push(
    `  This month: data transfer ${fmtBytes(month.served)} of ~${fmtBytes(FREE_PLAN.blobTransferBytes)} (${pct(month.served, FREE_PLAN.blobTransferBytes)}), server time ${fmtTime(month.serverMs)}, ${month.calls} calls.`,
  );
  if (storageUsed !== null) lines.push(`  Storage now: ${fmtBytes(storageUsed)} of ~${fmtBytes(FREE_PLAN.blobStorageBytes)} (${pct(storageUsed, FREE_PLAN.blobStorageBytes)}).`);
  lines.push("  (Our own count, close to Vercel's but not exact.)");
  return lines.join("\n");
}
