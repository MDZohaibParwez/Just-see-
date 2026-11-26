"use client";

import { useEffect, useState } from "react";
import { Icon } from "@just-see/ui";
import { useT } from "@/lib/i18n";
import { startHosting, stopLive, useLive } from "@/lib/live";

/** "Edit together": start a live session, share the invite, see who is in. */
export function LivePanel({ startOpen = false }: { startOpen?: boolean }) {
  const t = useT();
  const [open, setOpen] = useState(startOpen);
  const [link, setLink] = useState("");
  const live = useLive();
  useEffect(() => {
    const on = () => setOpen(true);
    window.addEventListener("justsee:live", on);
    return () => window.removeEventListener("justsee:live", on);
  }, []);
  const start = async () => {
    try {
      setLink(await startHosting());
    } catch {
      // error shown from state
    }
  };
  const shareLink = async () => {
    if (navigator.share) await navigator.share({ title: "Just See", text: t("liveInviteText"), url: link }).catch(() => undefined);
    else await navigator.clipboard?.writeText(link).catch(() => undefined);
  };
  return (
    <>
      {live.role !== "off" && (
        <button type="button" data-testid="live-badge" onClick={() => setOpen(true)} className="fixed right-3 top-14 z-30 flex items-center gap-1 rounded-full bg-danger px-3 py-1 text-xs font-semibold text-white shadow">
          ● {t("liveBadge")} · {live.peers.length + 1}
          {live.pendingMedia > 0 && <span>· ⇣{live.pendingMedia}</span>}
        </button>
      )}
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center" role="dialog" aria-label={t("shareLive")} data-testid="live-panel">
          <div className="w-full max-w-md rounded-t-2xl bg-surface p-4 sm:rounded-2xl">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-semibold">{t("shareLive")}</h2>
              <button type="button" className="flex h-9 w-9 items-center justify-center rounded-full bg-surface-2" aria-label={t("done")} onClick={() => setOpen(false)} data-testid="live-close">
                <Icon name="close" size={18} />
              </button>
            </div>
            {live.role === "off" && (
              <>
                <p className="mb-3 text-sm text-muted">{t("liveIntro")}</p>
                <button type="button" data-testid="live-start" className="w-full rounded-xl bg-accent py-3 font-semibold text-accent-contrast" onClick={() => void start()}>
                  {live.status === "connecting" ? "…" : t("liveStart")}
                </button>
              </>
            )}
            {live.role === "host" && (
              <>
                <p className="mb-2 text-sm">{t("liveSendLink")}</p>
                <input readOnly value={link} data-testid="live-link" className="mb-2 w-full rounded-lg bg-surface-2 px-2 py-2 text-xs" onFocus={(e) => e.currentTarget.select()} />
                <button type="button" className="mb-3 w-full rounded-xl bg-accent py-3 text-accent-contrast" onClick={() => void shareLink()}>
                  {t("share")}
                </button>
                <p className="mb-3 text-xs text-muted">{t("liveKeepOpen")}</p>
              </>
            )}
            {live.role !== "off" && (
              <>
                <p className="mb-1 text-xs uppercase tracking-wide text-muted">{t("livePeople")}</p>
                <ul className="mb-3 text-sm" data-testid="live-peers">
                  <li>• {t("liveYou")}</li>
                  {live.peers.map((p, i) => (
                    <li key={i}>• {p}</li>
                  ))}
                </ul>
                <button type="button" data-testid="live-stop" className="w-full rounded-xl border border-line py-3 text-sm" onClick={() => void stopLive().then(() => setOpen(false))}>
                  {t("liveStop")}
                </button>
              </>
            )}
            {live.status === "error" && <p className="mt-2 text-sm text-danger">{live.error}</p>}
          </div>
        </div>
      )}
    </>
  );
}
