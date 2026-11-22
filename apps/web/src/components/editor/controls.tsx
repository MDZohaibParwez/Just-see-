"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "@just-see/ui";
import type { Command } from "@just-see/schema";
import { useEditor } from "@/lib/editor-store";
import { useT } from "@/lib/i18n";

/** Bottom sheet on phones, side panel on desktop. */
export function Sheet({ title, children, onClose }: { title: string; children: ReactNode; onClose?: () => void }) {
  const t = useT();
  const close = onClose ?? (() => useEditor.getState().openPanel(null));
  return (
    <section
      className="sheet-in flex max-h-[46vh] flex-col border-t border-line bg-surface lg:max-h-none lg:border-l lg:border-t-0"
      role="dialog"
      aria-label={title}
      data-testid="sheet"
    >
      <div className="flex h-11 shrink-0 items-center justify-between px-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        <button
          type="button"
          onClick={close}
          className="flex h-9 items-center gap-1 rounded-full bg-surface-2 px-3 text-sm"
          aria-label={t("done")}
          data-testid="sheet-done"
        >
          <Icon name="check" size={18} />
          {t("done")}
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">{children}</div>
    </section>
  );
}

/**
 * Slider that previews while dragging and records one undo step on release.
 */
export function CommitSlider({
  label,
  value,
  min,
  max,
  step = 0.01,
  format,
  toCommand,
  testId,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  format?: (v: number) => string;
  toCommand: (v: number) => Command;
  testId?: string;
}) {
  const [local, setLocal] = useState(value);
  const dragging = useRef(false);
  const last = useRef<number | null>(null);
  useEffect(() => {
    if (!dragging.current) setLocal(value);
  }, [value]);

  const commit = () => {
    dragging.current = false;
    if (last.current !== null) {
      useEditor.getState().dispatch(toCommand(last.current));
      last.current = null;
    }
  };

  return (
    <label className="flex items-center gap-3 py-1">
      <span className="w-24 shrink-0 text-xs text-muted">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={local}
        data-testid={testId}
        className="min-w-0 flex-1"
        onPointerDown={() => (dragging.current = true)}
        onChange={(e) => {
          const v = Number(e.currentTarget.value);
          setLocal(v);
          last.current = v;
          if (dragging.current) useEditor.getState().preview(toCommand(v));
          else commit();
        }}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={commit}
        onTouchEnd={commit}
      />
      <span className="w-12 shrink-0 text-right font-mono text-xs tabular-nums">{format ? format(local) : local.toFixed(2)}</span>
    </label>
  );
}

export function Chip({
  active,
  onClick,
  children,
  testId,
  label,
}: {
  active?: boolean;
  onClick: () => void;
  children: ReactNode;
  testId?: string;
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      aria-pressed={active}
      aria-label={label}
      className={`shrink-0 rounded-xl border px-3 py-2 text-sm ${
        active ? "border-accent bg-accent/15 text-fg" : "border-line bg-surface-2 text-fg"
      }`}
    >
      {children}
    </button>
  );
}

export const SWATCHES = ["#ffffff", "#000000", "#ff8a1f", "#ffd60a", "#34c759", "#0a84ff", "#bf5af2", "#ff375f", "#8e8e93"];

export function ColorRow({ value, onPick, label }: { value: string; onPick: (c: string) => void; label: string }) {
  return (
    <div className="flex items-center gap-3 py-1">
      <span className="w-24 shrink-0 text-xs text-muted">{label}</span>
      <div className="no-scrollbar flex gap-2 overflow-x-auto">
        {SWATCHES.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => onPick(c)}
            aria-label={`${label} ${c}`}
            aria-pressed={value.toLowerCase() === c}
            className="h-8 w-8 shrink-0 rounded-full border-2"
            style={{ background: c, borderColor: value.toLowerCase() === c ? "var(--accent)" : "var(--border)" }}
          />
        ))}
        <input
          type="color"
          value={value}
          onChange={(e) => onPick(e.currentTarget.value)}
          className="h-8 w-8 shrink-0 cursor-pointer rounded-full border-0 bg-transparent p-0"
          aria-label={`${label} custom`}
        />
      </div>
    </div>
  );
}
