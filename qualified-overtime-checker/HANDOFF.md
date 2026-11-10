# Qualified Overtime Checker: handoff (day 1 of 7, 2026-11-10)

Rewritten at the end of every build day by the build routine
(BUILD_ROUTINE.md). It is the only state the next day's session has, and the
document the owner pastes into any other session to continue the work.

## Resume prompt

> Continue building `qualified-overtime-checker` in pisanuw/claude-built-apps
> (branch main; run `git config core.hooksPath .git-hooks`). Read
> `qualified-overtime-checker/HANDOFF.md`, `qualified-overtime-checker/docs/PLAN.md`,
> `docs/platform.md` and the repo CLAUDE.md, then work the next milestone as
> BUILD_ROUTINE.md Step 3 describes: implement with tests, review, push to
> main, update this handoff.

## Goal and customer

Idea: daily-project-ideas `ideas/2026-11-07.json` idea 2, "Qualified Overtime
Checker for W-2 Box 12 TT" (Small Business Ops, provisional, 19/30). Buyer:
the bookkeeper, per client file, or the owner of a small employer with hourly
staff. Promise: "it checks the new overtime number on my staff's W-2s and
tells me which ones are wrong and by how much." Shape marks: stateful,
connected, engine, shared (PLAN.md says why; unattended is deliberately no).

Picked on day 1 from tier a (small-business tools): all candidates were
provisional; three tied at 19 (this one 2026-11-07, Delivery Canary
2026-11-08, Off-TPT Catalog Kit 2026-11-10) and the older date won.

## What is live

- https://qualified-overtime-checker.hintwise.org (first deploy 2026-11-10,
  commit 0fcf33b, Deploy run 42806758271): upload a timesheet CSV (columns
  guessed and editable, SSN columns dropped, own OT/DT hours columns read),
  enter or import the payroll's TT figures (per tax year), see the FLSA
  workweek figure per employee, the difference, the likely cause, and a
  week-by-week table; results and worksheet CSV; a sample employer with six
  staff and four planted payroll mistakes. Data stays in the tab (in-memory
  repository; a reload loses it).
- Not live yet: milestones 2 to 7.

## Milestones (docs/PLAN.md)

| # | Milestone | Status | Day | Notes |
|---|---|---|---|---|
| 1 | One employer, checked | done | 1 | All acceptance tests pass; reviewed (code-review high), 13 findings fixed |
| 2 | Saved client files | next | | Supabase sign-in, `app_qualified_overtime_checker.client_files`, file list |
| 3 | The hard cases | | | bonuses, differentials, tip credit, paid-OT cap |
| 4 | Real exports | | | QuickBooks / Toast / EasyAcct presets, saved mappings, weekly-hours fallback |
| 5 | Worksheet and W-2c list | | | PDFs, W-2c CSV, print |
| 6 | Polish | | | |
| 7 | Finish | | | |

## How to run and verify

```bash
cd qualified-overtime-checker && npm ci && npm run lint && npm run typecheck && npm run coverage && npm run build
npm run dev          # http://localhost:5173
PW_CHROMIUM=/opt/pw-browsers/chromium npm run e2e   # cloud session: the bundled Playwright browser is missing
```

Tests: 103 vitest (core, compare, review regressions, jsdom UI), coverage
99.8% statements, 95% branches; 2 Playwright tests (sample flow, file
import). Live check: `curl -s https://qualified-overtime-checker.hintwise.org/ | grep -c "Chief Education Officer"` prints 1.

## Platform use

- Supabase: none yet. Milestone 2 adds `supabase/migrations/0001_init.sql`
  (schema `app_qualified_overtime_checker`, table `client_files` with the
  file as jsonb, RLS per user), `supabase: true` and the VITE_SUPABASE_* env
  in `deploy/target.yml` (values from `platform/supabase.json`, which
  exists). This app is the first to use the Deploy workflow's migrations
  step: check its log on the day-2 deploy.
- Sign-in: none yet (milestone 2: Google and magic link via `src/lib/auth.ts`).
- LLM: none, by design (PLAN.md).
- Env names (values never here): VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY (from milestone 2).

## Decisions and why

- 2026-11-10: browser-only engine; no LLM. A figure that goes on a W-2 must be arithmetic with a cited rule.
- 2026-11-10: SSN columns dropped at the parser (by header, including SS#, SS Number, Tax ID, and by 123-45-6789 values), never mapped, stored or exported.
- 2026-11-10: a week's TT goes to the year of the latest pay date in the week; without pay dates, the year the week ends (with a warning, and no year-end "likely cause").
- 2026-11-10: overtime-coded lines count as hours at the straight rate (rate / 1.5 or / 2), unless the rate equals a regular line's rate that week and the divided one does not (base rate on the OT line).
- 2026-11-10: lump sums (bonus, commission, tips, shift differential) are skipped with a reason until milestone 3, so the report shows what was left out.
- 2026-11-10: payroll figures are stored per tax year in the client file (`reported["2026"][employeeKey]`).
- 2026-11-10: deploy file held back from the first push so the app deployed once, after the review fixes.
- 2026-11-10: fixed the platform template's copy command (it turned `APP_SLUG` into `APP_my-app`); now a portable perl one-liner.

## Tried and rejected

- `Blob.text()` alone: jsdom lacks it; `readFileText` falls back to FileReader (also older Safari).
- Node `Buffer` in the Playwright spec: no @types/node in the template; the spec hands files over with DataTransfer instead.

## Open questions for the owner

1. Saving client files (milestone 2) puts employee names, dated hours and pay rates in the shared Supabase project (US East), never SSNs. Recommendation: allow it for signed-in users, with a "keep this file only in this browser" choice and a delete button. Default taken on 2026-11-11 if unanswered: as recommended.
2. The idea's per-file pricing ($49 a file, $199 for 10) is out of scope for the showcase. Recommendation: keep the app free. Default: free.

## Remaining and known issues

- Milestones 2 to 7.
- Phone layout: results show as cards; the weeks table scrolls sideways (polish day).
- The IRS fact sheet FS-2026-13 named in the idea was not re-read this run; the method follows 29 CFR 778 and the idea's evidence summary. Re-check the wording before the polish day.
- Review leftovers judged minor: none open.

## Key files

- `src/core/engine.ts`: workweeks, regular rate, premium, tax year.
- `src/core/compare.ts`: status and likely causes (mistake candidates).
- `src/core/importer.ts`: column guessing, SSN drop, row import; `csv.ts`, `dates.ts`.
- `src/core/reported.ts`: payroll figures import; `sample.ts`: the sample employer; `export.ts`: CSVs; `clientFile.ts`: the saved file shape.
- `src/ui/app.ts`, `src/ui/dom.ts`, `src/styles.css`: the page.
- `test/`: core, compare, review, app (jsdom); `e2e/walkthrough.spec.ts`.

## Log

- Day 1 (2026-11-10): picked, claimed, planned; milestone 1 built, reviewed, fixed and deployed.
