# Just See

> **Just connect and see — we edit your video like a professional editor.**

Just See is an all-in-one creative studio that runs in the browser. Creators can **edit video**, **clean up and produce audio**, and **build motion graphics** in one app, on one shared project, without switching tools.

- 📱 **Mobile-first.** Runs smoothly in a phone browser and installs as a PWA.
- 🖥️ **Pro on desktop.** Dockable panels, keyboard shortcuts, and separate Edit / Audio / Motion workspaces.
- 🤖 **Works with Claude.** A built-in Claude connector (remote MCP server) lets Claude create and edit projects end to end.
- 🌏 **Made for Indian creators.** Captions in Hindi, English, Hinglish and Urdu; correct Devanagari, Nastaliq and Gujarati text; Hindi and English UI from day one.

> **Status:** ✅ Phase 1 and ✅ Phase 2 (full video editor) are built: 170+ effects, 86 transitions, keyframes, LUTs, chroma key, AI background removal, auto captions (Hindi/English/Hinglish/Urdu), beat sync, auto reframe, 4K export. A few items need the GPU server (Phase 6) — see [docs/phase2-status.md](docs/phase2-status.md). Phase 3 (audio studio) is next.

---

## Table of contents

- [What you can do](#what-you-can-do)
  - [Video editor](#1-video-editor)
  - [Audio studio](#2-audio-studio)
  - [Motion studio](#3-motion-studio)
  - [Asset library](#4-asset-library)
  - [Claude connector](#5-claude-connector-mcp)
- [How it works](#how-it-works)
- [Tech stack](#tech-stack)
- [Repository layout](#repository-layout)
- [Getting started](#getting-started)
- [Roadmap](#roadmap)
- [Performance targets](#performance-targets)
- [Project rules](#project-rules)
- [Docs](#docs)
- [License](#license)

---

## What you can do

### 1. Video editor

| Area | Features |
| --- | --- |
| **Timeline** | Unlimited video, audio, text, sticker and effect tracks · magnetic main track · ripple, roll, slip and slide edits · snapping, split, trim, multi-select, grouping, markers · pinch-zoom on touch |
| **Clip tools** | Speed (constant + curve ramps) · reverse · freeze frame · crop, rotate, flip · opacity and blend modes · keyframes on every property |
| **Transitions** | 80+ transitions (fades, slides, zooms, glitch, light leak, morph-style) with adjustable duration and easing |
| **Effects and colour** | 150+ shader effects · `.cube` LUTs · colour wheels, curves, HSL · auto colour match between clips |
| **Keying and masks** | Chroma key with spill suppression · shape and pen masks with feather · AI background removal · AI cutout with tracking |
| **Text and captions** | Animated templates · per-word karaoke captions · auto captions (Hindi, English, Hinglish, Urdu) with an editable transcript · text-to-speech |
| **Smart tools** | Beat detection + auto cut-to-beat · auto reframe 16:9 → 9:16 · silence and filler-word removal · edit by deleting words in the transcript · stabilisation · AI upscale |
| **Canvas** | 9:16, 16:9, 1:1, 4:5 or custom · blur, colour or image backgrounds |
| **Export** | Up to 4K 60 fps · H.264, H.265, VP9, AV1 · transparent WebM (ProRes 4444 on the server) · GIF · presets for Reels, Shorts, YouTube and X · **no watermark** |

### 2. Audio studio

One audio engine, two modes.

**Edit mode** (voice, podcasts, cleanup)
- Multitrack and single-file waveform editing: non-destructive, sample-accurate cuts, crossfades, fade curves, clip gain
- Spectral view: paint out unwanted sounds with brush and lasso
- Repair: noise reduction, de-click, de-hum, de-reverb, de-ess, breath and mouth-click removal
- **One-tap "Studio voice"** enhancement
- AI stem separation: vocals, drums, bass, other
- Pitch correction with key/scale, formant-preserving pitch shift, time-stretch
- LUFS meter, true-peak limiter, one-tap normalise to **-14 LUFS** (social) or **-16 LUFS** (podcast)

**Produce mode** (beats and songs)
- Step sequencer, pattern and playlist arrangement, piano roll (velocity, quantise, scales, chord helper)
- Instruments: subtractive synth, FM synth, sampler with slicing, 808 and drum machine
- Mixer with channel strips, sends, buses, sidechain and automation lanes
- Effects: parametric EQ, compressor, multiband, limiter, gate, saturation, reverb (algorithmic + convolution), delay, chorus, flanger, phaser, bitcrusher, stereo widener
- Plugins via the [Web Audio Modules (WAM)](https://www.webaudiomodules.com/) standard
- Mic recording with monitoring, punch-in and takes · Web MIDI keyboards
- Export WAV, MP3, AAC, FLAC and stems · **send to the video timeline in one tap**

### 3. Motion studio

- Compositions of any size, frame rate and duration
- Layers: video, image, solid, shape, text, null, camera, light, adjustment, audio, precomp
- Keyframes everywhere, graph editor (value + speed graphs, bezier handles), easing presets, roving keyframes
- Parenting, track mattes (alpha/luma), blend modes, masks with feather and expansion
- Shape layers with trim paths, repeater, offset, wiggle, round corners, merge
- Text animators per character / word / line, text on a path, 50+ presets
- Effects: glow, blurs, turbulent displace, particles with physics, light rays, fractal noise, echo, motion blur
- 2.5D: 3D layers, camera (orbit, dolly, depth of field), basic lights
- Safe JavaScript expressions (`wiggle`, `loopOut`, `time`, property links)
- Point and planar motion tracking
- Templates: mark any property as editable
- Lottie JSON and SVG import/export · render to video, GIF or transparent WebM
- **Any composition drops into the video timeline and updates live**

### 4. Asset library

One search across everything:

- **Fonts:** full Google Fonts catalog + your own uploads, with strong Devanagari, Urdu (Nastaliq) and Gujarati coverage and font pairing suggestions
- **Music:** royalty-free tracks from licensed providers, filterable by mood, genre, BPM and length, auto-fit to your video
- **Sound effects:** CC0 / CC-BY sounds (with attribution) plus our own SFX pack
- **Stickers, emoji, overlays, LUTs, shapes, transitions, text templates** with favourites and recents

Every asset stores its **license, source URL, attribution text and commercial-use flag**. Only assets cleared for commercial use ship in the app.

### 5. Claude connector (MCP)

Add Just See to Claude as a custom connector (Streamable HTTP, OAuth 2.1) and Claude can edit for you:

> *"Make a 30 s reel from these 3 clips with Hinglish captions and beat-synced cuts."*

| Tool | What it does |
| --- | --- |
| `create_project` | New project with canvas size and fps |
| `import_media` | Add media from a URL or your library |
| `get_project_state` | Timeline, tracks, clips and effects as JSON |
| `add_clip` `trim_clip` `split_clip` `move_clip` `delete_clip` | Timeline edits |
| `set_speed` `add_transition` `apply_effect` `set_keyframes` | Styling and animation |
| `add_text` `auto_captions` | Titles and captions |
| `search_assets` `add_music` `add_sfx` | Library search and insert |
| `audio_cleanup` `separate_stems` `normalize_loudness` | Audio actions |
| `create_motion_comp` `animate_layer` | Motion actions |
| `apply_template` | Fill a template with text and media |
| `get_frame` | PNG preview at a timestamp, so Claude can see the edit |
| `render_export` `get_render_status` | Server render with a download link |
| `undo` `redo` | Step through history |

Long jobs (render, stems, captions) return a job id. Every tool is scoped to the signed-in user and rate-limited.

---

## How it works

```
              ┌───────────────────────────────────────────┐
              │        Project document (JSON + Zod)      │
              │ sequences · audio sessions · motion comps │
              └─────────────────────▲─────────────────────┘
                                    │  commands {type, payload, inverse}
          ┌─────────────────────────┼──────────────────────────┐
          │                         │                          │
   ┌──────┴──────┐          ┌───────┴───────┐          ┌───────┴───────┐
   │  Web app    │          │  MCP server   │          │ Render worker │
   │  (editor)   │          │  (Claude)     │          │ (GPU, server) │
   └──────┬──────┘          └───────────────┘          └───────┬───────┘
          │                                                    │
          └──────────────►  packages/engine  ◄─────────────────┘
                 renderFrame(project, t) → GPU texture
                 renderAudio(project, range) → PCM
```

1. **One project model.** A versioned JSON document holds sequences, audio sessions, motion compositions and assets. Any audio session or motion comp can sit on a timeline as a nested clip.
2. **Every edit is a command** with an inverse. This gives unlimited undo/redo, autosave, version history and (later) real-time collaboration. The MCP server uses the same commands as the app.
3. **One render engine.** Pure functions that run unchanged in the browser and in server workers, so **preview, export and Claude always produce the same result**.
4. **Media pipeline.** On import we build 540p proxies, a thumbnail strip and audio peaks for smooth phone editing. Export always uses the original files.
5. **You never lose work.** Autosave on every change, crash recovery and version history.

Full details will live in [ARCHITECTURE.md](ARCHITECTURE.md).

---

## Tech stack

| Layer | Choice |
| --- | --- |
| Frontend | Next.js (App Router), React, TypeScript (strict), Tailwind CSS, Zustand |
| Video I/O | WebCodecs, mp4box.js, ffmpeg.wasm (LGPL build, separate module) as fallback |
| Rendering | WebGPU with WebGL2 fallback; our own compositor; effects as WGSL/GLSL shaders |
| Audio | Web Audio API + AudioWorklet; heavy DSP in Rust → WebAssembly; Tone.js for transport and synths |
| Text | Our own canvas layout with HarfBuzz (WASM) for Indic and Urdu shaping |
| Storage | OPFS + IndexedDB on device; Cloudflare R2 + Postgres (Supabase or Neon) in the cloud |
| Backend | Node + TypeScript API; headless Chromium render workers on GPU; native FFmpeg for final mux |
| AI | Whisper-class captions, segmentation for background removal, source separation for stems; small models in-browser via ONNX Runtime Web |
| Auth | Email + Google login |
| Testing | Vitest unit tests for engine code, Playwright end-to-end tests per phase |

---

## Repository layout

Monorepo structure (`mcp-server`, `render-worker` and `dsp` arrive in later phases):

```
just-see/
├── apps/
│   ├── web/             # Next.js editor + PWA (static export)
│   ├── mcp-server/      # Claude connector (remote MCP) — Phase 6
│   └── render-worker/   # GPU server render — Phase 6
├── packages/
│   ├── engine/          # renderFrame / renderAudio, shared everywhere
│   ├── schema/          # project document + Zod schemas + commands
│   ├── dsp/             # Rust → WASM audio DSP — Phase 3
│   └── ui/              # shared components and icon set
├── docs/
│   └── asset-sources.md # provider API terms and licenses
├── README.md
├── ARCHITECTURE.md
├── THIRD_PARTY_LICENSES.md
└── CHANGELOG.md
```

---

## Getting started

**Requirements:** Node.js 20+, pnpm 10+, and a browser with WebCodecs and WebGL2 (recent Chrome, Edge, Samsung Internet, or Android Chrome). `ffmpeg` is only needed to generate E2E test media.

```bash
git clone https://github.com/MDZohaibParwez/Just-see-.git
cd Just-see-
pnpm install
pnpm dev          # web app at http://localhost:3000
pnpm test         # unit tests (schema + engine)
pnpm typecheck    # strict TypeScript everywhere
pnpm build        # static export to apps/web/out
pnpm test:e2e     # Playwright (builds needed first: pnpm build)
```

**Try it on your phone:** run `pnpm dev --hostname 0.0.0.0`, then open `http://<your-computer-ip>:3000` on a phone on the same Wi-Fi. Phone browsers only allow WebCodecs on `https://` or `localhost`, so for a real phone test use the deployed preview link (or a tunnel).

**Check a device:** open `/diagnostics` to see WebGL2, WebCodecs, the chosen encoders and whether every shader compiles.

**Keyboard (desktop):** Space play/pause · S split · Delete delete · Ctrl+Z / Ctrl+Shift+Z undo/redo · Ctrl+D duplicate · ← → step a frame · + / − zoom · T add text · M marker · I import · Ctrl+E export · Shift+click multi-select.

## Roadmap

Phases are built strictly in order. A phase is done only when its check passes.

| # | Phase | Done when | Status |
| --- | --- | --- | --- |
| 1 | **Foundation + video MVP**: monorepo, schema, commands, engine, import, timeline (cut, trim, split, speed), text, 20 transitions, 30 effects, MP4 export, autosave, PWA | A 60 s 9:16 reel with 5 clips, text and music exports correctly from a phone browser | ✅ Done |
| 2 | **Full video editor**: all of Module 1, incl. auto captions, background removal, beat sync | Every video feature passes E2E tests and a 4K export matches the preview frame-for-frame | ✅ Done ([status](docs/phase2-status.md)) |
| 3 | **Audio studio**: Edit mode, then Produce mode | A noisy phone voice recording becomes a clean -14 LUFS export in one tap, and a 16-bar beat can be built | ✅ Done ([status](docs/phase3-status.md)) |
| 4 | **Motion studio**: layers, keyframes, graph editor, shapes, text animators, effects, Lottie | An animated lower-third and a logo reveal can be built and dropped into a video | ✅ Done ([status](docs/phase4-status.md)) |
| 5 | **Assets, templates, accounts, cloud sync** | One search covers fonts, music and SFX, and every asset carries license data | ✅ Done, without a server ([status](docs/phase5-status.md)) |
| 6 | **Claude connector + server render** | Claude, using only the connector, turns 3 clips into a captioned 30 s reel and returns a download link | ✅ Done, rendered in the browser instead of a paid server ([status](docs/phase6-status.md)) |
| 7 | **Polish**: performance, accessibility, onboarding, analytics, crash reporting | All performance budgets met | ⬜ |

> 💰 Phases 2 and 3 were built to run free in the browser (captions, background removal and stems run on the device). Only Phase 6 (server render) may need a paid server; budget gets decided before it starts.

---

## Performance targets

| Device | Target |
| --- | --- |
| Mid-range Android (6 GB RAM, 2023 chip) | 1080p preview at 30 fps with 3 video layers + effects |
| Any phone | Scrub latency under 100 ms · app shell loads in under 3 s on 4G |
| Desktop | 4K preview via proxies · 50+ tracks without lag |
| Everyone | 60 fps UI animation · WCAG AA contrast · screen-reader labels on every control |
| New users | First edit finished in under 60 seconds |

---

## Project rules

These rules apply to every contribution:

1. **Original work only.** No code, UI layouts, icons or assets copied from CapCut, Adobe, FL Studio or any closed product. We study what features do, then design our own way.
2. **Permissive licenses only:** MIT, Apache-2.0, BSD, ISC (OFL for fonts). **No GPL/AGPL code** in the codebase. ffmpeg.wasm uses the LGPL build, loaded as a separate module.
3. **Every dependency** is listed in [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md).
4. **Every asset** (font, track, SFX, LUT, sticker) stores its license and source URL, and must allow commercial use. Attribution is shown in-app when required.
5. **TypeScript strict mode** everywhere; no `any` in engine code.
6. **Every feature ships with tests:** unit tests for engine code, Playwright E2E per phase.
7. **Never lose user work.**

---

## Docs

| File | What's in it |
| --- | --- |
| [README.md](README.md) | This overview |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Project model, command system, engine, pipelines |
| [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md) | Every dependency and its license |
| [CHANGELOG.md](CHANGELOG.md) | What changed in each release |
| [docs/phase2-status.md](docs/phase2-status.md) | Module 1 feature-by-feature status |
| [docs/asset-sources.md](docs/asset-sources.md) | Asset provider terms *(coming in Phase 5)* |

---

## License

Not chosen yet. Until a license is added, all rights are reserved by the project owner.
