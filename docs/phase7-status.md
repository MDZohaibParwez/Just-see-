# Phase 7 status — Polish

Everything stays free. No new dependencies and no third-party analytics or crash service.

## Done-when check: performance budgets

Measured by `apps/web/e2e/phase7-perf.spec.ts` (Pixel 7 emulation). The test machine has **no GPU**: WebGL runs on the CPU (SwiftShader), so the preview-fps line is confirmed on a real phone with the **Speed test** on `/diagnostics`.

| Budget (README) | Result |
| --- | --- |
| App shell loads in under 3 s on 4G | ✅ Home interactive in **2.1–2.2 s** on *slow* 4G (1.6 Mbps, 150 ms RTT) with a 4× slower CPU; editor opens in **0.8 s** after that |
| Scrub latency under 100 ms | ✅ p95 **≈ 20 ms** from scrub to new frame (3 video layers) |
| 1080p preview at 30 fps, 3 video layers + effects (mid-range Android) | 🟡 Needs the phone check: on the CPU-only test box it reaches **15 fps** (was 10 fps before this phase); with real GPUs uploads are cheap. Adaptive preview quality keeps playback smooth on slow phones |
| 50+ tracks without lag (desktop) | ✅ 53 tracks: an edit is on screen in **13–18 ms**, vertical scroll **60 fps** |
| 60 fps UI animation | ✅ **57–58 fps** while opening and closing panels |
| WCAG AA contrast · screen-reader labels on every control | ✅ `phase7-a11y.spec.ts`: home, editor, 9 panels, text, Library, Studio, Motion, Device check, in dark and light |
| First edit finished in under 60 s | ✅ `phase7-onboarding.spec.ts`: Quick reel with 3 clips is ready to export in **≈ 6 s**; the 30 s MP4 then saves and checks out with ffprobe (encode time depends on the phone's encoder) |

## Features

| Feature | Status | Notes |
| --- | --- | --- |
| Lazy-loaded screens and panels | ✅ | Editor download 431 → 357 kB (gzip) |
| Skip re-upload of unchanged video frames | ✅ | `requestVideoFrameCallback` |
| Adaptive playback quality | ✅ | Down to 50 % while playing on slow devices; full quality on pause |
| Memoised timeline rows | ✅ | |
| Overlay (picture-in-picture) button | ✅ | New in this phase; also needed for the 3-layer test |
| Speed test on `/diagnostics` | ✅ | |
| Accessibility audit (own code) | ✅ | No MPL/GPL audit engine used |
| Esc closes Library / Studio / Motion | ✅ | |
| Quick reel | ✅ | |
| First-run tips | ✅ | Shown once per device |
| Usage counts (on device) | ✅ | Feature names only |
| Crash reports (on device, send on tap) | ✅ | File names, links and emails are scrubbed; sent reports auto-delete after 30 days |

## Phone check (owner)

1. Open `https://just-see-one.vercel.app/diagnostics/` on the phone → **Run speed test**. Goal: ✅ 30 fps or more.
2. Home → **Quick reel** → pick 3 videos → reel opens with music and Export → export and save.
3. Switch to light theme (settings) and check that buttons and labels are easy to read.
4. Device check page → **Problems & usage** shows your feature counts.

## Needs the owner

- **Vercel Blob store** (from Phase 6): still waiting for the usage counter to fall under 1 GB after `clipforge-clips` was deleted. Share links, cloud backups, the connector and "Send report" need it.
