# Accessibility Lens

**Live:** [accessibility-lens.pisan.me](https://accessibility-lens.pisan.me) | TypeScript monorepo | 107 tests | MIT

**See your page through four kinds of eyes.** Paste a public URL and Accessibility
Lens fetches the markup, runs a deterministic subset of WCAG 2.1 checks, and
replays the page the way users with **low vision**, **color blindness**,
**keyboard-only navigation**, and **screen readers** actually experience it, with a
concrete suggested fix for every issue.

Most accessibility checkers hand you a wall of WCAG codes. This one is built as a
teaching tool: it tries to make the failures *visceral*. The signature feature is a
screen-reader view that strips away all layout and shows the page as the linear
stream of roles and text a blind user hears.

> Built as a capstone from the `daily-project-ideas` prompt for 2026-05-12
> ("Code Blindfold"). See [`ASSUMPTIONS.md`](./ASSUMPTIONS.md) for the full set of
> design decisions and known limitations.

## What it checks

Eleven high-signal rules, each mapped to the disability profiles it affects:

| Rule | WCAG | Affects |
| --- | --- | --- |
| Image missing alt text | 1.1.1 | screen reader, low vision |
| Page language not declared | 3.1.1 | screen reader |
| Missing or empty page title | 2.4.2 | screen reader |
| Form control without a label | 4.1.2 | screen reader, low vision |
| Broken heading structure | 1.3.1 | screen reader |
| Unclear or empty link text | 2.4.4 | screen reader |
| Button without an accessible name | 4.1.2 | screen reader, keyboard |
| Zoom disabled by viewport meta | 1.4.4 | low vision |
| Duplicate id attribute | 4.1.1 | screen reader |
| Positive tabindex disrupts focus order | 2.4.3 | keyboard |
| Low color contrast (inline styles) | 1.4.3 | low vision, color blindness |

The optional Claude integration rewrites the offending snippet into a corrected
one; without an API key the app still gives a solid rule-based fix for each issue.

## Architecture

A TypeScript monorepo using npm workspaces.

```
accessibility-lens/
  server/   Express API + the pure analysis engine
    src/engine/   rules, contrast math, screen-reader linearizer  (no I/O, fully tested)
    src/ai/       AiProvider interface, Anthropic + heuristic implementations
    src/api/      scan use case
    src/app.ts    Express app factory (serves the built client + /api)
  client/   React + Vite + Tailwind UI
    src/components/  scan form, score summary, profile tabs, simulations
```

Design principles at work: the engine is **pure and deterministic** (HTML in,
report out, no network or clock), I/O lives at the edges, the LLM sits behind an
interface so it is **optional and mockable**, and everything testable is tested.

## Run it locally

Requires Node 20+.

```bash
cd accessibility-lens
npm install

# Terminal 1: API on :3000
npm run dev:server

# Terminal 2: UI on :5173 (proxies /api to :3000)
npm run dev:client
```

Open http://localhost:5173.

To run the production single-service build (Express serves the built UI and the
API from one port):

```bash
npm run build
npm start            # serves on http://localhost:3000
```

## Configuration

All configuration is via environment variables, documented in
[`.env.example`](./.env.example). **The app runs fully with none of them set.** The
only meaningful one is `ANTHROPIC_API_KEY`, which upgrades the suggested fixes from
rule-based text to Claude-written code rewrites.

```bash
cp .env.example .env   # then edit if you want AI fixes
```

## Deploy to a public URL

It is a single Node service, so any host that runs Node works. Two ready paths:

- **Render**: this repo includes [`render.yaml`](./render.yaml). Create a new
  Blueprint pointing at the repo; Render builds and serves it. Add
  `ANTHROPIC_API_KEY` in the dashboard if you want AI fixes.
- **Docker** (Railway, Fly, Cloud Run, anything): the included
  [`Dockerfile`](./Dockerfile) is a multi-stage build that produces a slim
  production image.

  ```bash
  docker build -t accessibility-lens .
  docker run -p 3000:3000 -e ANTHROPIC_API_KEY=sk-... accessibility-lens
  ```

Health check: `GET /api/health`.

### Automated, config-driven deploy

There is also a one-file deploy system: edit [`deploy/target.yml`](./deploy/target.yml)
(provider, project name, directory, build) and push, and a GitHub Actions
workflow provisions and deploys to Render or Netlify, creating the project if it
does not exist. Provider tokens live as GitHub repo secrets, never in the repo.
Netlify support ships the API as a serverless function (the app is not static),
wired up by [`netlify.toml`](./netlify.toml). Full setup and a safe `--dry-run`
mode are documented in [`deploy/README.md`](./deploy/README.md).

## Quality gates

```bash
npm run lint        # ESLint, both workspaces
npm run typecheck   # tsc --noEmit, both workspaces
npm test            # Vitest, both workspaces
npm run coverage    # with coverage thresholds enforced
```

Current state: **107 tests passing**. Server coverage ~96% (threshold 85%), client
~96% (threshold 70%). CI runs lint, typecheck, coverage, and build on every push
via the repo-root [`.github/workflows/ci.yml`](../.github/workflows/ci.yml).

## Limitations (the honest list)

This analyzes server-delivered HTML, not a rendered browser DOM, so it does not see
content injected by client-side JavaScript, and the contrast check only inspects
inline styles. It is a fast, deployable, deterministic *complement* to a real audit
and a manual screen-reader walkthrough, not a replacement. The full reasoning is in
[`ASSUMPTIONS.md`](./ASSUMPTIONS.md).

## Roadmap: natural extensions

The current build is a complete, deployable v1. The most valuable directions from
here, roughly in order of payoff:

1. **Headless-browser rendering (Playwright).** The single biggest upgrade. Render
   the page in real Chromium instead of fetching raw HTML. This unlocks two things
   at once: support for JavaScript-rendered SPAs, and a *true* computed-contrast
   check against the full CSS cascade (replacing today's inline-style heuristic).
   It is isolated behind `engine/fetchPage.ts`, so the swap is contained.
2. **Real visual overlays.** With a rendered screenshot from Playwright, apply the
   color-blindness and low-vision filters to the *actual page image* (the "visual
   overlays" the original idea called for), not just to a sample palette.
3. **Shareable, persisted reports.** Store each scan and mint a permalink so
   students can attach a report to an assignment submission. Needs a small
   datastore (SQLite, Postgres, or Supabase) and turns the app from stateless to
   stateful; keep it optional behind a feature flag.
4. **CLI and CI gate.** A `lens scan <url> --fail-under 90` command plus a
   reusable GitHub Action, so a student's own pipeline fails when accessibility
   regresses. This fits the teaching context especially well.
5. **Multi-page crawl.** Follow same-origin links to a configurable depth and
   aggregate one site-wide report instead of scanning a single page.
6. **Classroom / professor mode.** Submit a roster of student URLs and get a
   dashboard of scores and common failures across the class, mirroring the
   "professor mode" in the sibling ideas from the same day.
7. **Broader rule coverage.** Move toward fuller WCAG 2.2: table header
   associations, ARIA role and attribute validity, landmark uniqueness, `reflow`
   at 320px, autocomplete tokens, and media captions. The one-file-per-rule
   registry makes each addition cheap.
8. **Regression tracking.** Persist scores per URL over time and show the trend,
   so a team can see accessibility improving (or slipping) release over release.

Operational hardening worth doing before any high-traffic public deploy: request
rate limiting, a short-lived response cache keyed by URL, and running the fetcher
in a network-restricted egress sandbox (the SSRF guard is a first line, not the
last). The handful of `npm audit` advisories are in the dev/build toolchain
(Vite/esbuild), not the runtime path; worth tracking but not shipping blockers.

## License

MIT. See [`LICENSE`](./LICENSE).
