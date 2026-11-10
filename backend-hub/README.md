# backend-hub

One Render web service hosting several small, low-traffic backends behind
path prefixes. Render bills per service instance, not per CPU used, so three
idle $7/month services collapse into one.

## Mounts

| Prefix | App | Status |
|---|---|---|
| `/mult-streak/` | [mult-streak](../mult-streak/) multiplication-streak game | live |
| `/chat/` | chatwithdigitalme (separate repo) | reserved, answers 501 |
| `/dsa/` | dsa-instructor (separate repo) | **stays standalone** — redirects to <https://ypdsa.pisan.me> |

dsa-instructor will NOT move into the hub (decided 2026-08): it is a
Python/FastAPI Docker service with a 2 GB persistent disk and 2 GB memory
needs, which doesn't fit this Node hub's shared 512 MB free instance.

`GET /` renders an index of the mounts; `GET /api/health` is the hub-wide
health check Render probes.

## How it works

`src/hub.ts` builds one Express app. Each backend exports an app factory and
is mounted with `hub.use('/<name>', app)`; the hub adds a root index, a root
health check, and a `301` from `/<name>` to `/<name>/` so the mounted page's
relative fetch paths resolve. mult-streak is consumed as a
`file:../mult-streak` dependency and its idle-email sweep is armed by
`startBackgroundJobs()`.

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
creates/updates the `backend-hub` Render web service (free plan, Oregon,
health check `/api/health`). It replaces `mult-streak/deploy/target.yml`;
the old standalone `mult-streak` Render service can be deleted once the hub
is live.
