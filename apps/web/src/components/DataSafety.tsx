"use client";

import { useEffect, useState } from "react";
import { Icon } from "@just-see/ui";
import { useT } from "@/lib/i18n";
import { kvGet, kvSet, listProjects, loadProject } from "@/lib/storage/db";

/**
 * Keeps work safe without accounts:
 * - "Install app" (Android/desktop) or an iPhone guide for Add to Home Screen,
 *   so the browser keeps the app's storage;
 * - a reminder to back up, and a free one-tap cloud backup link per project.
 */
type InstallEvent = Event & { prompt: () => Promise<void> };

let deferred: InstallEvent | null = null;
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e as InstallEvent;
  });
}

interface CloudBackup {
  projectId: string;
  name: string;
  link: string;
  at: number;
}

const WEEK = 7 * 24 * 3600 * 1000;

export function DataSafety() {
  const t = useT();
  const [installable, setInstallable] = useState(false);
  const [ios, setIos] = useState(false);
  const [standalone, setStandalone] = useState(true);
  const [hideIos, setHideIos] = useState(true);
  const [needsBackup, setNeedsBackup] = useState(false);
  const [backups, setBackups] = useState<CloudBackup[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const ua = navigator.userAgent;
    setIos(/iPhone|iPad|iPod/.test(ua) || (ua.includes("Mac") && navigator.maxTouchPoints > 1));
    setStandalone(window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true);
    setInstallable(!!deferred);
    const onPrompt = () => setInstallable(true);
    window.addEventListener("beforeinstallprompt", onPrompt);
    try {
      setHideIos(localStorage.getItem("justsee:hideIosGuide") === "1");
    } catch {
      setHideIos(false);
    }
    void (async () => {
      const [list, last, saved] = await Promise.all([listProjects(), kvGet<number>("lastBackupAt"), kvGet<CloudBackup[]>("cloudBackups")]);
      setBackups(saved ?? []);
      setNeedsBackup(list.length > 0 && (!last || Date.now() - last > WEEK));
    })().catch(() => undefined);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  const install = async () => {
    await deferred?.prompt();
    deferred = null;
    setInstallable(false);
  };

  const backupAll = async () => {
    setError("");
    try {
      const list = (await listProjects()).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 5);
      const { shareCopy } = await import("@/lib/share");
      const next: CloudBackup[] = [...backups];
      for (const [i, meta] of list.entries()) {
        setBusy(`${i + 1}/${list.length}`);
        const p = await loadProject(meta.id);
        if (!p) continue;
        const link = await shareCopy(p);
        const entry = { projectId: p.id, name: p.name, link, at: Date.now() };
        const k = next.findIndex((b) => b.projectId === p.id);
        if (k >= 0) next[k] = entry;
        else next.unshift(entry);
      }
      await kvSet("cloudBackups", next.slice(0, 50));
      await kvSet("lastBackupAt", Date.now());
      setBackups(next);
      setNeedsBackup(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  };

  return (
    <section className="mt-6 flex flex-col gap-2" aria-label={t("safetyTitle")}>
      {!standalone && installable && (
        <button type="button" data-testid="install-app" onClick={() => void install()} className="flex items-center gap-3 rounded-2xl border border-accent bg-accent/10 p-3 text-left text-sm">
          <Icon name="download" size={20} />
          <span className="flex-1">
            <b>{t("installTitle")}</b>
            <br />
            <span className="text-muted">{t("installWhy")}</span>
          </span>
        </button>
      )}
      {!standalone && ios && !hideIos && (
        <div className="rounded-2xl border border-accent bg-accent/10 p-3 text-sm" data-testid="ios-guide">
          <b>{t("iosTitle")}</b>
          <ol className="mt-1 list-decimal pl-5 text-muted">
            <li>{t("iosStep1")}</li>
            <li>{t("iosStep2")}</li>
            <li>{t("iosStep3")}</li>
          </ol>
          <p className="mt-1 text-xs text-muted">{t("iosWhy")}</p>
          <button
            type="button"
            className="mt-2 text-xs underline"
            onClick={() => {
              try {
                localStorage.setItem("justsee:hideIosGuide", "1");
              } catch {
                // ignore
              }
              setHideIos(true);
            }}
          >
            {t("iosDone")}
          </button>
        </div>
      )}
      {needsBackup && (
        <div className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-3 text-sm" data-testid="backup-reminder">
          <span className="flex-1">
            <b>{t("backupReminder")}</b>
            <br />
            <span className="text-muted">{t("backupReminderWhy")}</span>
          </span>
          <button type="button" data-testid="cloud-backup" disabled={!!busy} onClick={() => void backupAll()} className="shrink-0 rounded-full bg-accent px-4 py-2 text-accent-contrast">
            {busy ? `… ${busy}` : t("cloudBackup")}
          </button>
        </div>
      )}
      {error && <p className="text-xs text-danger">{error}</p>}
      {backups.length > 0 && (
        <details className="rounded-2xl border border-line bg-surface p-3 text-sm" data-testid="cloud-backups">
          <summary className="cursor-pointer">{t("cloudBackups")} ({backups.length})</summary>
          <p className="mt-1 text-xs text-muted">{t("cloudBackupsWhy")}</p>
          <ul className="mt-2 flex flex-col gap-1">
            {backups.map((b) => (
              <li key={b.projectId} className="flex items-center gap-2 text-xs">
                <span className="min-w-0 flex-1 truncate">{b.name} · {new Date(b.at).toLocaleDateString()}</span>
                <button type="button" className="rounded-full bg-surface-2 px-3 py-1" onClick={() => void navigator.clipboard?.writeText(b.link)}>
                  {t("copyLink")}
                </button>
              </li>
            ))}
          </ul>
          <button type="button" disabled={!!busy} onClick={() => void backupAll()} className="mt-2 text-xs underline">
            {busy ? `… ${busy}` : t("cloudBackupAgain")}
          </button>
        </details>
      )}
    </section>
  );
}
