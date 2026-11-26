"use client";

import { useMemo, useState } from "react";
import { Icon } from "@just-see/ui";
import { AUDIO_FX, AUDIO_FX_BY_TYPE, SFX, defaultAudioParams, type AudioFxCategory } from "@just-see/engine";
import { createId, findClip, isMediaClip } from "@just-see/schema";
import { addAssetAtPlayhead, addOwnSfx, addSfx } from "@/lib/audio-tools";
import { isProcessing } from "@/lib/clip-audio";
import { useEditor, useProject } from "@/lib/editor-store";
import { useT, type MessageKey } from "@/lib/i18n";
import { Chip, CommitSlider, Sheet } from "./controls";

const CATS: AudioFxCategory[] = ["repair", "voice", "dynamics", "space", "creative"];

export function AudioFxPanel() {
  const t = useT();
  const project = useProject();
  const selection = useEditor((s) => s.selection);
  const [cat, setCat] = useState<AudioFxCategory>("repair");
  const [open, setOpen] = useState<string | null>(null);
  const loc = project && selection ? findClip(project, selection.clipId) : undefined;
  if (!loc || !isMediaClip(loc.clip)) return null;
  const c = loc.clip;
  const d = useEditor.getState().dispatch;
  const add = (type: string) => {
    const def = AUDIO_FX_BY_TYPE.get(type);
    if (!def) return;
    const id = createId("af_");
    if (d({ type: "clip/addAudioFx", payload: { clipId: c.id, effect: { id, type, enabled: true, params: defaultAudioParams(def) } } })) setOpen(id);
  };
  return (
    <Sheet title={t("audioFx")}>
      <button
        type="button"
        data-testid="studio-voice"
        onClick={() => add("studio-voice")}
        className="mt-1 flex w-full items-center justify-center gap-2 rounded-xl bg-accent py-3 font-semibold text-accent-contrast"
      >
        <Icon name="effects" size={20} />
        {t("studioVoiceOneTap")}
      </button>
      <p className="mt-1 text-center text-[11px] text-muted">{t("studioVoiceHint")}</p>
      {isProcessing(c) && (
        <p className="mt-2 text-center text-xs text-muted" aria-live="polite" data-testid="audio-processing">
          {t("processingAudio")}
        </p>
      )}
      {c.audioFx.length > 0 && (
        <ul className="my-3 flex flex-col gap-2">
          {c.audioFx.map((fx) => {
            const def = AUDIO_FX_BY_TYPE.get(fx.type);
            if (!def) return null;
            const isOpen = open === fx.id || c.audioFx.length === 1;
            return (
              <li key={fx.id} className="rounded-xl border border-line bg-surface-2 p-2" data-testid="audio-fx-item">
                <div className="flex items-center gap-2">
                  <button type="button" className="flex-1 text-left text-sm font-medium" onClick={() => setOpen(isOpen ? null : fx.id)}>
                    {def.label}
                  </button>
                  <button
                    type="button"
                    className="flex h-8 w-8 items-center justify-center rounded-full"
                    aria-label={fx.enabled ? t("hide") : t("show")}
                    onClick={() => d({ type: "clip/updateAudioFx", payload: { clipId: c.id, effectId: fx.id, enabled: !fx.enabled } })}
                  >
                    <Icon name={fx.enabled ? "volume" : "mute"} size={18} />
                  </button>
                  <button
                    type="button"
                    className="flex h-8 w-8 items-center justify-center rounded-full text-danger"
                    aria-label={`${t("remove")} ${def.label}`}
                    onClick={() => d({ type: "clip/removeAudioFx", payload: { clipId: c.id, effectId: fx.id } })}
                  >
                    <Icon name="trash" size={18} />
                  </button>
                </div>
                {isOpen &&
                  def.params.map((prm) => (
                    <CommitSlider
                      key={prm.key}
                      label={prm.label}
                      value={fx.params[prm.key] ?? prm.default}
                      min={prm.min}
                      max={prm.max}
                      step={prm.step}
                      format={(v) => (prm.step >= 1 ? String(Math.round(v)) : v.toFixed(2))}
                      toCommand={(v) => ({ type: "clip/updateAudioFx", payload: { clipId: c.id, effectId: fx.id, params: { [prm.key]: v } } })}
                    />
                  ))}
              </li>
            );
          })}
        </ul>
      )}
      <div className="no-scrollbar my-2 flex gap-2 overflow-x-auto">
        {CATS.map((k) => (
          <Chip key={k} active={cat === k} onClick={() => setCat(k)} testId={`afcat-${k}`}>
            {t(`af_${k}` as MessageKey)}
          </Chip>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {AUDIO_FX.filter((f) => f.category === cat && f.type !== "time-stretch").map((f) => (
          <button
            key={f.type}
            type="button"
            data-testid={`audio-fx-${f.type}`}
            onClick={() => add(f.type)}
            className="flex h-14 items-center justify-center rounded-xl border border-line bg-surface-2 px-1 text-center text-xs active:scale-95"
          >
            {f.label}
          </button>
        ))}
      </div>
    </Sheet>
  );
}

let previewCtx: AudioContext | null = null;

export function SfxPanel() {
  const t = useT();
  const [cat, setCat] = useState<(typeof SFX)[number]["category"] | "mine">("transition");
  const [q, setQ] = useState("");
  const assets = useEditor((s) => s.history?.project.assets);
  const mine = useMemo(() => (assets ?? []).filter((a) => a.kind === "audio" && a.name.startsWith("[SFX] ")), [assets]);
  const play = (id: string) => {
    const def = SFX.find((s) => s.id === id);
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
  };
  return (
    <Sheet title={t("soundEffects")}>
      <div className="no-scrollbar my-2 flex gap-2 overflow-x-auto">
        {(["transition", "impact", "ui", "foley", "ambience", "meme"] as const).map((k) => (
          <Chip key={k} active={cat === k && !q} onClick={() => { setCat(k); setQ(""); }} testId={`sfxcat-${k}`}>
            {t(`sfx_${k}` as MessageKey)}
          </Chip>
        ))}
        <Chip active={cat === "mine" && !q} onClick={() => { setCat("mine"); setQ(""); }} testId="sfxcat-mine">
          {t("sfxMine")}
        </Chip>
      </div>
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={t("sfxSearch")}
        data-testid="sfx-search"
        className="mb-2 h-10 w-full rounded-xl border border-line bg-surface-2 px-3 text-sm"
      />
      {cat === "mine" && !q && (
        <div className="flex flex-col gap-1">
          <label className="flex h-11 cursor-pointer items-center justify-center gap-2 rounded-xl bg-accent text-sm text-accent-contrast">
            <Icon name="plus" size={16} />
            {t("sfxImport")}
            <input
              type="file"
              accept="audio/*"
              multiple
              hidden
              data-testid="sfx-import"
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                e.target.value = "";
                void (async () => {
                  for (const f of files) await addOwnSfx(f);
                })();
              }}
            />
          </label>
          {mine.map((a) => (
            <div key={a.id} className="flex items-center gap-2 rounded-xl border border-line bg-surface-2 px-2 py-1">
              <span className="flex-1 truncate text-sm">{a.name.slice(6)}</span>
              <button type="button" className="flex h-9 items-center gap-1 rounded-full bg-accent px-3 text-sm text-accent-contrast" onClick={() => addAssetAtPlayhead(a.id)}>
                <Icon name="plus" size={16} />
                {t("add")}
              </button>
            </div>
          ))}
        </div>
      )}
      <ul className="flex flex-col gap-1">
        {SFX.filter((s) => {
          if (!q) return s.category === cat;
          const needle = q.toLowerCase();
          return s.label.toLowerCase().includes(needle) || s.id.includes(needle) || (s.tags ?? []).some((x) => x.includes(needle));
        }).map((s) => (
          <li key={s.id} className="flex items-center gap-2 rounded-xl border border-line bg-surface-2 px-2 py-1">
            <button type="button" className="flex h-9 w-9 items-center justify-center rounded-full bg-surface-3" aria-label={`${t("play")} ${s.label}`} onClick={() => play(s.id)}>
              <Icon name="play" size={16} />
            </button>
            <span className="flex-1 text-sm">{s.label}</span>
            <span className="text-xs text-muted">{s.seconds}s</span>
            <button
              type="button"
              data-testid={`add-sfx-${s.id}`}
              className="flex h-9 items-center gap-1 rounded-full bg-accent px-3 text-sm text-accent-contrast"
              onClick={() => void addSfx(s.id)}
            >
              <Icon name="plus" size={16} />
              {t("add")}
            </button>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-center text-[11px] text-muted">{t("sfxLicense")}</p>
    </Sheet>
  );
}

export function AiVoicePanel() {
  const t = useT();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<number | null>(null);
  const toast = useEditor((s) => s.toast);
  const make = async () => {
    setBusy(0);
    try {
      const { addVoiceover } = await import("@/lib/ai-tools");
      await addVoiceover(text, (p) => setBusy(p));
      toast(t("addedToVideo"));
      setText("");
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setBusy(null);
    }
  };
  return (
    <Sheet title={t("aiVoice")}>
      <p className="mb-2 text-xs text-muted">{t("aiVoiceHint")}</p>
      <textarea data-testid="ai-voice-text" value={text} onChange={(e) => setText(e.target.value)} rows={4} maxLength={1500} className="w-full rounded-xl border border-line bg-surface-2 p-3 text-sm" placeholder="Welcome back to my channel! Today we are going to Goa." />
      <button type="button" data-testid="ai-voice-make" disabled={busy !== null || !text.trim()} className="mt-2 w-full rounded-xl bg-accent py-3 font-semibold text-accent-contrast disabled:opacity-50" onClick={() => void make()}>
        {busy !== null ? `${t("aiVoiceMaking")} ${Math.round(busy * 100)}%` : t("aiVoiceMake")}
      </button>
    </Sheet>
  );
}
