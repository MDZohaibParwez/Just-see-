"use client";

import { useEffect, useMemo, useState } from "react";
import { Icon } from "@just-see/ui";
import {
  ASPECT_PRESETS,
  DEFAULT_TRANSFORM,
  findClip,
  getSequence,
  isMediaClip,
  isTextClip,
  secondsToUs,
  type AspectPreset,
  type MediaClip,
  type TextAnimation,
  type TextClip,
  type TextStyle,
  type Transform,
} from "@just-see/schema";
import { EFFECTS, EFFECTS_BY_TYPE, TRANSITIONS, resolveParams, DEFAULT_TRANSITION_US, type EffectCategory } from "@just-see/engine";
import { addEffect, setTransition, setTransitionEverywhere } from "@/lib/actions";
import { useEditor, useProject } from "@/lib/editor-store";
import { useT } from "@/lib/i18n";
import { addVersion, getVersion, listVersions, type VersionRecord } from "@/lib/storage/db";
import { Chip, ColorRow, CommitSlider, Sheet } from "./controls";

function useSelectedClip() {
  const project = useProject();
  const selection = useEditor((s) => s.selection);
  if (!project || !selection) return undefined;
  return findClip(project, selection.clipId);
}

// ---------- Speed ----------
export function SpeedPanel() {
  const t = useT();
  const loc = useSelectedClip();
  if (!loc || !isMediaClip(loc.clip)) return null;
  const c = loc.clip;
  const set = (speed: number) => useEditor.getState().dispatch({ type: "clip/setSpeed", payload: { clipId: c.id, speed } });
  return (
    <Sheet title={t("speed")}>
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
    </Sheet>
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
const CATEGORIES: EffectCategory[] = ["color", "blur", "stylize", "distort", "motion", "retro"];

export function EffectsPanel() {
  const t = useT();
  const loc = useSelectedClip();
  const [cat, setCat] = useState<EffectCategory>("color");
  const [openId, setOpenId] = useState<string | null>(null);
  if (!loc) return null;
  const c = loc.clip;
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
                      toCommand={(v) => ({
                        type: "clip/updateEffect",
                        payload: { clipId: c.id, effectId: fx.id, params: { [prm.key]: v } },
                      })}
                    />
                  ))}
              </li>
            );
          })}
        </ul>
      )}
      <div className="no-scrollbar mb-2 flex gap-2 overflow-x-auto">
        {CATEGORIES.map((k) => (
          <Chip key={k} active={cat === k} onClick={() => setCat(k)}>
            {k[0]!.toUpperCase() + k.slice(1)}
          </Chip>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {EFFECTS.filter((e) => e.category === cat).map((e) => (
          <button
            key={e.type}
            type="button"
            data-testid={`effect-${e.type}`}
            className="flex h-14 items-center justify-center rounded-xl border border-line bg-surface-2 px-1 text-center text-xs active:scale-95"
            onClick={() => {
              const id = addEffect(c.id, e.type);
              if (id) setOpenId(id);
            }}
          >
            {e.label}
          </button>
        ))}
      </div>
    </Sheet>
  );
}

// ---------- Transition ----------
export function TransitionPanel() {
  const t = useT();
  const loc = useSelectedClip();
  const [dur, setDur] = useState(DEFAULT_TRANSITION_US);
  if (!loc || !isMediaClip(loc.clip)) return null;
  const c = loc.clip;
  const current = c.transitionIn;
  const duration = current?.durationUs ?? dur;
  return (
    <Sheet title={t("transitions")}>
      <div className="grid grid-cols-3 gap-2 py-2 sm:grid-cols-4">
        <button
          type="button"
          className={`h-12 rounded-xl border text-xs ${!current ? "border-accent bg-accent/15" : "border-line bg-surface-2"}`}
          onClick={() => setTransition(c.id, null)}
        >
          {t("none")}
        </button>
        {TRANSITIONS.map((tr) => (
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
      <CommitSlider
        label={t("duration")}
        value={duration / 1e6}
        min={0.1}
        max={2}
        step={0.1}
        format={(v) => `${v.toFixed(1)}s`}
        toCommand={(v) => {
          setDur(secondsToUs(v));
          return { type: "clip/setTransition", payload: { clipId: c.id, transition: { type: current?.type ?? "crossfade", durationUs: secondsToUs(v) } } };
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
    </Sheet>
  );
}

// ---------- Text ----------
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
export function AdjustPanel() {
  const t = useT();
  const loc = useSelectedClip();
  if (!loc) return null;
  const c = loc.clip;
  const tf = c.transform;
  const cmd = (transform: Partial<Transform>) => ({ type: "clip/update", payload: { clipId: c.id, patch: { transform } } }) as const;
  return (
    <Sheet title={t("adjust")}>
      <CommitSlider label={t("scale")} value={tf.scale} min={0.1} max={5} step={0.01} format={(v) => `${Math.round(v * 100)}%`} toCommand={(v) => cmd({ scale: v })} />
      <CommitSlider label={t("positionX")} value={tf.x} min={-1} max={1} step={0.005} toCommand={(v) => cmd({ x: v })} />
      <CommitSlider label={t("positionY")} value={tf.y} min={-1} max={1} step={0.005} toCommand={(v) => cmd({ y: v })} />
      <CommitSlider label={t("rotation")} value={tf.rotation} min={-180} max={180} step={1} format={(v) => `${Math.round(v)}°`} toCommand={(v) => cmd({ rotation: v })} />
      <CommitSlider label={t("opacity")} value={tf.opacity} min={0} max={1} step={0.01} format={(v) => `${Math.round(v * 100)}%`} toCommand={(v) => cmd({ opacity: v })} />
      <div className="flex flex-wrap gap-2 pt-2">
        <Chip active={tf.flipH} onClick={() => useEditor.getState().dispatch(cmd({ flipH: !tf.flipH }))}>
          {t("flipH")}
        </Chip>
        <Chip active={tf.flipV} onClick={() => useEditor.getState().dispatch(cmd({ flipV: !tf.flipV }))}>
          {t("flipV")}
        </Chip>
        <Chip onClick={() => useEditor.getState().dispatch(cmd({ ...DEFAULT_TRANSFORM }))}>{t("reset")}</Chip>
      </div>
    </Sheet>
  );
}

// ---------- Canvas ----------
export function CanvasPanel() {
  const t = useT();
  const project = useProject();
  if (!project) return null;
  const seq = getSequence(project);
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
      <ColorRow
        label={t("backgroundColor")}
        value={seq.background.color}
        onPick={(color) => useEditor.getState().dispatch({ type: "sequence/update", payload: { background: { kind: "color", color } } })}
      />
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
