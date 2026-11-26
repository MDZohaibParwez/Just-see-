import { describe, expect, it } from "vitest";
import { EFFECTS, REEL_STYLES, TEMPLATE_BY_ID, TRANSITIONS, MOODS, styleGuide } from "./index";

describe("reel styles", () => {
  it("only use effects, transitions, moods and templates that exist", () => {
    expect(REEL_STYLES.length).toBeGreaterThanOrEqual(9);
    for (const s of REEL_STYLES) {
      for (const e of s.effects) expect(EFFECTS.some((x) => x.type === e.type), `${s.id}: ${e.type}`).toBe(true);
      if (s.transition) expect(TRANSITIONS.some((x) => x.type === s.transition), `${s.id}: ${s.transition}`).toBe(true);
      if (s.musicMood) expect(MOODS.some((m) => m.id === s.musicMood), s.id).toBe(true);
      for (const o of s.overlays) {
        const t = TEMPLATE_BY_ID.get(o.template);
        expect(t, `${s.id}: ${o.template}`).toBeTruthy();
        const comp = t!.build((p) => `${p}1`, { width: 1080, height: 1920 });
        for (const [label, key] of Object.entries(o.fields)) {
          expect(comp.editable.some((e) => e.label === label), `${s.id}/${o.template}: label ${label}`).toBe(true);
          expect(s.fields.some((f) => f.key === key), `${s.id}: field ${key}`).toBe(true);
        }
      }
      expect(styleGuide(s)).toContain("Hook:");
    }
  });
});
