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

Also: `apps/api` (Phase 6: share links, connector, render jobs; one free Vercel Function), `packages/dsp` (Rust → WASM, Phase 3).

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
- The MCP connector (Phase 6) edits recipes that the browser turns into the same commands.

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

## Phase 2 additions

- **Keyframes** (`schema/src/keyframes.ts`): per-clip map of property → sorted keyframes in clip-local µs. `resolveFrame` samples them (`animatedTransform`, `animatedCrop`, `animatedEffects`); the mixer samples `volume`. Split and trim cut keyframes so values stay continuous.
- **Speed ramps**: piecewise-linear multipliers over the clip; `sourceOffsetAt` integrates them (and handles reverse and freeze frames). Preview drives `playbackRate` per frame; export reads exact source times.
- **Compositor**: crop via the UV matrix, blend modes via a shader that reads the frame so far, 3D LUT textures, a mask pass for AI background removal.
- **Render session** (`engine/src/export/session.ts`): shared by MP4, WebM, GIF and PNG-sequence exports and by caption audio mixing.
- **Frame-exact pause**: when paused, the preview swaps `<video>` frames for frames from the same WebCodecs decoder export uses, so stills match exports exactly.
- **AI in the browser**: MediaPipe Tasks (segmentation for background removal, object detection for auto reframe) with the wasm runtime served from `/vendor/mediapipe`; Whisper through transformers.js for captions. Models download on first use and are cached by the browser.
- **Analysis**: beat detection, silence detection, colour statistics and reframe planning are pure functions with unit tests.
- **New commands**: `clip/setKeyframe`, `clip/removeKeyframe`, `clip/clearKeyframes`, `clip/setSpeedCurve`, `clip/freeze`, `clip/slip`, `clip/roll`, `clip/slide`, `clip/group`, `clip/ungroup`, `clip/deleteMany`, `timeline/rippleDelete`, `marker/add`, `marker/remove`, `marker/setBeats`.

## Phase 3 additions (audio)

- **DSP**: `packages/dsp` is Rust compiled to `wasm32` with a C ABI (FFT, STFT, spectral denoise, HPSS, time-stretch, pitch shift). `build.mjs` embeds the wasm as base64 in `engine/src/audio/dsp-wasm.ts`; `loadDsp()` instantiates it. Filters, dynamics, loudness and creative effects are TypeScript in `engine/src/audio/dsp.ts`.
- **Clip audio effects**: `MediaClip.audioFx` is a chain from the `AUDIO_FX` registry. Preview plays a processed, cached WAV of the clip; export runs the same chain in `mixAudio`, so both match.
- **Studio sessions**: `project.audioSessions` (`schema/src/session.ts`) hold tracks, patterns, instruments, regions and mixer settings. `renderStudio` renders a session offline (drums, synths, regions → track fx → pan/volume automation → sidechain → reverb bus → master soft clip and true-peak limiter). "Send to video" bounces a WAV asset and places or updates an audio clip. Every change is one `session/put` command, so undo works across the studio and the editor.
- **Sounds and moods**: `audio/sfx.ts` synthesises sound effects; `audio/moods.ts` builds editable sessions for background music moods.

## Phase 4 additions (motion)

- **Schema** (`schema/src/motion.ts`): `project.motionComps` holds compositions. A layer has a transform (anchor, position, scale, rotation, opacity), keyframes keyed by property path (`x`, `shape.trimEnd`, `anim.progress`, `fx.glow` …), optional parent, matte, blend mode, shape/text/image data and effects. Index 0 is the top layer.
- **Evaluation** (`engine/src/motion/eval.ts`): pure functions sample keyframes (with loop and wiggle), build 2D affine matrices through parents, flatten shapes to polylines, cut trim paths and compute text-animator amounts. All unit-tested without a DOM.
- **Rendering** (`engine/src/motion/render.ts`): Canvas 2D, so it runs on a normal canvas or an `OffscreenCanvas`. Layers with mattes or glow/blur are drawn into a scratch canvas first.
- **Timeline**: a text clip with `motionCompId` resolves to a `MotionSource`. The compositor renders the comp to a cached canvas (keyed by comp object, time, size and image versions), uploads it as a texture and places it like an image, so clip transform, effects and fades still apply. Preview and export use the same path.
- **Lottie** (`engine/src/motion/lottie.ts`): export bakes animated values every 2 frames; import reads the same subset back.
- **Templates** (`engine/src/motion/templates.ts`): functions that build comps sized to the video, with `editable` fields for the quick-edit panel.

## Phase 5 additions (library, no server)

- **Library** (`apps/web/src/lib/library.ts`): built-in fonts, moods, sound effects, motion templates and saved "my templates" become one list of items searched by `searchItems` (`engine/src/library/search.ts`: word, prefix, substring and one-typo matches over labels and tags, including Hindi tags).
- **Online** (`lib/openverse.ts`): Openverse API from the browser, filtered to CC0, PDM and CC BY; downloads keep the licence on the asset.
- **Licences**: `License` has `licenseName`, `licenseUrl`, `author`, `source` and `attribution`. Every import path fills them. `lib/credits.ts` builds the Licences page and `credits.txt`.
- **Fonts**: `project.fonts` lists Google fonts; `ensureProjectFonts` loads them on open and before export. When a font finishes loading the text raster caches are invalidated (`bumpFontEpoch`).
- **Backups** (`lib/backup.ts`): `.justsee` = stored ZIP with `project.json`, `manifest.json` and `media/<assetId>`. Restoring writes media to OPFS/IndexedDB and saves the project under a new id when needed. This replaces accounts and cloud sync, so there is still no server.

## Phase 6 additions (connector, sharing, live)

- **API** (`apps/api`): one Vercel Function built with the Build Output API (`build.mjs`), plain Node handlers in `src/app.ts`. Storage is Vercel Blob (`BlobStore`) in production and a folder (`FsStore`) in dev/tests. Routes: `/api/config`, `/api/upload` (Blob client uploads), `/api/share`, `/api/recipes/:id`, `/api/jobs/:id`, `/api/report`, `/api/mcp/<key>`.
- **Connector** (`src/mcp.ts`): MCP server over Streamable HTTP (stateless). Tools edit a high-level **recipe** (`packages/schema/src/recipe.ts`), not the project directly. `render_video` creates a job; the browser that opens `/render` builds the project from the recipe with the normal editor code, exports and uploads the MP4. So "server render" costs nothing.
- **Auto-delete**: files older than 30 days are removed on upload (checked at most every 12 h, marker in `meta/`), so the free 1 GB Blob limit does not fill.
- **Live editing** (`lib/live.ts`): PeerJS (WebRTC). The host holds the master copy; commands are broadcast, a hash check resyncs, media is sent in chunks.
- **Heavy tools**: stabiliser (block matching + path smoothing, `engine/src/analysis/stabilize.ts`), HD enhance (shaders), Swin2SR ×2 and SpeechT5 via transformers.js on the device.

## Phase 7 additions (polish)

- **Code splitting**: Studio, Motion, Library, Export, captions, audio panels and live editing load on first use (`React.lazy`). Their open/close state lives in `lib/ui-stores.ts` so the editor does not import the screens. Workspace packages are `sideEffects: false`.
- **Preview speed**: video textures are re-uploaded only when the browser reports a new frame (`requestVideoFrameCallback`). During playback the preview drops its resolution (down to 50 %) when a frame takes over 22 ms and climbs back when there is room; pause restores full quality. `PreviewPlayer.stats()` reports fps, render time and scrub latency.
- **Timeline**: rows are memoised, so vertical scrolling and playhead moves do not re-render clips (53 tracks scroll at 60 fps).
- **Speed test** on `/diagnostics` (`lib/speed-test.ts`): the README preview budget (3 layers + effect at the 1080p preview size) measured on the user's own device.
- **Accessibility**: in-house audit (`e2e/a11y.ts`) for control names, image alt text and WCAG AA contrast, run on every main screen in both themes; Esc closes full-screen editors.
- **Onboarding**: Quick reel (`lib/quickstart.ts`) and three first-run tips.
- **Usage and crashes** (`lib/telemetry.ts`): counters and crash reports kept in `localStorage`, scrubbed of file names, links and emails. Uploaded only when the user taps Send on `/diagnostics`.

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
- `apps/web/e2e` (Playwright, Pixel 7 emulation): smoke + shader compile, editing flow with autosave/reload, transitions, and the Phase 1 acceptance test (60 s 9:16 reel with 5 clips, text and music, exported and checked with ffprobe and pixel comparisons). One spec per later phase; Phase 7 adds performance budgets, the accessibility audit, onboarding timing and crash reports.
- `apps/api/test`: connector flow, share links, crash reports, 30-day cleanup.
