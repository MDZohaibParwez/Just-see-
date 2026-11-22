"use client";

import { create } from "zustand";

export type Theme = "dark" | "light";

interface ThemeState {
  theme: Theme;
  setTheme: (t: Theme) => void;
}

export const useTheme = create<ThemeState>((set) => ({
  theme: "dark",
  setTheme: (theme) => {
    try {
      localStorage.setItem("js.theme", theme);
    } catch {
      // ignore
    }
    if (typeof document !== "undefined") document.documentElement.dataset.theme = theme;
    set({ theme });
  },
}));

export function hydrateTheme(): void {
  let t: Theme = "dark";
  try {
    const saved = localStorage.getItem("js.theme");
    if (saved === "light" || saved === "dark") t = saved;
  } catch {
    // ignore
  }
  useTheme.getState().setTheme(t);
}

/** Light haptic tick where supported (Android). */
export function haptic(ms = 8): void {
  try {
    navigator.vibrate?.(ms);
  } catch {
    // ignore
  }
}
