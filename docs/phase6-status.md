# Phase 6 status — Connector, sharing, live editing, heavy tools

Everything is free: one Vercel Function (Hobby), Vercel Blob (free tier), the free PeerJS broker, and models that run on the device.

## Done-when check

| Check | Result |
| --- | --- |
| Claude, using only the connector, turns 3 clips into a captioned 30 s reel and returns a download link | ✅ `phase6-connector.spec`: an MCP client adds 3 clips, captions, title, whoosh, music, fit 30 s, renders; the render link builds the reel in the browser and uploads it; `get_render` returns the MP4 link (720×1280, 30.0 s, with audio and burned-in captions) |

## Features

| Feature | Status | Notes |
| --- | --- | --- |
| MCP connector (Claude.ai, ChatGPT, any MCP client) | ✅ | Streamable HTTP, stateless; URL contains a secret key |
| Upload page for phone clips | ✅ | |
| Server render | 🟡 | Rendered in the browser that opens the render link (free). A headless render worker is a later option |
| Share a copy by link / cloud backups | ✅ | Needs the Blob store on the API project |
| Live team editing | ✅ | Direct device-to-device; works best on the same Wi-Fi or normal mobile data; very strict networks may block it |
| Reel styles (9) + 7 templates | ✅ | Library → Reel styles; connector `apply_style` |
| Stabilise | ✅ | Measured: shake 14.4 → 6.8 on the test clip |
| HD enhance | ✅ | Non-AI sharpen/clarity on the GPU |
| AI photo upscale ×2 | 🟡 | Swin2SR via transformers.js; flow tested with a stand-in, model download not testable in CI |
| AI voice | 🟡 | English only (SpeechT5, MIT). No permissive Hindi voice model found yet |
| AI vocal separation | ⬜ | Clean-licence browser models not found (UMX-L weights are non-commercial); the free DSP method stays |
| Data safety | ✅ | Install prompt, iPhone guide, backup reminder, cloud backup links |

## Needs the owner

- **Vercel Blob store**: creating it was refused with `usage_threshold_limits_reached` on the Hobby team. Until a store is connected to the `just-see-api` project, share links, cloud backups and the connector answer "Online storage is not set up yet".
