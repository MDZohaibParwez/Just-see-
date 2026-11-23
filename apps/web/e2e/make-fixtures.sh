#!/usr/bin/env bash
# Generates test media with ffmpeg (dev tool only, never shipped).
set -euo pipefail
cd "$(dirname "$0")/fixtures"
F="ffmpeg -y -hide_banner -loglevel error"
D=12.1
# 1: portrait 1080x1920 with tone
[ -f clip1.mp4 ] || $F -f lavfi -i "testsrc2=size=1080x1920:rate=30" -f lavfi -i "sine=frequency=330:sample_rate=48000" -t $D -c:v libx264 -preset veryfast -pix_fmt yuv420p -g 30 -bf 2 -c:a aac -b:a 128k clip1.mp4
# 2: landscape 1920x1080
[ -f clip2.mp4 ] || $F -f lavfi -i "smptehdbars=size=1920x1080:rate=30" -f lavfi -i "sine=frequency=440:sample_rate=44100" -t $D -c:v libx264 -preset veryfast -pix_fmt yuv420p -c:a aac clip2.mp4
# 3: phone-style: stored landscape, display rotation (portrait on screen)
[ -f clip3-src.mp4 ] || $F -f lavfi -i "testsrc=size=1280x720:rate=30" -f lavfi -i "sine=frequency=550:sample_rate=48000" -t $D -c:v libx264 -preset veryfast -pix_fmt yuv420p -c:a aac clip3-src.mp4
[ -f clip3.mp4 ] || $F -display_rotation 90 -i clip3-src.mp4 -c copy clip3.mp4
# 4: no audio, 60 fps
[ -f clip4.mp4 ] || $F -f lavfi -i "mandelbrot=size=720x1280:rate=60" -t $D -c:v libx264 -preset veryfast -pix_fmt yuv420p clip4.mp4
# 5: 25 fps square
[ -f clip5.mp4 ] || $F -f lavfi -i "rgbtestsrc=size=1080x1080:rate=25" -f lavfi -i "sine=frequency=660:sample_rate=48000" -t $D -c:v libx264 -preset veryfast -pix_fmt yuv420p -c:a aac clip5.mp4
# music, 70 s
[ -f music.mp3 ] || $F -f lavfi -i "sine=frequency=220:sample_rate=44100,volume=0.4" -t 70 -c:a libmp3lame -b:a 128k music.mp3
# photo
[ -f photo.png ] || $F -f lavfi -i "testsrc2=size=1200x1600" -frames:v 1 photo.png
# invert LUT
[ -f invert.cube ] || printf 'TITLE "Invert"\nLUT_3D_SIZE 2\n1 1 1\n0 1 1\n1 0 1\n0 0 1\n1 1 0\n0 1 0\n1 0 0\n0 0 0\n' > invert.cube
# green screen clip: green background with a moving white box
[ -f greenscreen.mp4 ] || $F -f lavfi -i "color=c=0x00ff00:size=720x1280:rate=30,drawbox=x='100+t*40':y=400:w=300:h=300:color=white:t=fill" -t 4 -c:v libx264 -preset veryfast -pix_fmt yuv420p greenscreen.mp4
# 120 BPM click track, 10 s
[ -f beat.mp3 ] || $F -f lavfi -i "aevalsrc='0.8*sin(2*PI*900*t)*exp(-60*mod(t-0.25,0.5))*gte(t,0.25)':s=44100:d=10" -c:a libmp3lame -b:a 128k beat.mp3
# tone, 2 s silence, tone
[ -f gap.mp3 ] || $F -f lavfi -i "aevalsrc='0.5*sin(2*PI*300*t)*(lt(t,2)+gte(t,4))':s=44100:d=6" -c:a libmp3lame -b:a 128k gap.mp3
# Noisy phone voice: buzzy "speech" bursts + hiss + 50 Hz hum, quiet level.
[ -f noisy-voice.mp4 ] || $F -f lavfi -i "color=c=0x334455:size=720x1280:rate=30" -f lavfi -i "aevalsrc='0.08*(sin(2*PI*150*t)+0.5*sin(2*PI*300*t)+0.3*sin(2*PI*450*t)+0.2*sin(2*PI*900*t))*gt(sin(2*PI*0.6*t),0)+0.02*sin(2*PI*50*t)':s=48000:d=8" -f lavfi -i "anoisesrc=color=white:amplitude=0.02:d=8:r=48000" -filter_complex "[1:a][2:a]amix=inputs=2:normalize=0[a]" -map 0:v -map "[a]" -t 8 -c:v libx264 -preset veryfast -pix_fmt yuv420p -c:a aac -b:a 128k noisy-voice.mp4
# Shaky handheld-style clip (moving crop of clip1) for the stabiliser.
[ -f shaky.mp4 ] || $F -i clip1.mp4 -vf "crop=w=iw-48:h=ih-48:x='24+18*sin(t*11)+6*sin(t*29)':y='24+16*cos(t*13)+5*sin(t*31)',scale=480:-2" -t 6 -an -c:v libx264 -pix_fmt yuv420p shaky.mp4
