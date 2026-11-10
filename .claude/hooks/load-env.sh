#!/bin/bash
# SessionStart hook: decrypt .env-claude.asc and load it into the session's
# shell. Does nothing unless the environment provides GPG_KEY_B64 and
# GPG_PASSPHRASE, so it is a no-op on machines without them.
# Prints only a count, never values: hook output enters the model's context.
set -euo pipefail
[ -n "${GPG_KEY_B64:-}" ] && [ -n "${GPG_PASSPHRASE:-}" ] || exit 0
src="${CLAUDE_PROJECT_DIR:-.}/.env-claude.asc"
[ -f "$src" ] || exit 0
out="$HOME/.env-claude"
GNUPGHOME="$(mktemp -d)"; export GNUPGHOME
trap 'gpgconf --kill gpg-agent 2>/dev/null; rm -rf "$GNUPGHOME"' EXIT
printf '%s' "$GPG_KEY_B64" | base64 -d | gpg --batch --quiet --import 2>/dev/null
umask 077
printf '%s' "$GPG_PASSPHRASE" | gpg --batch --quiet --pinentry-mode loopback \
  --passphrase-fd 0 --decrypt "$src" > "$out"
[ -n "${CLAUDE_ENV_FILE:-}" ] && echo "set -a; . '$out'; set +a" >> "$CLAUDE_ENV_FILE"
echo "Loaded $(grep -c '^[A-Za-z_]' "$out") variables from .env-claude.asc"
