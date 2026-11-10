# <App name>: handoff (day <N> of 7, <YYYY-MM-DD>)

Rewritten at the end of every build day by the build routine
(BUILD_ROUTINE.md). It is the only state the next day's session has, and the
document the owner pastes into any other session to continue the work.

## Resume prompt

> Continue building `<slug>` in pisanuw/claude-built-apps (branch main; run
> `git config core.hooksPath .git-hooks`). Read `<slug>/HANDOFF.md`,
> `<slug>/docs/PLAN.md`, `docs/platform.md` and the repo CLAUDE.md, then work
> the next milestone as BUILD_ROUTINE.md "Build day" describes: implement with
> tests, review, push to main, update this handoff.

## Goal and customer

Idea: daily-project-ideas `ideas/<YYYY-MM-DD>.json` idea <n>, "<title>".
Buyer: <who pays, in one line>. Promise: <the one sentence a shop owner would
repeat to a friend>. Shape marks: <stateful, connected, ...>.

## What is live

- https://<slug>.hintwise.org (last deploy <date>, commit <sha>): <what a
  visitor can do today, two or three lines>.
- Not live yet: <milestones not deployed>.

## Milestones (docs/PLAN.md)

| # | Milestone | Status | Day | Notes |
|---|---|---|---|---|
| 1 | <vertical slice> | done | 1 | |
| 2 | <...> | in progress | 2 | <what is left> |
| 3 | <...> | next | | |

## How to run and verify

```bash
cd <slug> && npm ci && npm run lint && npm run typecheck && npm run coverage && npm run build
npm run dev          # http://localhost:5173
npm run e2e          # Playwright walkthrough (milestone <k> onward)
```

Tests: <count> vitest, coverage <n>%. Live check: `curl -s https://<slug>.hintwise.org/ | grep -c "Chief Education Officer"` prints 1.

## Platform use

- Supabase schema `app_<slug_>`: tables <...>; migrations in
  `supabase/migrations/`; applied through <the Deploy workflow | the Supabase
  admin workflow `sql`> on <date>.
- Sign-in: <Google and magic link | none>.
- LLM: <none | bring-your-own-key only | gateway app slug `<slug>`, caps
  default, default model `<model>`>.
- Env names (values never here): VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, <...>.

## Decisions and why

- <date>: <decision>. <why, one line>.

## Tried and rejected

- <what> because <why>.

## Open questions for the owner

1. <question> Recommendation: <x>. Default taken on <date> if unanswered: <x>.

## Remaining and known issues

- <item>

## Key files

- `src/...`: <what>

## Log

- Day 1 (<date>): <one line>.
