"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Compositor, EFFECTS, TRANSITIONS, defaultParams, pickAudioCodec, pickVideoCodec, type FramePlan, type VisualLayer } from "@just-see/engine";
import { DEFAULT_TRANSFORM, NO_CROP } from "@just-see/schema";

interface Report {
  webgl2: boolean;
  webcodecs: boolean;
  opfs: boolean;
  videoEncoder: string;
  audioEncoder: string;
  shaderErrors: string[];
  renderErrors: string[];
  effects: number;
  transitions: number;
}

/** Device check page: shows what this browser supports. Also used by tests. */
export default function Diagnostics() {
  const [report, setReport] = useState<Report | null>(null);
  useEffect(() => {
    void (async () => {
      const canvas = document.createElement("canvas");
      let shaderErrors: string[] = [];
      const renderErrors: string[] = [];
      let webgl2 = false;
      try {
        const c = new Compositor(canvas);
        webgl2 = true;
        shaderErrors = c.compileAll(
          EFFECTS.map((e) => e.type),
          TRANSITIONS.map((t) => t.type),
        );
        // Render every effect and transition once and check for GL errors.
        c.resize(96, 160);
        const pattern = document.createElement("canvas");
        pattern.width = 64;
        pattern.height = 64;
        const pctx = pattern.getContext("2d");
        if (pctx) {
          const g = pctx.createLinearGradient(0, 0, 64, 64);
          g.addColorStop(0, "#ff3366");
          g.addColorStop(1, "#33ccff");
          pctx.fillStyle = g;
          pctx.fillRect(0, 0, 64, 64);
        }
        const layer = (clipId: string, effects: VisualLayer["effects"]): VisualLayer => ({
          kind: "visual",
          clipId,
          trackId: "t",
          source: { kind: "image", clipId, assetId: "p", sourceTimeUs: 0, width: 64, height: 64, rotation: 0 },
          transform: { ...DEFAULT_TRANSFORM },
          crop: NO_CROP,
          blendMode: "normal",
          opacity: 1,
          effects,
          localTime: 1.3,
        });
        const provider = { getImage: () => ({ image: pattern, rotation: 0, version: 1 }) };
        const base = { timeUs: 0, width: 96, height: 160, background: "#000000" };
        for (const e of EFFECTS) {
          const plan: FramePlan = { ...base, layers: [layer("a", [{ id: "e", type: e.type, enabled: true, params: defaultParams(e) }])] };
          c.render(plan, provider);
          const err = c.glError();
          if (err) renderErrors.push(`effect ${e.type}: GL error ${err}`);
        }
        for (const tr of TRANSITIONS) {
          const plan: FramePlan = { ...base, layers: [{ kind: "transition", type: tr.type, progress: 0.5, from: layer("a", []), to: layer("b", []) }] };
          c.render(plan, provider);
          const err = c.glError();
          if (err) renderErrors.push(`transition ${tr.type}: GL error ${err}`);
        }
        const blendPlan: FramePlan = { ...base, layers: [layer("a", []), { ...layer("b", []), blendMode: "overlay" }] };
        c.render(blendPlan, provider);
        if (c.glError()) renderErrors.push("blend: GL error");
        c.dispose();
      } catch (e) {
        shaderErrors = [(e as Error).message];
      }
      const webcodecs = typeof VideoEncoder !== "undefined";
      let videoEncoder = "none";
      let audioEncoder = "none";
      if (webcodecs) {
        videoEncoder = await pickVideoCodec(1080, 1920, 30, 12e6).then((c) => `${c.label} (${c.codec})`).catch(() => "none");
        audioEncoder = (await pickAudioCodec(48000, 2, 160000))?.label ?? "none";
      }
      setReport({
        webgl2,
        webcodecs,
        opfs: !!navigator.storage?.getDirectory,
        videoEncoder,
        audioEncoder,
        shaderErrors,
        renderErrors,
        effects: EFFECTS.length,
        transitions: TRANSITIONS.length,
      });
    })();
  }, []);

  return (
    <main className="mx-auto max-w-xl p-4">
      <Link href="/" className="text-sm text-accent">
        ← Home
      </Link>
      <h1 className="my-3 text-xl font-bold">Device check</h1>
      {!report ? (
        <p>Checking…</p>
      ) : (
        <dl className="grid grid-cols-2 gap-2 text-sm" data-testid="diagnostics" data-shader-errors={report.shaderErrors.length} data-render-errors={report.renderErrors.length} data-effects={report.effects} data-transitions={report.transitions}>
          <dt>WebGL2</dt>
          <dd>{report.webgl2 ? "yes" : "no"}</dd>
          <dt>WebCodecs</dt>
          <dd>{report.webcodecs ? "yes" : "no"}</dd>
          <dt>On-device storage (OPFS)</dt>
          <dd>{report.opfs ? "yes" : "no"}</dd>
          <dt>Video encoder</dt>
          <dd>{report.videoEncoder}</dd>
          <dt>Audio encoder</dt>
          <dd>{report.audioEncoder}</dd>
          <dt>Effects / transitions</dt>
          <dd>
            {report.effects} / {report.transitions}
          </dd>
          <dt>Render errors</dt>
          <dd>{report.renderErrors.length === 0 ? "none" : <pre className="whitespace-pre-wrap text-danger">{report.renderErrors.join("\n")}</pre>}</dd>
          <dt>Shader errors</dt>
          <dd>{report.shaderErrors.length === 0 ? "none" : <pre className="whitespace-pre-wrap text-danger">{report.shaderErrors.join("\n")}</pre>}</dd>
        </dl>
      )}
    </main>
  );
}
