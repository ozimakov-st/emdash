#!/bin/sh
# Build the OZdash app for this Mac (Apple Silicon), unsigned by Apple,
# then sign it ad hoc so macOS lets it start.
#
# Usage: scripts/oz/build-mac.sh
# Result: apps/emdash-desktop/release/mac-arm64/OZdash.app (+ .dmg, .zip)
#
# Why the ad hoc signature: electron-builder flips Electron fuses after
# packaging, which breaks the original signature. Without a valid signature,
# macOS kills the app at start ("Code Signature Invalid").
set -eu
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
APP="$ROOT/apps/emdash-desktop/release/mac-arm64/OZdash.app"

cd "$ROOT"
pnpm install
cd apps/emdash-desktop
CSC_IDENTITY_AUTO_DISCOVERY=false pnpm run package:mac -- --arm64 --publish never
codesign --force --deep --sign - "$APP"
codesign --verify --deep --strict "$APP"
echo "Built and signed: $APP"
