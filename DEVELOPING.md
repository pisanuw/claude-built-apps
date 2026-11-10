# Developing in this repository

The [README](./README.md) is for people using the apps. This page is for
people working on them.

## How an app gets here

1. A scheduled Claude routine in
   [`daily-project-ideas`](https://github.com/pisanuw/daily-project-ideas)
   looks for real demand (complaints, feature requests, people paying for
   similar tools) and writes up a few ideas each morning.
2. The build routine ([BUILD_ROUTINE.md](./BUILD_ROUTINE.md)) picks one
   substantial idea a week, small business tools first, and Claude builds it
   over up to seven build days in its own folder here: TypeScript, vitest with
   at least 85% coverage, lint, typecheck, a `deploy/target.yml`, and the
   shared platform in [docs/platform.md](./docs/platform.md) (Supabase
   sign-in and data, an LLM gateway with spending caps). Each day is a fresh
   session that resumes from the project's own `HANDOFF.md`.
3. CI checks every package on every push. The deploy workflow finds every
   `*/deploy/target.yml` and ships changed apps to Netlify or Render, each at
   `<app>.hintwise.org` (the runner creates the Cloudflare DNS record).
4. A shared footer from [`scripts/site-footer.mjs`](./scripts/site-footer.mjs)
   is added to every app at deploy time.
5. The mirror workflow copies each app into its own repo in the
   [pisan-labs](https://github.com/pisan-labs) organization. A new app's repo
   is created by `scripts/pisan_labs_setup.py`, which runs daily on the
   owner's Mac (halflife) through `scripts/halflife/` together with a manual
   Mirror apps run (`gh workflow run mirror.yml --repo pisanuw/claude-built-apps`).

Apps built before November 2026 replace the idea's suggested LLM calls with
deterministic code, so they are free to run, work offline and give the same
answer twice. Newer apps keep deterministic code wherever it does the job and
otherwise offer a model through the visitor's own key or the owner's capped
key (docs/platform.md). The design decisions for each app are in its README.

Also in the repo: [`backend-hub`](./backend-hub) (several small backends on one
Render service), [`summit-navigator`](./summit-navigator) (schedule for a
conference that has now happened) and [`tetromino-arcade`](./tetromino-arcade).

## Running one locally

```bash
cd bombe-bench
npm ci
npm run dev
```

Every package also has `npm run lint`, `npm run typecheck`, `npm run coverage`
and `npm run build`. Commit messages follow Conventional Commits; see
[CLAUDE.md](./CLAUDE.md).

[![CI](https://github.com/pisanuw/claude-built-apps/actions/workflows/ci.yml/badge.svg)](https://github.com/pisanuw/claude-built-apps/actions/workflows/ci.yml)
