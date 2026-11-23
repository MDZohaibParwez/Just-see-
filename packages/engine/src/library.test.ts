import { describe, expect, it } from "vitest";
import { FONT_CATALOG, SFX, ZipWriter, googleFontCssUrl, readZip, scoreItem, searchItems } from "./index";

describe("library search", () => {
  const items = [
    { label: "Rain", tags: ["barish", "weather"], kind: "sound" },
    { label: "Lo-fi / Chill", tags: ["study", "calm"], kind: "music" },
    { label: "Poppins", tags: ["modern", "title"], kind: "font" },
    { label: "Applause", tags: ["taali", "clap"], kind: "sound" },
  ];
  it("matches labels, tags, kinds and Hindi words", () => {
    expect(searchItems("rain", items)[0]!.label).toBe("Rain");
    expect(searchItems("barish", items)[0]!.label).toBe("Rain");
    expect(searchItems("lofi", items).map((x) => x.label)).toContain("Lo-fi / Chill");
    expect(searchItems("taali", items)[0]!.label).toBe("Applause");
    expect(searchItems("font", items)[0]!.label).toBe("Poppins");
    expect(searchItems("popins", items)[0]!.label).toBe("Poppins"); // typo
  });
  it("every query word must match", () => {
    expect(scoreItem("rain clap", items[0]!)).toBe(0);
    expect(searchItems("", items)).toHaveLength(4);
  });
  it("finds real catalog entries", () => {
    expect(searchItems("whoosh", SFX).length).toBeGreaterThan(2);
    expect(searchItems("hindi", FONT_CATALOG.map((f) => ({ label: f.family, tags: f.tags, kind: f.category }))).length).toBeGreaterThan(5);
    expect(new Set(FONT_CATALOG.map((f) => f.family)).size).toBe(FONT_CATALOG.length);
  });
  it("builds Google Fonts URLs", () => {
    expect(googleFontCssUrl("Baloo 2", [700, 400])).toBe("https://fonts.googleapis.com/css2?family=Baloo+2:wght@400;700&display=swap");
  });
});

describe("zip round trip", () => {
  it("reads what ZipWriter writes", async () => {
    const z = new ZipWriter();
    const a = new TextEncoder().encode('{"hello":"दुनिया"}');
    const b = new Uint8Array(100_000).map((_, i) => i % 251);
    z.add("project.json", a);
    z.add("media/a_1", b);
    const bytes = new Uint8Array(await z.finish().arrayBuffer());
    const files = readZip(bytes);
    expect(new TextDecoder().decode(files.get("project.json")!)).toBe('{"hello":"दुनिया"}');
    expect(files.get("media/a_1")!.length).toBe(100_000);
    expect(files.get("media/a_1")![300]).toBe(300 % 251);
    bytes[200] = (bytes[200] ?? 0) ^ 0xff;
    expect(() => readZip(bytes)).toThrow();
  });
});
