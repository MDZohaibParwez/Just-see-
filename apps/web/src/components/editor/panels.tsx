"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@just-see/ui";
import {
  ASPECT_PRESETS,
  DEFAULT_TRANSFORM,
  findClip,
  getSequence,
  isMediaClip,
  isTextClip,
  secondsToUs,
  SPEED_CURVE_PRESETS,
  type AspectPreset,
  type BlendMode,
  type MediaClip,
  type TextAnimation,
  type TextClip,
  type TextStyle,
  type Transform,
} from "@just-see/schema";
import { EFFECTS, EFFECTS_BY_TYPE, TRANSITIONS, animatedTransform, resolveParams, DEFAULT_TRANSITION_US, type EffectCategory } from "@just-see/engine";
import {
  KEYFRAME_PROPS,
  addEffect,
  addLutEffect,
  animatableCommand,
  localPlayhead,
  matchColors,
  setTransition,
  setTransitionEverywhere,
  toggleTransformKeyframe,
} from "@/lib/actions";
import { useEditor, useProject } from "@/lib/editor-store";
import { useT, type MessageKey } from "@/lib/i18n";
import { addVersion, getVersion, listVersions, type VersionRecord } from "@/lib/storage/db";
import { Chip, ColorRow, CommitSlider, Sheet } from "./controls";

function useSelectedClip() {
  const project = useProject();
  const selection = useEditor((s) => s.selection);
  if (!project || !selection) return undefined;
  return findClip(project, selection.clipId);
}

// ---------- Speed ----------
const CURVES = Object.keys(SPEED_CURVE_PRESETS);

export function SpeedPanel() {
  const t = useT();
  const loc = useSelectedClip();
  const [mode, setMode] = useState<"constant" | "curve">("constant");
  if (!loc || !isMediaClip(loc.clip)) return null;
  const c = loc.clip;
  const d = useEditor.getState().dispatch;
  const set = (speed: number) => d({ type: "clip/setSpeed", payload: { clipId: c.id, speed } });
  return (
    <Sheet title={t("speed")}>
      <div className="flex gap-2 py-2">
        <Chip active={mode === "constant"} onClick={() => setMode("constant")}>
          {t("constant")}
        </Chip>
        <Chip active={mode === "curve"} onClick={() => setMode("curve")} testId="speed-curve-tab">
          {t("curve")}
        </Chip>
        <Chip active={c.reverse} onClick={() => d({ type: "clip/update", payload: { clipId: c.id, patch: { reverse: !c.reverse } } })} testId="reverse">
          {t("reverse")}
        </Chip>
      </div>
      {mode === "constant" ? (
        <>
          <div className="no-scrollbar flex gap-2 overflow-x-auto py-2">
            {[0.25, 0.5, 0.75, 1, 1.5, 2, 3, 5].map((s) => (
              <Chip key={s} active={Math.abs(c.speed - s) < 1e-6} onClick={() => set(s)} testId={`speed-${s}`}>
                {s}×
              </Chip>
            ))}
          </div>
          <CommitSlider
            label={t("speed")}
            value={Math.log2(c.speed)}
            min={-3}
            max={3.3}
            step={0.01}
            format={(v) => `${Math.pow(2, v).toFixed(2)}×`}
            toCommand={(v) => ({ type: "clip/setSpeed", payload: { clipId: c.id, speed: Math.round(Math.pow(2, v) * 100) / 100 } })}
          />
        </>
      ) : (
        <div className="grid grid-cols-3 gap-2 py-2 sm:grid-cols-4">
          <button
            type="button"
            className={`h-12 rounded-xl border text-xs ${!c.speedCurve ? "border-accent bg-accent/15" : "border-line bg-surface-2"}`}
            onClick={() => d({ type: "clip/setSpeedCurve", payload: { clipId: c.id, curve: null } })}
          >
            {t("none")}
          </button>
          {CURVES.map((name) => (
            <button
              key={name}
              type="button"
              data-testid={`curve-${name}`}
              className={`flex h-12 flex-col items-center justify-center rounded-xl border text-xs ${
                c.speedCurve?.preset === name ? "border-accent bg-accent/15" : "border-line bg-surface-2"
              }`}
              onClick={() => d({ type: "clip/setSpeedCurve", payload: { clipId: c.id, curve: { preset: name, points: SPEED_CURVE_PRESETS[name]! } } })}
            >
              <CurveIcon points={SPEED_CURVE_PRESETS[name]!} />
              {name}
            </button>
          ))}
        </div>
      )}
    </Sheet>
  );
}

function CurveIcon({ points }: { points: { p: number; s: number }[] }) {
  const max = Math.max(...points.map((x) => x.s));
  const d = points.map((x, i) => `${i ? "L" : "M"}${x.p * 40},${14 - (x.s / max) * 12}`).join(" ");
  return (
    <svg width="40" height="16" aria-hidden className="text-accent">
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

// ---------- Volume ----------
export function VolumePanel() {
  const t = useT();
  const loc = useSelectedClip();
  if (!loc || !isMediaClip(loc.clip)) return null;
  const c = loc.clip;
  const upd = (patch: Partial<Pick<MediaClip, "volume" | "muted" | "fadeInUs" | "fadeOutUs">>) =>
    ({ type: "clip/update", payload: { clipId: c.id, patch } }) as const;
  return (
    <Sheet title={t("volume")}>
      <div className="flex gap-2 py-2">
        <Chip active={c.muted} onClick={() => useEditor.getState().dispatch(upd({ muted: !c.muted }))}>
          <span className="flex items-center gap-1">
            <Icon name={c.muted ? "mute" : "volume"} size={18} />
            {c.muted ? t("unmute") : t("mute")}
          </span>
        </Chip>
      </div>
      <CommitSlider
        label={t("volume")}
        value={c.volume}
        min={0}
        max={2}
        step={0.01}
        format={(v) => `${Math.round(v * 100)}%`}
        toCommand={(v) => upd({ volume: v })}
        testId="volume-slider"
      />
      <CommitSlider
        label={t("fadeIn")}
        value={c.fadeInUs / 1e6}
        min={0}
        max={3}
        step={0.1}
        format={(v) => `${v.toFixed(1)}s`}
        toCommand={(v) => upd({ fadeInUs: secondsToUs(v) })}
      />
      <CommitSlider
        label={t("fadeOut")}
        value={c.fadeOutUs / 1e6}
        min={0}
        max={3}
        step={0.1}
        format={(v) => `${v.toFixed(1)}s`}
        toCommand={(v) => upd({ fadeOutUs: secondsToUs(v) })}
      />
    </Sheet>
  );
}

// ---------- Effects ----------
const CATEGORIES: EffectCategory[] = ["look", "color", "blur", "stylize", "distort", "motion", "retro", "light", "key"];

export function EffectsPanel() {
  const t = useT();
  const loc = useSelectedClip();
  const project = useProject();
  const [cat, setCat] = useState<EffectCategory>("look");
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const lutInput = useRef<HTMLInputElement>(null);
  if (!loc || !project) return null;
  const c = loc.clip;
  const q = query.trim().toLowerCase();
  const list = EFFECTS.filter((e) => (q ? e.label.toLowerCase().includes(q) || e.type.includes(q) : e.category === cat));
  const others = loc.track.clips.filter((x) => x.id !== c.id && isMediaClip(x) && x.kind !== "audio");
  return (
    <Sheet title={t("effects")}>
      {c.effects.length > 0 && (
        <ul className="mb-3 flex flex-col gap-2">
          {c.effects.map((fx) => {
            const def = EFFECTS_BY_TYPE.get(fx.type);
            if (!def) return null;
            const params = resolveParams(def, fx.params);
            const open = openId === fx.id;
            return (
              <li key={fx.id} className="rounded-xl border border-line bg-surface-2 p-2">
                <div className="flex items-center gap-2">
                  <button type="button" className="flex-1 text-left text-sm font-medium" onClick={() => setOpenId(open ? null : fx.id)}>
                    {def.label}
                    {fx.assetId && <span className="ml-1 text-xs text-muted">· {project.assets.find((x) => x.id === fx.assetId)?.name}</span>}
                  </button>
                  <button
                    type="button"
                    className="flex h-8 w-8 items-center justify-center rounded-full"
                    onClick={() =>
                      useEditor.getState().dispatch({ type: "clip/updateEffect", payload: { clipId: c.id, effectId: fx.id, enabled: !fx.enabled } })
                    }
                    aria-label={fx.enabled ? t("hide") : t("show")}
                  >
                    <Icon name={fx.enabled ? "eye" : "eyeOff"} size={18} />
                  </button>
                  <button
                    type="button"
                    className="flex h-8 w-8 items-center justify-center rounded-full text-danger"
                    onClick={() => useEditor.getState().dispatch({ type: "clip/removeEffect", payload: { clipId: c.id, effectId: fx.id } })}
                    aria-label={`${t("remove")} ${def.label}`}
                  >
                    <Icon name="trash" size={18} />
                  </button>
                </div>
                {(open || c.effects.length === 1) &&
                  def.params.map((prm) => (
                    <CommitSlider
                      key={prm.key}
                      label={prm.label}
                      value={params[prm.key] ?? prm.default}
                      min={prm.min}
                      max={prm.max}
                      step={prm.step}
                      format={(v) => (prm.step >= 1 ? String(Math.round(v)) : v.toFixed(2))}
                      toCommand={(v) =>
                        c.keyframes[`fx.${fx.id}.${prm.key}`]?.length
                          ? { type: "clip/setKeyframe", payload: { clipId: c.id, prop: `fx.${fx.id}.${prm.key}`, t: localPlayhead(c.id) ?? 0, v } }
                          : { type: "clip/updateEffect", payload: { clipId: c.id, effectId: fx.id, params: { [prm.key]: v } } }
                      }
                    />
                  ))}
              </li>
            );
          })}
        </ul>
      )}
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.currentTarget.value)}
        placeholder={t("searchEffects")}
        aria-label={t("searchEffects")}
        data-testid="effect-search"
        className="mb-2 w-full rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm"
      />
      {!q && (
        <div className="no-scrollbar mb-2 flex gap-2 overflow-x-auto">
          {CATEGORIES.map((k) => (
            <Chip key={k} active={cat === k} onClick={() => setCat(k)} testId={`fxcat-${k}`}>
              {t(`fx_${k}` as MessageKey)}
            </Chip>
          ))}
        </div>
      )}
      {cat === "color" && !q && (
        <div className="mb-2 flex flex-wrap gap-2">
          <Chip onClick={() => lutInput.current?.click()} testId="import-lut">
            {t("importLut")}
          </Chip>
          {isMediaClip(c) &&
            others.slice(0, 6).map((o) => (
              <Chip key={o.id} onClick={() => void matchColors(c.id, o.id)}>
                {t("matchTo")} #{loc.track.clips.indexOf(o) + 1}
              </Chip>
            ))}
        </div>
      )}
      <input
        ref={lutInput}
        type="file"
        accept=".cube,text/plain"
        hidden
        data-testid="lut-input"
        onChange={(e) => {
          const file = e.currentTarget.files?.[0];
          e.currentTarget.value = "";
          if (file) void addLutEffect(c.id, file);
        }}
      />
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {list.map((e) => (
          <button
            key={e.type}
            type="button"
            data-testid={`effect-${e.type}`}
            className="flex h-14 items-center justify-center rounded-xl border border-line bg-surface-2 px-1 text-center text-xs active:scale-95"
            onClick={() => {
              if (e.lut) {
                lutInput.current?.click();
                return;
              }
              const id = addEffect(c.id, e.type);
              if (id) setOpenId(id);
            }}
          >
            {e.label}
          </button>
        ))}
      </div>
      <p className="mt-2 text-center text-xs text-muted">
        {EFFECTS.length} {t("effects")}
      </p>
    </Sheet>
  );
}

// ---------- Transition ----------
const TR_CATS = ["basic", "slide", "wipe", "zoom", "stylish"] as const;

export function TransitionPanel() {
  const t = useT();
  const loc = useSelectedClip();
  const [dur, setDur] = useState(DEFAULT_TRANSITION_US);
  const [cat, setCat] = useState<(typeof TR_CATS)[number]>("basic");
  if (!loc || !isMediaClip(loc.clip)) return null;
  const c = loc.clip;
  const current = c.transitionIn;
  const duration = current?.durationUs ?? dur;
  return (
    <Sheet title={t("transitions")}>
      <div className="no-scrollbar flex gap-2 overflow-x-auto py-2">
        {TR_CATS.map((k) => (
          <Chip key={k} active={cat === k} onClick={() => setCat(k)} testId={`trcat-${k}`}>
            {t(`tr_${k}` as MessageKey)}
          </Chip>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-2 py-2 sm:grid-cols-4">
        <button
          type="button"
          className={`h-12 rounded-xl border text-xs ${!current ? "border-accent bg-accent/15" : "border-line bg-surface-2"}`}
          onClick={() => setTransition(c.id, null)}
        >
          {t("none")}
        </button>
        {TRANSITIONS.filter((tr) => tr.category === cat).map((tr) => (
          <button
            key={tr.type}
            type="button"
            data-testid={`transition-${tr.type}`}
            aria-pressed={current?.type === tr.type}
            className={`h-12 rounded-xl border px-1 text-xs active:scale-95 ${
              current?.type === tr.type ? "border-accent bg-accent/15" : "border-line bg-surface-2"
            }`}
            onClick={() => setTransition(c.id, tr.type, duration)}
          >
            {tr.label}
          </button>
        ))}
      </div>
      {current && (
        <div className="no-scrollbar flex gap-2 overflow-x-auto py-1">
          {(["linear", "ease-in", "ease-out", "ease-in-out"] as const).map((e) => (
            <Chip
              key={e}
              active={(current.ease ?? "ease-in-out") === e}
              testId={`tr-ease-${e}`}
              onClick={() => useEditor.getState().dispatch({ type: "clip/setTransition", payload: { clipId: c.id, transition: { ...current, ease: e } } })}
            >
              {t(`ease_${e}` as MessageKey)}
            </Chip>
          ))}
        </div>
      )}
      <CommitSlider
        label={t("duration")}
        value={duration / 1e6}
        min={0.1}
        max={2}
        step={0.1}
        format={(v) => `${v.toFixed(1)}s`}
        toCommand={(v) => {
          setDur(secondsToUs(v));
          return { type: "clip/setTransition", payload: { clipId: c.id, transition: { type: current?.type ?? "crossfade", durationUs: secondsToUs(v), ease: current?.ease } } };
        }}
      />
      {current && (
        <button
          type="button"
          className="mt-2 w-full rounded-xl bg-surface-2 py-2 text-sm"
          onClick={() => setTransitionEverywhere(current.type, current.durationUs)}
        >
          {t("applyToAll")}
        </button>
      )}
      <p className="mt-2 text-center text-xs text-muted">
        {TRANSITIONS.length} {t("transitions")}
      </p>
    </Sheet>
  );
}

// ---------- Text ----------
interface TextTemplate {
  id: string;
  label: string;
  preview: string;
  style: Partial<TextStyle>;
  animIn: TextAnimation;
  animOut: TextAnimation;
  transform: Partial<Transform>;
}

const TEXT_TEMPLATES: TextTemplate[] = [
  { id: "title", label: "Title", preview: "#ffffff", style: { fontSize: 0.075, fontWeight: 900, strokeWidth: 0.06, color: "#ffffff", backgroundOpacity: 0 }, animIn: "pop", animOut: "fade", transform: { y: 0 } },
  { id: "subtitle", label: "Subtitle", preview: "#f2f3f5", style: { fontSize: 0.035, fontWeight: 500, strokeWidth: 0, shadow: true, backgroundOpacity: 0 }, animIn: "fade", animOut: "fade", transform: { y: 0.32 } },
  { id: "lower-third", label: "Lower third", preview: "#ff8a1f", style: { fontSize: 0.038, fontWeight: 700, align: "left", backgroundColor: "#ff8a1f", backgroundOpacity: 0.9, color: "#1a0d00", shadow: false }, animIn: "slide-right", animOut: "slide-left", transform: { x: -0.12, y: 0.25 } },
  { id: "neon", label: "Neon", preview: "#bf5af2", style: { fontSize: 0.06, fontWeight: 800, color: "#ffffff", strokeColor: "#bf5af2", strokeWidth: 0.1, shadow: true }, animIn: "blur", animOut: "blur", transform: { y: -0.1 } },
  { id: "typewriter", label: "Typewriter", preview: "#ffd60a", style: { fontFamily: "ui-monospace, 'Courier New', monospace", fontSize: 0.045, fontWeight: 600, color: "#ffd60a" }, animIn: "typewriter", animOut: "fade", transform: { y: 0 } },
  { id: "quote", label: "Quote", preview: "#ffffff", style: { fontFamily: "Georgia, 'Noto Serif', serif", italic: true, fontSize: 0.045, fontWeight: 400, backgroundColor: "#000000", backgroundOpacity: 0.5 }, animIn: "slide-up", animOut: "fade", transform: { y: 0 } },
  { id: "big-number", label: "Big number", preview: "#34c759", style: { fontSize: 0.18, fontWeight: 900, color: "#34c759", strokeWidth: 0.04 }, animIn: "zoom", animOut: "pop", transform: { y: -0.05 } },
  { id: "sticker", label: "Sticker", preview: "#ff375f", style: { fontSize: 0.05, fontWeight: 800, color: "#ffffff", backgroundColor: "#ff375f", backgroundOpacity: 1, shadow: true }, animIn: "pop", animOut: "pop", transform: { rotation: -6 } },
];

export function TextPanel() {
  const t = useT();
  const loc = useSelectedClip();
  const clip = loc && isTextClip(loc.clip) ? loc.clip : undefined;
  const [value, setValue] = useState(clip?.text ?? "");
  const id = clip?.id;
  useEffect(() => {
    setValue(clip?.text ?? "");
    // Only when switching clips.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  if (!clip) return null;
  const commit = () => {
    if (value !== clip.text) useEditor.getState().dispatch({ type: "clip/update", payload: { clipId: clip.id, patch: { text: value } } });
  };
  return (
    <Sheet
      title={t("text")}
      onClose={() => {
        commit();
        useEditor.getState().openPanel(null);
      }}
    >
      <div className="no-scrollbar mb-2 flex gap-2 overflow-x-auto">
        {TEXT_TEMPLATES.map((tpl) => (
          <Chip
            key={tpl.id}
            testId={`text-tpl-${tpl.id}`}
            onClick={() =>
              useEditor.getState().dispatch({
                type: "clip/update",
                payload: {
                  clipId: clip.id,
                  patch: { style: tpl.style, animationIn: tpl.animIn, animationOut: tpl.animOut, transform: tpl.transform },
                },
              })
            }
          >
            {/* Previews keep their real colours, on a dark tile in both themes. */}
            <span className="rounded bg-[#15171c] px-1.5" style={{ fontWeight: tpl.style.fontWeight, color: tpl.preview }}>
              {tpl.label}
            </span>
          </Chip>
        ))}
      </div>
      <textarea
        autoFocus
        value={value}
        rows={3}
        dir="auto"
        data-testid="text-input"
        placeholder={t("typeHere")}
        aria-label={t("typeHere")}
        className="w-full resize-none rounded-xl border border-line bg-surface-2 p-3 text-base"
        onChange={(e) => {
          setValue(e.currentTarget.value);
          useEditor.getState().preview({ type: "clip/update", payload: { clipId: clip.id, patch: { text: e.currentTarget.value } } });
        }}
        onBlur={commit}
      />
    </Sheet>
  );
}

const FONTS: { label: string; family: string }[] = [
  { label: "Sans", family: "system-ui, 'Noto Sans', 'Noto Sans Devanagari', 'Noto Nastaliq Urdu', 'Noto Sans Gujarati', sans-serif" },
  { label: "Serif", family: "Georgia, 'Noto Serif', 'Noto Serif Devanagari', serif" },
  { label: "Mono", family: "ui-monospace, 'Courier New', monospace" },
  { label: "Rounded", family: "ui-rounded, 'Arial Rounded MT Bold', system-ui, sans-serif" },
  { label: "Hand", family: "'Comic Sans MS', 'Segoe Print', cursive" },
  { label: "Impact", family: "Impact, 'Arial Black', sans-serif" },
];

export function TextStylePanel() {
  const t = useT();
  const loc = useSelectedClip();
  if (!loc || !isTextClip(loc.clip)) return null;
  const c = loc.clip;
  const st = (style: Partial<TextStyle>) => ({ type: "clip/update", payload: { clipId: c.id, patch: { style } } }) as const;
  const go = (style: Partial<TextStyle>) => useEditor.getState().dispatch(st(style));
  return (
    <Sheet title={t("style")}>
      <div className="no-scrollbar flex gap-2 overflow-x-auto py-2">
        {FONTS.map((f) => (
          <Chip key={f.label} active={c.style.fontFamily === f.family} onClick={() => go({ fontFamily: f.family })}>
            <span style={{ fontFamily: f.family }}>{f.label} अ</span>
          </Chip>
        ))}
        {(useEditor.getState().history?.project.fonts ?? []).map((f) => (
          <Chip key={f.family} active={c.style.fontFamily === f.css} onClick={() => go({ fontFamily: f.css })} testId={`font-${f.family}`}>
            <span style={{ fontFamily: f.css }}>{f.family} अ</span>
          </Chip>
        ))}
        <Chip onClick={() => void import("@/lib/ui-stores").then((m) => m.useLibraryUi.getState().show("font"))} testId="more-fonts">
          + {t("moreFonts")}
        </Chip>
      </div>
      <div className="flex gap-2 py-1">
        <Chip active={c.style.fontWeight >= 700} onClick={() => go({ fontWeight: c.style.fontWeight >= 700 ? 400 : 700 })}>
          <b>{t("bold")}</b>
        </Chip>
        <Chip active={c.style.italic} onClick={() => go({ italic: !c.style.italic })}>
          <i>{t("italic")}</i>
        </Chip>
        <Chip active={c.style.shadow} onClick={() => go({ shadow: !c.style.shadow })}>
          {t("shadow")}
        </Chip>
        {(["left", "center", "right"] as const).map((a) => (
          <Chip key={a} active={c.style.align === a} onClick={() => go({ align: a })} label={`${t("align")} ${a}`}>
            {a === "left" ? "⟸" : a === "right" ? "⟹" : "≡"}
          </Chip>
        ))}
      </div>
      <CommitSlider
        label={t("size")}
        value={c.style.fontSize}
        min={0.015}
        max={0.25}
        step={0.001}
        format={(v) => `${Math.round(v * 1000)}`}
        toCommand={(v) => st({ fontSize: v })}
      />
      <ColorRow label={t("color")} value={c.style.color} onPick={(color) => go({ color })} />
      <CommitSlider
        label={t("stroke")}
        value={c.style.strokeWidth}
        min={0}
        max={0.2}
        step={0.005}
        format={(v) => `${Math.round(v * 100)}`}
        toCommand={(v) => st({ strokeWidth: v })}
      />
      <ColorRow label={t("stroke")} value={c.style.strokeColor} onPick={(strokeColor) => go({ strokeColor })} />
      <CommitSlider
        label={t("background")}
        value={c.style.backgroundOpacity}
        min={0}
        max={1}
        step={0.05}
        format={(v) => `${Math.round(v * 100)}%`}
        toCommand={(v) => st({ backgroundOpacity: v })}
      />
      <ColorRow label={t("background")} value={c.style.backgroundColor} onPick={(backgroundColor) => go({ backgroundColor })} />
    </Sheet>
  );
}

const ANIMS: TextAnimation[] = ["none", "fade", "pop", "slide-up", "slide-down", "slide-left", "slide-right", "zoom", "typewriter", "blur"];

export function AnimationPanel() {
  const t = useT();
  const loc = useSelectedClip();
  if (!loc || !isTextClip(loc.clip)) return null;
  const c: TextClip = loc.clip;
  const set = (patch: { animationIn?: TextAnimation; animationOut?: TextAnimation }) =>
    useEditor.getState().dispatch({ type: "clip/update", payload: { clipId: c.id, patch } });
  return (
    <Sheet title={t("animation")}>
      <p className="mt-1 text-xs text-muted">{t("animIn")}</p>
      <div className="no-scrollbar flex gap-2 overflow-x-auto py-2">
        {ANIMS.map((a) => (
          <Chip key={a} active={c.animationIn === a} onClick={() => set({ animationIn: a })}>
            {a}
          </Chip>
        ))}
      </div>
      <p className="text-xs text-muted">{t("animOut")}</p>
      <div className="no-scrollbar flex gap-2 overflow-x-auto py-2">
        {ANIMS.filter((a) => a !== "typewriter").map((a) => (
          <Chip key={a} active={c.animationOut === a} onClick={() => set({ animationOut: a })}>
            {a}
          </Chip>
        ))}
      </div>
      <CommitSlider
        label={t("duration")}
        value={c.animationDurationUs / 1e6}
        min={0.1}
        max={2}
        step={0.1}
        format={(v) => `${v.toFixed(1)}s`}
        toCommand={(v) => ({ type: "clip/update", payload: { clipId: c.id, patch: { animationDurationUs: secondsToUs(v) } } })}
      />
    </Sheet>
  );
}

// ---------- Adjust ----------
const BLENDS: BlendMode[] = ["normal", "multiply", "screen", "overlay", "darken", "lighten", "add", "difference", "soft-light", "hard-light", "color-dodge", "color-burn"];

export function AdjustPanel() {
  const t = useT();
  const loc = useSelectedClip();
  const playhead = useEditor((s) => s.playheadUs);
  if (!loc) return null;
  const c = loc.clip;
  const local = Math.min(Math.max(0, playhead - c.startUs), c.durationUs);
  const tf = animatedTransform(c.transform, c.keyframes, local);
  const animated = KEYFRAME_PROPS.some((k) => (c.keyframes[k]?.length ?? 0) > 0);
  const atKey = KEYFRAME_PROPS.some((k) => c.keyframes[k]?.some((kf) => Math.abs(kf.t - local) <= 1000));
  const cmd = (transform: Partial<Transform>) => ({ type: "clip/update", payload: { clipId: c.id, patch: { transform } } }) as const;
  const anim = (prop: string) => (v: number) => animatableCommand(c.id, prop, v) ?? cmd({});
  return (
    <Sheet title={t("adjust")}>
      <div className="flex items-center gap-2 py-2">
        <button
          type="button"
          data-testid="keyframe-toggle"
          onClick={() => toggleTransformKeyframe(c.id)}
          aria-pressed={atKey}
          className={`flex h-9 items-center gap-1 rounded-full px-3 text-sm ${atKey ? "bg-accent text-accent-contrast" : "bg-surface-2"}`}
        >
          <span aria-hidden>◆</span>
          {atKey ? t("removeKeyframe") : t("addKeyframe")}
        </button>
        {animated && (
          <button
            type="button"
            className="h-9 rounded-full bg-surface-2 px-3 text-sm"
            onClick={() => useEditor.getState().dispatch({ type: "clip/clearKeyframes", payload: { clipId: c.id } })}
          >
            {t("clearKeyframes")}
          </button>
        )}
      </div>
      <CommitSlider label={t("scale")} value={tf.scale} min={0.1} max={5} step={0.01} format={(v) => `${Math.round(v * 100)}%`} toCommand={anim("scale")} testId="adjust-scale" />
      <CommitSlider label={t("positionX")} value={tf.x} min={-1} max={1} step={0.005} toCommand={anim("x")} testId="adjust-x" />
      <CommitSlider label={t("positionY")} value={tf.y} min={-1} max={1} step={0.005} toCommand={anim("y")} />
      <CommitSlider label={t("rotation")} value={tf.rotation} min={-180} max={180} step={1} format={(v) => `${Math.round(v)}°`} toCommand={anim("rotation")} />
      <CommitSlider label={t("opacity")} value={tf.opacity} min={0} max={1} step={0.01} format={(v) => `${Math.round(v * 100)}%`} toCommand={anim("opacity")} />
      <div className="flex flex-wrap gap-2 pt-2">
        <Chip active={c.transform.flipH} onClick={() => useEditor.getState().dispatch(cmd({ flipH: !c.transform.flipH }))}>
          {t("flipH")}
        </Chip>
        <Chip active={c.transform.flipV} onClick={() => useEditor.getState().dispatch(cmd({ flipV: !c.transform.flipV }))}>
          {t("flipV")}
        </Chip>
        <Chip onClick={() => useEditor.getState().dispatch(cmd({ ...DEFAULT_TRANSFORM }))}>{t("reset")}</Chip>
      </div>
      <p className="mt-3 text-xs text-muted">{t("blendMode")}</p>
      <div className="no-scrollbar flex gap-2 overflow-x-auto py-2">
        {BLENDS.map((b) => (
          <Chip
            key={b}
            active={c.blendMode === b}
            testId={`blend-${b}`}
            onClick={() => useEditor.getState().dispatch({ type: "clip/update", payload: { clipId: c.id, patch: { blendMode: b } } })}
          >
            {b}
          </Chip>
        ))}
      </div>
    </Sheet>
  );
}

// ---------- Crop ----------
export function CropPanel() {
  const t = useT();
  const loc = useSelectedClip();
  const project = useProject();
  if (!loc || !isMediaClip(loc.clip) || !project) return null;
  const c = loc.clip;
  const asset = project.assets.find((a) => a.id === c.assetId);
  const d = useEditor.getState().dispatch;
  const setRatio = (rw: number, rh: number) => {
    if (!asset) return;
    const ar = asset.width / Math.max(1, asset.height);
    const target = rw / rh;
    if (ar > target) {
      const keep = target / ar;
      d({ type: "clip/update", payload: { clipId: c.id, patch: { crop: { left: (1 - keep) / 2, right: (1 - keep) / 2, top: 0, bottom: 0 } } } });
    } else {
      const keep = ar / target;
      d({ type: "clip/update", payload: { clipId: c.id, patch: { crop: { top: (1 - keep) / 2, bottom: (1 - keep) / 2, left: 0, right: 0 } } } });
    }
  };
  const side = (k: "left" | "top" | "right" | "bottom") => (v: number) => animatableCommand(c.id, `crop.${k}`, v)!;
  return (
    <Sheet title={t("crop")}>
      <div className="no-scrollbar flex gap-2 overflow-x-auto py-2">
        <Chip onClick={() => d({ type: "clip/update", payload: { clipId: c.id, patch: { crop: { left: 0, top: 0, right: 0, bottom: 0 } } } })}>{t("none")}</Chip>
        <Chip onClick={() => setRatio(9, 16)} testId="crop-9:16">9:16</Chip>
        <Chip onClick={() => setRatio(1, 1)} testId="crop-1:1">1:1</Chip>
        <Chip onClick={() => setRatio(4, 5)}>4:5</Chip>
        <Chip onClick={() => setRatio(16, 9)}>16:9</Chip>
      </div>
      {(["left", "top", "right", "bottom"] as const).map((k) => (
        <CommitSlider key={k} label={t(k)} value={c.crop[k]} min={0} max={0.9} step={0.005} format={(v) => `${Math.round(v * 100)}%`} toCommand={side(k)} />
      ))}
    </Sheet>
  );
}

// ---------- Canvas ----------
export function CanvasPanel() {
  const t = useT();
  const project = useProject();
  if (!project) return null;
  const seq = getSequence(project);
  const bg = seq.background;
  const images = project.assets.filter((a) => a.kind === "image");
  const setBg = (patch: Partial<typeof bg>) =>
    useEditor.getState().dispatch({ type: "sequence/update", payload: { background: { ...bg, ...patch } } });
  return (
    <Sheet title={t("canvas")}>
      <p className="mt-1 text-xs text-muted">{t("aspectRatio")}</p>
      <div className="no-scrollbar flex gap-2 overflow-x-auto py-2">
        {(Object.keys(ASPECT_PRESETS) as AspectPreset[]).map((k) => {
          const p = ASPECT_PRESETS[k];
          const active = seq.width === p.width && seq.height === p.height;
          return (
            <Chip
              key={k}
              active={active}
              testId={`aspect-${k}`}
              onClick={() => useEditor.getState().dispatch({ type: "sequence/update", payload: { width: p.width, height: p.height } })}
            >
              {k}
            </Chip>
          );
        })}
      </div>
      <p className="mt-1 text-xs text-muted">{t("background")}</p>
      <div className="flex gap-2 py-2">
        <Chip active={bg.kind === "color"} onClick={() => setBg({ kind: "color" })} testId="bg-color">
          {t("color")}
        </Chip>
        <Chip active={bg.kind === "blur"} onClick={() => setBg({ kind: "blur" })} testId="bg-blur">
          {t("blur")}
        </Chip>
        <Chip active={bg.kind === "image"} onClick={() => images[0] && setBg({ kind: "image", assetId: bg.assetId ?? images[0].id })}>
          {t("image")}
        </Chip>
      </div>
      {bg.kind === "color" && <ColorRow label={t("backgroundColor")} value={bg.color} onPick={(color) => setBg({ color })} />}
      {bg.kind === "blur" && (
        <CommitSlider
          label={t("intensity")}
          value={bg.blur}
          min={0}
          max={1}
          step={0.05}
          format={(v) => `${Math.round(v * 100)}%`}
          toCommand={(v) => ({ type: "sequence/update", payload: { background: { ...bg, blur: v } } })}
        />
      )}
      {bg.kind === "image" && (
        <div className="no-scrollbar flex gap-2 overflow-x-auto py-2">
          {images.length === 0 && <p className="text-xs text-muted">{t("importPhotoFirst")}</p>}
          {images.map((a) => (
            <Chip key={a.id} active={bg.assetId === a.id} onClick={() => setBg({ assetId: a.id })}>
              {a.name.slice(0, 18)}
            </Chip>
          ))}
        </div>
      )}
    </Sheet>
  );
}

// ---------- History ----------
export function HistoryPanel() {
  const t = useT();
  const project = useProject();
  const past = useEditor((s) => s.history?.past ?? []);
  const [versions, setVersions] = useState<VersionRecord[]>([]);
  const pid = project?.id;
  const refresh = useMemo(() => () => pid && void listVersions(pid).then(setVersions), [pid]);
  useEffect(() => {
    refresh();
  }, [refresh]);
  if (!project) return null;
  return (
    <Sheet title={t("history")}>
      <button
        type="button"
        className="mb-3 mt-1 w-full rounded-xl bg-accent py-2 text-sm font-semibold text-accent-contrast"
        onClick={() => void addVersion(project, "Saved by you").then(refresh)}
      >
        {t("saveVersion")}
      </button>
      <h3 className="text-xs uppercase tracking-wide text-muted">{t("versions")}</h3>
      <ul className="mb-3 flex flex-col">
        {versions.map((v) => (
          <li key={v.id} className="flex items-center justify-between border-b border-line py-2 text-sm">
            <span>
              {v.label} · {new Date(v.at).toLocaleString()}
            </span>
            <button
              type="button"
              className="rounded-full bg-surface-2 px-3 py-1 text-xs"
              onClick={() =>
                v.id !== undefined &&
                void getVersion(v.id).then((rec) => {
                  if (!rec) return;
                  const old = rec.project;
                  // Restoring is itself undoable.
                  useEditor.getState().dispatch({
                    type: "internal/restore",
                    payload: {
                      name: old.name,
                      assets: old.assets,
                      sequences: Object.fromEntries(old.sequences.map((s) => [s.id, s])),
                      activeSequenceId: old.activeSequenceId,
                    },
                  });
                })
              }
            >
              {t("restore")}
            </button>
          </li>
        ))}
      </ul>
      <h3 className="text-xs uppercase tracking-wide text-muted">{t("undo")}</h3>
      <ol className="flex flex-col-reverse text-sm text-muted">
        {past.slice(-30).map((e, i) => (
          <li key={i} className="border-b border-line py-1.5">
            {e.label}
          </li>
        ))}
      </ol>
    </Sheet>
  );
}
