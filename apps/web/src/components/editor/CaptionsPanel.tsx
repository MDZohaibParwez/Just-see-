"use client";

import { useMemo, useState } from "react";
import { CAPTION_STYLES, captionCommands, groupCaptions, isFillerWord, type CaptionLanguage } from "@just-see/engine";
import { createId, getSequence, isTextClip, type Command, type TextClip } from "@just-see/schema";
import { useEditor, useProject } from "@/lib/editor-store";
import { useT, type MessageKey } from "@/lib/i18n";
import { transcribeTimeline, type ModelSize } from "@/lib/transcribe";
import { Chip, Sheet } from "./controls";

const LANGS: { id: CaptionLanguage; label: MessageKey }[] = [
  { id: "auto", label: "langAuto" },
  { id: "hi", label: "langHindi" },
  { id: "en", label: "langEnglish" },
  { id: "hinglish", label: "langHinglish" },
  { id: "ur", label: "langUrdu" },
];

interface WordRef {
  key: string;
  clipId: string;
  index: number;
  text: string;
  startUs: number;
  endUs: number;
}

export function CaptionsPanel() {
  const t = useT();
  const project = useProject();
  const [lang, setLang] = useState<CaptionLanguage>("auto");
  const [size, setSize] = useState<ModelSize>("base");
  const [style, setStyle] = useState(CAPTION_STYLES[0]!.id);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const captionClips = useMemo(() => {
    if (!project) return [] as TextClip[];
    const seq = getSequence(project);
    return seq.tracks.flatMap((tr) => tr.clips.filter((c): c is TextClip => isTextClip(c) && !!c.captionGroup)).sort((a, b) => a.startUs - b.startUs);
  }, [project]);

  const words: WordRef[] = useMemo(
    () =>
      captionClips.flatMap((c) =>
        c.words.map((w, i) => ({ key: `${c.id}:${i}`, clipId: c.id, index: i, text: w.text, startUs: c.startUs + w.startUs, endUs: c.startUs + w.endUs })),
      ),
    [captionClips],
  );

  if (!project) return null;

  const generate = async () => {
    setBusy(true);
    setStatus(t("preparing"));
    try {
      const transcript = await transcribeTimeline(project, lang, size, (p) => {
        if (p.phase === "audio") setStatus(t("mixingAudio"));
        else if (p.phase === "download") setStatus(`${t("downloadingModel")} ${Math.round(p.progress * 100)}%`);
        else setStatus(t("transcribing"));
      });
      if (!transcript.length) {
        setStatus(t("noSpeech"));
        return;
      }
      const lines = groupCaptions(transcript);
      // Replace any captions made before.
      const remove: Command[] = captionClips.map((c) => ({ type: "clip/delete", payload: { clipId: c.id } }));
      const add = captionCommands(lines, { styleId: style, language: lang, groupId: createId("cap_"), trackId: createId("t_") });
      useEditor.getState().dispatch({ type: "batch", payload: { label: "Auto captions", commands: [...remove, ...add] } });
      setStatus(`${t("captionsAdded")}: ${lines.length}`);
    } catch (e) {
      console.error(e);
      setStatus(`${t("captionsFailed")}: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const restyle = (id: string) => {
    setStyle(id);
    const preset = CAPTION_STYLES.find((s) => s.id === id);
    if (!preset || !captionClips.length) return;
    useEditor.getState().dispatch({
      type: "batch",
      payload: {
        label: "Caption style",
        commands: captionClips.map((c) => ({ type: "clip/update", payload: { clipId: c.id, patch: { style: preset.style, transform: { y: preset.y } } } })),
      },
    });
  };

  /** Cut the selected words out of the video (all tracks ripple). */
  const cutWords = (refs: WordRef[]) => {
    if (!refs.length) return;
    // Merge touching ranges, then cut from the end so earlier times stay valid.
    const ranges = refs
      .map((w) => ({ s: w.startUs, e: w.endUs }))
      .sort((a, b) => a.s - b.s)
      .reduce<{ s: number; e: number }[]>((acc, r) => {
        const last = acc[acc.length - 1];
        if (last && r.s - last.e < 80_000) last.e = Math.max(last.e, r.e);
        else acc.push({ ...r });
        return acc;
      }, [])
      .reverse();
    const commands: Command[] = ranges.map((r) => ({ type: "timeline/rippleDelete", payload: { startUs: r.s, endUs: r.e, idSeed: createId("cut_") } }));
    useEditor.getState().dispatch({ type: "batch", payload: { label: "Cut words", commands } });
    setSelected(new Set());
  };

  const editLine = (clip: TextClip, text: string) => {
    const parts = text.trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return;
    const n = parts.length;
    const words =
      n === clip.words.length
        ? clip.words.map((w, i) => ({ ...w, text: parts[i]! }))
        : parts.map((p, i) => ({ text: p, startUs: Math.round((clip.durationUs * i) / n), endUs: Math.round((clip.durationUs * (i + 1)) / n) }));
    useEditor.getState().dispatch({ type: "clip/update", payload: { clipId: clip.id, patch: { text: parts.join(" "), words } } });
  };

  const fillers = words.filter((w) => isFillerWord(w.text));

  return (
    <Sheet title={t("captions")}>
      <p className="mt-1 text-xs text-muted">{t("language")}</p>
      <div className="no-scrollbar flex gap-2 overflow-x-auto py-2">
        {LANGS.map((l) => (
          <Chip key={l.id} active={lang === l.id} onClick={() => setLang(l.id)} testId={`cap-lang-${l.id}`}>
            {t(l.label)}
          </Chip>
        ))}
      </div>
      <div className="flex gap-2 py-1">
        <Chip active={size === "base"} onClick={() => setSize("base")}>
          {t("fast")}
        </Chip>
        <Chip active={size === "small"} onClick={() => setSize("small")}>
          {t("accurate")}
        </Chip>
      </div>
      <p className="mt-2 text-xs text-muted">{t("style")}</p>
      <div className="no-scrollbar flex gap-2 overflow-x-auto py-2">
        {CAPTION_STYLES.map((s) => (
          <Chip key={s.id} active={style === s.id} onClick={() => restyle(s.id)} testId={`cap-style-${s.id}`}>
            {s.label}
          </Chip>
        ))}
      </div>
      <button
        type="button"
        disabled={busy}
        onClick={() => void generate()}
        data-testid="generate-captions"
        className="mt-2 w-full rounded-xl bg-accent py-3 font-semibold text-accent-contrast disabled:opacity-50"
      >
        {captionClips.length ? t("regenerateCaptions") : t("generateCaptions")}
      </button>
      {status && (
        <p className="mt-2 text-center text-xs text-muted" aria-live="polite" data-testid="caption-status">
          {status}
        </p>
      )}
      <p className="mt-1 text-center text-[11px] text-muted">{t("captionsPrivacy")}</p>

      {captionClips.length > 0 && (
        <section className="mt-4" aria-label={t("transcript")}>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-xs uppercase tracking-wide text-muted">{t("transcript")}</h3>
            <div className="flex gap-2">
              {fillers.length > 0 && (
                <Chip onClick={() => cutWords(fillers)} testId="remove-fillers">
                  {t("removeFillers")} ({fillers.length})
                </Chip>
              )}
              {selected.size > 0 && (
                <Chip onClick={() => cutWords(words.filter((w) => selected.has(w.key)))} testId="cut-selected-words">
                  {t("cutWords")} ({selected.size})
                </Chip>
              )}
            </div>
          </div>
          <p className="mb-2 text-[11px] text-muted">{t("transcriptHint")}</p>
          <div className="flex flex-wrap gap-1" data-testid="transcript-words">
            {words.map((w) => {
              const on = selected.has(w.key);
              return (
                <button
                  key={w.key}
                  type="button"
                  dir="auto"
                  aria-pressed={on}
                  onClick={() => {
                    const next = new Set(selected);
                    if (on) next.delete(w.key);
                    else next.add(w.key);
                    setSelected(next);
                    useEditor.getState().setPlayhead(w.startUs);
                  }}
                  className={`rounded-md px-1.5 py-0.5 text-sm ${on ? "bg-danger text-white line-through" : isFillerWord(w.text) ? "bg-surface-3" : "hover:bg-surface-2"}`}
                >
                  {w.text}
                </button>
              );
            })}
          </div>
          <details className="mt-3">
            <summary className="cursor-pointer text-xs text-muted">{t("editLines")}</summary>
            <ul className="mt-2 flex flex-col gap-1">
              {captionClips.map((c) => (
                <li key={c.id}>
                  <input
                    dir="auto"
                    defaultValue={c.text}
                    aria-label={t("editLines")}
                    onBlur={(e) => e.currentTarget.value !== c.text && editLine(c, e.currentTarget.value)}
                    className="w-full rounded-lg border border-line bg-surface-2 px-2 py-1 text-sm"
                  />
                </li>
              ))}
            </ul>
          </details>
        </section>
      )}
    </Sheet>
  );
}
