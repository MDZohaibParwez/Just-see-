---
name: just-see-tools
description: Complete guide to every Just See editing tool (app and Claude connector) — what each does, when to use it and how — plus professional editing, colour and audio workflow learned from a full DaVinci Resolve course. Use when editing a video with Just See, choosing which tool fits a request, explaining a tool, or mapping a feature from another editor (Resolve, CapCut, Premiere) to Just See.
---

# Just See tools: what, when, how

Two ways to edit: the **app** (phone/laptop browser) and the **connector** (Claude edits a "recipe"; the render link builds it in a browser). Feature status and the Resolve → Just See map: `docs/reference-tools.md`. Reel formats: the `reel-editor` skill.

## 1. Workflow that works (from the pro course)

1. **Gather and sort** clips first. Name what each clip is (hook, b-roll, talking, ending).
2. **Anchor technique**: place the 2–3 shots the story can't live without, then fill around them.
3. **Rough cut** for story, then **fine cut** (trim, slip, roll) for timing. Don't grade or mix before the cut is locked.
4. **Cut on action** (a hand moving, a turn) so cuts feel invisible; ask "what does the viewer want to see next?"
5. **Effects and graphics**, then **colour**, then **audio mix**, then **export**. Work in passes.
6. **Colour order**: balance each shot (exposure, white balance) → match shots to each other → apply one look over the scene. Use scopes, not only eyes; reset your eyes on a neutral image.
7. **Audio order**: dialogue clean and level → music under dialogue (duck) → sound effects for every visible action → loudness to -14 LUFS for social.

## 2. App tools

| Need | Tool (where) | How / tips |
| --- | --- | --- |
| Start fast | **Quick reel** (home) | Pick videos → 9:16 reel ≤ 30 s with music, Export open |
| Add clips | **Media** / **Overlay** (toolbar) | Overlay = picture-in-picture layer above |
| Cut, trim | **Split**, edit modes **Trim / Roll / Slip / Slide** | Roll moves a cut without changing length; slip changes what part of the clip shows |
| Speed | **Speed** → constant or curve | Ramps for hits on the beat; freeze frame for emphasis |
| Move/zoom/rotate | Drag on the preview, keyframe ◆ | Keyframe start and end; ease in/out |
| Shake | **Stabilize** | Then a slight zoom hides edges |
| Vertical from wide | **Auto reframe** | Follows the main subject |
| **Faces** | **Face** → Follow / Blur / Mosaic / Stick | Follow keeps the face centred with zoom (talking heads, vlogs). Blur/Mosaic for privacy. Stick = emoji/text that rides above the head. Works while the person moves |
| Look | **Effects** (looks, film, blur, glitch…), **Adjust** (wheels, curves, HSL), LUT import | Balance first, look last |
| Match shots | **Match colour** chip in Effects → Colour | Pick the reference clip |
| Cut-outs | **Remove background**, chroma key, masks | Masks take keyframes; feather edges |
| Text | **Text** + styles + animations, **Motion** templates | Hooks big and early; keep inside safe area |
| Captions | **Captions** (auto, Hindi/English/Hinglish/Urdu) | Edit the words; bold-pop style for reels |
| Music | **Music**, Library moods, **Studio** beats | **Auto duck** under speech; cut-to-beat |
| Sound effects | **Sound effects** (75 built-in + yours) | Whoosh on transitions, impact on cuts |
| Voice | **Audio FX** → Studio voice, de-noise, EQ, reverb | -14 LUFS for social |
| AI voice | **AI voice** | English TTS |
| Live together | **Edit together** | Host keeps the master copy |
| Save / share | Export (MP4/WebM/GIF), Share link, backups | Presets for Reels/Shorts/YouTube |

## 3. Connector tools (Claude)

| Tool | Use when | Notes |
| --- | --- | --- |
| `create_video` | New edit | aspect 9:16 for reels |
| `add_media` | User gives a link (Google Drive share link "Anyone with the link", Dropbox, OneDrive, direct) | Big files answer at once and download in the background → call `list_media` after ~1 min. Up to 900 MB |
| `get_upload_link` | Clips are on the user's phone | Then `list_media` |
| `list_media` | See ids and lengths; check downloads | Shows "(downloading…)" / "(failed)" lines |
| `get_transcript` | Know what is said (pick best lines, cut silences, place B-roll/captions on words) | Ready a few minutes after `add_media` (cloud worker). Hindi/English/Hinglish/Urdu |
| `get_frames` | Know what is on screen (people, place, text, shot type) before choosing clips and styles | Up to 12 frames with times |
| `add_clip` | Put clips in order, with trims | Plan the story first (anchor shots) |
| `add_text` | Hook, titles, CTA | style + position |
| `add_captions` | Talking videos | auto mode; style bold for reels |
| `add_music` | Mood music or a clip | ducks under speech |
| `add_sound_effect` | Whoosh, impact, pop… | `list_options` for names |
| `add_effect` | Look or effect on a clip | `list_options` for types |
| `track_face` | Person on camera: follow (zoom with face), blur/mosaic (privacy), stick (emoji/text on the face) | zoom 1 ≈ face a third of the height |
| `enhance_voice` | Any talking clip | Studio voice, -14 LUFS |
| `add_motion_template` | Lower third, subscribe, end card… | |
| `list_styles` / `get_style_guide` / `apply_style` | User wants a known reel format | See `reel-editor` skill |
| `fit_duration` | Exact length (15/30/60 s) | Trims clips evenly |
| `remove_step` / `get_video` | Review and fix the plan | |
| `render_video` | Finish | The cloud worker renders it within ~5–10 minutes even if every device is off; the user can also open the link to render at once. Personal mode deletes source clips once the render page has them |
| `get_render` | After the link was opened | Shows the MP4 link and **Cloud use** — always show those lines |
| `get_usage` | "Kitna cloud laga?" | Our own count; Claude's credits are in Claude → Settings → Usage |
| `delete_video` | Clean up | Never touches the user's Drive |

## 4. Mapping other editors' tools

Resolve / CapCut / Premiere names → Just See:
- Blade / Razor → Split · Ripple/Roll/Slip/Slide → edit modes · Retime / speed ramp → Speed curve
- Dynamic zoom / Ken Burns → keyframed scale · Stabilization → Stabilize · Smart reframe → Auto reframe
- IntelliTrack on a face / CapCut "face tracking" → **Face** tool · Magic Mask → Remove background
- Power window → masks (keyframe or face-track) · Primaries wheels → Adjust → wheels · Hue vs Sat → HSL
- Shot match → Match colour · LUT → Effects → Import LUT
- Fairlight EQ/compressor/reverb → Audio FX · Voice isolation → Studio voice · Ducking → Auto duck
- AI music editor (fit length) → *coming* (V1); meanwhile `fit_duration` on clips and mood music generated to length
- Deliver presets → Export presets

## 5. Not built yet (say so plainly, offer the workaround)

Track any object (only faces now) · AI music fit to length · qualifier (change one colour) · adjustment clip · scopes · multicam sync. Order and status: `docs/reference-tools.md`.
