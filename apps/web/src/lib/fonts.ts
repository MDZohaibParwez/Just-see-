"use client";

import { FONT_CATALOG, OFL, bumpFontEpoch, fontCss, googleFontCssUrl, type FontEntry } from "@just-see/engine";

let listening = false;
/** Redraw text when any web font finishes loading. */
function listen(): void {
  if (listening || typeof document === "undefined") return;
  listening = true;
  document.fonts.addEventListener("loadingdone", () => {
    bumpFontEpoch();
    window.dispatchEvent(new Event("justsee:fonts"));
  });
}
import type { Project, ProjectFont } from "@just-see/schema";

const links = new Map<string, Promise<void>>();

/** Load a Google font's CSS and wait until the faces are usable (or give up after a while). */
export function loadWebFont(family: string, weights: number[]): Promise<void> {
  const key = `${family}:${[...weights].sort().join(",")}`;
  let job = links.get(key);
  if (!job) {
    job = (async () => {
      if (typeof document === "undefined") return;
      listen();
      await new Promise<void>((resolve) => {
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = googleFontCssUrl(family, weights);
        link.onload = () => resolve();
        link.onerror = () => resolve();
        document.head.appendChild(link);
        setTimeout(resolve, 8000);
      });
      await Promise.race([
        Promise.all(weights.map((w) => document.fonts.load(`${w} 32px '${family}'`, "Aaअ"))).catch(() => undefined),
        new Promise((r) => setTimeout(r, 8000)),
      ]);
    })();
    links.set(key, job);
  }
  return job;
}

export function fontEntry(family: string): FontEntry | undefined {
  return FONT_CATALOG.find((f) => f.family === family);
}

export function projectFontFor(f: FontEntry): ProjectFont {
  return {
    family: f.family,
    css: fontCss(f.family, f.category),
    source: "google",
    weights: f.weights,
    license: { kind: "library", name: `${f.family} (Google Fonts)`, commercialUse: true, ...OFL, source: "google-fonts", sourceUrl: `https://fonts.google.com/specimen/${f.family.replace(/ /g, "+")}` },
  };
}

/** Make sure every web font the project uses is loaded (preview and export). */
export async function ensureProjectFonts(project: Project | null | undefined): Promise<void> {
  if (!project?.fonts?.length) return;
  await Promise.all(project.fonts.filter((f) => f.source === "google").map((f) => loadWebFont(f.family, f.weights)));
}
