#!/bin/bash
# Keep the photo2pgn reader (cli/pgn-worker.mjs) running on this Mac with launchd.
# Starts at login, restarts if it exits with an error, logs to
# ~/Library/Logs/photo2pgn-worker.log. Safe to re-run: it replaces the agent.
#
#   bash install-pgn-worker-agent.sh            install or update
#   bash install-pgn-worker-agent.sh uninstall  remove it
#
# Override the defaults with REPO=..., TOKEN_FILE=... or SITE=... in front.
set -euo pipefail

REPO="${REPO:-$HOME/photo2pgn}"
TOKEN_FILE="${TOKEN_FILE:-$HOME/.config/photo2pgn/worker-token}"
SITE="${SITE:-https://photo2pgn.hintwise.org}"
LABEL="org.hintwise.photo2pgn-worker"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/photo2pgn-worker.log"
DOMAIN="gui/$(id -u)"

if [ "${1:-}" = "uninstall" ]; then
  launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
  rm -f "$PLIST"
  echo "Removed $LABEL."
  exit 0
fi

fail() { echo "Not installed: $*" >&2; exit 1; }

# launchd does not read your shell profile, so find the tools now and write
# their full paths into the agent.
NODE="$(command -v node)" || fail "node is not on PATH."
CLAUDE="$(command -v claude)" || fail "claude (Claude Code) is not on PATH."
"$NODE" -e 'process.exit(+process.versions.node.split(".")[0] >= 22 ? 0 : 1)' \
  || fail "Node 22 or later is needed ($("$NODE" --version) found)."
[ -f "$REPO/cli/pgn-worker.mjs" ] || fail "$REPO/cli/pgn-worker.mjs is missing: clone the repo first."
[ -s "$TOKEN_FILE" ] || fail "$TOKEN_FILE is missing or empty."
chmod 600 "$TOKEN_FILE"

# The same check as by hand: the site answers and accepts the token.
echo "Checking the site and the token..."
"$NODE" "$REPO/cli/pgn-worker.mjs" --site "$SITE" --token-file "$TOKEN_FILE" --claude "$CLAUDE" --list \
  || fail "the check above failed."

# One reader is enough: stop the tmux one if it is running.
command -v tmux >/dev/null && tmux kill-session -t pgn 2>/dev/null && echo "Stopped the tmux reader." || true

mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE</string>
    <string>$REPO/cli/pgn-worker.mjs</string>
    <string>--site</string>
    <string>$SITE</string>
    <string>--token-file</string>
    <string>$TOKEN_FILE</string>
    <string>--claude</string>
    <string>$CLAUDE</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$REPO</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>HOME</key>
    <string>$HOME</string>
    <key>PATH</key>
    <string>$(dirname "$NODE"):$(dirname "$CLAUDE"):/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <!-- Restart after an error exit (a setup problem, a crash), not after a clean stop. -->
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <!-- Wait 5 minutes between restarts, so a wrong token does not spin. -->
  <key>ThrottleInterval</key>
  <integer>300</integer>
  <key>StandardOutPath</key>
  <string>$LOG</string>
  <key>StandardErrorPath</key>
  <string>$LOG</string>
</dict>
</plist>
EOF
plutil -lint "$PLIST" >/dev/null || fail "the generated $PLIST is not a valid plist."

launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
launchctl bootstrap "$DOMAIN" "$PLIST"
sleep 5
if launchctl print "$DOMAIN/$LABEL" | grep -q "state = running"; then
  echo "Running. Log: $LOG"
else
  echo "Installed, but not running yet. See: launchctl print $DOMAIN/$LABEL ; tail $LOG" >&2
  exit 1
fi
