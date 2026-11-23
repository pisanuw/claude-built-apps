# backend-hub

One Render web service hosting several small, low-traffic backends behind
path prefixes. Render bills per service instance, not per CPU used, so three
idle $7/month services collapse into one.

## Mounts

| Prefix | App | Status |
|---|---|---|
| `/mult-streak/` | [mult-streak](../mult-streak/) multiplication-streak game | live |
| `/tagging-doctor/` | [Tagging Doctor](../tagging-doctor/)'s checker ([tagging-doctor-worker](../tagging-doctor-worker/)): LuaLaTeX and veraPDF, one job at a time; health at `/tagging-doctor/api/health` | mounted from Tagging Doctor's milestone 4b (CR-13); needs the Docker image |
| `/chat/` | chatwithdigitalme (separate repo) | reserved, answers 501; **will not move** (checked 2026-11-18): it is a Python/FastAPI Docker app with scikit-learn and a SQLite database on a Render disk, and this hub is one Node process with no disk |
| `/dsa/` | dsa-instructor (separate repo) | **stays standalone** — redirects to <https://ypdsa.pisan.me> |

dsa-instructor will NOT move into the hub (decided 2026-08): it is a
Python/FastAPI Docker service with a 2 GB persistent disk and 2 GB memory
needs, which doesn't fit this Node hub's shared 512 MB free instance.

`GET /` renders an index of the mounts; `GET /api/health` is the hub-wide
health check Render probes. The checker's own health route is
`GET /tagging-doctor/api/health`; when its self-test fails it answers
`compile: false` and takes no job, and the hub's other mounts run on.

## How it works

`src/hub.ts` builds one Express app. Each backend exports an app factory and
is mounted with `hub.use('/<name>', app)`; the hub adds a root index, a root
health check, and a `301` from `/<name>` to `/<name>/` so the mounted page's
relative fetch paths resolve. mult-streak is consumed as a
`file:../mult-streak` dependency and its idle-email sweep is armed by
`startBackgroundJobs()`.

## The Docker image

Since Tagging Doctor's milestone 4b the hub runs from `Dockerfile` (Render's
Docker runtime), because the checker needs TeX Live 2026 and veraPDF. The
build context is the repository's root: the image builds `mult-streak/` and
the hub with `npm ci`, and copies `tagging-doctor-worker/src/` (TypeScript
that Node 24 runs itself). `Dockerfile.dockerignore` lets in only those
folders. Its TeX stage is the worker's, line for line (`test/dockerfile.test.ts`).

```bash
# from the repository's root
docker build -f backend-hub/Dockerfile -t backend-hub:dev .
docker run --rm -p 10000:10000 -e COOKIE_SECRET=dev \
  -e TAGGING_DOCTOR_SUPABASE_URL=https://auth.hintwise.org -e TAGGING_DOCTOR_SUPABASE_ANON_KEY=<the app's anon key> backend-hub:dev
```

The checker's settings are the hub's `TAGGING_DOCTOR_*` env vars with the
prefix taken off (see `tagging-doctor-worker/src/config.ts`). Outside the
image (`npm run dev`, CI) the checker is not loaded and its stand-in answers.
The checker's isolation tests run against this image:
`WORKER_IMAGE=backend-hub:dev npm run test:image` in `tagging-doctor-worker/`.

Every deploy is a Docker build on the TeX image (about 2.9 GB pulled), and
restarts every mount: mult-streak's file store and the checker's jobs reset.

## Moving an app into the hub

1. In the app's repo, split `listen` from app construction: export a factory
   that returns the wired Express app (see `mult-streak/src/serve.ts`).
2. Make the frontend's fetch paths RELATIVE (`fetch('api/state')`, not
   `fetch('/api/state')`) so they resolve under the prefix. Serve the page
   from a trailing-slash URL.
3. Scope cookies to the mount (`path: '/<name>'`) or use names that cannot
   collide with the other mounted apps.
4. Prefix the app's env vars with its mount name (`CHAT_...`, `DSA_...`).
   mult-streak predates the hub and keeps its historical unprefixed names.
5. Add the app as a dependency here, mount it in `src/hub.ts` (flip its
   `MOUNTS` entry from `reserved` to `mounted`), add its env to
   `deploy/target.yml`, and cover the mount in `test/hub.test.ts`.
6. After the hub deploy is verified, delete the app's old Render service in
   the dashboard.

Trade-offs accepted: one shared failure domain and one shared 512 MB
instance (Render compute plan 0.5c-512mb, $7/month, always on since 10 Nov
2026; it was the free instance, which slept when idle. Render's API refuses a
free-to-paid switch, so that change was made once in the dashboard); any
deploy restarts every mounted app. Fine for hobby-scale
services, worth revisiting if one app grows real traffic.

## Develop

```bash
npm run deps        # install + build ../mult-streak (needed once, and after changes there)
npm ci
npm run dev         # http://localhost:3000
```

## Quality gates

```bash
npm run lint
npm run typecheck
npm run coverage    # vitest, thresholds: 85% stmts/fns/lines, 80% branches
npm run build
```

## Deploy

`deploy/target.yml` is auto-discovered by the repo's Deploy workflow and
creates/updates the `backend-hub` Render web service (plan 0.5c-512mb, Oregon,
health check `/api/health`, Docker runtime with the repository's root as root
directory and a build filter, so only changes to the folders the image takes
rebuild it). It replaces `mult-streak/deploy/target.yml`;
the old standalone `mult-streak` Render service can be deleted once the hub
is live.
