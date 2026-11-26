import { createId, createTextClip, type Command, type TextClip, type TextStyle } from "@just-see/schema";

/** One recognised word with timeline times in µs. */
export interface TranscriptWord {
  text: string;
  startUs: number;
  endUs: number;
}

export interface CaptionLine {
  startUs: number;
  endUs: number;
  words: TranscriptWord[];
}

export type CaptionLanguage = "auto" | "hi" | "en" | "hinglish" | "ur";

/** Split a word stream into short caption lines. */
export function groupCaptions(
  words: readonly TranscriptWord[],
  opts: { maxWords?: number; maxChars?: number; maxDurationUs?: number; gapUs?: number } = {},
): CaptionLine[] {
  const maxWords = opts.maxWords ?? 5;
  const maxChars = opts.maxChars ?? 28;
  const maxDur = opts.maxDurationUs ?? 2_800_000;
  const gap = opts.gapUs ?? 700_000;
  const lines: CaptionLine[] = [];
  let cur: TranscriptWord[] = [];
  const flush = () => {
    if (!cur.length) return;
    lines.push({ startUs: cur[0]!.startUs, endUs: cur[cur.length - 1]!.endUs, words: cur });
    cur = [];
  };
  for (const w of words) {
    const text = w.text.trim();
    if (!text) continue;
    const word = { ...w, text };
    const last = cur[cur.length - 1];
    const chars = cur.reduce((n, x) => n + x.text.length + 1, 0) + text.length;
    const tooLong = cur.length >= maxWords || chars > maxChars || (cur[0] && word.endUs - cur[0].startUs > maxDur);
    const pause = last && word.startUs - last.endUs > gap;
    const sentenceEnd = last && /[.!?।]$/.test(last.text);
    if (tooLong || pause || sentenceEnd) flush();
    cur.push(word);
  }
  flush();
  return lines;
}

// ---------- Devanagari → Latin (Hinglish) ----------
const CONSONANTS: Record<string, string> = {
  क: "k", ख: "kh", ग: "g", घ: "gh", ङ: "n",
  च: "ch", छ: "chh", ज: "j", झ: "jh", ञ: "n",
  ट: "t", ठ: "th", ड: "d", ढ: "dh", ण: "n",
  त: "t", थ: "th", द: "d", ध: "dh", न: "n",
  प: "p", फ: "ph", ब: "b", भ: "bh", म: "m",
  य: "y", र: "r", ल: "l", व: "v", श: "sh", ष: "sh", स: "s", ह: "h",
  क़: "q", ख़: "kh", ग़: "gh", ज़: "z", फ़: "f", ड़: "r", ढ़: "rh", य़: "y",
};
const NUKTA_BASE: Record<string, string> = { क: "q", ख: "kh", ग: "gh", ज: "z", फ: "f", ड: "r", ढ: "rh", य: "y" };
const VOWELS: Record<string, string> = {
  अ: "a", आ: "aa", इ: "i", ई: "ee", उ: "u", ऊ: "oo", ऋ: "ri", ए: "e", ऐ: "ai", ओ: "o", औ: "au", ऑ: "o", ऍ: "e",
};
const MATRAS: Record<string, string> = {
  "ा": "aa", "ि": "i", "ी": "ee", "ु": "u", "ू": "oo", "ृ": "ri",
  "े": "e", "ै": "ai", "ो": "o", "ौ": "au", "ॉ": "o", "ॅ": "e",
};
const VIRAMA = "्";
const NUKTA = "़";
const SIGNS: Record<string, string> = { "ं": "n", "ँ": "n", "ः": "h", "।": ".", "॥": "." };
const DIGITS = "०१२३४५६७८९";

function transliterateWord(word: string): string {
  const chars = Array.from(word.normalize("NFC"));
  let out = "";
  let pendingA = false;
  let syllables = 0;
  for (let i = 0; i < chars.length; i++) {
    let ch = chars[i]!;
    if (chars[i + 1] === NUKTA && NUKTA_BASE[ch]) {
      ch = ch + NUKTA;
      i++;
    }
    const cons = CONSONANTS[ch] ?? (ch.length === 2 ? NUKTA_BASE[ch[0]!] : undefined);
    if (cons !== undefined) {
      if (pendingA) out += "a";
      out += cons;
      pendingA = true;
      syllables++;
      continue;
    }
    if (ch === VIRAMA) {
      pendingA = false;
      syllables--;
      continue;
    }
    const m = MATRAS[ch];
    if (m !== undefined) {
      out += m;
      pendingA = false;
      continue;
    }
    const v = VOWELS[ch];
    if (v !== undefined) {
      if (pendingA) out += "a";
      out += v;
      pendingA = false;
      syllables++;
      continue;
    }
    const sign = SIGNS[ch];
    if (sign !== undefined) {
      if (pendingA) out += "a";
      pendingA = false;
      out += sign;
      continue;
    }
    const d = DIGITS.indexOf(ch);
    if (pendingA) out += "a";
    pendingA = false;
    out += d >= 0 ? String(d) : ch;
  }
  // Schwa deletion: a final inherent "a" is silent in most Hindi words.
  if (pendingA && syllables <= 1) out += "a";
  return out;
}

/** Romanise Devanagari text the way people type Hinglish (e.g. "नमस्ते दोस्तों" → "namaste doston"). */
export function devanagariToHinglish(text: string): string {
  return text.replace(/[ऀ-ॿ]+/g, (w) => transliterateWord(w));
}

// ---------- Filler words ----------
const FILLERS = new Set([
  "um", "umm", "uh", "uhh", "er", "erm", "ah", "hmm", "mm", "like", "basically", "actually", "you know",
  "matlab", "toh", "haan", "acha", "achha", "accha", "na", "yaani",
  "मतलब", "तो", "हाँ", "अच्छा", "यानी", "उम्म", "आ", "अ",
]);

export function isFillerWord(word: string): boolean {
  const w = word.toLowerCase().replace(/[.,!?।"'…]/g, "").trim();
  return w.length > 0 && FILLERS.has(w);
}

// ---------- Caption styles ----------
export interface CaptionStylePreset {
  id: string;
  label: string;
  style: Partial<TextStyle>;
  y: number;
}

export const CAPTION_STYLES: readonly CaptionStylePreset[] = [
  { id: "clean", label: "Clean", y: 0.3, style: { fontSize: 0.042, fontWeight: 700, color: "#ffffff", strokeWidth: 0.08, strokeColor: "#000000", shadow: true, backgroundOpacity: 0, highlightColor: "#ffd60a" } },
  { id: "box", label: "Box", y: 0.3, style: { fontSize: 0.038, fontWeight: 700, color: "#ffffff", strokeWidth: 0, backgroundColor: "#000000", backgroundOpacity: 0.65, shadow: false, highlightColor: "#ff8a1f" } },
  { id: "bold-pop", label: "Bold pop", y: 0.18, style: { fontSize: 0.055, fontWeight: 900, color: "#ffffff", strokeWidth: 0.12, strokeColor: "#000000", shadow: true, highlightColor: "#34c759" } },
  { id: "subtle", label: "Subtle", y: 0.38, style: { fontSize: 0.032, fontWeight: 500, color: "#f2f3f5", strokeWidth: 0, shadow: true, backgroundOpacity: 0, highlightColor: "#ffffff" } },
];

/**
 * Commands that put caption lines on a new text track as karaoke text clips.
 * Word times become clip-local.
 */
export function captionCommands(
  lines: readonly CaptionLine[],
  opts: { styleId?: string; groupId?: string; trackId?: string; language?: CaptionLanguage } = {},
): Command[] {
  const preset = CAPTION_STYLES.find((s) => s.id === opts.styleId) ?? CAPTION_STYLES[0]!;
  const groupId = opts.groupId ?? createId("cap_");
  const trackId = opts.trackId ?? createId("t_");
  const romanise = opts.language === "hinglish";
  const cmds: Command[] = [];
  let prevEnd = 0;
  for (const line of lines) {
    const start = Math.max(prevEnd, line.startUs);
    const end = Math.max(start + 200_000, line.endUs);
    const clip: TextClip = {
      ...createTextClip({ startUs: start, durationUs: end - start }),
      text: line.words.map((w) => (romanise ? devanagariToHinglish(w.text) : w.text)).join(" "),
      animationIn: "none",
      animationOut: "none",
      captionGroup: groupId,
      words: line.words.map((w) => ({
        text: romanise ? devanagariToHinglish(w.text) : w.text,
        startUs: Math.max(0, w.startUs - start),
        endUs: Math.max(0, Math.min(end, w.endUs) - start),
      })),
    };
    clip.style = { ...clip.style, ...preset.style };
    clip.transform = { ...clip.transform, y: preset.y };
    cmds.push({ type: "clip/add", payload: { clip, trackType: "text", newTrackId: trackId } });
    prevEnd = end;
  }
  return cmds;
}
