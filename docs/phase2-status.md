# Phase 2 status — full video editor (Module 1)

Legend: ✅ done and covered by tests · 🟡 partly done · ☁️ needs the GPU server (Phase 6, paid)

## Timeline

| Feature | Status | Notes / test |
| --- | --- | --- |
| Unlimited video, audio, text, sticker, effect tracks | ✅ | Overlay/text/audio tracks are created on demand |
| Magnetic main track | ✅ | `normalizeMainTrack`, schema tests |
| Ripple, roll, slip, slide edits | ✅ | Edit-mode switch on the timeline; `clip/roll`, `clip/slip`, `clip/slide`; `phase2-edits.spec` |
| Snapping, split, trim, multi-select, grouping, markers | ✅ | Snapping to clips, playhead and markers with haptics |
| Pinch-zoom on touch | ✅ | Custom pointer handling |

## Clip tools

| Feature | Status | Notes |
| --- | --- | --- |
| Speed: constant + curve ramps with presets | ✅ | 6 ramp presets (montage, hero, bullet, flash in/out, jump) |
| Reverse | ✅ | Export is frame-exact; preview seeks frame by frame |
| Freeze frame | ✅ | `clip/freeze` |
| Crop, rotate, flip, opacity | ✅ | Crop presets 9:16, 1:1, 4:5, 16:9 |
| Blend modes | ✅ | 12 modes in a shader (W3C formulas) |
| Keyframes on every property | ✅ | Position, scale, rotation, opacity, crop, volume, every effect parameter; linear / ease / hold / bezier |

## Transitions and effects

| Feature | Status | Notes |
| --- | --- | --- |
| 80+ transitions, adjustable duration and easing | ✅ | 86 transitions in 5 groups |
| 150+ shader effects | ✅ | 170+ effects; every one is compiled **and rendered** in the diagnostics test |
| `.cube` LUTs | ✅ | 3D texture; E2E checks an invert LUT in the export |
| Colour wheels, curves, HSL | ✅ | Plus levels, vibrance, split tone, channel mixer, white balance, 40 looks |
| Auto colour match between clips | ✅ | Mean/std transfer from thumbnails |

## Keying and masks

| Feature | Status | Notes |
| --- | --- | --- |
| Chroma key with spill suppression | ✅ | E2E with a green-screen clip |
| Shape and pen masks with feather | ✅ | Rectangle, ellipse, linear, spotlight, 3–6 point pen mask |
| AI background removal | ✅ | MediaPipe selfie segmenter in the browser; E2E runs the real model |
| AI person/object cutout **with tracking** | 🟡 | Person cutout works per frame (no tracking needed). Tracking an arbitrary object is not built yet |

## Text and captions

| Feature | Status | Notes |
| --- | --- | --- |
| Animated templates | ✅ | 8 text templates + 10 in/out animations |
| Per-word karaoke captions | ✅ | Word highlight colour per style |
| Auto captions: Hindi, English, Hinglish, Urdu + editable transcript | ✅ | Whisper base/small **in the browser** (first run downloads the model). Hinglish = Hindi recognition + our own Devanagari→Latin transliteration. Real-model quality must be checked on a phone; CI uses a stand-in recogniser |
| Text-to-speech voices | ☁️ | Browsers cannot record their built-in voices to a file. Needs a TTS model on the server |

## Smart tools

| Feature | Status | Notes |
| --- | --- | --- |
| Beat detection + auto cut-to-beat | ✅ | Onset envelope + tempo autocorrelation, ±3 % BPM in tests |
| Auto reframe 16:9 → 9:16 following the subject | ✅ | MediaPipe object detector + smoothed pan keyframes |
| Silence removal | ✅ | RMS threshold, padding, ripple |
| Filler-word removal, transcript-based editing | ✅ | Tap words to cut them from every track |
| Stabilisation | ☁️ | Good stabilisation needs optical flow over the whole clip; planned for the render worker |
| AI upscale | ☁️ | Needs a GPU model on the server |

## Canvas and export

| Feature | Status | Notes |
| --- | --- | --- |
| 9:16, 16:9, 1:1, 4:5, custom; blur/colour/image backgrounds | ✅ | |
| Up to 4K 60 fps | ✅ | |
| H.264, H.265, VP9, AV1 where supported | ✅ | Falls back automatically per device |
| Transparent export | 🟡 | In the browser: transparent **PNG sequence (.zip)**. Browsers cannot encode video with alpha yet (`Alpha encoding is not currently supported`), so transparent WebM and ProRes 4444 come with the server render ☁️ |
| GIF | ✅ | Own encoder |
| Presets for Reels, Shorts, YouTube, X | ✅ | Plus WhatsApp status and GIF |
| No watermark | ✅ | |

## Done-when check

> Every Module 1 feature passes E2E tests and a 4K export matches the preview frame-for-frame (pixel-diff test).

- `e2e/phase2-pixel.spec.ts`: a 4K **lossless** export (PNG sequence) is pixel-identical to the preview (mean difference 0.00). The 4K MP4 differs only by encoder noise (≈1.7–2.3 mean abs difference, below what x264 at the same bitrate scores on the same frame).
- To make this true, the paused preview now shows frames decoded by the same WebCodecs decoder as the export.
- Items marked ☁️ cannot reach the target quality in a phone browser; they are planned for the server workers in Phase 6, which needs a paid GPU host.
