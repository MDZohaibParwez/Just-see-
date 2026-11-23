"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@just-see/ui";
import { createProject, formatTimecode, type AspectPreset } from "@just-see/schema";
import { Prefs } from "@/components/Prefs";
import { useT, type MessageKey } from "@/lib/i18n";
import { deleteProject, kvGet, listProjects, saveProject, type ProjectRecord } from "@/lib/storage/db";
import { requestPersistentStorage } from "@/lib/storage/media-store";

const ASPECTS: { id: AspectPreset; label: MessageKey; w: number; h: number }[] = [
  { id: "9:16", label: "reels", w: 9, h: 16 },
  { id: "16:9", label: "youtube", w: 16, h: 9 },
  { id: "1:1", label: "square", w: 1, h: 1 },
  { id: "4:5", label: "portrait", w: 4, h: 5 },
];

type Meta = Omit<ProjectRecord, "project">;

export default function Home() {
  const t = useT();
  const router = useRouter();
  const [projects, setProjects] = useState<Meta[] | null>(null);
  const [lastId, setLastId] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  const refresh = () => {
    void listProjects()
      .then(setProjects)
      .catch(() => setProjects([]));
  };

  useEffect(() => {
    refresh();
    void kvGet<string>("lastProjectId").then(setLastId).catch(() => undefined);
  }, []);

  const create = async (aspect: AspectPreset) => {
    if (busy) return;
    setBusy(true);
    void requestPersistentStorage();
    const p = createProject({ aspect, name: t("untitled") });
    await saveProject(p);
    router.push(`/edit/?id=${encodeURIComponent(p.id)}`);
  };

  const remove = async (id: string) => {
    if (!window.confirm(t("deleteConfirm"))) return;
    await deleteProject(id);
    refresh();
  };

  const last = projects?.find((p) => p.id === lastId);

  return (
    <main className="mx-auto flex min-h-full max-w-3xl flex-col px-4 pb-16 pt-[max(1rem,env(safe-area-inset-top))]">
      <header className="flex items-center justify-between py-2">
        <div className="flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent text-accent-contrast">
            <Icon name="logo" size={22} />
          </span>
          <h1 className="text-xl font-bold tracking-tight">{t("appName")}</h1>
        </div>
        <Prefs />
      </header>

      <p className="mt-6 text-2xl font-semibold leading-snug">{t("tagline")}</p>

      {last && (
        <button
          type="button"
          onClick={() => router.push(`/edit/?id=${encodeURIComponent(last.id)}`)}
          className="mt-5 flex items-center justify-between rounded-2xl border border-line bg-surface px-4 py-3 text-left"
        >
          <span>
            <span className="block text-xs uppercase tracking-wide text-muted">{t("continueEditing")}</span>
            <span className="block font-medium">{last.name}</span>
          </span>
          <Icon name="play" />
        </button>
      )}

      <section className="mt-6" aria-labelledby="new-h">
        <h2 id="new-h" className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">
          {t("newProject")} · {t("chooseCanvas")}
        </h2>
        <div className="grid grid-cols-4 gap-2 sm:gap-3">
          {ASPECTS.map((a) => (
            <button
              key={a.id}
              type="button"
              data-testid={`new-${a.id}`}
              disabled={busy}
              onClick={() => void create(a.id)}
              className="flex flex-col items-center gap-2 rounded-2xl border border-line bg-surface p-3 transition active:scale-95 hover:border-accent disabled:opacity-50"
            >
              <span className="flex h-16 items-center justify-center">
                <span
                  className="rounded-md border-2 border-accent bg-accent/15"
                  style={{ width: a.w > a.h ? 56 : (56 * a.w) / a.h, height: a.h >= a.w ? 56 : (56 * a.h) / a.w }}
                />
              </span>
              <span className="text-sm font-semibold">{a.id}</span>
              <span className="text-center text-[11px] leading-tight text-muted">{t(a.label)}</span>
            </button>
          ))}
        </div>
      </section>

      <label className="mt-4 flex cursor-pointer items-center justify-center gap-2 rounded-2xl border border-dashed border-line p-3 text-sm text-muted">
        <Icon name="folder" size={18} />
        {t("backupOpen")}
        <input
          type="file"
          accept=".justsee,application/zip"
          hidden
          data-testid="backup-open"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (!f) return;
            setBusy(true);
            void import("@/lib/backup")
              .then((m) => m.restoreBackup(f))
              .then((id) => router.push(`/edit/?id=${encodeURIComponent(id)}`))
              .catch((err: unknown) => {
                setBusy(false);
                alert(err instanceof Error ? err.message : String(err));
              });
          }}
        />
      </label>

      <section className="mt-8" aria-labelledby="proj-h">
        <h2 id="proj-h" className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">
          {t("yourProjects")}
        </h2>
        {projects === null ? (
          <p className="text-muted">{t("loading")}</p>
        ) : projects.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-line p-6 text-center text-muted">{t("noProjects")}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {projects.map((p) => (
              <li key={p.id} className="flex items-center gap-2 rounded-2xl border border-line bg-surface pr-2">
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-3 p-3 text-left"
                  onClick={() => router.push(`/edit/?id=${encodeURIComponent(p.id)}`)}
                >
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-xs text-muted">
                    {p.aspect}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{p.name}</span>
                    <span className="block text-xs text-muted">
                      {formatTimecode(p.durationUs, false)} · {new Date(p.updatedAt).toLocaleString()}
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  className="flex h-10 w-10 items-center justify-center rounded-full text-muted hover:bg-surface-2 hover:text-danger"
                  onClick={() => void remove(p.id)}
                  aria-label={`${t("delete")} ${p.name}`}
                >
                  <Icon name="trash" size={20} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="mt-10 text-center text-xs text-muted">{t("storageWarning")}</p>
    </main>
  );
}
