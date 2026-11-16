#!/usr/bin/env bash
# Web-sized copies of the phone app recordings for the product page.
set -euo pipefail
SRC="${HOME}/Desktop/NASA/video"
OUT="$(cd "$(dirname "$0")/.." && pwd)/public/media"
for n in me areyouok emergency astra; do
  ffmpeg -y -loglevel error -i "${SRC}/phone-${n}.mp4" -an -vf "scale=480:-2" -c:v libx264 -crf 28 -preset slow -pix_fmt yuv420p -movflags +faststart "${OUT}/phone-${n}.mp4"
done
ls -la "${OUT}"/phone-*.mp4
