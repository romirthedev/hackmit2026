#!/bin/bash
# Start the actual Notch agent behind the paired REWIND workspace.
set -euo pipefail
cd "$(dirname "$0")/.."
APP="$(pwd)/build/Notch.app"
if [[ ! -x "$APP/Contents/MacOS/Notch" ]]; then
    echo "Build Notch first with integrations/notch/scripts/build-app.sh." >&2
    exit 1
fi
# Keep source permissions and the existing Notch tool policy. The phone owns
# speech playback and reminders; unattended vault consolidation is separate.
export NOTCH_AGENT_BACKEND=codex
export NOTCH_TTS=0
export NOTCH_CONSOLIDATE_HOURS=0
exec "$APP/Contents/MacOS/Notch" --rewind-control
