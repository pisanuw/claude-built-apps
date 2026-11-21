#!/bin/sh
# Runs scripts/spike.sh in a container with the given CPU limit and 512 MB, and
# samples the container's cgroup (v1) every 100 ms for peak memory: anonymous
# memory (rss) and the whole usage including page cache.
#   sh scripts/spike-measure.sh <image> <cpus> [plain|tagged]
set -eu
IMAGE=$1; CPUS=$2; MODE=${3:-plain}
DIR=$(cd "$(dirname "$0")/.." && pwd)
ID=$(docker run -d -e SAFER="${SAFER:-0}" --cpus "$CPUS" --memory 512m --memory-swap 512m \
  -v "$DIR/fixtures/math-notes:/fixture:ro" -v "$DIR/scripts:/scripts:ro" "$IMAGE" sh /scripts/spike.sh "$MODE")
CG=/sys/fs/cgroup/memory/docker/$ID
PEAK_RSS=0
while [ "$(docker inspect -f '{{.State.Running}}' "$ID")" = true ]; do
  RSS=$(awk '$1=="total_rss"{print $2}' "$CG/memory.stat" 2>/dev/null || echo 0)
  [ "${RSS:-0}" -gt "$PEAK_RSS" ] && PEAK_RSS=$RSS
  MAXU=$(cat "$CG/memory.max_usage_in_bytes" 2>/dev/null || echo "$MAXU")
  FAIL=$(cat "$CG/memory.failcnt" 2>/dev/null || echo "${FAIL:-0}")
  sleep 0.1
done
docker logs "$ID"
echo "MEMORY cpus=$CPUS mode=$MODE peak_rss_mb=$((PEAK_RSS / 1048576)) max_usage_incl_cache_mb=$((${MAXU:-0} / 1048576)) failcnt=${FAIL:-0} oom_killed=$(docker inspect -f '{{.State.OOMKilled}}' "$ID") exit=$(docker inspect -f '{{.State.ExitCode}}' "$ID")"
docker rm "$ID" >/dev/null
