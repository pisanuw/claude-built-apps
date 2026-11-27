# Heard-As Check: the capture spike (AC-1)

A measurement, run once in a session on day 1 (2026-11-27); not the mount, and
never deployed. Milestone 2 writes the mount in `heard-as-check-worker/`; this
folder must stay out of backend-hub's build filter (SPEC open item S3-4).
The numbers and the go or no-go are in hintwise-workflow
`projects/heard-as-check/build/DECISIONS.md` (D-12 onwards).

What the image holds: the hub's Node image (same digest), backend-hub and its
mounts idle (mult-streak; Tagging Doctor's checker without TeX Live), Chrome
for Testing's headless shell 158.0.8127.36, pdf.js 6.5.438, veraPDF 1.30.4 as
the hub's image installs it, and a Java 21 runtime for it.

What a job does (`spike.mjs`): as root, it serves pdf.js and the file on
loopback; it starts Chromium as uid 10002 (`hacjob`: not root, not the
checker's 10001) with its sandbox on, over `--remote-debugging-pipe`; the page
(`static/capture.mjs`) renders one page at a time without drawing the canvas
and builds the job's own output (pdf.js's structure tree, and the show-text
strings with their marked-content ids); the driver reads each page's
accessibility tree in parts (`Accessibility.getChildAXNodes`, 64 calls at a
time); Chromium is closed; then veraPDF runs as uid 10002 with the checker's
Java flags. A sampler sums the job's memory every 100 ms.

## Run it

```sh
# 1. dockerd running; the hub and mult-streak built
(cd backend-hub && npm ci && npm run build); (cd mult-streak && npm ci && npm run build)
# 2. the image (downloads are checked by sha256)
DL=/some/scratch heard-as-check-worker/spike/build.sh
# 3. the fixtures
(cd heard-as-check && npm run fixtures)
# 4. the seccomp profile Chromium's sandbox needs under Docker (Docker's default refuses it)
curl -fsSL -o $DL/default.json https://raw.githubusercontent.com/moby/profiles/main/seccomp/default.json
node heard-as-check-worker/spike/make-seccomp.mjs $DL/default.json $DL/seccomp-chromium.json
# 5. AC-1's sequence (five-pages, stress, big-tree twice with one result held, five-pages)
docker run --rm --cpus 0.5 --memory 512m --memory-swap 512m --security-opt seccomp=$DL/seccomp-chromium.json \
  -v $PWD/heard-as-check/test/fixtures/out:/fixtures:ro -v $DL/results:/results hac-spike --plan default
# other plans: --plan canvas (basic and roles, with and without drawing); --plan single --files a,b
```

Root inside the container cannot read `smaps_rollup` of the job user's
processes, so the in-container sampler falls back to RssAnon + RssShmem
(S3-7); PSS split into anon, shmem and file was read from the host
(`/proc/<pid>/smaps_rollup` of uid 10002) during the same runs.

`veraPDF.json` was written in this image with `--network none`:
`docker run --rm --network none --entrypoint node -v $PWD/heard-as-check:/w -w /w -e VERAPDF='java <the checker flags> ... GreenfieldCliWrapper' hac-spike test/fixtures/verapdf.ts`.
