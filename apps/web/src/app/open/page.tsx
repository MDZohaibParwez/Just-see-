"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { Recipe } from "@just-see/schema";
import { apiJson } from "@/lib/api";
import { useT } from "@/lib/i18n";

/** Opens a share link (copy of a project), a live session invite, or a connector project. */
function Opener() {
  const t = useT();
  const params = useSearchParams();
  const router = useRouter();
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const share = params.get("share");
    const recipeId = params.get("recipe");
    const live = params.get("live");
    void (async () => {
      try {
        if (live) {
          router.replace(`/edit/?live=${encodeURIComponent(live)}`);
          return;
        }
        if (share) {
          setMsg(t("openingShare"));
          const s = await apiJson<{ url: string; name: string }>(`/api/share/${share}`);
          const res = await fetch(s.url);
          if (!res.ok) throw new Error(t("shareExpired"));
          const { restoreBackup } = await import("@/lib/backup");
          const id = await restoreBackup(new File([await res.blob()], `${s.name}.justsee`));
          router.replace(`/edit/?id=${encodeURIComponent(id)}`);
          return;
        }
        if (recipeId) {
          setMsg(t("openingRecipe"));
          const { recipe } = await apiJson<{ recipe: Recipe }>(`/api/recipes/${recipeId}`);
          const { buildRecipe } = await import("@/lib/recipe-run");
          const p = await buildRecipe(recipe, (s) => setMsg(`${s.label} (${s.done}/${s.total})`));
          router.replace(`/edit/?id=${encodeURIComponent(p.id)}`);
          return;
        }
        setError(t("notFound"));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [params, router, t]);
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-4 p-6">
      <h1 className="text-xl font-bold">Just See</h1>
      {msg && !error && <p className="text-muted" data-testid="open-status">{msg}</p>}
      {error && <p className="rounded-xl bg-danger/15 p-3 text-sm text-danger" role="alert">{error}</p>}
    </main>
  );
}

export default function OpenPage() {
  return (
    <Suspense fallback={null}>
      <Opener />
    </Suspense>
  );
}
