# Changelog

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
