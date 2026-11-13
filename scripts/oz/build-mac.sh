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

# Never overwrite the bundle a running OZdash uses. Deleting or replacing it while the
# app runs breaks every new agent: "spawn .../OZdash Helper ENOENT". Run the app from
# /Applications (ditto the built bundle there) and build in any worktree.
if pgrep -f "$APP/Contents/" >/dev/null 2>&1; then
  echo "OZdash is running from $APP. Quit it first, or build in another worktree." >&2
  exit 1
fi

cd "$ROOT"
pnpm install
# Build the workspace packages first (@emdash/core, @emdash/plugins, …). The app build
# bundles their dist/ output, not their sources, so a stale dist/ ships old agent code
# (this once lost cursor --model and codex reasoning effort). The release workflows do
# the same through the root `pnpm run build`.
# Clean dist/ first and skip the nx cache: old hashed chunks left in dist/ once broke
# the app build ("Exported variable ... is not defined").
rm -rf packages/*/dist
pnpm exec nx run-many -t build --skip-nx-cache --exclude='@emdash/emdash-desktop,@emdash/workspace-server'
cd apps/emdash-desktop
CSC_IDENTITY_AUTO_DISCOVERY=false pnpm run package:mac -- --arm64 --publish never
# Sign with the local "OZdash Local Signing" certificate when it exists
# (scripts/oz/make-signing-cert.sh), so the signature stays the same across
# builds (macOS still asks for keychain access once per rebuild, because a
# self-signed certificate has no Apple Team ID). Otherwise sign ad hoc.
IDENTITY="$(security find-certificate -c "OZdash Local Signing" -Z 2>/dev/null | awk '/SHA-1/ {print $3}')"
codesign --force --deep --sign "${IDENTITY:--}" "$APP"
codesign --verify --deep --strict "$APP"
# The notification chime (same Glass sound as the other OZ notifications).
CHIME="$HOME/Library/Application Support/emdash-oz/chime.wav"
if [ ! -f "$CHIME" ]; then
  mkdir -p "$(dirname "$CHIME")"
  afconvert -f WAVE -d LEI16 /System/Library/Sounds/Glass.aiff "$CHIME"
fi
echo "Built and signed: $APP"
