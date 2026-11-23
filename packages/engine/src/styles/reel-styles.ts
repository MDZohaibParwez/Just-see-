/**
 * Reel styles: editing recipes distilled from popular Instagram Reels formats
 * (anime dialogue, POV story, aesthetic detail, hook montage, quote reveal,
 * talking-head funnel, scenic lyric montage, dream card, lyric card).
 * Each style is a plan the app applies to the user's own clips; the guide
 * text tells a person or an AI how the format works and how to shoot it.
 * The looks are built from our own effects and templates (no copied assets).
 */

export interface StyleField {
  key: string;
  label: string;
  default: string;
}

export interface StyleOverlay {
  template: string;
  /** "whole" = the full video, "start" = from 0, "end" = the last `seconds`, or a time in seconds. */
  at: "whole" | "start" | "end" | number;
  seconds?: number;
  /** Template quick-edit label → style field key. */
  fields: Record<string, string>;
}

export interface ReelStyle {
  id: string;
  label: string;
  /** The kind of reel it recreates. */
  format: string;
  hook: string;
  structure: string[];
  shoot: string[];
  text: string;
  sound: string;
  grade: string;
  pacing: string;
  /** Applied to every main-track clip. */
  effects: { type: string; params: Record<string, number> }[];
  transition: string | null;
  transitionSec: number;
  /** Slow zoom on photos (anime stills, book pages). */
  kenBurns: boolean;
  /** Playback speed for video clips (0.5 = slow motion). */
  speed: number;
  overlays: StyleOverlay[];
  captions: "auto" | null;
  musicMood: string | null;
  fields: StyleField[];
}

const END: StyleOverlay = { template: "end-card", at: "end", seconds: 2, fields: { Handle: "handle" } };
const HANDLE: StyleField = { key: "handle", label: "Your @handle", default: "@yourhandle" };

export const REEL_STYLES: readonly ReelStyle[] = [
  {
    id: "anime-dialogue",
    label: "Anime dialogue romance",
    format: "Anime / manhwa stills with short dialogue lines, soft romantic song, slow zoom, payoff moment",
    hook: "A short question line in the first second (e.g. “Kya dekh rahi ho?”) creates curiosity.",
    structure: ["0–5 s: 3–4 dialogue lines alternating top/bottom, one per ~1.3 s", "5–16 s: the payoff (wide shot, gentle movement)", "Last 2 s: dark fade + @handle"],
    shoot: ["Use your own drawings, commissioned art or AI art you have rights to", "2–4 stills: two character close-ups + one wide shot", "Bright, soft background light reads as romantic"],
    text: "Serif/cursive white text with a thin dark outline and soft shadow; one line at a time.",
    sound: "Soft romantic track, low and intimate; no SFX during dialogue.",
    grade: "Bright, slightly warm, soft bloom on highlights.",
    pacing: "Slow: 1–1.5 s per dialogue line, then a long held payoff.",
    effects: [{ type: "bloom", params: { amount: 0.35 } }, { type: "temperature", params: { amount: 0.12 } }],
    transition: "fade-white",
    transitionSec: 0.4,
    kenBurns: true,
    speed: 1,
    overlays: [{ template: "dialogue", at: "start", seconds: 6, fields: { "Line 1": "line1", "Line 2": "line2", "Line 3": "line3", "Line 4": "line4" } }, END],
    captions: null,
    musicMood: "lofi",
    fields: [
      { key: "line1", label: "Line 1", default: "Kya dekh rahi ho?" },
      { key: "line2", label: "Line 2", default: "Aapke baal bahut acche hain" },
      { key: "line3", label: "Line 3", default: "Chhu sakti hoon?" },
      { key: "line4", label: "Line 4", default: "Zaroor!" },
      HANDLE,
    ],
  },
  {
    id: "pov-story",
    label: "POV story with notification",
    format: "Live-action mini story: POV header, a phone notification pop-up, a caring act, couple payoff",
    hook: "“POV :- …” header tells the story in one line before anything happens.",
    structure: ["0–4 s: setup shot (person waiting / sitting)", "~4 s: message notification pops in from the top", "5–15 s: reaction and action (gets up, picks something)", "15–32 s: payoff in a second location (walk together, hold hands)", "Last 2 s: dark fade + @handle"],
    shoot: ["2 locations: indoor setup + evening outdoor payoff", "Close-ups of the key prop (heels, gift, flowers)", "Hold each shot 2–3 s; one clear action per shot"],
    text: "White bold POV header on a banner at the top for the whole video.",
    sound: "Soft romantic song; a small notification ding at the pop-up.",
    grade: "Warm indoor, cooler night outdoor, gentle contrast.",
    pacing: "Slow-medium, cuts on actions.",
    effects: [{ type: "fade", params: { amount: 0.15 } }, { type: "vignette", params: { amount: 0.25 } }],
    transition: "crossfade",
    transitionSec: 0.4,
    kenBurns: false,
    speed: 1,
    overlays: [
      { template: "hook-header", at: "whole", fields: { Header: "pov", Subline: "subline" } },
      { template: "notification", at: 3.8, seconds: 3, fields: { Name: "from", Message: "message" } },
      END,
    ],
    captions: null,
    musicMood: "cinematic",
    fields: [
      { key: "pov", label: "POV line", default: "POV :- She's wearing heels tonight" },
      { key: "subline", label: "Second line", default: " " },
      { key: "from", label: "Notification from", default: "Babe ❤️" },
      { key: "message", label: "Notification text", default: "how am I looking? 😘" },
      HANDLE,
    ],
  },
  {
    id: "aesthetic-detail",
    label: "Aesthetic detail (no face)",
    format: "Faceless detail shots (fabric, hands, watch, beads, hair) with one poetic line",
    hook: "One small centred line like “The way she describes me 🌙”.",
    structure: ["6–8 detail shots of 1.5–2.5 s each", "Light through blinds / window shadows", "Last 2 s: black + @handle"],
    shoot: ["Hide the face; shoot hands, fabric folds, accessories", "Side light from a window or blinds for shadow patterns", "Slow, steady hand movements"],
    text: "Small centred white text for the whole video.",
    sound: "Melodic, nostalgic song.",
    grade: "Warm cream / sepia, lifted blacks, light grain.",
    pacing: "Calm, cuts every 2 s.",
    effects: [{ type: "sepia", params: { amount: 0.25 } }, { type: "fade", params: { amount: 0.25 } }, { type: "grain", params: { amount: 0.25 } }, { type: "vignette", params: { amount: 0.3 } }],
    transition: "crossfade",
    transitionSec: 0.35,
    kenBurns: true,
    speed: 1,
    overlays: [{ template: "hook-header", at: "whole", fields: { Header: "line", Subline: "subline" } }, END],
    captions: null,
    musicMood: "lofi",
    fields: [{ key: "line", label: "Line", default: "The way she describes me 🌙" }, { key: "subline", label: "Second line", default: " " }, HANDLE],
  },
  {
    id: "hook-montage",
    label: "Hook + fast lyric montage",
    format: "Sarcastic hook card, then 1-second cuts of moody clips with lyric words on each cut",
    hook: "Bold top text that sets up a comparison (e.g. “BOYS: HOW TO IMPRESS A BOOKISH GIRL 🙄”).",
    structure: ["0–2 s: hook shot with the header", "2–14 s: one clip per beat (≈1 s), lyric word on each", "Last 2 s: @handle"],
    shoot: ["10–14 short moody clips (bike at night, suit, stairs, flowers, street)", "Darker exposure, strong silhouettes"],
    text: "Header on a banner; lyric words big and bold, white or yellow, centre.",
    sound: "Upbeat catchy track; cut exactly on the beat (use Mark beats → Cut to beat).",
    grade: "Desaturated, moody, crushed blacks.",
    pacing: "Fast: a cut every beat.",
    effects: [{ type: "saturation", params: { amount: -0.35 } }, { type: "contrast", params: { amount: 0.25 } }, { type: "vignette", params: { amount: 0.35 } }],
    transition: null,
    transitionSec: 0.2,
    kenBurns: false,
    speed: 1,
    overlays: [{ template: "hook-header", at: "whole", fields: { Header: "hook", Subline: "subline" } }, END],
    captions: null,
    musicMood: "upbeat",
    fields: [{ key: "hook", label: "Hook", default: "BOYS: HOW TO IMPRESS A BOOKISH GIRL 🙄" }, { key: "subline", label: "Second line", default: "Fictional men:" }, HANDLE],
  },
  {
    id: "quote-reveal",
    label: "Book quote reveal",
    format: "Hold a page with a quote, slow push-in, then turn to reveal the cover",
    hook: "A one-word reaction header like “Damn…😭”.",
    structure: ["0–6 s: page with the quote, slow push-in", "7–11 s: turn to reveal the cover / product", "Last 2 s: @handle"],
    shoot: ["Warm lamp light, shelf or plants behind", "Move the camera slowly; keep the quote readable for 3+ s"],
    text: "Short reaction header at the top.",
    sound: "Sad or emotional track, soft.",
    grade: "Warm, soft contrast, slight vignette.",
    pacing: "Slow; one reveal.",
    effects: [{ type: "temperature", params: { amount: 0.2 } }, { type: "vignette", params: { amount: 0.35 } }],
    transition: "blur-dissolve",
    transitionSec: 0.5,
    kenBurns: true,
    speed: 1,
    overlays: [{ template: "hook-header", at: "whole", fields: { Header: "reaction", Subline: "subline" } }, END],
    captions: null,
    musicMood: "cinematic",
    fields: [{ key: "reaction", label: "Reaction", default: "Damn…😭" }, { key: "subline", label: "Second line", default: " " }, HANDLE],
  },
  {
    id: "talking-head",
    label: "Talking head + captions + CTA",
    format: "Educational talking head with word captions, B-roll proof, key-point labels and a comment CTA",
    hook: "Pop-culture or bold claim in the first 3 s (“I used Patrick Jane's psychology on 200 students…”).",
    structure: ["0–3 s: hook line + reference clip", "3–60 s: points, each with a label pop and B-roll proof", "Then: why it matters / scarcity", "End: CTA “Comment PLAYBOOK and I'll send it”"],
    shoot: ["Mic close to mouth, quiet room", "Eye-level camera, warm practical lights behind", "Record B-roll of proof (stage, screen, product)"],
    text: "Word-by-word captions in the lower middle; bold yellow labels for key ideas; CTA card at the end.",
    sound: "Clean voice (Studio voice), little or no music so speech is clear.",
    grade: "Natural, slightly warm.",
    pacing: "Cut every 3–5 s between talking head and B-roll; remove silences.",
    effects: [{ type: "clarity", params: { amount: 0.15 } }],
    transition: null,
    transitionSec: 0.2,
    kenBurns: false,
    speed: 1,
    overlays: [
      { template: "label-pop", at: 3, seconds: 2.5, fields: { Label: "label" } },
      { template: "end-card", at: "end", seconds: 3, fields: { Handle: "cta", Line: "handle" } },
    ],
    captions: "auto",
    musicMood: null,
    fields: [{ key: "label", label: "Key point label", default: "Pattern Interrupt" }, { key: "cta", label: "Call to action", default: "Comment “PLAYBOOK” 👇" }, HANDLE],
  },
  {
    id: "scenic-lyric",
    label: "Scenic couple lyric montage",
    format: "Cinematic music-video montage: environment → her → him → together → nature → close-ups → calm landscape ending, small lyric subtitles",
    hook: "Open on a wide, atmospheric environment shot (trees, mist, sky) before any face.",
    structure: ["0–1.5 s: establishing environment", "1.5–5 s: introduce each person (window, profile, close-up)", "5–14 s: wide couple shots, foreground flowers, walking", "14–25 s: emotional close-ups, solo moments", "Last 3 s: calm wide landscape ending"],
    shoot: ["Golden hour or misty weather", "Foreground elements (flowers, window frame) for depth", "Mix wide / medium / close-up; shallow focus on faces"],
    text: "Small white lyric subtitles, lower centre, synced to the vocal phrases.",
    sound: "Emotional romantic song; cut on vocal phrases, fade in and out.",
    grade: "Muted greens, soft highlights, natural skin, light bloom and haze.",
    pacing: "Medium: 1.5–3 s per shot, soft dissolves.",
    effects: [{ type: "saturation", params: { amount: -0.15 } }, { type: "bloom", params: { amount: 0.25 } }, { type: "fade", params: { amount: 0.12 } }],
    transition: "blur-dissolve",
    transitionSec: 0.45,
    kenBurns: false,
    speed: 1,
    overlays: [],
    captions: null,
    musicMood: "cinematic",
    fields: [HANDLE],
  },
  {
    id: "dream-card",
    label: "Dream card + slow motion",
    format: "A black quote card, then a slow-motion glowing clip with a one-word title",
    hook: "A black card with a twist line (“Relax, it was just a dream”).",
    structure: ["0–2 s: black quote card", "2–10 s: slow-motion dance / twirl, title in the centre"],
    shoot: ["Light clothes, backlight or window light", "Spins, hair movement, hands"],
    text: "Serif italic quote; small centred title.",
    sound: "Soft dreamy track.",
    grade: "Bright, glowing highlights, soft grain.",
    pacing: "Very slow (0.5×).",
    effects: [{ type: "bloom", params: { amount: 0.5 } }, { type: "grain", params: { amount: 0.2 } }, { type: "fade", params: { amount: 0.15 } }],
    transition: "fade-white",
    transitionSec: 0.5,
    kenBurns: false,
    speed: 0.5,
    overlays: [{ template: "quote-card", at: "start", seconds: 2, fields: { Quote: "quote" } }, END],
    captions: null,
    musicMood: "lofi",
    fields: [{ key: "quote", label: "Quote", default: "“Relax, it was just a dream”" }, HANDLE],
  },
  {
    id: "lyric-card",
    label: "Minimal lyric card",
    format: "No filming needed: top hook banner + minimal motion graphics with serif lyric lines",
    hook: "“If he sends you this 💓” style banner that makes people send it to someone.",
    structure: ["Whole video: top banner", "Below: colour blocks (black → cream → green) with a star and 3 lyric lines in time with the song"],
    shoot: ["Nothing to film: works on a plain background or any clip"],
    text: "Bold banner text + small subline; elegant serif italic lyrics.",
    sound: "Emotional song; change the lyric line on each vocal phrase.",
    grade: "Flat colours (black, cream, dark green).",
    pacing: "One line every 3 s.",
    effects: [],
    transition: null,
    transitionSec: 0.3,
    kenBurns: false,
    speed: 1,
    overlays: [
      { template: "hook-header", at: "whole", fields: { Header: "hook", Subline: "subline" } },
      { template: "lyric-card", at: "whole", fields: { "Line 1": "line1", "Line 2": "line2", "Line 3": "line3" } },
    ],
    captions: null,
    musicMood: "lofi",
    fields: [
      { key: "hook", label: "Hook", default: "If he sends you this 💓" },
      { key: "subline", label: "Second line", default: "(You won)" },
      { key: "line1", label: "Lyric 1", default: "Tu woh jo…" },
      { key: "line2", label: "Lyric 2", default: "Kaise ye bayaan?" },
      { key: "line3", label: "Lyric 3", default: "Tu na ja…" },
    ],
  },
];

export const REEL_STYLE_BY_ID: ReadonlyMap<string, ReelStyle> = new Map(REEL_STYLES.map((s) => [s.id, s]));

/** Human-readable guide for a style (for the app, the connector and the skill file). */
export function styleGuide(s: ReelStyle): string {
  return [
    `${s.label} — ${s.format}`,
    `Hook: ${s.hook}`,
    `Structure:\n${s.structure.map((x) => `  • ${x}`).join("\n")}`,
    `How to shoot:\n${s.shoot.map((x) => `  • ${x}`).join("\n")}`,
    `Text: ${s.text}`,
    `Sound: ${s.sound}`,
    `Colour: ${s.grade}`,
    `Pacing: ${s.pacing}`,
    `Fields: ${s.fields.map((f) => `${f.key} (${f.label}, e.g. "${f.default}")`).join("; ")}`,
  ].join("\n");
}
