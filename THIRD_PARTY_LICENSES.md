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

Notes:

- `mp4-muxer` is marked deprecated upstream in favour of Mediabunny. Mediabunny
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

## Assets

Phase 1 ships no third-party fonts, music, sound effects, LUTs or stickers.
The icon set (`packages/ui/src/icons.tsx`) and app icon are original work for
this project. Text uses the device's system fonts.
