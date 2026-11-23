"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Editor } from "@/components/editor/Editor";
import { useEditor } from "@/lib/editor-store";
import { useT } from "@/lib/i18n";
import { kvSet, loadProject } from "@/lib/storage/db";

function EditorLoader() {
  const t = useT();
  const params = useSearchParams();
  const id = params.get("id");
  const live = params.get("live");
  const [status, setStatus] = useState<"loading" | "ready" | "missing">("loading");
  const [liveError, setLiveError] = useState("");

  // Joining someone's live session from an invite link.
  useEffect(() => {
    if (!live || id) return;
    let alive = true;
    void import("@/lib/live")
      .then((m) => m.joinLive(live))
      .then((p) => {
        if (!alive) return;
        void kvSet("lastProjectId", p.id);
        setStatus("ready");
      })
      .catch((e: unknown) => {
        if (!alive) return;
        setLiveError(e instanceof Error ? e.message : String(e));
        setStatus("missing");
      });
    return () => {
      alive = false;
      void import("@/lib/live").then((m) => m.stopLive());
      useEditor.getState().unload();
    };
  }, [live, id]);

  useEffect(() => {
    if (live && !id) return;
    if (!id) {
      setStatus("missing");
      return;
    }
    let alive = true;
    loadProject(id)
      .then((p) => {
        if (!alive) return;
        if (!p) {
          setStatus("missing");
          return;
        }
        useEditor.getState().load(p);
        void import("@/lib/fonts").then((m) => m.ensureProjectFonts(p));
        void kvSet("lastProjectId", p.id);
        setStatus("ready");
      })
      .catch((e: unknown) => {
        console.error(e);
        if (alive) setStatus("missing");
      });
    return () => {
      alive = false;
      useEditor.getState().unload();
      void import("@/lib/live").then((m) => { if (m.useLive.getState().role === "host") void m.stopLive(); });
    };
  }, [id, live]);

  if (status === "loading") return <p className="p-6 text-muted">{t("loading")}</p>;
  if (status === "missing")
    return (
      <div className="flex flex-col items-start gap-3 p-6">
        <p>{liveError || t("notFound")}</p>
        <Link href="/" className="rounded-full bg-accent px-4 py-2 text-accent-contrast">
          {t("goHome")}
        </Link>
      </div>
    );
  return <Editor />;
}

export default function EditPage() {
  return (
    <Suspense fallback={null}>
      <EditorLoader />
    </Suspense>
  );
}
