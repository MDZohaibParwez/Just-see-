"use client";

import { useEffect } from "react";
import { recordCrash } from "@/lib/telemetry";

/** Shown if a screen crashes. Work is autosaved, so a reload is safe. */
export default function ErrorScreen({ error, reset }: { error: Error; reset: () => void }) {
  useEffect(() => {
    recordCrash(error, "screen");
  }, [error]);
  return (
    <main className="mx-auto flex min-h-full max-w-md flex-col items-center justify-center gap-4 p-6 text-center" role="alert" data-testid="crash-screen">
      <h1 className="text-xl font-bold">Something went wrong</h1>
      <p className="text-muted">Your work is saved on this device. Reloading usually fixes it.</p>
      <div className="flex gap-2">
        <button type="button" className="rounded-xl bg-accent px-4 py-2 font-semibold text-accent-contrast" onClick={() => window.location.reload()}>
          Reload
        </button>
        <button type="button" className="rounded-xl border border-line px-4 py-2" onClick={reset}>
          Try again
        </button>
      </div>
      <a href="/diagnostics/#problems" className="text-sm text-accent-strong underline">
        See or send the problem report
      </a>
    </main>
  );
}
