"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Compositor, EFFECTS, TRANSITIONS, pickAudioCodec, pickVideoCodec } from "@just-see/engine";

interface Report {
  webgl2: boolean;
  webcodecs: boolean;
  opfs: boolean;
  videoEncoder: string;
  audioEncoder: string;
  shaderErrors: string[];
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
      let webgl2 = false;
      try {
        const c = new Compositor(canvas);
        webgl2 = true;
        shaderErrors = c.compileAll(
          EFFECTS.map((e) => e.type),
          TRANSITIONS.map((t) => t.type),
        );
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
        <dl className="grid grid-cols-2 gap-2 text-sm" data-testid="diagnostics" data-shader-errors={report.shaderErrors.length}>
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
          <dt>Shader errors</dt>
          <dd>{report.shaderErrors.length === 0 ? "none" : <pre className="whitespace-pre-wrap text-danger">{report.shaderErrors.join("\n")}</pre>}</dd>
        </dl>
      )}
    </main>
  );
}
