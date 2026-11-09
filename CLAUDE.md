# Claude-capstone: Agent Instructions

## Commit messages

All commits in this repo use **Conventional Commits**:

```
type(scope)?: subject
```

Types: `feat`, `fix`, `chore`, `docs`, `style`, `refactor`, `test`, `perf`, `ci`, `build`, `revert`

Scope is the affected package: `accessibility-lens`, `mult-streak`, `mult-streak-edge`, `backend-hub`, `schema-storyteller`, `emoji-lingua`, `migration-diff-narrator`, `shortcut-sprint`, `ui-diff-lens`, `code-review-gauntlet`, `sound-sketchpad`, `sql-replay`, `har-detective`, `code-analogy-forge`, `game-palette-inspector`, `pathfinding-playground`, `prompt-genome`, `type-witness`, `cron-cartographer`, `summit-navigator`, `prompt-shrink-ray`, `agent-blast-radius`, `repo-weight-map`, `cipher-ladder`, `where-does-it-say`, `elevator-algorithm-lab`, `reverse-minesweeper-studio`, `state-space-atlas`, `bombe-bench`, `heap-arena-replay`, `program-alarm-1202`, `outguess-me`, `code-viva`, `diagram-layout-engine`, `letter-ledger`, `brocot-gear-finder`, `fork-count`, `assignment-stress-test`, `cache-miss-theater`, `edit-graph-lab`, `lockstep-lab`, `tetromino-arcade`, `net-units`, `study-buddy-matchmaker`, `pluck-lab`, `pull-the-pin`, `leap-second-lab`, `data-structure-city`, `poincare-paint`, `tamerlane-board`, `tiny-brains-league`, `gpu-parallel-puzzler`, `modulo-bias-microscope`, `consent-leak-watch`, `acr-draft`, `accessibility-fleet-log`, `misrepresentation-preflight`, `popup-check`, `health-page-tracker-watch`, `donation-receipts`, `ci`, `deploy`.

Examples:
- `feat(mult-streak): add hint button`
- `fix(accessibility-lens): handle redirects in SSRF guard`
- `chore(ci): add coverage thresholds to mult-streak job`
- `docs: update test counts in READMEs`

A git `commit-msg` hook enforces this for local commits. The hook lives in `.git-hooks/commit-msg`; install it once after cloning:

```bash
git config core.hooksPath .git-hooks
```

## Project overview

This is a monorepo of capstone projects built autonomously from prompts in
[`pisanuw/daily-project-ideas`](https://github.com/pisanuw/daily-project-ideas).

| Package | Description | Host |
|---|---|---|
| `accessibility-lens/` | WCAG 2.1 analyzer + 4-profile replay | Netlify |
| `mult-streak/` | Multiplication-streak game | Render (via `backend-hub`) |
| `backend-hub/` | One Render service hosting several backends under path prefixes | Render |
| `mult-streak-edge/` | Same game, serverless variant | Netlify |

## Adding a new project

1. Since 9 November 2026 the build routine (BUILD_ROUTINE.md) builds one substantial idea per week over up to seven build days, each day a fresh session resuming from `<slug>/HANDOFF.md` (template: `docs/templates/PROJECT_HANDOFF.md`; plan template `docs/templates/PLAN.md`). It picks a `substantial` Multi-week idea from `pisanuw/daily-project-ideas`, small business first.
2. Build in a new subdirectory. Follow the same structure: TypeScript, vitest tests (≥85% coverage), `.env.example`, `deploy/target.yml`. Use the shared platform in `docs/platform.md`: the Supabase project for sign-in (Google, magic link) and a per-app schema `app_<slug_>` with row level security and migrations in `<slug>/supabase/migrations/`; the LLM gateway for model calls (bring-your-own-key always offered; the owner's key only through the gateway and its caps; deterministic code wherever it does the job); backend-hub on Render when a server is unavoidable. No live app calls Claude or any paid API on the owner's key except through the gateway.
3. Add a row to the matching audience table in the root README and a write-up section at the end of PROJECTS.md.
4. The deploy workflow auto-discovers any `*/deploy/target.yml`, so no workflow changes are needed.
   Every app's primary address is `https://<app>.hintwise.org`. In `target.yml`, still write `netlify.customDomain: <app>.pisan.me` from the first deploy, like every other app: the runner swaps the base domain for `APP_DOMAIN` from `scripts/domains.mjs`, so it serves `<app>.hintwise.org` (this keeps the 60 existing `target.yml` files, and their paid deploys, untouched). The runner creates the Cloudflare CNAME (secret `CLOUDFLARE_API_TOKEN`) and redirects the `.netlify.app` address there. Link to the hintwise.org address everywhere; old `<app>.pisan.me` links 301 to it.
5. Do not add the "built by" footer to the app: the deploy adds it from `scripts/site-footer.mjs`. Do not make `body` a row flexbox (that puts the footer beside the app; column flex and grid are fine), and set `footer: false` in `target.yml` only if the app cannot host it.

## Quality gates (all must pass before push)

```bash
# from each package dir:
npm run lint
npm run typecheck
npm run coverage
npm run build
```

CI (`.github/workflows/ci.yml`) runs all three packages on every push and PR.
