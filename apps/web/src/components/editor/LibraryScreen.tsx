"use client";

import { useLibraryUi, type LibraryTab } from "@/lib/ui-stores";
import { useEffect, useMemo, useRef, useState } from "react";
import { FONT_CATALOG, REEL_STYLE_BY_ID, SFX_BY_ID, fontCss } from "@just-see/engine";
import { Icon } from "@just-see/ui";
import { useEditor } from "@/lib/editor-store";
import { useT, type MessageKey } from "@/lib/i18n";
import { creditsText, licenseLabel, projectCredits } from "@/lib/credits";
import { loadWebFont } from "@/lib/fonts";
import { listMyTemplates, localItems, searchLocal, applyItem, addOnline, deleteMyTemplate, type LibItem, type LibKind, type MyTemplate } from "@/lib/library";
import { searchOpenverse, type OnlineItem } from "@/lib/openverse";
import { Chip } from "./controls";

export { useLibraryUi };

type Tab = LibraryTab;
const TABS: Tab[] = ["all", "style", "font", "music", "sound", "template", "online", "licenses"];

let previewCtx: AudioContext | null = null;
function playSfx(id: string) {
  const def = SFX_BY_ID.get(id);
  if (!def) return;
  previewCtx ??= new AudioContext();
  const sr = previewCtx.sampleRate;
  const ch = def.make(sr);
  const buf = previewCtx.createBuffer(2, ch[0]!.length, sr);
  ch.forEach((c, i) => buf.copyToChannel(c as Float32Array<ArrayBuffer>, i));
  const src = previewCtx.createBufferSource();
  src.buffer = buf;
  src.connect(previewCtx.destination);
  src.start();
}

export function LibraryScreen() {
  const open = useLibraryUi((s) => s.open);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-bg" role="dialog" aria-label="Library" data-testid="library">
      <LibraryBody />
    </div>
  );
}

function LibraryBody() {
  const t = useT();
  const tab = useLibraryUi((s) => s.tab);
  const [q, setQ] = useState("");
  const [mine, setMine] = useState<MyTemplate[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const toast = useEditor((s) => s.toast);
  useEffect(() => {
    void listMyTemplates().then(setMine);
  }, []);
  const items = useMemo(() => localItems(mine), [mine]);
  const results = useMemo(() => (tab === "online" || tab === "licenses" ? [] : searchLocal(q, items, tab === "all" ? "all" : tab)), [q, items, tab]);

  const [styleId, setStyleId] = useState<string | null>(null);
  const use = async (item: LibItem) => {
    if (item.kind === "style") {
      setStyleId(item.id.slice(6));
      return;
    }
    setBusy(item.id);
    try {
      const msg = await applyItem(item, mine);
      if (msg) toast(t(msg as MessageKey));
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-2">
        <button type="button" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-2" aria-label={t("studioBack")} onClick={() => useLibraryUi.getState().hide()} data-testid="library-close">
          <Icon name="back" size={18} />
        </button>
        <input
          type="search"
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("librarySearch")}
          data-testid="library-search"
          className="h-10 min-w-0 flex-1 rounded-xl border border-line bg-surface-2 px-3 text-sm"
        />
      </header>
      <div className="no-scrollbar flex shrink-0 gap-2 overflow-x-auto px-2 py-2">
        {TABS.map((k) => (
          <Chip key={k} active={tab === k} onClick={() => useLibraryUi.setState({ tab: k })} testId={`lib-tab-${k}`}>
            {t(`lib_${k}` as MessageKey)}
          </Chip>
        ))}
      </div>
      {styleId && <StyleDialog styleId={styleId} onClose={() => setStyleId(null)} />}
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-6">
        {tab === "online" ? (
          <OnlineTab q={q} />
        ) : tab === "licenses" ? (
          <LicensesTab />
        ) : (
          <>
            <ul className="flex flex-col gap-1" data-testid="library-results">
              {results.slice(0, 120).map((item, i) => (
                <ResultRow key={item.id} item={item} busy={busy === item.id} onUse={() => void use(item)} loadFont={i < 24} onDelete={item.kind === "mine" ? () => void deleteMyTemplate(item.id.slice(5)).then(() => listMyTemplates().then(setMine)) : undefined} />
              ))}
            </ul>
            {results.length === 0 && (
              <div className="p-6 text-center text-sm text-muted">
                <p>{t("libraryNothing")}</p>
                {q && (
                  <button type="button" className="mt-3 rounded-full bg-accent px-4 py-2 text-accent-contrast" onClick={() => useLibraryUi.setState({ tab: "online" })}>
                    {t("librarySearchOnline")}
                  </button>
                )}
              </div>
            )}
            <p className="mt-4 text-center text-[11px] text-muted">{t("libraryFootnote")}</p>
          </>
        )}
      </div>
    </>
  );
}

function ResultRow({ item, busy, onUse, loadFont, onDelete }: { item: LibItem; busy: boolean; onUse: () => void; loadFont: boolean; onDelete?: () => void }) {
  const t = useT();
  const font = item.kind === "font" ? FONT_CATALOG.find((f) => f.family === item.label) : undefined;
  useEffect(() => {
    if (font && loadFont) void loadWebFont(font.family, font.weights);
  }, [font, loadFont]);
  const icon = item.kind === "font" ? "text" : item.kind === "music" ? "music" : item.kind === "sound" ? "volume" : item.kind === "style" ? "effects" : "animation";
  return (
    <li className="flex items-center gap-2 rounded-xl border border-line bg-surface-2 px-2 py-2" data-testid={`lib-item-${item.id}`}>
      {item.kind === "sound" ? (
        <button type="button" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-3" aria-label={t("play")} onClick={() => playSfx(item.id.slice(6))}>
          <Icon name="play" size={16} />
        </button>
      ) : (
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-3">
          <Icon name={icon} size={16} />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm" style={font ? { fontFamily: fontCss(font.family, font.category), fontWeight: 700 } : undefined}>
          {item.label}
          {font && (font.category === "indic" ? " · नमस्ते" : font.category === "urdu" ? " · سلام" : "")}
        </span>
        <span className="block truncate text-[11px] text-muted">
          {t(`lib_${item.kind}` as MessageKey)} · {item.hint} · <span data-testid="lib-license">{item.licenseName}</span>
        </span>
      </span>
      {onDelete && (
        <button type="button" className="h-8 w-8 rounded-full bg-surface-3" aria-label={t("delete")} onClick={onDelete}>
          ✕
        </button>
      )}
      <button type="button" disabled={busy} data-testid={`lib-add-${item.id}`} className="flex h-9 shrink-0 items-center gap-1 rounded-full bg-accent px-3 text-sm text-accent-contrast disabled:opacity-60" onClick={onUse}>
        {busy ? "…" : <Icon name="plus" size={16} />}
        {t(item.kind === "font" ? "libraryUseFont" : "add")}
      </button>
    </li>
  );
}

function OnlineTab({ q }: { q: string }) {
  const t = useT();
  const [kind, setKind] = useState<"audio" | "image">("audio");
  const [state, setState] = useState<{ status: "idle" | "loading" | "done" | "error"; items: OnlineItem[]; error?: string }>({ status: "idle", items: [] });
  const [busy, setBusy] = useState<string | null>(null);
  const toast = useEditor((s) => s.toast);
  const audio = useRef<HTMLAudioElement | null>(null);
  const run = async () => {
    if (!q.trim()) return;
    setState({ status: "loading", items: [] });
    try {
      setState({ status: "done", items: await searchOpenverse(q.trim(), kind) });
    } catch (e) {
      setState({ status: "error", items: [], error: e instanceof Error ? e.message : String(e) });
    }
  };
  useEffect(() => {
    const id = setTimeout(() => void run(), 400);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, kind]);
  useEffect(() => () => audio.current?.pause(), []);
  const add = async (it: OnlineItem) => {
    setBusy(it.id);
    try {
      await addOnline(it);
      toast(t("addedToVideo"));
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setBusy(null);
    }
  };
  return (
    <div>
      <div className="mb-2 flex gap-2">
        <Chip active={kind === "audio"} onClick={() => setKind("audio")} testId="online-audio">{t("lib_sound")}</Chip>
        <Chip active={kind === "image"} onClick={() => setKind("image")} testId="online-image">{t("libraryImages")}</Chip>
      </div>
      <p className="mb-2 text-[11px] text-muted">{t("libraryOnlineNote")}</p>
      {!q.trim() && <p className="p-4 text-center text-sm text-muted">{t("libraryTypeToSearch")}</p>}
      {state.status === "loading" && <p className="p-4 text-center text-sm text-muted">{t("loading")}</p>}
      {state.status === "error" && <p className="p-4 text-center text-sm text-danger">{t("libraryOffline")}</p>}
      {state.status === "done" && state.items.length === 0 && <p className="p-4 text-center text-sm text-muted">{t("libraryNothing")}</p>}
      <ul className={kind === "image" ? "grid grid-cols-2 gap-2" : "flex flex-col gap-1"} data-testid="online-results">
        {state.items.map((it) => (
          <li key={it.id} className="flex items-center gap-2 rounded-xl border border-line bg-surface-2 p-2" data-testid="online-item">
            {it.kind === "audio" ? (
              <button
                type="button"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-3"
                aria-label={t("play")}
                onClick={() => {
                  audio.current?.pause();
                  audio.current = new Audio(it.url);
                  void audio.current.play().catch(() => undefined);
                }}
              >
                <Icon name="play" size={16} />
              </button>
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={it.thumbnail ?? it.url} alt="" className="h-14 w-14 shrink-0 rounded-lg object-cover" loading="lazy" />
            )}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm">{it.title}</span>
              <span className="block truncate text-[11px] text-muted">
                {it.creator} · {it.license.licenseName}
                {it.durationMs ? ` · ${(it.durationMs / 1000).toFixed(1)}s` : ""}
              </span>
            </span>
            <button type="button" disabled={busy === it.id} data-testid="online-add" className="flex h-9 shrink-0 items-center rounded-full bg-accent px-3 text-sm text-accent-contrast" onClick={() => void add(it)}>
              {busy === it.id ? "…" : <Icon name="plus" size={16} />}
            </button>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-center text-[11px] text-muted">{t("libraryOpenverse")}</p>
    </div>
  );
}

function LicensesTab() {
  const t = useT();
  const project = useEditor((s) => s.history?.project);
  const toast = useEditor((s) => s.toast);
  if (!project) return null;
  const lines = projectCredits(project);
  const text = creditsText(project);
  return (
    <div>
      <p className="mb-2 text-xs text-muted">{t("licensesIntro")}</p>
      <ul className="flex flex-col gap-1" data-testid="licenses">
        {lines.map((c, i) => (
          <li key={i} className="rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm" data-testid="license-row">
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate">{c.what}</span>
              <span className="shrink-0 rounded-full bg-surface-3 px-2 py-[2px] text-[11px]" data-testid="license-name">{licenseLabel(c.license)}</span>
            </div>
            <div className="truncate text-[11px] text-muted">
              {c.kind}
              {c.license.author ? ` · ${c.license.author}` : ""}
              {c.license.attribution ? ` · ${t("licenseNeedsCredit")}` : ""}
              {c.license.sourceUrl && (
                <>
                  {" · "}
                  <a href={c.license.sourceUrl} target="_blank" rel="noreferrer" className="underline">
                    {t("licenseSource")}
                  </a>
                </>
              )}
            </div>
          </li>
        ))}
      </ul>
      {lines.length === 0 && <p className="p-4 text-center text-sm text-muted">{t("licensesEmpty")}</p>}
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          data-testid="credits-copy"
          className="flex-1 rounded-xl bg-surface-2 py-3 text-sm"
          onClick={() => void navigator.clipboard?.writeText(text || "No credits needed.").then(() => toast(t("copied")), () => toast(t("copied")))}
        >
          {t("creditsCopy")}
        </button>
        <button
          type="button"
          data-testid="credits-download"
          className="flex-1 rounded-xl bg-surface-2 py-3 text-sm"
          onClick={() => {
            const a = document.createElement("a");
            a.href = URL.createObjectURL(new Blob([text || "No credits needed: everything is your own or free for any use.\n"], { type: "text/plain" }));
            a.download = "credits.txt";
            a.click();
          }}
        >
          {t("creditsDownload")}
        </button>
      </div>
    </div>
  );
}

function StyleDialog({ styleId, onClose }: { styleId: string; onClose: () => void }) {
  const t = useT();
  const style = REEL_STYLE_BY_ID.get(styleId);
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries((style?.fields ?? []).map((f) => [f.key, f.default])));
  const [busy, setBusy] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const toast = useEditor((s) => s.toast);
  if (!style) return null;
  const apply = async () => {
    setBusy(true);
    try {
      const { applyStyle } = await import("@/lib/styles");
      await applyStyle(style.id, values);
      toast(t("styleApplied"));
      onClose();
      useLibraryUi.getState().hide();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center" role="dialog" aria-label={style.label} data-testid="style-dialog">
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-surface p-4 sm:rounded-2xl">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-semibold">{style.label}</h2>
          <button type="button" className="flex h-9 w-9 items-center justify-center rounded-full bg-surface-2" aria-label={t("done")} onClick={onClose}>
            <Icon name="close" size={18} />
          </button>
        </div>
        <p className="mb-3 text-xs text-muted">{style.format}</p>
        {style.fields.map((f) => (
          <label key={f.key} className="mb-2 block text-xs">
            <span className="text-muted">{f.label}</span>
            <input data-testid={`style-field-${f.key}`} value={values[f.key] ?? ""} onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))} className="mt-1 w-full rounded-lg bg-surface-2 px-3 py-2 text-sm" />
          </label>
        ))}
        <button type="button" className="mb-2 text-xs underline" onClick={() => setShowGuide((x) => !x)}>
          {t("styleHowTo")}
        </button>
        {showGuide && (
          <div className="mb-3 rounded-xl bg-surface-2 p-3 text-xs leading-relaxed">
            <p><b>Hook:</b> {style.hook}</p>
            <p className="mt-1"><b>Structure:</b></p>
            <ul className="list-disc pl-4">{style.structure.map((x) => <li key={x}>{x}</li>)}</ul>
            <p className="mt-1"><b>Shoot:</b></p>
            <ul className="list-disc pl-4">{style.shoot.map((x) => <li key={x}>{x}</li>)}</ul>
            <p className="mt-1"><b>Sound:</b> {style.sound}</p>
            <p><b>Colour:</b> {style.grade}</p>
            <p><b>Pacing:</b> {style.pacing}</p>
          </div>
        )}
        <button type="button" data-testid="style-apply" disabled={busy} className="w-full rounded-xl bg-accent py-3 font-semibold text-accent-contrast disabled:opacity-60" onClick={() => void apply()}>
          {busy ? "…" : t("styleApply")}
        </button>
      </div>
    </div>
  );
}
