/**
 * Private, free analytics and crash reporting. Everything stays on this
 * device (localStorage). Nothing is sent anywhere unless the user taps
 * "Send report", which uploads one crash report they can read first.
 */
export const APP_VERSION = "0.7.0";

const USAGE_KEY = "js.usage";
const CRASH_KEY = "js.crashes";
const MAX_CRASHES = 30;

export interface Usage {
  since: number;
  counts: Record<string, number>;
}

export interface CrashReport {
  id: string;
  at: number;
  message: string;
  stack: string;
  where: string;
  version: string;
  browser: string;
}

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage full or blocked: drop it, never break the app
  }
}

/** Count a feature use (e.g. "export", "quick-reel"). Names only, no content. */
export function track(event: string): void {
  if (!/^[a-z0-9:_-]{1,60}$/.test(event)) return;
  const u = read<Usage>(USAGE_KEY, { since: Date.now(), counts: {} });
  u.counts[event] = (u.counts[event] ?? 0) + 1;
  write(USAGE_KEY, u);
}

export function usage(): Usage {
  return read<Usage>(USAGE_KEY, { since: Date.now(), counts: {} });
}

/** Strip anything that could identify a person or a file: query strings, blob URLs, file names. */
export function scrub(text: string): string {
  return text
    .replace(/blob:[^\s)]+/g, "blob:…")
    .replace(/https?:\/\/[^\s)]+/g, (u) => u.replace(/[?#].*$/, ""))
    .replace(/[\w.-]+@[\w.-]+\.\w+/g, "…@…")
    .replace(/[^\s/\\"'()]+\.(mp4|mov|webm|mkv|mp3|wav|m4a|aac|png|jpe?g|heic|gif|justsee)\b/gi, "file.$1")
    .slice(0, 4000);
}

export function recordCrash(error: unknown, where = ""): CrashReport | null {
  const e = error instanceof Error ? error : new Error(typeof error === "string" ? error : JSON.stringify(error ?? "Unknown error"));
  // Noise from the browser itself, not our bug.
  if (/ResizeObserver loop|Script error\.?$|AbortError/i.test(e.message)) return null;
  const report: CrashReport = {
    id: Math.random().toString(36).slice(2, 10),
    at: Date.now(),
    message: scrub(e.message).slice(0, 500),
    stack: scrub(e.stack ?? ""),
    where: where || (typeof location !== "undefined" ? location.pathname : ""),
    version: APP_VERSION,
    browser: typeof navigator !== "undefined" ? navigator.userAgent.replace(/\([^)]*\)/g, "").slice(0, 200) : "",
  };
  const list = read<CrashReport[]>(CRASH_KEY, []);
  // Same error again: keep one copy.
  if (list.some((c) => c.message === report.message && c.where === report.where)) return report;
  list.unshift(report);
  write(CRASH_KEY, list.slice(0, MAX_CRASHES));
  track("crash");
  return report;
}

export function crashes(): CrashReport[] {
  return read<CrashReport[]>(CRASH_KEY, []);
}

export function clearCrashes(): void {
  write(CRASH_KEY, []);
}

let installed = false;
/** Catch errors that reach the window. */
export function installCrashHandlers(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("error", (e) => {
    recordCrash(e.error ?? e.message);
  });
  window.addEventListener("unhandledrejection", (e) => {
    recordCrash(e.reason, "promise");
  });
}

/** Upload one report (user-initiated). Stored online for 30 days, then deleted. */
export async function sendReport(report: CrashReport, note: string): Promise<string> {
  const { apiBase } = await import("./api");
  const res = await fetch(`${apiBase()}/api/report`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...report, note: scrub(note).slice(0, 1000) }),
  });
  const body = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
  if (!res.ok || !body.id) throw new Error(body.error ?? `Could not send (${res.status})`);
  return body.id;
}
