/**
 * Curated Google Fonts. Every family here is licensed under the SIL Open
 * Font License 1.1 (free for commercial use, can be embedded). Checked
 * against fonts.googleapis.com; the CSS is loaded on demand in the browser.
 */
export interface FontEntry {
  family: string;
  category: "sans" | "serif" | "display" | "script" | "mono" | "indic" | "urdu";
  weights: number[];
  tags: string[];
}

const F = (family: string, category: FontEntry["category"], weights: number[], ...tags: string[]): FontEntry => ({ family, category, weights, tags });

export const FONT_CATALOG: readonly FontEntry[] = [
  F("Poppins", "sans", [400, 700], "modern", "clean", "youtube", "title"),
  F("Montserrat", "sans", [400, 700], "modern", "clean", "title"),
  F("Inter", "sans", [400, 700], "clean", "ui", "subtitle", "caption"),
  F("Lato", "sans", [400, 700], "clean", "body"),
  F("Oswald", "sans", [400, 700], "condensed", "bold", "news"),
  F("Bebas Neue", "display", [400], "condensed", "bold", "title", "cinematic"),
  F("Anton", "display", [400], "condensed", "bold", "meme", "thumbnail"),
  F("Raleway", "sans", [400, 700], "elegant", "thin"),
  F("Playfair Display", "serif", [400, 700], "elegant", "luxury", "wedding"),
  F("Merriweather", "serif", [400, 700], "classic", "reading"),
  F("Lobster", "script", [400], "retro", "fun"),
  F("Pacifico", "script", [400], "fun", "summer", "handwriting"),
  F("Dancing Script", "script", [400, 700], "handwriting", "wedding", "love"),
  F("Caveat", "script", [400, 700], "handwriting", "notes"),
  F("Permanent Marker", "display", [400], "marker", "handwriting", "vlog"),
  F("Bangers", "display", [400], "comic", "meme", "fun"),
  F("Righteous", "display", [400], "retro", "gaming"),
  F("Fredoka", "sans", [400, 700], "rounded", "kids", "fun"),
  F("Nunito", "sans", [400, 700], "rounded", "friendly"),
  F("Quicksand", "sans", [400, 700], "rounded", "light"),
  F("Archivo Black", "display", [400], "bold", "heavy", "thumbnail"),
  F("Abril Fatface", "serif", [400], "fashion", "magazine"),
  F("Satisfy", "script", [400], "signature"),
  F("Great Vibes", "script", [400], "wedding", "calligraphy", "elegant"),
  F("Shadows Into Light", "script", [400], "handwriting", "casual"),
  F("Press Start 2P", "mono", [400], "pixel", "gaming", "retro", "8bit"),
  F("Orbitron", "display", [400, 700], "sci-fi", "tech", "futuristic", "gaming"),
  F("Audiowide", "display", [400], "tech", "futuristic"),
  F("Bungee", "display", [400], "street", "bold"),
  F("Black Ops One", "display", [400], "army", "gaming", "stencil"),
  F("Teko", "sans", [400, 700], "condensed", "sports"),
  F("Rajdhani", "sans", [400, 700], "tech", "devanagari", "hindi"),
  F("Space Grotesk", "sans", [400, 700], "tech", "modern"),
  F("DM Serif Display", "serif", [400], "elegant", "title"),
  F("Cinzel", "serif", [400, 700], "cinematic", "epic", "roman"),
  F("Comfortaa", "sans", [400, 700], "rounded", "soft"),
  F("Kalam", "indic", [400, 700], "hindi", "devanagari", "handwriting"),
  F("Hind", "indic", [400, 700], "hindi", "devanagari", "clean"),
  F("Mukta", "indic", [400, 700], "hindi", "devanagari", "clean"),
  F("Baloo 2", "indic", [400, 700], "hindi", "devanagari", "rounded", "fun"),
  F("Yatra One", "indic", [400], "hindi", "devanagari", "display", "bollywood"),
  F("Noto Sans Devanagari", "indic", [400, 700], "hindi", "devanagari", "marathi"),
  F("Tiro Devanagari Hindi", "indic", [400], "hindi", "devanagari", "serif"),
  F("Rozha One", "indic", [400], "hindi", "devanagari", "bold", "bollywood"),
  F("Amita", "indic", [400, 700], "hindi", "devanagari", "calligraphy"),
  F("Khand", "indic", [400, 700], "hindi", "devanagari", "condensed"),
  F("Martel", "indic", [400, 700], "hindi", "devanagari", "serif"),
  F("Noto Sans Gujarati", "indic", [400, 700], "gujarati"),
  F("Noto Nastaliq Urdu", "urdu", [400, 700], "urdu", "nastaliq"),
  F("Gulzar", "urdu", [400], "urdu", "nastaliq", "display"),
];

export const OFL = { licenseName: "OFL 1.1", licenseUrl: "https://openfontlicense.org" } as const;

/** CSS URL for a family (Google Fonts CSS2 API). */
export function googleFontCssUrl(family: string, weights: number[]): string {
  const w = [...new Set(weights)].sort((a, b) => a - b).join(";");
  return `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, "+")}:wght@${w}&display=swap`;
}

export function fontCss(family: string, category: FontEntry["category"]): string {
  const fallback = category === "serif" ? "serif" : category === "mono" ? "monospace" : category === "script" ? "cursive" : "system-ui, sans-serif";
  return `'${family}', ${fallback}`;
}
