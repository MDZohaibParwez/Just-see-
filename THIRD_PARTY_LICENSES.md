# Third-party licenses

Every dependency used by Just See, with its license. Only permissive licenses
(MIT, Apache-2.0, BSD, ISC; OFL for fonts) are allowed inside the product.
GPL/AGPL code is not allowed. Update this file whenever a dependency changes.

## Shipped in the app (runtime)

| Package | Version | License | Used for |
| --- | --- | --- | --- |
| [next](https://github.com/vercel/next.js) | 16.4.6 | MIT | Web framework, static export |
| [react](https://github.com/facebook/react), react-dom | 19.3.1 | MIT | UI |
| [zustand](https://github.com/pmndrs/zustand) | 5.1.0 | MIT | UI and editor state |
| [zod](https://github.com/colinhacks/zod) | 4.6.7 | MIT | Project schema validation |
| [idb](https://github.com/jakearchibald/idb) | 8.0.4 | ISC | IndexedDB wrapper (projects, versions, thumbnails) |
| [mp4box](https://github.com/gpac/mp4box.js) | 2.6.0 | BSD-3-Clause | MP4/MOV demuxing |
| [mp4-muxer](https://github.com/Vanilagy/mp4-muxer) | 5.2.2 | MIT | MP4 muxing for export |
| [webm-muxer](https://github.com/Vanilagy/webm-muxer) | 5.1.4 | MIT | WebM muxing for export |
| [@huggingface/transformers](https://github.com/huggingface/transformers.js) | 4.3.2 | Apache-2.0 | Whisper speech recognition in the browser (auto captions) |
| [onnxruntime-web](https://github.com/microsoft/onnxruntime) | (via transformers) | MIT | Runs the Whisper model (wasm/WebGPU) |
| [@mediapipe/tasks-vision](https://github.com/google-ai-edge/mediapipe) | 1.2.3 | Apache-2.0 | Person segmentation (AI background removal) |
| [peerjs](https://github.com/peers/peerjs) | 1.5.5 | MIT | Live team editing (WebRTC between devices; free PeerJS broker only introduces them) |
| [@vercel/blob](https://github.com/vercel/storage) | 2.9.0 | Apache-2.0 | Uploads for share links, cloud backups and connector media |

### API (apps/api, one Vercel Function)

| Package | Version | License | Used for |
| --- | --- | --- | --- |
| [@modelcontextprotocol/sdk](https://github.com/modelcontextprotocol/typescript-sdk) | 1.32.2 | MIT | Claude / ChatGPT connector (MCP server) |
| [@vercel/blob](https://github.com/vercel/storage) | 2.9.0 | Apache-2.0 | File and JSON storage |
| [mp4box](https://github.com/gpac/mp4box.js) | 2.6.0 | BSD-3-Clause | Reading clip lengths |
| [esbuild](https://github.com/evanw/esbuild) (build only) | 0.28.2 | MIT | Bundling the function |
| [peer](https://github.com/peers/peerjs-server) (tests only) | 1.0.2 | MIT | Local broker for live-editing tests |

### AI models (downloaded at runtime, not bundled)

Added in Phase 6: [Xenova/swin2SR-classical-sr-x2-64](https://huggingface.co/Xenova/swin2SR-classical-sr-x2-64) (Apache-2.0, AI photo upscale ×2) and [Xenova/speecht5_tts](https://huggingface.co/Xenova/speecht5_tts) from [microsoft/speecht5_tts](https://huggingface.co/microsoft/speecht5_tts) (MIT, English AI voice). Rejected: Open-Unmix UMX-L ONNX stems (weights are non-commercial upstream) and MMS-TTS Hindi (CC BY-NC).

| Model | Source | License |
| --- | --- | --- |
| Whisper base / small (ONNX, timestamped) | huggingface.co/onnx-community | MIT (OpenAI Whisper weights) |
| Selfie segmenter (float16) | storage.googleapis.com/mediapipe-models | Apache-2.0 |

Node-only packages pulled in by transformers.js (`onnxruntime-node` MIT, `sharp`
Apache-2.0 with LGPL-3.0 libvips binaries) are never bundled into the web app.

Notes:

- `mp4-muxer` and `webm-muxer` are marked deprecated upstream in favour of Mediabunny. Mediabunny
  is MPL-2.0, which is not on our allowed list, so we stay on `mp4-muxer` (MIT)
  until a decision is made.
- ffmpeg.wasm is **not** used in Phase 1. When added it will be the LGPL build,
  loaded as a separate module.

## Development only (not shipped)

| Package | Version | License |
| --- | --- | --- |
| typescript | 5.9.3 | Apache-2.0 |
| vitest | 3.2.7 | MIT |
| @playwright/test | 1.63.0 | Apache-2.0 |
| tailwindcss, @tailwindcss/postcss | 4.3.5 | MIT |
| fake-indexeddb | 6.2.8 | Apache-2.0 |
| @types/react, @types/react-dom, @types/node | 19.3.0 / 19.3.0 / 22.20.5 | MIT |

The E2E fixture script calls the system `ffmpeg` binary to generate test media.
It is a developer tool and is never bundled.

Written in this project (no third-party code): the Rust DSP module
(`packages/dsp`: FFT, STFT, spectral denoise, HPSS, phase vocoder; no
external crates), all TypeScript audio DSP and effects, GIF encoder (`packages/engine/src/export/gif.ts`),
ZIP writer and reader, library search, `.cube` LUT parser, beat/silence detection, all effect and transition shaders.

## Assets

No third-party fonts, music, sound effects, LUTs or stickers are bundled in the app.

### Loaded at runtime (Phase 5)

| Source | License | How it is used |
| --- | --- | --- |
| [Google Fonts](https://fonts.google.com) — the 50 families in `packages/engine/src/library/fonts.ts` | SIL Open Font License 1.1 (each family checked) | CSS and font files are loaded from Google's servers when a user picks a font. The licence is saved in `project.fonts`. |
| [Openverse](https://openverse.org) search API | Results under CC0, Public Domain Mark or CC BY only (share-alike and non-commercial are filtered out) | Users search and download free sounds and images. Each file is saved with its licence, author, source page and the credit line CC BY needs; the Licences page can copy or download credits. |

Motion templates (`packages/engine/src/motion/templates.ts`) and text presets are original designs made from our own shapes and text.

The built-in sound effects (`packages/engine/src/audio/sfx.ts`), drum kits,
synth presets and mood music templates (`audio/studio.ts`, `audio/moods.ts`)
are generated by code written for this project. They contain no recordings
or samples from anyone else, so they can be used in any video, including
commercial ones. Sounds a user imports are stored with the licence
`user-upload` and stay in that user's project.
The icon set (`packages/ui/src/icons.tsx`) and app icon are original work for
this project. Text uses the device's system fonts unless the user picks a Google Font.
