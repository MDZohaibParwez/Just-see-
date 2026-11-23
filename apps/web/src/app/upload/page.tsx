"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { Recipe } from "@just-see/schema";
import { apiJson, uploadFile } from "@/lib/api";
import { useT } from "@/lib/i18n";

/** Opened from the connector: add clips from a phone or computer to a connector project. */
function Uploader() {
  const t = useT();
  const id = useSearchParams().get("recipe") ?? "";
  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const refresh = () => apiJson<{ recipe: Recipe }>(`/api/recipes/${id}`).then((r) => setRecipe(r.recipe), (e: Error) => setError(e.message));
  useEffect(() => {
    if (id) void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  const onFiles = async (files: File[]) => {
    setError("");
    for (const [i, f] of files.entries()) {
      try {
        setStatus(`${t("uploading")} ${i + 1}/${files.length}: ${f.name}`);
        const safe = f.name.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(-80) || "clip";
        const url = await uploadFile(`uploads/${id}/${Date.now()}-${safe}`, f, (p) => setStatus(`${t("uploading")} ${i + 1}/${files.length}: ${Math.round(p * 100)}%`));
        await apiJson(`/api/recipes/${id}/media`, { method: "POST", body: JSON.stringify({ url, name: f.name, contentType: f.type }) });
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    }
    setStatus(t("uploadDone"));
    await refresh();
  };
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-4 p-6">
      <h1 className="text-xl font-bold">{t("uploadTitle")}</h1>
      {recipe && <p className="text-sm text-muted">{recipe.name}</p>}
      <label className="flex cursor-pointer items-center justify-center rounded-2xl border-2 border-dashed border-accent p-8 text-center font-semibold">
        {t("uploadPick")}
        <input type="file" accept="video/*,image/*,audio/*" multiple hidden data-testid="upload-input" onChange={(e) => { const fs = Array.from(e.target.files ?? []); e.target.value = ""; void onFiles(fs); }} />
      </label>
      {status && <p className="text-sm" data-testid="upload-status">{status}</p>}
      {error && <p className="rounded-xl bg-danger/15 p-3 text-sm text-danger">{error}</p>}
      <ul className="flex flex-col gap-1" data-testid="upload-list">
        {recipe?.media.map((m) => (
          <li key={m.id} className="rounded-xl border border-line bg-surface px-3 py-2 text-sm">
            {m.name} · {m.kind}{m.durationSec != null ? ` · ${m.durationSec.toFixed(1)}s` : ""}
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted">{t("uploadHint")}</p>
    </main>
  );
}

export default function UploadPage() {
  return (
    <Suspense fallback={null}>
      <Uploader />
    </Suspense>
  );
}
