# Changelog

## 0.2.0 — Phase 2: full video editor

### Added

- Keyframes on every property (position, scale, rotation, opacity, crop, volume, effect parameters) with linear, ease, hold and bezier easing; keyframe markers on clips.
- Crop with presets, 12 blend modes, freeze frame, reverse, speed ramps (6 presets), blur and image canvas backgrounds.
- Roll, slip and slide edits; multi-select, grouping, delete many; timeline markers and beat markers.
- 170+ effects (40 looks, colour wheels, curves, HSL, levels, LUT, keys, masks, blurs, distortions, stylize, retro, motion, light) and 86 transitions with easing.
- `.cube` LUT import, auto colour match, chroma key with spill, luma key, rectangle/ellipse/linear/spotlight/pen masks.
- AI in the browser: background removal (MediaPipe), auto reframe for 9:16 (object detection), auto captions with Whisper (Hindi, English, Hinglish, Urdu), karaoke word highlight, transcript editing, filler-word removal.
- Beat detection with cut-to-beat; silence removal.
- Export: WebM, GIF, transparent PNG sequence, H.265 option, social presets (Reels, Shorts, YouTube, X, WhatsApp).
- Frame-exact paused preview (same decoder as export) and a 4K preview-vs-export pixel-diff test.
- Diagnostics renders every effect and transition and reports GL errors.

### Changed

- Project schema stays version 1; new fields have defaults so Phase 1 projects open unchanged.
- Exporter split into a shared render session plus per-format encoders.

## 0.1.0 — Phase 1: foundation + video editor MVP

### Added

- Monorepo (pnpm workspaces): `apps/web`, `packages/schema`, `packages/engine`, `packages/ui`.
- Project schema v1 (Zod), integer-microsecond timeline, magnetic main track, overlay, text and audio tracks.
- Command system with inverse commands: unlimited undo/redo, one undo step per gesture.
- Editing: import video/photo/music, split, trim (both edges), move/reorder, delete, duplicate, speed (0.1×–10×), volume and fades, position/scale/rotation/opacity/flip, snapping with haptics, pinch-zoom timeline.
- Text clips with style (font, size, colour, outline, background box, shadow, alignment) and 10 in/out animations, including grapheme-aware typewriter.
- 30 shader effects and 20 shader transitions (WebGL2).
- Canvas presets 9:16, 16:9, 1:1, 4:5 and background colour.
- MP4 export in the browser with WebCodecs (H.264/VP9/AV1, AAC/Opus), 720p–4K, 24–60 fps, no watermark; download or share.
- On-device storage: originals in OPFS (IndexedDB fallback), autosave on every change, crash recovery, version history.
- Mobile-first UI with desktop side panel and keyboard shortcuts; English and Hindi; dark and light themes; custom icon set.
- PWA: install, offline app shell.
- `/diagnostics` device check page.
- Unit tests (schema, engine) and Playwright E2E tests, including the Phase 1 acceptance reel export.
