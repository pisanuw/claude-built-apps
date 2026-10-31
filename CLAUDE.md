# Claude-capstone: Agent Instructions

## Commit messages

All commits in this repo use **Conventional Commits**:

```
type(scope)?: subject
```

Types: `feat`, `fix`, `chore`, `docs`, `style`, `refactor`, `test`, `perf`, `ci`, `build`, `revert`

Scope is the affected package: `accessibility-lens`, `mult-streak`, `mult-streak-edge`, `backend-hub`, `schema-storyteller`, `emoji-lingua`, `migration-diff-narrator`, `shortcut-sprint`, `ui-diff-lens`, `code-review-gauntlet`, `sound-sketchpad`, `sql-replay`, `har-detective`, `code-analogy-forge`, `game-palette-inspector`, `pathfinding-playground`, `prompt-genome`, `type-witness`, `cron-cartographer`, `summit-navigator`, `prompt-shrink-ray`, `agent-blast-radius`, `repo-weight-map`, `cipher-ladder`, `where-does-it-say`, `elevator-algorithm-lab`, `reverse-minesweeper-studio`, `state-space-atlas`, `bombe-bench`, `heap-arena-replay`, `program-alarm-1202`, `outguess-me`, `code-viva`, `diagram-layout-engine`, `letter-ledger`, `brocot-gear-finder`, `fork-count`, `assignment-stress-test`, `cache-miss-theater`, `edit-graph-lab`, `lockstep-lab`, `tetromino-arcade`, `net-units`, `study-buddy-matchmaker`, `pluck-lab`, `pull-the-pin`, `leap-second-lab`, `data-structure-city`, `ci`, `deploy`.

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

1. Pick the oldest un-implemented ideas day from `pisanuw/daily-project-ideas`.
2. Build in a new subdirectory. Follow the same structure: TypeScript, vitest tests (≥85% coverage), `.env.example`, `deploy/target.yml`.
3. Add the project to the root README.
4. The deploy workflow auto-discovers any `*/deploy/target.yml`, so no workflow changes are needed.
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
