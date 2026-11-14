#!/bin/sh
# Update the OZdash app in /Applications. This is the only supported way to update it.
#
# Usage:
#   scripts/oz/update.sh [--ref <branch or commit>] [--yes]   build, then quit, swap, start
#   scripts/oz/update.sh --rollback [--yes]                     put the previous app back
#
# Steps:
#   1. Fetch, then build <ref> (default origin/oz/mcp-server, the fork branch on GitHub) in a
#      build-only worktree (~/Projects/ozdash-build),
#      then move the bundle to /Applications/.OZdash.app.new. The running app is not touched.
#   2. List agents that are working (app database, read-only). Quitting stops their current
#      turn; sessions resume after the start. Ask before going on (or --yes).
#   3. In a detached process (so it survives the quit, even when an OZdash agent or terminal
#      runs this script): quit OZdash normally (never a force kill), zip the old app to
#      ~/Library/Application Support/OZdash-backup/OZdash-prev.zip, swap in the new one, start it.
#      Log: ~/Library/Logs/OZdash-update.log
#
# Never run OZdash from a release/ folder, and never build in the checkout the app runs from.
set -eu

SELF="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
APP="${OZDASH_APP:-/Applications/OZdash.app}"
STAGED="$(dirname "$APP")/.OZdash.app.new"
OLD="$(dirname "$APP")/.OZdash.app.old"
BACKUP_DIR="${OZDASH_BACKUP_DIR:-$HOME/Library/Application Support/OZdash-backup}"
BACKUP="$BACKUP_DIR/OZdash-prev.zip"
DB="${OZDASH_DB:-$HOME/Library/Application Support/emdash-oz/emdash4.db}"
LOG="${OZDASH_UPDATE_LOG:-$HOME/Library/Logs/OZdash-update.log}"
BUILD_DIR="${OZDASH_BUILD_DIR:-$HOME/Projects/ozdash-build}"
BUNDLE_ID="${OZDASH_BUNDLE_ID:-com.emdash.oz}"
QUIT_TIMEOUT="${OZDASH_QUIT_TIMEOUT:-120}"
REF="origin/oz/mcp-server"
YES=0
MODE=update

log() { printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }
fail() {
  log "ERROR: $*" >&2
  exit 1
}
running() { pgrep -f "$APP/Contents/MacOS/" >/dev/null 2>&1; }
version() { defaults read "$1/Contents/Info.plist" CFBundleShortVersionString 2>/dev/null || echo "?"; }

while [ $# -gt 0 ]; do
  case "$1" in
    --ref)
      [ $# -ge 2 ] || fail "--ref needs a value"
      REF="$2"
      shift
      ;;
    --yes) YES=1 ;;
    --rollback) MODE=rollback ;;
    --swap) MODE=swap ;; # internal: the detached quit/swap/start step
    -h | --help)
      sed -n '2,20p' "$SELF"
      exit 0
      ;;
    *) fail "unknown argument: $1" ;;
  esac
  shift
done

# Prints one line per agent the app marks as working. Read-only.
working_agents() {
  [ -f "$DB" ] || return 0
  sqlite3 -readonly "$DB" "SELECT t.name || ' / ' || c.title FROM conversations c
    JOIN tasks t ON t.id = c.task_id
    WHERE c.agent_status = 'working' AND t.archived_at IS NULL AND t.deleted_at IS NULL;" \
    2>/dev/null || echo "(could not read the app database: $DB)"
}

confirm_quit() {
  running || return 0
  agents="$(working_agents)"
  [ -n "$agents" ] || return 0
  echo "These agents are working. Quitting stops their current turn; they resume after the start:"
  echo "$agents" | sed 's/^/  - /'
  [ "$YES" = 1 ] && return 0
  if [ -t 0 ]; then
    printf 'Quit OZdash now? [y/N] '
    read -r answer
    case "$answer" in y | Y | yes) return 0 ;; esac
  fi
  fail "Stopped before quitting. The new build waits at $STAGED; run again later, or pass --yes."
}

# pnpm (and node) may be missing from PATH: nvm loads lazily in interactive shells only.
# Look in Homebrew and nvm's node folders, then give up with a clear message.
find_pnpm() {
  command -v pnpm >/dev/null 2>&1 && return 0
  found=""
  # The last match wins: nvm folders sort after Homebrew, the newest nvm node last.
  for dir in /opt/homebrew/bin "$HOME"/.nvm/versions/node/*/bin; do
    [ -x "$dir/pnpm" ] && found="$dir"
  done
  if [ -n "$found" ]; then
    PATH="$found:$PATH"
    export PATH
    log "Using pnpm from $found"
    return 0
  fi
  fail "pnpm not found. Run 'corepack enable pnpm' once (Node 24), then try again."
}

build() {
  if [ -n "${OZDASH_BUILT_APP:-}" ]; then
    # Tests: use a ready bundle instead of building.
    rm -rf "$STAGED"
    ditto "$OZDASH_BUILT_APP" "$STAGED"
    return
  fi
  find_pnpm
  if [ ! -d "$BUILD_DIR" ]; then
    log "Creating the build-only worktree $BUILD_DIR"
    git -C "$(dirname "$SELF")" fetch -q origin
    git -C "$(dirname "$SELF")" worktree add --detach "$BUILD_DIR" "$REF"
  fi
  git -C "$BUILD_DIR" fetch -q origin
  [ -z "$(git -C "$BUILD_DIR" status --porcelain)" ] ||
    fail "$BUILD_DIR has local changes. It is build-only; clean it first."
  git -C "$BUILD_DIR" checkout -q --detach "$REF"
  log "Building $REF @ $(git -C "$BUILD_DIR" rev-parse --short HEAD) in $BUILD_DIR"
  sh "$BUILD_DIR/scripts/oz/build-mac.sh"
  built="$BUILD_DIR/apps/emdash-desktop/release/mac-arm64/OZdash.app"
  # Move, not copy: no second OZdash.app stays behind for Spotlight to list.
  rm -rf "$STAGED"
  mv "$built" "$STAGED"
}

# Quit (if running), back up, swap, start. Runs detached from the caller.
swap() {
  [ -d "$STAGED" ] || fail "nothing staged at $STAGED"
  codesign --verify --deep --strict "$STAGED" || fail "the staged app has no valid signature"
  if running; then
    log "Asking OZdash to quit"
    osascript -e "tell application id \"$BUNDLE_ID\" to quit" >/dev/null 2>&1 || true
    waited=0
    while running; do
      waited=$((waited + 1))
      [ "$waited" -le "$QUIT_TIMEOUT" ] ||
        fail "OZdash did not quit in ${QUIT_TIMEOUT}s. Nothing changed; the new build waits at $STAGED."
      sleep 1
    done
  fi
  mkdir -p "$BACKUP_DIR"
  if [ -d "$APP" ]; then
    log "Backing up $(version "$APP") to $BACKUP"
    rm -f "$BACKUP.tmp"
    ditto -c -k --keepParent "$APP" "$BACKUP.tmp"
    mv -f "$BACKUP.tmp" "$BACKUP"
    rm -rf "$OLD"
    mv "$APP" "$OLD"
  fi
  mv "$STAGED" "$APP"
  rm -rf "$OLD"
  log "Installed $(version "$APP") at $APP"
  if [ "${OZDASH_NO_OPEN:-0}" != 1 ]; then
    open "$APP"
    log "Started OZdash"
  fi
}

detach_swap() {
  mkdir -p "$(dirname "$LOG")"
  log "Quit, swap and start continue in a detached process. Follow: tail -f \"$LOG\""
  # New session: the quit kills OZdash's terminals and agents, but not this step.
  python3 -I -c 'import os, sys; os.setsid(); os.execvp(sys.argv[1], sys.argv[1:])' \
    sh "$SELF" --swap </dev/null >>"$LOG" 2>&1 &
}

case "$MODE" in
  swap) swap ;;
  update)
    build
    log "Staged $(version "$STAGED") at $STAGED"
    confirm_quit
    detach_swap
    ;;
  rollback)
    [ -f "$BACKUP" ] || fail "no backup at $BACKUP"
    tmp="$(mktemp -d)"
    ditto -x -k "$BACKUP" "$tmp"
    rm -rf "$STAGED"
    mv "$tmp/$(basename "$APP")" "$STAGED"
    rm -rf "$tmp"
    log "Staged the backup $(version "$STAGED") at $STAGED"
    confirm_quit
    detach_swap
    ;;
esac
