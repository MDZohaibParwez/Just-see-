# Changelog

## 0.7.4 — Cloud usage in connector replies

### Added

- Each `add_media` reply says how much was downloaded and stored and how long the server worked.
- When a render is done, `get_render` adds a **Cloud use** block: this video's download, storage, data sent to the browser and server time; this month's data transfer against the free plan; storage in use now.
- `get_usage` tool for the month (or one video). Claude's own credits are not visible to a connector (see Claude → Settings → Usage).
- Listed in `docs/before-going-public.md` (to be reworked later).

## 0.7.3 — Personal mode: delete clips as early as possible

### Changed

- **Personal mode (on now):** once the render page has copied every clip to the device, the online copies are deleted straight away, before the render finishes. If a render then fails, the project still opens in the editor on that device. Turn off with `JUST_SEE_EAGER_DELETE=0`.
- `docs/before-going-public.md`: the list of personal-use settings to change before the app goes public.

## 0.7.2 — Connector: files up to 900 MB, server stays safe

### Changed

- Clips up to **900 MB** (was 300 MB). Big files stream straight from Drive into storage, so the server never holds them in memory; length is read from small pieces of the file.
- Files added on the upload page are used where they are (no second copy) and are deleted after the render too.
- Storage guard: a download that would push storage past ~950 MB is refused with a clear message (after first clearing clips of projects not rendered in 2 days), so the free 1 GB is never exceeded.
- Clips of projects that are never rendered are removed after 2 days.

## 0.7.1 — Connector: Google Drive clips, auto-delete after render

### Added

- `add_media` takes **Google Drive** share links ("Anyone with the link"), also Dropbox and OneDrive. Big Drive files (100 MB+) work; up to 300 MB per file.
- Source clips are **deleted from Just See's online storage once the MP4 is saved** (`render_video` `keep_media: true` keeps them). Files in the user's own Drive are never touched.
- `delete_video` tool: remove a project's clips and plan right away.

## 0.7.0 — Phase 7: polish (speed, accessibility, onboarding, crash reports)

### Added

- **Quick reel** on the home screen: pick videos, get a 9:16 reel (up to 30 s) with mood music and Export open. First edit done in about 6 s in tests.
- **First-run tips** (3 steps, shown once).
- **Overlay** button: put a video or photo on top as picture-in-picture.
- **Speed test** on the Device check page, to check the 30 fps preview goal on your own phone.
- **Problems & usage** on the Device check page: crashes and feature counts stay on the phone; a report is uploaded only if you tap Send.
- Esc closes Library, Studio and Motion.

### Changed

- Editor starts faster: big screens load when first opened (editor download 431 → 357 kB compressed).
- Smoother preview: unchanged video frames are not re-uploaded, and playback lowers preview resolution on slow phones (full quality when paused).
- Timeline with 50+ tracks scrolls at 60 fps.
- Light theme: dark text on orange buttons, stronger clip labels and link colour (WCAG AA).

## 0.6.0 — Phase 6: connector, sharing, live editing, reel styles

### Added

- **Claude / ChatGPT connector (MCP)** at `https://just-see-api.vercel.app/api/mcp/<key>`. Tools to create a video, add clips by link or via an upload page, trim, captions, text, music, sound effects, effects, studio voice, motion templates, reel styles, fit duration, render and get the download link. Videos are built and rendered in the browser that opens the render link, so the server stays free.
- **Free API** (`apps/api`): one Vercel Function + Vercel Blob for share links, cloud backups, connector recipes and render jobs; a local folder in dev/tests.
- **Share a copy** by link, **cloud backup** links, backup reminder, Install-app prompt and an iPhone "Add to Home Screen" guide.
- **Live team editing** between phones/laptops (WebRTC via PeerJS): edits, undo and media sync, host keeps the master copy.
- **Reel styles** (9): anime dialogue, POV story, aesthetic detail, hook montage, quote reveal, talking head + CTA, scenic lyric, dream card, lyric card. 7 new motion templates and text fit-to-width.
- **Video stabiliser** (own algorithm), **HD enhance**, **AI photo upscale ×2** (Swin2SR) and **English AI voice** (SpeechT5).
- **Auto-delete after 30 days** for online files (uploads, shares, cloud backups, renders), checked at most every 12 hours on upload, so the free 1 GB Blob limit does not fill up.
- `.claude/skills/reel-editor`: playbook for analysing and recreating reel formats.

## 0.5.0 — Phase 5: library, licences, backups (no server)

### Added

- One library search for fonts (50 free Google Fonts, incl. Hindi and Urdu), background music (mood templates), 75 sound effects, motion templates and your own templates. Works with Hindi/Hinglish words and small typos.
- Free online sounds and images from Openverse (CC0, public domain, CC BY only).
- Every asset carries licence data (licence name, link, author, source, credit line). A Licences page lists everything in the project and exports `credits.txt`.
- Fonts picked in the library apply to the selected text and load before preview and export.
- Backups: save a project with all its media as one `.justsee` file and open it on any device (replaces accounts and cloud sync, no server needed).
- "My templates": save a motion composition and reuse it in any project on this device.

### Changed

- Licence schema gains `licenseName`, `licenseUrl`, `author` and `source`; projects gain `fonts` (defaults keep schema version 1).

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
