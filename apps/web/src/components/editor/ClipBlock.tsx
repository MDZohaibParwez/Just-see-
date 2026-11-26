"use client";

import { memo, useEffect, useRef, useState } from "react";
import { formatTimecode, isMediaClip, type Asset, type Clip } from "@just-see/schema";
import { getPeaks, getThumbnails, PEAKS_PER_SECOND, type Thumb } from "@/lib/media";

interface Props {
  clip: Clip;
  asset: Asset | undefined;
  pps: number;
  height: number;
  selected: boolean;
  trackColor: string;
}

function Thumbs({ asset, clip, pps, height }: { asset: Asset; clip: Clip; pps: number; height: number }) {
  const [thumbs, setThumbs] = useState<Thumb[]>([]);
  useEffect(() => {
    let alive = true;
    void getThumbnails(asset).then((t) => alive && setThumbs(t)).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [asset]);
  if (!thumbs.length || !isMediaClip(clip)) return null;
  const tileW = Math.max(16, Math.round((asset.width / Math.max(1, asset.height)) * height));
  const width = (clip.durationUs / 1e6) * pps;
  const count = Math.min(200, Math.ceil(width / tileW));
  const tiles = [];
  for (let i = 0; i < count; i++) {
    const timelineUs = ((i * tileW + tileW / 2) / pps) * 1e6;
    const srcUs = clip.sourceInUs + timelineUs * clip.speed;
    let best = thumbs[0]!;
    for (const th of thumbs) if (Math.abs(th.timeUs - srcUs) < Math.abs(best.timeUs - srcUs)) best = th;
    tiles.push(
      // eslint-disable-next-line @next/next/no-img-element
      <img key={i} src={best.url} alt="" draggable={false} className="h-full shrink-0 object-cover" style={{ width: tileW }} />,
    );
  }
  return <div className="pointer-events-none absolute inset-0 flex overflow-hidden opacity-90">{tiles}</div>;
}

function Wave({ asset, clip, pps, height }: { asset: Asset; clip: Clip; pps: number; height: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [peaks, setPeaks] = useState<Float32Array | null>(null);
  useEffect(() => {
    let alive = true;
    void getPeaks(asset).then((p) => alive && setPeaks(p));
    return () => {
      alive = false;
    };
  }, [asset]);
  const width = Math.max(1, Math.min(16000, Math.round((clip.durationUs / 1e6) * pps)));
  useEffect(() => {
    const c = ref.current;
    if (!c || !peaks || !isMediaClip(clip)) return;
    c.width = width;
    c.height = height;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    const mid = height / 2;
    const buckets = peaks.length / 2;
    for (let x = 0; x < width; x++) {
      const srcSec = (clip.sourceInUs + ((x / pps) * 1e6) * clip.speed) / 1e6;
      const b = Math.floor(srcSec * PEAKS_PER_SECOND);
      if (b < 0 || b >= buckets) continue;
      const min = peaks[b * 2] ?? 0;
      const max = peaks[b * 2 + 1] ?? 0;
      const y1 = mid - max * mid * 0.95;
      const y2 = mid - min * mid * 0.95;
      ctx.fillRect(x, y1, 1, Math.max(1, y2 - y1));
    }
  }, [peaks, width, height, clip, pps]);
  return <canvas ref={ref} className="pointer-events-none absolute inset-0 h-full" style={{ width }} aria-hidden />;
}

export const ClipBlock = memo(function ClipBlock({ clip, asset, pps, height, selected, trackColor }: Props) {
  const width = Math.max(2, (clip.durationUs / 1e6) * pps);
  const label =
    clip.kind === "text"
      ? clip.text.replace(/\n/g, " ")
      : `${asset?.name ?? ""}${isMediaClip(clip) && clip.speed !== 1 ? ` · ${clip.speed}×` : ""}`;
  return (
    <div
      className="absolute top-0 overflow-hidden rounded-md"
      style={{
        left: (clip.startUs / 1e6) * pps,
        width,
        height,
        background: trackColor,
        boxShadow: selected ? "inset 0 0 0 2px var(--accent)" : "inset 0 0 0 1px rgba(255,255,255,0.08)",
      }}
      data-role="clip"
      data-clip-id={clip.id}
      data-testid="timeline-clip"
      data-kind={clip.kind}
      role="button"
      aria-pressed={selected}
      aria-label={`${clip.kind} ${label} ${formatTimecode(clip.durationUs)}`}
    >
      {asset && (clip.kind === "video" || clip.kind === "image") && <Thumbs asset={asset} clip={clip} pps={pps} height={height} />}
      {asset && clip.kind === "audio" && <Wave asset={asset} clip={clip} pps={pps} height={height} />}
      <div className="pointer-events-none absolute left-1 top-0.5 max-w-full truncate rounded bg-black/65 px-1 text-[10px] font-medium leading-4 text-white">
        {label || " "}
      </div>
      {isMediaClip(clip) && clip.effects.length > 0 && (
        <div className="pointer-events-none absolute bottom-0.5 left-1 rounded bg-black/65 px-1 text-[10px] leading-4 text-white">
          fx {clip.effects.length}
        </div>
      )}
      <div className="pointer-events-none absolute bottom-0.5 right-1 rounded bg-black/65 px-1 text-[10px] leading-4 text-white">
        {formatTimecode(clip.durationUs)}
      </div>
      {Object.keys(clip.keyframes ?? {}).length > 0 && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-3" aria-hidden>
          {[...new Set(Object.values(clip.keyframes).flatMap((k) => k.map((kf) => kf.t)))].map((t) => (
            <span
              key={t}
              data-testid="keyframe-marker"
              className="absolute bottom-0.5 h-2 w-2 -translate-x-1 rotate-45 bg-accent"
              style={{ left: (t / 1e6) * pps }}
            />
          ))}
        </div>
      )}
      {selected && (
        <>
          <div
            data-role="handle-start"
            data-clip-id={clip.id}
            aria-label="Trim start"
            className="absolute inset-y-0 left-0 flex w-4 items-center justify-center bg-accent"
          >
            <span className="pointer-events-none h-1/2 w-0.5 rounded bg-accent-contrast/70" />
          </div>
          <div
            data-role="handle-end"
            data-clip-id={clip.id}
            aria-label="Trim end"
            className="absolute inset-y-0 right-0 flex w-4 items-center justify-center bg-accent"
          >
            <span className="pointer-events-none h-1/2 w-0.5 rounded bg-accent-contrast/70" />
          </div>
        </>
      )}
    </div>
  );
});
