"use client";

import { Icon } from "@just-see/ui";
import { useLocale, useT } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";

/** Theme and language toggles. */
export function Prefs() {
  const t = useT();
  const { theme, setTheme } = useTheme();
  const { locale, setLocale } = useLocale();
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        className="flex h-10 items-center gap-1 rounded-full px-3 text-sm text-muted hover:bg-surface-2"
        onClick={() => setLocale(locale === "en" ? "hi" : "en")}
        aria-label={t("language")}
      >
        <Icon name="globe" size={18} />
        {locale === "en" ? "हिंदी" : "English"}
      </button>
      <button
        type="button"
        className="flex h-10 w-10 items-center justify-center rounded-full text-muted hover:bg-surface-2"
        onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
        aria-label={`${t("theme")}: ${theme === "dark" ? t("light") : t("dark")}`}
      >
        <Icon name={theme === "dark" ? "sun" : "moon"} size={20} />
      </button>
    </div>
  );
}
