#!/bin/bash
# Installs the daily pisan-labs sync as a launchd agent on this Mac.
#   scripts/halflife/install.sh          # install or update, runs daily 04:13
#   scripts/halflife/install.sh --remove # uninstall
# launchd, not cron: it runs a missed job when the Mac wakes up.
set -euo pipefail
LABEL=me.pisan.pisan-labs-sync
BIN="$HOME/.local/bin/pisan-labs-sync"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
HERE="$(cd "$(dirname "$0")" && pwd)"

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
if [ "${1:-}" = "--remove" ]; then
  rm -f "$PLIST" "$BIN"; echo "Removed $LABEL."; exit 0
fi

mkdir -p "$(dirname "$BIN")" "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
install -m 0755 "$HERE/pisan-labs-sync.sh" "$BIN"
cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>/bin/bash</string><string>$BIN</string></array>
  <key>StartCalendarInterval</key><dict><key>Hour</key><integer>4</integer><key>Minute</key><integer>13</integer></dict>
  <key>StandardOutPath</key><string>$HOME/Library/Logs/pisan-labs-sync.log</string>
  <key>StandardErrorPath</key><string>$HOME/Library/Logs/pisan-labs-sync.log</string>
</dict>
</plist>
PLIST
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "Installed $LABEL: daily at 04:13, log ~/Library/Logs/pisan-labs-sync.log"
echo "Run it now with: launchctl kickstart gui/$(id -u)/$LABEL"
