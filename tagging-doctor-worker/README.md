# Tagging Doctor's checker (`tagging-doctor-worker`)

The server behind Tagging Doctor's "Compile and check": it compiles a LaTeX
project with LuaLaTeX (TeX Live 2026) and checks the PDF against PDF/UA-2 with
veraPDF 1.30.4, one job at a time, and deletes everything within 30 minutes.
The app is at https://tagging-doctor.hintwise.org. Since the app's milestone
4b (CR-13) the checker runs as a mount of [backend-hub](../backend-hub/) at
`/tagging-doctor`, in the hub's Docker image (`backend-hub/Dockerfile`, whose
TeX stage is this folder's `Dockerfile`, line for line): `src/mount.ts`
(`startChecker`) is what the hub loads, with its `TAGGING_DOCTOR_*` env vars,
prefix taken off. Before, it was a Render service of its own on the free
instance; its `deploy/target.yml` is gone, and `src/main.ts` still runs the
checker alone (local runs, `tagging-doctor-worker:dev`).

## API

| Route | Token | What it does |
|---|---|---|
| `GET /api/health` (in the hub `/tagging-doctor/api/health`) | no | `status`, the TeX Live and veraPDF versions, the self-test, the queue |
| `POST /api/jobs?mainFile=<path>&mode=check` | yes | body: the project as a zip (at most 25 MB); 202 and the job |
| `GET /api/jobs/:id` | owner | status (`queued`, `running`, `done`, `failed`), result, failure, last 50 log lines |
| `GET /api/jobs/:id/pdf` | owner | the PDF, until 30 minutes after the check or a restart |
| `DELETE /api/jobs/:id` | owner | deletes the job and its files |

The token is the visitor's Supabase access token (`Authorization: Bearer`);
the worker checks it with Supabase and holds no secret. Only the app's origin
gets CORS permission (and `http://localhost:5173` with `ALLOW_LOCAL=1`).

## What a job may do

The upload is checked first: no links, no `..`, at most 2000 entries and
100 MB unpacked, only the file types in `src/zip.ts`. TeX runs as its own user
(uid 10001) with `--nosocket --no-shell-escape`, `openout_any=p`, rlimits, a
minimal environment and a 120-second limit for the whole job; it can write
only in its own job folder. Reads are not checked by TeX Live 2026, so the
other jobs' files are kept out of its reach by file permissions. See the
project's decisions D-56 to D-63 (hintwise-workflow
`projects/tagging-doctor/build/DECISIONS.md`).

## Run and test

```bash
npm ci && npm run lint && npm run typecheck && npm run coverage && npm run build
# The image tests run against the hub's image by default (AC-82):
(cd .. && docker build -f backend-hub/Dockerfile -t backend-hub:dev .)
npm run test:image                        # hostile fixtures, the API, load, the spike and hub.test.ts (AC-82)
# Or against this folder's image, the checker alone:
docker build -t tagging-doctor-worker:dev . && WORKER_IMAGE=tagging-doctor-worker:dev npm run test:image
sh scripts/spike-measure.sh <image> 0.1   # the AC-65 spike: one job at 0.1 CPU and 512 MB
```

The server is TypeScript that Node 24 runs directly (type stripping), so the
image has no npm install and no build step.
