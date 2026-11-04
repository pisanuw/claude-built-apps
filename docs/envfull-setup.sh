#!/bin/bash
# Setup script for EnvFull, the cloud environment the scheduled routines share
# (claude-built-apps, daily-project-ideas, teacherspayteachers, dsa-instructor;
# Full network, no variables, no network secrets). This file is the copy kept
# in git: the live one is pasted under Setup script in the environment dialog
# at claude.ai/code. Saving a change there rebuilds every repository's cache.
# The deployed copy of 2026-11-03 calls the environment "Routines" in its
# first line; the code is the same.
#
# Measured 2026-11-03: the cache is kept per environment and repository (a
# second teacherspayteachers session restored its own snapshot, not the newer
# dsa-instructor one). Setup took 3 s for teacherspayteachers, 48 s for
# dsa-instructor and 27 s for claude-built-apps in EnvFull; daily-project-ideas
# needs nothing. A new app's npm install (288 packages, no lockfile) then took
# 13.5 s in EnvFull, against 21 s without the cache on 2026-11-02.
#
# Routine runs cache differently (seen in their startup logs, 2026-11-03/04;
# the docs do not describe it). They never read or write the cache above.
# Each routine keeps its own per environment: its first run there starts
# "new" (clone, then this script), and later runs start "resume-cached"
# from that first run's machine as it stood after this script (not the end
# of any run), fetching the repositories forward and skipping the script.
# So a change here reaches a routine only when its own cache is rebuilt.
# The build routine's first EnvFull run installed a new app in 4 s.
#
# It runs as root, one directory above the session's repository, before the
# environment's variables are set and before the GitHub proxy is up, once per
# environment cache: the first session, after an edit to this script or the
# allowed hosts, and about every 7 days. What it leaves on disk is the snapshot
# later sessions start from. Two rules from the docs: exit 0 (or no session
# starts) and finish within about 5 minutes (or nothing is cached and every
# session runs this again).
#
# The per-repository work lives in each repository's own
# .claude/cloud-setup.sh, versioned in git, so this script rarely changes.
# Each one runs under a time limit: a stalled download (seen 2026-11-03, a uv
# fetch hung for 10+ minutes) must not push the whole script past the cache
# limit. Each repository's SessionStart hook tops up whatever is missing.
set -u
start=$(date +%s)
ran=""

for d in */; do
  d=${d%/}
  [ -f "$d/.claude/cloud-setup.sh" ] || continue
  echo "routines-setup: $d/.claude/cloud-setup.sh" >&2
  if ( cd "$d" && timeout -k 10 200 bash .claude/cloud-setup.sh ); then
    ran="$ran $d"
  else
    echo "routines-setup: $d's script failed or timed out (exit $?); its SessionStart hook is the fallback" >&2
    ran="$ran $d(failed)"
  fi
done

# A stamp, so a session can tell when its snapshot was built and from which
# repository: cat /root/.routines-setup.json
printf '{"built_at":"%s","dir":"%s","repos":"%s","ran":"%s","seconds":%s}\n' \
  "$(date -u +%FT%TZ)" "$PWD" "$(ls -d */ 2>/dev/null | tr -d / | tr '\n' ' ')" \
  "${ran# }" "$(( $(date +%s) - start ))" > /root/.routines-setup.json || true

exit 0
