# Phase 4 status — Motion studio (Module 3)

Legend: ✅ done and tested · 🟡 partly done · ⬜ not yet

## Done-when check

| Check | Result |
| --- | --- |
| An animated lower third can be built and dropped into a video | ✅ Template → quick edit → "Add to video" → MP4 export; the lower-third area changes by 37.7 (mean abs diff) while the rest of the frame stays within 0.3 (`phase4-motion.spec`) |
| A logo reveal can be built and dropped into a video | ✅ The user's logo image is revealed with a ring draw, sparks and glow, and exported in the video |
| Built from scratch | ✅ Blank comp → shape layer → keyframes → graph easing → Lottie export → into the video; editing the comp updates the video preview live |

## Features

| Feature | Status | Notes |
| --- | --- | --- |
| Compositions of any size, frame rate and duration | ✅ | New comps match the video size |
| Layers: solid, shape, text, image, null | ✅ | Camera, light, adjustment, audio and precomp layers ⬜ |
| Keyframes on every number property | ✅ | Diamond toggle per property; dragging on the canvas writes keyframes |
| Graph editor | ✅ | Value curve, drag keyframes in time and value, easing presets, bezier handles with overshoot |
| Parenting, blend modes, track mattes (alpha, inverted, luma) | ✅ | |
| Masks with feather | ⬜ | Use a shape layer as a track matte for now |
| Shape layers: rect, ellipse, star, polygon, bezier path | ✅ | Round corners, gradient fill, stroke |
| Trim paths, repeater | ✅ | Unit-tested lengths and wrap-around |
| Text animators per character / word / line | ✅ | Offset, opacity, scale, rotation, blur, random order, soft edge |
| Text presets | 🟡 | 20 presets (plan says 50+) |
| Effects: glow, blur, drop shadow | ✅ | Particles, turbulent displace, light rays, fractal noise, motion blur ⬜ |
| Wiggle and loop | ✅ | As layer settings, not a general expression language |
| Safe JavaScript expressions | ⬜ | |
| 3D layers, camera, lights | ⬜ | |
| Motion tracking | ⬜ | |
| Templates with editable fields | ✅ | 8 templates: 3 lower thirds, 2 logo reveals, cinematic title, subscribe button, callout |
| Lottie export / import | 🟡 | Shapes, solids, nulls, text, transforms, trim paths, repeater, parenting. Text animators, effects, mattes and images are not exported. SVG ⬜ |
| Drops into the video timeline and updates live | ✅ | A timeline clip points at the comp, so every edit shows up straight away |
| Render to video | ✅ | Through the normal video export (MP4, WebM, GIF, PNG sequence) |
