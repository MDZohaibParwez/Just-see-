import { describe, expect, it } from "vitest";
import { applyCommand, createProject, getSequence, type Project } from "@just-see/schema";
import { captionCommands, devanagariToHinglish, groupCaptions, isFillerWord, type TranscriptWord } from "./index";

const w = (text: string, s: number, e: number): TranscriptWord => ({ text, startUs: s * 1e6, endUs: e * 1e6 });

describe("caption grouping", () => {
  it("breaks on word count, pauses and sentence ends", () => {
    const words = [w("Hello", 0, 0.3), w("everyone.", 0.3, 0.8), w("Today", 0.9, 1.2), w("we", 1.2, 1.3), w("cook", 1.3, 1.6), w("rice", 3, 3.4)];
    const lines = groupCaptions(words);
    expect(lines.map((l) => l.words.map((x) => x.text).join(" "))).toEqual(["Hello everyone.", "Today we cook", "rice"]);
  });
});

describe("Hinglish transliteration", () => {
  it.each([
    ["नमस्ते", "namaste"],
    ["दोस्तों", "doston"],
    ["आज", "aaj"],
    ["हम", "ham"],
    ["खाना", "khaanaa"],
    ["बनाएंगे", "banaaenge"],
    ["क्या", "kyaa"],
    ["ज़िंदगी", "zindagee"],
    ["२०२६", "2026"],
  ])("%s → %s", (dev, latin) => {
    expect(devanagariToHinglish(dev)).toBe(latin);
  });

  it("keeps Latin words and punctuation", () => {
    expect(devanagariToHinglish("Hello दोस्तों!")).toBe("Hello doston!");
  });
});

describe("fillers", () => {
  it("knows English, Hinglish and Hindi fillers", () => {
    expect(isFillerWord("Um,")).toBe(true);
    expect(isFillerWord("matlab")).toBe(true);
    expect(isFillerWord("मतलब")).toBe(true);
    expect(isFillerWord("video")).toBe(false);
  });
});

describe("caption clips", () => {
  it("creates karaoke text clips on one track", () => {
    const lines = groupCaptions([w("नमस्ते", 0.2, 0.6), w("दोस्तों", 0.6, 1.1), w("आज", 1.6, 1.8)], { gapUs: 300_000 });
    let p: Project = createProject({});
    for (const c of captionCommands(lines, { language: "hinglish", trackId: "cap", groupId: "g" })) p = applyCommand(p, c).project;
    const track = getSequence(p).tracks.find((t) => t.id === "cap")!;
    expect(track.clips).toHaveLength(2);
    const first = track.clips[0]!;
    expect(first.kind).toBe("text");
    if (first.kind === "text") {
      expect(first.text).toBe("namaste doston");
      expect(first.words[1]).toMatchObject({ text: "doston", startUs: 400_000, endUs: 900_000 });
      expect(first.captionGroup).toBe("g");
    }
  });
});
