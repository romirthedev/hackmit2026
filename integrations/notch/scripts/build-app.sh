#!/bin/bash
# Builds Notch.app from the SwiftPM package (no Xcode required).
# Usage: scripts/build-app.sh [--run]
set -euo pipefail

cd "$(dirname "$0")/.."

CONFIG=release
APP=build/Notch.app

echo "→ swift build -c $CONFIG"
swift build -c $CONFIG

echo "→ assembling $APP"
# Rollback insurance for self-modification: keep the last good bundle.
if [[ -d "$APP" ]]; then
    rm -rf "$APP.bak"
    cp -R "$APP" "$APP.bak"
fi
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp ".build/$CONFIG/Notch" "$APP/Contents/MacOS/Notch"
cp Resources/Info.plist "$APP/Contents/Info.plist"
# bundle art assets (everything except the plist)
find Resources -type f ! -name Info.plist -exec cp {} "$APP/Contents/Resources/" \;

# Stable identity keeps TCC grants (Accessibility etc.) across rebuilds;
# ad-hoc signatures change every build and invalidate them. The identity is a
# locally-created self-signed cert (see scripts/setup-signing.sh) — not
# trust-anchored, so it appears in `find-identity -p codesigning` but NOT in
# the `-v` valid-only list. codesign signs with it regardless; the designated
# requirement pins to the cert hash, which is all TCC needs.
if security find-identity -p codesigning 2>/dev/null | grep -q "Notch Dev Signing"; then
    echo "→ codesign (Notch Dev Signing)"
    codesign --force --sign "Notch Dev Signing" "$APP"
else
    echo "→ codesign (ad-hoc — TCC grants will reset on rebuild)"
    codesign --force --sign - "$APP"
fi

echo "✓ $APP"
if [[ "${1:-}" == "--run" ]]; then
    # Relaunch cleanly if already running.
    pkill -x Notch 2>/dev/null || true
    sleep 0.3
    open "$APP"
fi
