# Architecture

Just See runs on **one project model** and **one render engine**. Preview,
export and (later) the Claude connector all go through the same code, so they
always produce the same result.

```
                ┌──────────────────────────────────────────┐
                │  packages/schema                         │
                │  Project JSON (Zod) · commands · history │
                └───────────────▲──────────────────────────┘
                                │ Command {type, payload}
     ┌──────────────────────────┼──────────────────────────┐
     │                          │                          │
┌────┴─────────┐        ┌───────┴───────┐        ┌─────────┴─────────┐
│ apps/web     │        │ mcp-server    │        │ render-worker     │
│ editor + PWA │        │ (Phase 6)     │        │ (Phase 6)         │
└────┬─────────┘        └───────────────┘        └─────────┬─────────┘
     │                                                     │
     └──────────────►  packages/engine  ◄──────────────────┘
          resolveFrame(project, t) → FramePlan → Compositor (WebGL2)
          resolveAudio(project)    → segments  → mixSegments → PCM
```

## Packages

| Path | What it holds |
| --- | --- |
| `packages/schema` | Project document types and Zod schemas, time helpers, timeline math, the command system, undo/redo history |
| `packages/engine` | Frame resolver, WebGL2 compositor, 30 effects, 20 transitions, text rasteriser, MP4 demux + WebCodecs decode, audio mixer, MP4 export |
| `packages/ui` | The Just See icon set |
| `apps/web` | Next.js app (static export), editor UI, on-device storage, preview player, PWA |

Planned: `apps/mcp-server`, `apps/render-worker` (Phase 6), `packages/dsp` (Rust → WASM, Phase 3).

## Project document

`packages/schema/src/model.ts`. Versioned (`schemaVersion: 1`) and validated with Zod when loaded.

- **Time** is always integer **microseconds** (`startUs`, `durationUs`, `sourceInUs`). No floating-point drift.
- **Project** → `assets[]` + `sequences[]`.
- **Sequence** → canvas `width/height/fps`, `background`, `tracks[]` (drawn bottom to top).
- **Track** types: `main` (exactly one, magnetic), `video` (overlays), `text`, `audio`.
- **Clip** kinds: `video`, `image`, `audio` (media clips: `assetId`, `sourceInUs`, `speed`, `volume`, `transform`, `effects`, `transitionIn`, fades) and `text`.
- **Transform** positions are fractions of the canvas, so a layout survives a resolution or aspect change.
- **Asset** stores display size, container rotation, duration, and a `license` (user uploads are `user-upload`, commercial use allowed).

### Main track rules

Clips sit back to back from 0 in array order. A `transitionIn` on clip *n*
makes it overlap clip *n−1* by the transition length (so a transition shortens
the timeline). Transitions are clamped to half the shorter neighbour. These
rules are applied by `normalizeMainTrack` after every command.

## Commands, undo and autosave

`packages/schema/src/commands.ts`.

- Every edit is a JSON command: `clip/add`, `clip/split`, `clip/trim`, `clip/move`, `clip/setSpeed`, `clip/setTransition`, `clip/addEffect`, `clip/update`, `sequence/update`, `asset/add`, … and `batch`.
- `applyCommand(project, command)` is pure. It validates the payload with Zod, applies it to a copy, and returns the new project plus an **inverse** command (`internal/restore` with the previous state of only the parts that changed).
- `history.ts` keeps `past`/`future` stacks of `{command, inverse}`. Undo applies the inverse; redo replays the command. Unlimited in practice (500 steps in memory; older states live in version history).
- During a drag, the UI calls `preview(command)` to show the result without recording it, then dispatches the final command once on release, so one gesture = one undo step.
- The MCP connector (Phase 6) will call the same `applyCommand`.

**Autosave** (`apps/web/src/lib/autosave.ts`): every committed change is written to IndexedDB after 350 ms, and immediately when the tab is hidden or closed. **Crash recovery** is therefore just "open the project": the last saved state loads. **Version history** keeps an automatic snapshot every 3 minutes of editing plus manual "Save version", 30 per project.

## Render engine

### Frame resolver

`resolveFrame(project, t)` returns a `FramePlan`: background colour plus an
ordered list of layers. A layer is a media layer (asset, source time,
transform, opacity, effects), a text layer (with animation state), or a
transition layer (`from`, `to`, eased progress). Pure and unit-tested.

### Compositor

`packages/engine/src/gl/compositor.ts`, WebGL2.

1. Clear the accumulation target to the background colour.
2. For each layer: draw the source into a scratch target with its placement matrix (contain-fit, then scale/rotate/translate/flip), run its effect passes (ping-pong), then blend it onto the accumulation target with premultiplied alpha.
3. Transitions render both sides, then mix them with the transition shader.
4. Present to the canvas.

Every effect and transition is a GLSL ES 3.00 shader (`effects/catalog.ts`,
`transitions/catalog.ts`). Sizes in shaders are relative to the frame, so a
720p preview and a 4K export look the same. A diagnostics page
(`/diagnostics`) compiles all of them; an E2E test checks it.

WebGPU is planned as the primary path later, with this WebGL2 path as fallback.

### Text

Rasterised with Canvas 2D at the output resolution, then composited like any
other layer. The browser's own shaper handles Devanagari, Nastaliq and Gujarati
today; HarfBuzz (WASM) comes in Phase 2 for full control. Typewriter animation
splits by grapheme (`Intl.Segmenter`) so conjuncts stay whole.

## Media pipeline

- **Import** (`apps/web/src/lib/media.ts`): read metadata (mp4box for rotation, fps, audio presence; a media element for display size and duration), store the original file on the device, add an asset.
- **Storage**: originals in **OPFS** (`media/<assetId>`), with an IndexedDB fallback where OPFS cannot be written. Projects, versions, thumbnails and peaks in IndexedDB.
- **Thumbnails** (JPEG strip) and **audio peaks** are computed once and cached in IndexedDB.
- **Proxies** (540p) are planned for Phase 2. Phase 1 previews from the originals.

## Preview vs export

| | Preview (`apps/web/src/lib/playback.ts`) | Export (`packages/engine/src/export/exporter.ts`) |
| --- | --- | --- |
| Video frames | `<video>` elements, seeked or playing (hardware decode, instant seeking) | mp4box demux → WebCodecs `VideoDecoder`, frame-exact |
| Images | `ImageBitmap` | `ImageBitmap` |
| Compositing | Shared `Compositor` | Shared `Compositor` (OffscreenCanvas) |
| Audio | Media elements, volume per clip, fades | Decoded PCM, mixed in JS (`mixSegments`), `AudioEncoder` |
| Output | Canvas | `VideoEncoder` → `mp4-muxer` → MP4 |

Export picks the best codec the device supports: H.264 High → Main → Baseline
→ VP9 → AV1 for video, AAC → Opus for audio (desktop Linux Chrome has no AAC
encoder, so it gets Opus inside the MP4). Phone videos with a rotation flag are
rotated in the shader during export; the `<video>` element already rotates
them in preview.

Known Phase 1 limits:

- Speed changes resample audio, so pitch follows speed in both preview and export. Pitch-preserving time-stretch comes with the audio DSP in Phase 3.
- Clip gain above 100% is heard in export but capped at 100% in preview.
- Export runs on the main thread. Moving it to a worker is planned.

## Web app

- Next.js App Router, **static export** (`output: "export"`). Everything runs on the device; no server is needed in Phase 1.
- State: Zustand store (`editor-store.ts`) holding the history, a transient drag draft, playhead, zoom, selection and the open panel.
- Layout: mobile first (preview, transport, timeline, bottom toolbar, bottom sheets). From 1024 px wide, panels open as a side column.
- Timeline: custom pointer handling (pan to scrub with fling, pinch to zoom, trim handles, drag to move, snapping with haptic tick). The playhead is fixed in the centre.
- i18n: English and Hindi (`lib/i18n.ts`), saved per device.
- Themes: dark (default) and light, one accent colour (saffron).
- PWA: `manifest.webmanifest` + `sw.js` (app shell offline, hashed assets cache-first).

## Tests

- `packages/schema`: commands, ripple/trim/split math, transitions, undo/redo round-trips, validation, frame math, snapping.
- `packages/engine`: frame resolver, text animation, audio mix, layout matrices, rotation, catalogs, codec selection.
- `apps/web/e2e` (Playwright, Pixel 7 emulation): smoke + shader compile, editing flow with autosave/reload, transitions, and the Phase 1 acceptance test (60 s 9:16 reel with 5 clips, text and music, exported and checked with ffprobe and pixel comparisons).
