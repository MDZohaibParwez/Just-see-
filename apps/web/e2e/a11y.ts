import type { Page } from "@playwright/test";

export interface A11yIssue {
  rule: "name" | "contrast" | "alt";
  what: string;
  detail?: string;
}

/**
 * Small in-house accessibility audit (no third-party engine):
 * - every visible control has an accessible name,
 * - every visible image has alt text,
 * - visible text meets WCAG AA contrast (4.5:1, or 3:1 for large text).
 */
export async function audit(page: Page): Promise<A11yIssue[]> {
  return page.evaluate(() => {
    const issues: { rule: "name" | "contrast" | "alt"; what: string; detail?: string }[] = [];
    const visible = (el: Element) => {
      const r = (el as HTMLElement).getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return false;
      const cs = getComputedStyle(el);
      if (cs.visibility === "hidden" || cs.display === "none" || Number(cs.opacity) === 0) return false;
      if ((el as HTMLElement).closest("[aria-hidden='true'],[hidden],.sr-only")) return false;
      return true;
    };
    const describe = (el: Element) => {
      const h = el as HTMLElement;
      const id = h.dataset.testid ? `[data-testid=${h.dataset.testid}]` : "";
      return `${el.tagName.toLowerCase()}${id} "${(h.innerText || h.getAttribute("value") || "").trim().slice(0, 30)}"`;
    };
    const nameOf = (el: Element): string => {
      const h = el as HTMLElement;
      const label = h.getAttribute("aria-label");
      if (label?.trim()) return label;
      const by = h.getAttribute("aria-labelledby");
      if (by) return by.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? "").join(" ");
      if (h.id) {
        const l = document.querySelector(`label[for="${CSS.escape(h.id)}"]`);
        if (l?.textContent?.trim()) return l.textContent;
      }
      const wrap = h.closest("label");
      if (wrap?.textContent?.trim()) return wrap.textContent;
      if (h.title?.trim()) return h.title;
      if ((h as HTMLInputElement).placeholder?.trim()) return (h as HTMLInputElement).placeholder;
      if (h instanceof HTMLInputElement && ["button", "submit"].includes(h.type)) return h.value;
      const text = h.textContent?.trim() ?? "";
      if (text) return text;
      const img = h.querySelector("img[alt],svg[aria-label]");
      return img?.getAttribute("alt") ?? img?.getAttribute("aria-label") ?? "";
    };
    const controls = document.querySelectorAll("button, a[href], input:not([type=hidden]), select, textarea, [role=button], [role=slider], [role=tab], [role=switch], [role=radio], [role=checkbox]");
    for (const el of controls) {
      if (!visible(el)) continue;
      if (!nameOf(el).trim()) issues.push({ rule: "name", what: describe(el) });
    }
    for (const img of document.querySelectorAll("img")) {
      if (visible(img) && !img.hasAttribute("alt")) issues.push({ rule: "alt", what: img.src.slice(-40) });
    }
    // Contrast.
    const parse = (c: string): [number, number, number, number] | null => {
      const m = c.match(/rgba?\(([^)]+)\)/);
      if (!m) {
        // color(srgb r g b / a) and other forms
        const s = c.match(/color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)(?: \/ ([\d.]+))?\)/);
        if (s) return [Number(s[1]) * 255, Number(s[2]) * 255, Number(s[3]) * 255, s[4] === undefined ? 1 : Number(s[4])];
        // oklab(L a b / alpha), as Tailwind 4 writes colours with opacity.
        const o = c.match(/oklab\(([-\d.]+%?) ([-\d.e]+) ([-\d.e]+)(?: \/ ([\d.]+%?))?\)/);
        if (o) {
          const L = o[1]!.endsWith("%") ? parseFloat(o[1]!) / 100 : Number(o[1]);
          const A = Number(o[2]);
          const B = Number(o[3]);
          const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
          const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
          const k = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
          const lin = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * k, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * k, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * k];
          const enc = (v: number) => 255 * Math.min(1, Math.max(0, v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055));
          const alpha = o[4] === undefined ? 1 : o[4].endsWith("%") ? parseFloat(o[4]) / 100 : Number(o[4]);
          return [enc(lin[0]!), enc(lin[1]!), enc(lin[2]!), alpha];
        }
        return null;
      }
      const p = m[1]!.split(/[\s,/]+/).filter(Boolean).map(Number);
      return [p[0]!, p[1]!, p[2]!, p[3] ?? 1];
    };
    const lum = ([r, g, b]: number[]) => {
      const f = (v: number) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * f(r!) + 0.7152 * f(g!) + 0.0722 * f(b!);
    };
    const blend = (top: number[], under: number[]) => {
      const a = top[3]!;
      return [top[0]! * a + under[0]! * (1 - a), top[1]! * a + under[1]! * (1 - a), top[2]! * a + under[2]! * (1 - a), 1];
    };
    const bgOf = (el: Element): number[] | null => {
      const stack: number[][] = [];
      let n: Element | null = el;
      while (n) {
        const cs = getComputedStyle(n);
        if (cs.backgroundImage && cs.backgroundImage !== "none") return null; // gradients/images: skip
        const c = parse(cs.backgroundColor);
        if (c && c[3] > 0) {
          stack.push(c);
          if (c[3] >= 1) break;
        }
        n = n.parentElement;
      }
      let base = [255, 255, 255, 1];
      const root = parse(getComputedStyle(document.body).backgroundColor);
      if (root && root[3] >= 1) base = root;
      for (let i = stack.length - 1; i >= 0; i--) base = blend(stack[i]!, base);
      return base;
    };
    const seen = new Set<string>();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let t = walker.nextNode(); t; t = walker.nextNode()) {
      if (!t.textContent?.trim()) continue;
      const el = t.parentElement;
      if (!el || !visible(el)) continue;
      if (el.closest("canvas,video,[data-no-contrast]")) continue;
      const cs = getComputedStyle(el);
      const fg = parse(cs.color);
      const bg = bgOf(el);
      if (!fg || !bg) continue;
      const fgc = fg[3] < 1 ? blend(fg, bg) : fg;
      // Disabled controls are exempt in WCAG.
      if (el.closest("button:disabled,[aria-disabled=true],input:disabled")) continue;
      const opacity = (() => {
        let o = 1;
        for (let n: Element | null = el; n; n = n.parentElement) o *= Number(getComputedStyle(n).opacity);
        return o;
      })();
      const fgFinal = opacity < 1 ? blend([...fgc.slice(0, 3), opacity], bg) : fgc;
      const L1 = lum(fgFinal);
      const L2 = lum(bg);
      const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
      const size = parseFloat(cs.fontSize);
      const bold = Number(cs.fontWeight) >= 700;
      const large = size >= 24 || (bold && size >= 18.66);
      const need = large ? 3 : 4.5;
      if (ratio < need) {
        const key = `${describe(el)}|${cs.color}|${ratio.toFixed(2)}`;
        if (!seen.has(key)) {
          seen.add(key);
          issues.push({ rule: "contrast", what: describe(el), detail: `${ratio.toFixed(2)} < ${need} (${cs.color} on rgb(${bg.slice(0, 3).map(Math.round).join(",")}))` });
        }
      }
    }
    return issues;
  });
}
