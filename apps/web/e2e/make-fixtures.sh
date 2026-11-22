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
