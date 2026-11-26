"use client";

import { useState } from "react";
import Link from "next/link";
import { Icon } from "@just-see/ui";
import { useCanRedo, useCanUndo, useEditor, useProject } from "@/lib/editor-store";
import { useT } from "@/lib/i18n";

export function TopBar() {
  const t = useT();
  const project = useProject();
  const canUndo = useCanUndo();
  const canRedo = useCanRedo();
  const saveState = useEditor((s) => s.saveState);
  const { undo, redo, openPanel, dispatch } = useEditor.getState();
  const [editing, setEditing] = useState(false);

  return (
    <header className="flex h-14 shrink-0 items-center gap-1 px-2 pt-[env(safe-area-inset-top)]">
      <Link href="/" className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-surface-2" aria-label={t("back")}>
        <Icon name="back" />
      </Link>
      <div className="min-w-0 flex-1">
        {editing ? (
          <input
            autoFocus
            defaultValue={project?.name}
            className="w-full rounded-md bg-surface-2 px-2 py-1 text-sm"
            aria-label={t("rename")}
            onBlur={(e) => {
              const v = e.currentTarget.value.trim();
              if (v && v !== project?.name) dispatch({ type: "project/rename", payload: { name: v.slice(0, 200) } });
              setEditing(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") setEditing(false);
            }}
          />
        ) : (
          <button type="button" className="block max-w-full truncate text-left text-sm font-semibold" onClick={() => setEditing(true)}>
            {project?.name}
          </button>
        )}
        <span className="block text-[11px] text-muted" data-testid="save-state">
          {saveState === "saving" ? t("saving") : t("saved")}
        </span>
      </div>
      <button
        type="button"
        className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-surface-2 disabled:opacity-30"
        onClick={() => openPanel("history")}
        aria-label={t("history")}
      >
        <Icon name="history" size={20} />
      </button>
      <button
        type="button"
        className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-surface-2 disabled:opacity-30"
        onClick={undo}
        disabled={!canUndo}
        aria-label={t("undo")}
        data-testid="undo"
      >
        <Icon name="undo" size={20} />
      </button>
      <button
        type="button"
        className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-surface-2 disabled:opacity-30"
        onClick={redo}
        disabled={!canRedo}
        aria-label={t("redo")}
        data-testid="redo"
      >
        <Icon name="redo" size={20} />
      </button>
      <button
        type="button"
        className="ml-1 flex h-9 items-center gap-1 rounded-full bg-accent px-4 text-sm font-semibold text-accent-contrast active:scale-95"
        onClick={() => {
          useEditor.getState().setPlaying(false);
          openPanel("export");
        }}
        data-testid="open-export"
      >
        <Icon name="export" size={18} />
        {t("export")}
      </button>
    </header>
  );
}
