"use client";

import { useEffect } from "react";
import { hydrateLocale } from "@/lib/i18n";
import { hydrateTheme } from "@/lib/theme";

/** Client-only startup: saved preferences and the offline service worker. */
export function ClientBoot() {
  useEffect(() => {
    hydrateLocale();
    hydrateTheme();
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }
  }, []);
  return null;
}
