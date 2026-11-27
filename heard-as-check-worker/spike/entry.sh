#!/bin/sh
# Starts the hub idle (as the image does), waits for its health route, then runs the spike.
set -e
cd /app/backend-hub
NODE_ENV=production PORT=10000 COOKIE_SECRET=spike-only TAGGING_DOCTOR_CHECKER=/app/tagging-doctor-worker/src/mount.ts \
  TAGGING_DOCTOR_JOBS_ROOT=/jobs node --disable-warning=ExperimentalWarning dist/index.js > /tmp/hub.log 2>&1 &
HUB=$!
for i in $(seq 1 100); do
  node -e "fetch('http://127.0.0.1:10000/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))" && break
  sleep 0.2
done
echo "hub up: $(node -e "fetch('http://127.0.0.1:10000/api/health').then(r=>r.text()).then(t=>console.log(t))")"
echo "hub rss kB: $(grep VmRSS /proc/$HUB/status)"
cd /app/spike
node spike.mjs "$@"
echo "hub rss kB after: $(grep VmRSS /proc/$HUB/status)"
