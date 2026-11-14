#!/bin/sh
# Remove the OZdash app and all its data and settings from this Mac.
#
# Usage:
#   scripts/oz/uninstall.sh                 dry run: list what would be removed (default)
#   scripts/oz/uninstall.sh --yes           remove it (asks you to type "wipe ozdash" first)
#   options with --yes:
#     --no-backup      do not zip the data and settings first
#                      (default: ~/OZdash-wipe-backup-<date>.zip)
#     --signing-cert   also delete the "OZdash Local Signing" certificate (needed to build again)
#     --build-dirs     also delete ~/Projects/ozdash-build and the release/ folders of the checkouts
#
# Removes: /Applications/OZdash.app (+ staged update copies), ~/Library/Application Support/
# emdash-oz (databases, logs, MCP token, ticket events), the update backup and log, the
# com.emdash.oz preferences and caches, and the "OZdash Safe Storage" keychain key.
#
# Never touches: the official Emdash app and its data, the agent hooks in ~/.claude, ~/.codex
# and ~/.cursor (shared with Emdash, they do nothing outside its sessions), task worktrees,
# git checkouts, the vault, or the emdash-oz CLI. OZdash must be quit (it asks it to quit
# normally; it never force-kills).
set -eu

H="${OZDASH_UNINSTALL_HOME:-$HOME}"
APPS="${OZDASH_UNINSTALL_APPS:-/Applications}"
# File names always use the real id; only the quit target can be overridden (tests).
APP_ID="com.emdash.oz"
QUIT_ID="${OZDASH_BUNDLE_ID:-$APP_ID}"
SKIP_KEYCHAIN="${OZDASH_UNINSTALL_SKIP_KEYCHAIN:-0}" # tests only
QUIT_TIMEOUT="${OZDASH_QUIT_TIMEOUT:-60}"
APP="$APPS/OZdash.app"
DO=0
BACKUP=1
CERT=0
BUILD=0

while [ $# -gt 0 ]; do
  case "$1" in
    --yes) DO=1 ;;
    --no-backup) BACKUP=0 ;;
    --signing-cert) CERT=1 ;;
    --build-dirs) BUILD=1 ;;
    -h | --help)
      sed -n '2,21p' "$0"
      exit 0
      ;;
    *)
      echo "unknown argument: $1 (see --help)" >&2
      exit 1
      ;;
  esac
  shift
done

running() { pgrep -f "$APP/Contents/MacOS/" >/dev/null 2>&1; }

# Everything this script may remove, one path per line. Only paths that exist are used.
paths() {
  printf '%s\n' \
    "$APP" \
    "$APPS/.OZdash.app.new" \
    "$APPS/.OZdash.app.old" \
    "$H/Library/Application Support/emdash-oz" \
    "$H/Library/Application Support/OZdash-backup" \
    "$H/Library/Preferences/$APP_ID.plist" \
    "$H/Library/Logs/OZdash-update.log" \
    "$H/Library/Saved Application State/$APP_ID.savedState" \
    "$H/Library/Caches/$APP_ID" \
    "$H/Library/Caches/$APP_ID.ShipIt" \
    "$H/Library/HTTPStorages/$APP_ID" \
    "$H/Library/HTTPStorages/$APP_ID.binarycookies" \
    "$H/Library/WebKit/$APP_ID"
  if [ "$BUILD" = 1 ]; then
    printf '%s\n' \
      "$H/Projects/ozdash-build" \
      "$H/Projects/emdash/apps/emdash-desktop/release" \
      "$H/Projects/emdash-oz-fixes/apps/emdash-desktop/release"
  fi
}

has_keychain_item() { [ "$SKIP_KEYCHAIN" != 1 ] && security find-generic-password -s "OZdash Safe Storage" >/dev/null 2>&1; }
has_cert() { [ "$SKIP_KEYCHAIN" != 1 ] && security find-certificate -c "OZdash Local Signing" >/dev/null 2>&1; }

echo "OZdash uninstall: $([ "$DO" = 1 ] && echo "REMOVING" || echo "dry run, nothing is removed")"
echo
found=0
tmp_list="$(mktemp)"
trap 'rm -f "$tmp_list"' EXIT
paths | while IFS= read -r p; do
  if [ -e "$p" ]; then
    echo "  $(du -sh "$p" 2>/dev/null | cut -f1)	$p"
    printf '%s\n' "$p" >>"$tmp_list"
  fi
done
[ -s "$tmp_list" ] && found=1
if has_keychain_item; then
  echo "  keychain	\"OZdash Safe Storage\" (the app's encryption key)"
  found=1
fi
if [ "$CERT" = 1 ] && has_cert; then
  echo "  keychain	\"OZdash Local Signing\" certificate and key"
  found=1
fi
echo
echo "Kept: the official Emdash app and data, agent hooks, task worktrees, checkouts, vault."
[ "$CERT" = 1 ] || { has_cert && echo "Kept: the \"OZdash Local Signing\" certificate (add --signing-cert to remove)."; } || true
[ "$BUILD" = 1 ] || echo "Kept: build folders (add --build-dirs to remove)."

if [ "$found" = 0 ]; then
  echo "Nothing of OZdash is left on this Mac."
  exit 0
fi
if [ "$DO" != 1 ]; then
  echo
  echo "To remove the items above, run again with --yes."
  exit 0
fi

# --- removing ----------------------------------------------------------------
if [ -t 0 ]; then
  printf '\nType "wipe ozdash" to remove everything listed above: '
  read -r answer
  [ "$answer" = "wipe ozdash" ] || {
    echo "Stopped. Nothing was removed."
    exit 1
  }
elif [ "${OZDASH_UNINSTALL_CONFIRM:-}" != "wipe ozdash" ]; then
  echo "No terminal to confirm in. Nothing was removed." >&2
  exit 1
fi

if running; then
  echo "Asking OZdash to quit…"
  osascript -e "tell application id \"$QUIT_ID\" to quit" >/dev/null 2>&1 || true
  waited=0
  while running; do
    waited=$((waited + 1))
    if [ "$waited" -gt "$QUIT_TIMEOUT" ]; then
      echo "OZdash did not quit in ${QUIT_TIMEOUT}s. Quit it yourself, then run again. Nothing was removed." >&2
      exit 1
    fi
    sleep 1
  done
fi

if [ "$BACKUP" = 1 ]; then
  zip_path="$H/OZdash-wipe-backup-$(date +%Y%m%d-%H%M%S).zip"
  stage="$(mktemp -d)"
  for p in "$H/Library/Application Support/emdash-oz" "$H/Library/Preferences/$APP_ID.plist"; do
    [ -e "$p" ] && cp -R "$p" "$stage/"
  done
  if [ -n "$(ls -A "$stage")" ]; then
    ditto -c -k --norsrc "$stage" "$zip_path"
    echo "Backup of data and settings: $zip_path"
  fi
  rm -rf "$stage"
fi

# The build folder is a git worktree: remember its repo, so the entry can be pruned after.
build_repo=""
if [ "$BUILD" = 1 ] && [ -d "$H/Projects/ozdash-build" ]; then
  build_repo="$(git -C "$H/Projects/ozdash-build" rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)"
fi
while IFS= read -r p; do
  [ -e "$p" ] || continue
  rm -rf "$p"
  echo "removed $p"
done <"$tmp_list"
[ -z "$build_repo" ] || git --git-dir="$build_repo" worktree prune 2>/dev/null || true

# The preferences daemon caches settings in memory; drop that copy too.
[ "$SKIP_KEYCHAIN" = 1 ] || defaults delete "$APP_ID" >/dev/null 2>&1 || true
if has_keychain_item; then
  security delete-generic-password -s "OZdash Safe Storage" >/dev/null && echo "removed keychain \"OZdash Safe Storage\""
fi
if [ "$CERT" = 1 ] && has_cert; then
  security delete-identity -c "OZdash Local Signing" >/dev/null 2>&1 ||
    security delete-certificate -c "OZdash Local Signing" >/dev/null
  echo "removed keychain \"OZdash Local Signing\""
fi
echo "Done. OZdash is removed."
