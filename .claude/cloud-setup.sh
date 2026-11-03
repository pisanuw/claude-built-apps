#!/bin/bash
# Cloud environment setup for this repository. The shared environment's setup
# script runs it from the repository root, once per environment cache, before
# the session starts.
#
# The build routine starts a new app from the newest app's package.json and
# runs `npm install` (288 packages, about 21 s from the registry on
# 2026-11-02). Installing that same package.json once here leaves the packages
# in npm's cache (~/.npm), which the snapshot keeps, so the routine's install
# reads them from disk. Only the cache is kept; the scratch directory goes.
# Never fails the session.
set -u
newest=$(git log --diff-filter=A --format= --name-only -- '*/package.json' 2>/dev/null | head -1)
[ -n "$newest" ] && [ -f "$newest" ] || newest=$(ls -d */package.json 2>/dev/null | tail -1)
if [ -n "$newest" ]; then
  tmp=$(mktemp -d)
  cp "$newest" "$tmp/package.json"
  (cd "$tmp" && npm install --no-audit --no-fund --ignore-scripts >/dev/null 2>&1) ||
    echo "claude-built-apps cloud-setup: npm cache warm-up from $newest failed" >&2
  rm -rf "$tmp"
fi
exit 0
