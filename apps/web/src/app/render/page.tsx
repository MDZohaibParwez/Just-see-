"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { exportProject, exportSizes } from "@just-see/engine";
import { getSequence, type Recipe, type RenderJob } from "@just-see/schema";
import { apiJson, uploadFile } from "@/lib/api";
import { mediaLoader } from "@/lib/media";
import { useT } from "@/lib/i18n";

type View =
  | { kind: "loading" }
  | { kind: "working"; label: string; progress: number }
  | { kind: "done"; url: string; local: string; projectId: string }
  | { kind: "error"; message: string; projectId?: string };

/** Opened from the connector's render link: builds the video here and uploads it. */
function Renderer() {
  const t = useT();
  const params = useSearchParams();
  const job = params.get("job") ?? "";
  const key = params.get("key") ?? "";
  const [view, setView] = useState<View>({ kind: "loading" });
  const started = useRef(false);

  useEffect(() => {
    if (started.current || !job) return;
    started.current = true;
    const report = (status: string, extra: Record<string, unknown> = {}) =>
      apiJson(`/api/jobs/${job}/status`, { method: "POST", body: JSON.stringify({ key, status, ...extra }) }).catch(() => undefined);
    let builtId = "";
    void (async () => {
      try {
        const info = await apiJson<Omit<RenderJob, "token">>(`/api/jobs/${job}`);
        if (info.status === "done" && info.outputUrl) {
          setView({ kind: "done", url: info.outputUrl, local: info.outputUrl, projectId: "" });
          return;
        }
        const { recipe } = await apiJson<{ recipe: Recipe }>(`/api/recipes/${info.recipeId}`);
        await report("rendering");
        const { buildRecipe } = await import("@/lib/recipe-run");
        const project = await buildRecipe(recipe, (s) => setView({ kind: "working", label: s.label, progress: (s.done / Math.max(1, s.total)) * 0.4 }));
        builtId = project.id;
        // Every clip is now on this device: the online copies can go.
        await apiJson(`/api/jobs/${job}/loaded`, { method: "POST", body: JSON.stringify({ key }) }).catch(() => undefined);
        await (await import("@/lib/fonts")).ensureProjectFonts(project);
        const seq = getSequence(project);
        const sizes = exportSizes(seq.width, seq.height);
        const size = sizes.find((s) => s.label === info.resolution) ?? sizes[1] ?? sizes[0]!;
        const res = await exportProject(project, mediaLoader, {
          width: size.width,
          height: size.height,
          fps: 30,
          format: "mp4",
          codec: "avc",
          videoBitrate: size.width * size.height >= 1920 * 1080 ? 12e6 : 6e6,
          onProgress: (p) => setView({ kind: "working", label: t("renderingVideo"), progress: 0.4 + (p.phase === "video" ? p.progress : p.phase === "finalize" ? 1 : 0) * 0.5 }),
        });
        setView({ kind: "working", label: t("uploading"), progress: 0.9 });
        const url = await uploadFile(`renders/${job}.mp4`, new File([res.blob], `${recipe.name || "video"}.mp4`, { type: "video/mp4" }), (p) => setView({ kind: "working", label: t("uploading"), progress: 0.9 + p * 0.1 }));
        await report("done", { url });
        setView({ kind: "done", url, local: URL.createObjectURL(res.blob), projectId: project.id });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        await report("failed", { error: message.slice(0, 1900) });
        // The project is saved on this device, so it can still be finished in the editor.
        setView({ kind: "error", message, projectId: builtId || undefined });
      }
    })();
  }, [job, key, t]);

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-4 p-6">
      <h1 className="text-xl font-bold">{t("renderTitle")}</h1>
      {view.kind === "loading" && <p className="text-muted">{t("loading")}</p>}
      {view.kind === "working" && (
        <div data-testid="render-working">
          <p className="mb-2 text-sm">{view.label}</p>
          <div className="h-2 w-full overflow-hidden rounded-full bg-surface-2">
            <div className="h-full bg-accent transition-[width]" style={{ width: `${Math.round(view.progress * 100)}%` }} />
          </div>
          <p className="mt-3 text-xs text-muted">{t("renderKeepOpen")}</p>
        </div>
      )}
      {view.kind === "done" && (
        <div className="flex flex-col gap-3" data-testid="render-done">
          <video src={view.local} controls playsInline className="w-full rounded-xl bg-black" />
          <a href={view.url} download className="rounded-xl bg-accent py-3 text-center font-semibold text-accent-contrast" data-testid="render-download">
            {t("download")}
          </a>
          <p className="break-all text-xs text-muted" data-testid="render-url">{view.url}</p>
          {view.projectId && (
            <Link href={`/edit/?id=${encodeURIComponent(view.projectId)}`} className="rounded-xl border border-line py-3 text-center text-sm">
              {t("openInEditor")}
            </Link>
          )}
        </div>
      )}
      {view.kind === "error" && (
        <>
          <p className="rounded-xl bg-danger/15 p-3 text-sm text-danger" role="alert" data-testid="render-error">
            {view.message}
          </p>
          {view.projectId && (
            <Link href={`/edit/?id=${encodeURIComponent(view.projectId)}`} className="rounded-xl border border-line py-3 text-center text-sm" data-testid="render-open-local">
              {t("openInEditor")}
            </Link>
          )}
        </>
      )}
    </main>
  );
}

export default function RenderPage() {
  return (
    <Suspense fallback={null}>
      <Renderer />
    </Suspense>
  );
}
