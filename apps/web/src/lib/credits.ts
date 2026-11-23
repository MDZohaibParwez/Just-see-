"use client";

import type { License, Project } from "@just-see/schema";

export interface CreditLine {
  what: string;
  kind: string;
  license: License;
}

/** Everything in the project with its licence, for the licences page and credits file. */
export function projectCredits(p: Project): CreditLine[] {
  const out: CreditLine[] = p.assets.map((a) => ({ what: a.name, kind: a.kind, license: a.license }));
  for (const f of p.fonts ?? []) out.push({ what: f.family, kind: "font", license: f.license });
  return out;
}

export function licenseLabel(l: License): string {
  if (l.licenseName) return l.licenseName;
  return l.kind === "user-upload" ? "Your own media" : l.name ?? "Library";
}

/** Plain-text credits to paste in a video description. Only items that need or deserve credit. */
export function creditsText(p: Project): string {
  const lines = projectCredits(p)
    .filter((c) => c.license.kind === "library" && c.license.source !== "built-in" && !c.license.source?.startsWith("just-see"))
    .map((c) => {
      const l = c.license;
      if (l.attribution) return `• ${l.attribution}${l.sourceUrl ? ` — ${l.sourceUrl}` : ""}`;
      return `• ${l.name ?? c.what}${l.author ? ` by ${l.author}` : ""} — ${licenseLabel(l)}${l.sourceUrl ? ` — ${l.sourceUrl}` : ""}`;
    });
  return lines.length ? `Credits\n${lines.join("\n")}\n` : "";
}
