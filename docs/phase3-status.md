# Phase 3 status — Audio studio (Module 2)

Legend: ✅ done and tested · 🟡 partly done · ⬜ not yet

Everything runs in the browser for free. There is no paid server.

## Done-when check

| Check | Result |
| --- | --- |
| A noisy phone voice recording becomes a clean -14 LUFS export in one tap | ✅ -26.8 LUFS → -14.0 LUFS, true peak -1.1 dBTP (`phase3-audio.spec`, measured with ffmpeg `ebur128`) |
| A 16-bar beat can be built with the sequencer, piano roll and mixer | ✅ The E2E test builds drums, chords and an 808 line, mixes them, exports a 40 s WAV (true peak < 0 dBTP) and sends it to the video |

## Edit mode

| Feature | Status | Notes |
| --- | --- | --- |
| One-tap Studio voice | ✅ | Denoise → de-hum → de-click → de-ess → EQ → compressor → -14 LUFS → limiter |
| Noise reduction, de-hum, de-click, de-ess, de-reverb, breath removal | ✅ | Spectral denoise in Rust/wasm, the rest in TypeScript |
| LUFS meter, true-peak limiter, normalise | ✅ | BS.1770 loudness; limiter uses 4× oversampled true-peak detection |
| Regions: position, trim, gain, fades, pitch | ✅ | Audio edit tab |
| Stems (vocals, drums, bass, other) and karaoke | 🟡 | Free DSP method (HPSS + mid/side). Works on most songs but is weaker than AI separation |
| Pitch shift, time-stretch | ✅ | Phase vocoder (formant not preserved) |
| Mic recording, Web MIDI | ✅ | Punch-in and takes not yet |
| Spectral brush/lasso | ⬜ | Later |
| Pitch correction (auto-tune) | ⬜ | Later |

## Produce mode

| Feature | Status | Notes |
| --- | --- | --- |
| Step sequencer (8 pads, 1–8 bar patterns) | ✅ | 3 kits: 808, studio, lofi |
| Piano roll with key/scale filter and chord helper | ✅ | |
| Instruments | ✅ | Subtractive (pluck, pad, lead, keys, bass), FM (bell, e-piano, brass), 808, sampler |
| Mixer: volume, pan, mute, solo, reverb send, sidechain pump, effects | ✅ | Volume/pan automation in the engine; no lane editor UI yet |
| BGM mood templates | ✅ | Upbeat, Cinematic, Lo-fi, Suspense, Theme/intro, Stinger |
| Export WAV, send to video | ✅ | Re-sending updates the same clip |
| MP3/AAC/FLAC export, stems export | ⬜ | WAV only for now |
| WAM plugins | ⬜ | Later |

## Sound effects (all synthesised by us, free for any use)

75 sounds in 6 groups, with search in English and Hindi/Hinglish words:

- **Transitions**: whoosh, fast whoosh, whoosh down, swish, whip, riser, long riser, downer, reverse cymbal, sweep, glitch
- **Impacts**: cinematic boom, bass drop, deep meme boom, punch hit, punch, logo impact, horror stinger, dun-dun-dun, body thud, kick
- **UI & tech**: click, mouse click, pop, bubble, subscribe bell, ding, notification, message sent, success, error buzzer, beep, censor beep, typing, camera shutter, coin, cash register, swipe
- **Foley**: footsteps, cloth rustle, door knock, door creak, door close, paper tear, glass clink, cup down, water drop, keys, heartbeat
- **Ambience / room tone**: wind, rain, thunder, birds, crickets, city traffic, cafe crowd (walla), room tone, ocean, fire
- **Meme & comedy**: record scratch, awkward crickets, drum roll, ba-dum-tss, boing, slide whistle, falling whistle, sad trombone, air horn, applause, xylophone up/down, magic sparkle

**My sounds**: users can add their own sound files. They stay in that user's project.

Voice filters: telephone, walkie-talkie, megaphone, old radio, muffled (next room), underwater, cave echo, echo/delay, robot, chipmunk, deep voice.

Real recorded sounds (footsteps, crowds, gunshots and so on) come in Phase 5 from licence-checked CC0 sources, with licence data stored on each asset.
