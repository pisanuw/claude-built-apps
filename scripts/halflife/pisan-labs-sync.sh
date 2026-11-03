#!/bin/bash
# Daily on halflife: create any missing pisan-labs repos, refresh every repo's
# About box from scripts/pisan-labs-repos.csv, then run the "Mirror apps"
# workflow so new and changed apps reach their pisan-labs repos.
#
# It works in its own clone (PISAN_LABS_SYNC_DIR), never in your working copy,
# so it cannot switch your branch or touch uncommitted work.
#
# Needs: gh logged in as an owner of pisan-labs, with the workflow scope
# (gh auth refresh -s workflow), plus git and python3.
# Install with scripts/halflife/install.sh. Log: ~/Library/Logs/pisan-labs-sync.log
set -euo pipefail
export PATH="${PATH:-/usr/bin:/bin}:/opt/homebrew/bin:/usr/local/bin"

REPO=pisanuw/claude-built-apps
DIR="${PISAN_LABS_SYNC_DIR:-$HOME/.local/share/pisan-labs-sync/claude-built-apps}"
say() { printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S %Z')" "$*"; }

say "start"
if ! gh auth status >/dev/null 2>&1; then
  say "ERROR: gh is not logged in (run: gh auth login)"; exit 1
fi
if [ ! -d "$DIR/.git" ]; then
  mkdir -p "$(dirname "$DIR")"
  git clone --quiet "https://github.com/$REPO.git" "$DIR"
fi
git -C "$DIR" fetch --quiet origin main
git -C "$DIR" checkout --quiet -B main origin/main
say "claude-built-apps at $(git -C "$DIR" rev-parse --short HEAD)"

# Creates missing repos (public, empty) and syncs description, homepage, topics.
python3 "$DIR/scripts/pisan_labs_setup.py" | sed 's/^/  /'

# A manual run mirrors every listed app; pushes that change nothing are no-ops.
gh workflow run mirror.yml --repo "$REPO" --ref main
say "Mirror apps started: https://github.com/$REPO/actions/workflows/mirror.yml"
say "done"
