---
name: reel-editor
description: Plan, analyse and build Instagram Reels / Shorts style edits (anime dialogue, POV story with notification, aesthetic detail, hook + lyric montage, book quote reveal, talking-head funnel with captions and CTA, scenic couple lyric montage, dream card, minimal lyric card) with Just See. Use when the user shares a reel to recreate, asks "is type ki video banao", wants a video breakdown, or asks for a reel blueprint.
---

# Reel editor playbook (Just See)

Use this when someone wants a reel like one they saw, or wants a breakdown of a reel.
Formats and techniques are fine to recreate; never copy another creator's footage, art,
music, logo or watermark. The user brings their own clips, their own or licensed art,
and built-in or licensed music.

## 1. Analyse a reference video at 5 levels

Say which parts are **facts from the file** (duration, resolution, fps, audio stream,
visible text/timestamps) and which are **inference** (maker's intent, software used).
Shooting date, place and the editing app are usually not inside the file. Do not guess
them, unless something visible in the frame shows them (like a school name on a wall).

1. **Pre-production**: concept, trope, hook, mood, shot list.
2. **Cinematography**: angles, framing, movement, focus, light, foreground depth.
3. **Editing**: cut list with timestamps, transitions, speed, text placement, grade.
4. **Sound**: song mood, vocals vs instrumental, SFX, ambience, sync points, fades.
   If there is no audio stream, say so and do not invent beat timings.
5. **Post**: resolution, fps, codec, export settings, watermark / end card.

Technical facts: `ffprobe -v error -show_streams -show_format -of json file.mp4`.
Frames: `ffmpeg -ss T -i file.mp4 -frames:v 1 out.png`.

## 2. Pick the matching built-in style

| Reference looks like | Style id | Key pieces |
| --- | --- | --- |
| Anime/manhwa stills + dialogue lines + romantic song | `anime-dialogue` | dialogue template, Ken Burns, white flash, bloom |
| Live-action POV mini story, phone notification, caring act | `pov-story` | hook header, notification pop-up, crossfades |
| Faceless details (hands, fabric, beads), one poetic line | `aesthetic-detail` | sepia + fade + grain, centred line |
| Sarcastic hook, then 1 s moody cuts with lyric words | `hook-montage` | header, desaturated grade, cut to beat |
| Book page quote, slow push-in, cover reveal | `quote-reveal` | reaction header, warm grade, blur dissolve |
| Talking head teaching, B-roll proof, labels, comment CTA | `talking-head` | auto captions, label pop, CTA end card, studio voice |
| Scenic couple music video with small lyric subtitles | `scenic-lyric` | muted greens, bloom, blur dissolves, cinematic music |
| Black quote card, then slow-mo glowing dance | `dream-card` | quote card, 0.5× speed, bloom + grain, white flash |
| No filming: top banner + minimal shapes + serif lyrics | `lyric-card` | hook header + lyric-card motion template |

Full breakdowns of the 10 reference reels and the cinematic couple montage are in
`references/reel-formats.md`. Read it when you need timings or shot lists.

## 3. Build it

**In the app (phone/laptop):** add the clips in order → Library → Reel styles → pick
the style → fill the text (header, lines, @handle) → Apply. Then fine-tune:
- trims, and Mark beats → Cut to beat for montages;
- captions (auto, karaoke) for speech;
- Motion studio for custom overlays;
- export at 1080×1920, 30 fps.

**Through the connector (Claude / ChatGPT):**
1. `create_video` (9:16).
2. `add_media` / `get_upload_link`, then `list_media`.
3. `get_style_guide <style>` to plan trims and text.
4. `add_clip` for each clip (with trims), in order.
5. `apply_style` with fields.
6. Optional: `add_text`, `add_captions`, `add_sound_effect` and `fit_duration`.
7. `render_video`, then send the link to the user, then `get_render` for the MP4.

## 4. Quality checklist before saying "done"

- Hook in the first 1–2 s (text or striking image); story readable with sound off.
- Text inside the safe area: top 10 % and bottom 15 % stay clear of app buttons.
- One idea per shot; cuts on actions or on vocal phrases / beats.
- Grade consistent across clips; faces natural.
- Music not louder than speech (auto duck); fade out at the end.
- End card with the user's own @handle; last frame is not abrupt.
- Credits for any CC BY media (Library → Licences → Copy credits).
