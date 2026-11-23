# Changelog

## 0.4.0 — Phase 4: motion studio

### Added

- Motion studio: compositions with solid, shape, text, image and null layers; keyframes on every number property; parenting; blend modes; alpha, inverted and luma track mattes.
- Shape layers (rect, ellipse, star, polygon, bezier path) with round corners, gradient fill, stroke, trim paths and repeater.
- Text animators by character, word or line (offset, opacity, scale, rotation, blur, random order) and 20 text animation presets.
- Graph editor: value curve, drag keyframes, easing presets and bezier handles (overshoot allowed).
- Glow, blur and drop shadow; wiggle and keyframe loop.
- 8 templates with quick-edit fields: 3 lower thirds, 2 logo reveals (with your own logo), cinematic title, subscribe button, callout.
- Lottie JSON export and import (common subset).
- "Add to video": a composition becomes a timeline clip that updates live and exports with the video.

### Changed

- Project gains `motionComps`; text clips gain `motionCompId` (defaults keep schema version 1).

## 0.3.0 — Phase 3: audio studio

### Added

- Audio effects on any clip (35+): Studio voice in one tap, noise reduction (Rust/wasm spectral), de-hum, de-click, de-ess, de-reverb, breath removal, compressor, limiter, gate, EQ, pitch, voice filters (telephone, walkie-talkie, muffled, radio, megaphone, robot, chipmunk, deep), reverb, echo, cave echo, chorus, flanger, phaser, 8D pan, lo-fi, bitcrusher.
- LUFS and true-peak measurement; the limiter now detects true peak (4× oversampled).
- Free stem split (vocals, drums, bass, other) and vocal removal.
- 75 built-in sound effects, synthesised in code (free to use), with search; "My sounds" for your own files.
- Auto duck: lowers music under speech.
- Audio studio: step sequencer, piano roll with scale and chords, synths (subtractive, FM, 808, sampler), 3 drum kits, mixer with sends and sidechain, audio regions with trim/gain/fades/pitch, mic recording, Web MIDI, WAV export, send to video.
- Background-music mood templates: Upbeat, Cinematic, Lo-fi, Suspense, Theme/intro, Stinger.

### Changed

- Project gains `audioSessions` and clips gain `audioFx` (both default to empty, schema stays version 1).

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
