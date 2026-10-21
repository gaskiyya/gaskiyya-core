#!/bin/sh
set -e
cd "$(dirname "$0")"
command -v ffmpeg >/dev/null || { echo "ffmpeg is required (brew install ffmpeg)"; exit 1; }
[ -x .cache/venv/bin/python ] || python3 -m venv .cache/venv
.cache/venv/bin/pip install -q -r requirements.txt
