"use client";

import { useEffect, useState } from "react";
import { clearCrashes, crashes, sendReport, usage, type CrashReport, type Usage } from "@/lib/telemetry";

/** On-device crash reports and usage counts. Nothing leaves the phone unless "Send" is tapped. */
export function ProblemsPanel() {
  const [list, setList] = useState<CrashReport[]>([]);
  const [use, setUse] = useState<Usage | null>(null);
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState("");
  useEffect(() => {
    setList(crashes());
    setUse(usage());
  }, []);
  const text = (c: CrashReport) => `${c.message}\n${c.stack}\nwhere: ${c.where} · v${c.version} · ${new Date(c.at).toISOString()}\n${c.browser}`;
  const send = async (c: CrashReport) => {
    setMsg("Sending…");
    try {
      const id = await sendReport(c, note);
      setMsg(`Sent. Report id: ${id}`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    }
  };
  const counts = use ? Object.entries(use.counts).sort((a, b) => b[1] - a[1]) : [];
  return (
    <section id="problems" className="mt-8" aria-labelledby="problems-h" data-testid="problems">
      <h2 id="problems-h" className="mb-1 text-lg font-semibold">
        Problems &amp; usage
      </h2>
      <p className="mb-3 text-sm text-muted">Kept only on this device. A report is sent only when you tap Send, and you can read it first.</p>
      {list.length === 0 ? (
        <p className="text-sm" data-testid="no-crashes">
          No problems recorded. 🎉
        </p>
      ) : (
        <>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="What were you doing? (optional)"
            aria-label="What were you doing?"
            className="mb-2 w-full rounded-xl border border-line bg-surface-2 p-2 text-sm"
            rows={2}
          />
          <ul className="flex flex-col gap-2">
            {list.map((c) => (
              <li key={c.id} className="rounded-xl border border-line bg-surface p-3 text-sm" data-testid="crash-item">
                <p className="font-medium">{c.message}</p>
                <p className="text-xs text-muted">
                  {new Date(c.at).toLocaleString()} · {c.where}
                </p>
                <details className="mt-1">
                  <summary className="cursor-pointer text-xs">Show full report</summary>
                  <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap text-[11px]">{text(c)}</pre>
                </details>
                <div className="mt-2 flex gap-2">
                  <button type="button" className="rounded-lg border border-line px-3 py-1" onClick={() => void navigator.clipboard?.writeText(text(c)).then(() => setMsg("Copied"))}>
                    Copy
                  </button>
                  <button type="button" className="rounded-lg bg-accent px-3 py-1 text-accent-contrast" data-testid="crash-send" onClick={() => void send(c)}>
                    Send
                  </button>
                </div>
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="mt-2 text-sm text-muted underline"
            data-testid="crash-clear"
            onClick={() => {
              clearCrashes();
              setList([]);
            }}
          >
            Clear all
          </button>
        </>
      )}
      {msg && (
        <p className="mt-2 text-sm" role="status" data-testid="crash-msg">
          {msg}
        </p>
      )}
      <h3 className="mb-1 mt-4 text-sm font-semibold">Features you used</h3>
      {counts.length === 0 ? (
        <p className="text-sm text-muted">Nothing yet.</p>
      ) : (
        <dl className="grid grid-cols-2 gap-1 text-sm" data-testid="usage">
          {counts.map(([k, v]) => (
            <div key={k} className="contents">
              <dt>{k}</dt>
              <dd className="text-right tabular-nums">{v}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}
