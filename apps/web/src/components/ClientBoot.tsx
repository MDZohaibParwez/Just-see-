"use client";

import { useEffect } from "react";
import { hydrateLocale } from "@/lib/i18n";
import { hydrateTheme } from "@/lib/theme";
import { installCrashHandlers } from "@/lib/telemetry";

/** Client-only startup: crash capture (on device), saved preferences and the offline service worker. */
export function ClientBoot() {
  useEffect(() => {
    installCrashHandlers();
    hydrateLocale();
    hydrateTheme();
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }
  }, []);
  return null;
}
