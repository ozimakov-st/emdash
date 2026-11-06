#!/bin/sh
# Rebuilds the OZdash branding assets from the scripts in this folder.
# Needs python3, rsvg-convert (brew install librsvg), swift, sips, tiffutil (macOS).
#
# Usage: scripts/oz/make-branding.sh
# Writes:
#   scripts/oz/ozdash-wordmark.svg                        (wordmark, for reference)
#   apps/emdash-desktop/build/dmg-background.tiff         (DMG window, 1x + 2x)
#   apps/emdash-desktop/src/assets/images/emdash/emdash-dev.png  (dev-build icon)
# The wordmark paths in emdash-logo.tsx and renderer/index.html come from
# `python3 scripts/oz/ozdash-wordmark.py --paths` (paste them when the art changes).
set -eu
HERE="$(cd "$(dirname "$0")" && pwd)"
APP="$HERE/../../apps/emdash-desktop"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

python3 "$HERE/ozdash-wordmark.py" > "$HERE/ozdash-wordmark.svg"

python3 "$HERE/dmg-background.py" > "$TMP/dmg.svg"
rsvg-convert -w 530 -h 319 "$TMP/dmg.svg" -o "$TMP/dmg.png"
rsvg-convert -w 1060 -h 638 "$TMP/dmg.svg" -o "$TMP/dmg@2x.png"
sips -s format tiff "$TMP/dmg.png" --out "$TMP/dmg.tiff" >/dev/null
sips -s format tiff "$TMP/dmg@2x.png" --out "$TMP/dmg@2x.tiff" >/dev/null
tiffutil -cathidpicheck "$TMP/dmg.tiff" "$TMP/dmg@2x.tiff" -out "$APP/build/dmg-background.tiff"

swift "$HERE/icon-dev.swift" "$APP/src/assets/images/emdash/emdash.png" \
  "$APP/src/assets/images/emdash/emdash-dev.png"
echo "Branding assets rebuilt."
