# Qualified Overtime Checker: handoff (day 4 of 7, 2026-11-11)

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

- https://qualified-overtime-checker.hintwise.org (deploy 2026-11-11 about
  10:40 UTC, commit af17b38): milestones 1 to 4 and sign-in in the header.
  - Checker, client files (browser or account), bonuses, differentials,
    tip credit, paid cap (milestones 1-3; see PLAN.md "Method").
  - Milestone 4: Toast time entries recognised (columns from Toast's field
    reference: Regular/Overtime Hours, Wage, Overtime Pay, GUID); QuickBooks
    Online time activities recognised as an inferred layout (name rows,
    hours:minutes, billing rate and amount ignored); hourly pay rates typed
    per employee for hours-only files; column choices saved per layout in the
    file; "add to the hours already here" without duplicates (Toast by GUID);
    weekly totals checked by week and marked; pay-period totals refused.
- Verified live 2026-11-11: 200 with the footer; the Toast fixture imports
  (Ann $90.73, Rosa $6.39 as worked by hand); no console errors.
- Pushed, not deployed: import report says rows used (lines) separately;
  clearer overtime sentence; the bonus help naming Earned from/to columns.

## Milestones (docs/PLAN.md)

| # | Milestone | Status | Day | Notes |
|---|---|---|---|---|
| 1 | One employer, checked | done | 1 | reviewed (high), 13 findings fixed |
| 2 | Saved client files | done | 2 | reviewed (high) and security-reviewed; owner confirmed signed-in save 10 Nov |
| 3 | The hard cases | done | 3 | reviewed (high), 10 findings fixed; security review of the sign-in move: nothing serious, 3 low fixed |
| 4 | Real exports | done | 4 | Toast (confirmed) and QuickBooks (inferred) presets, typed rates, saved mappings, add without duplicates, weekly totals; EasyACCT not supported (no dated hours); reviewed (high), 10 findings fixed |
| 5 | Worksheet and W-2c list | next | | PDFs, W-2c CSV, print |
| 6 | Polish | | | |
| 7 | Finish | | | |

## How to run and verify

```bash
cd qualified-overtime-checker && npm ci && npm run lint && npm run typecheck && npm run coverage && npm run build
npm run dev          # http://localhost:5173
PW_CHROMIUM=/opt/pw-browsers/chromium npm run e2e   # cloud session: the bundled Playwright browser is missing
```

Tests: 216 vitest (core, compare, hard cases, presets with Toast and
QuickBooks fixtures, layouts, review regressions, codec and stores, jsdom
UI), coverage 99.3% statements, 94.8% branches; 3 Playwright tests.

## Platform use

- Supabase schema `app_qualified_overtime_checker`: table `client_files` (id
  uuid, user_id default auth.uid(), name, tax_year, summary jsonb, data jsonb
  in the compact codec form, timestamps), RLS select/insert/update/delete own
  rows, grants select/insert/update/delete to authenticated only. Migration
  `supabase/migrations/0001_init.sql` applied by the Deploy workflow on
  2026-11-10 12:41 UTC (recorded in platform.migrations; never edit it, add
  0002_*.sql).
- Exposed through PostgREST, but only after `expose-schema --reapply`
  (13:03 UTC): the stored db_schema had the schema, yet the API kept the old
  list for 25 minutes. Fixed for later apps: expose-schema now waits for the
  Data API and resends once (platform commit 5f50e7b).
- Sign-in: Google and magic link via `src/lib/auth.ts` (template), profile
  row through platform.ensure_profile.
- LLM: none, by design.
- Env names (values never here): VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY,
  set in `deploy/target.yml` env from `platform/supabase.json`. The deploy
  runner now passes VITE_* env to the local build (it did not before; fixed
  in accessibility-lens/deploy/deploy.mjs).

## Decisions and why

- 2026-11-10: browser-only engine; no LLM. A figure that goes on a W-2 must be arithmetic with a cited rule.
- 2026-11-10: SSN columns dropped at the parser (by header, including SS#, SS Number, Tax ID, and by 123-45-6789 values), never mapped, stored or exported.
- 2026-11-10: a week's TT goes to the year of the latest pay date in the week; without pay dates, the year the week ends (with a warning, and no year-end "likely cause").
- 2026-11-10: overtime-coded lines count as hours at the straight rate (rate / 1.5 or / 2), unless the rate equals a regular line's rate that week and the divided one does not (base rate on the OT line).
- 2026-11-10: lump sums (bonus, commission, tips, shift differential) are skipped with a reason until milestone 3, so the report shows what was left out.
- 2026-11-10: payroll figures are stored per tax year in the client file (`reported["2026"][employeeKey]`).
- 2026-11-10: deploy file held back from the first push so the app deployed once, after the review fixes.
- 2026-11-10 (owner): saved files in Supabase allowed for signed-in users, with a browser-only choice and a delete button; the app stays free.
- 2026-11-10: browser files in localStorage (MemoryFileStore when storage is blocked); account files in Supabase; a file is saved once it has a name or hours; a signed-in user's new files go to the account.
- 2026-11-10: one write queue for saves, moves and deletes; a failed save asks before the file is left; sign-out or a user switch closes an account file and keeps unsaved changes as a browser copy.
- 2026-11-10: stored files use a compact codec (lines as arrays, employees and pay codes in lookup tables), less than half the plain JSON size.
- 2026-11-10: columns of undashed nine-digit numbers are dropped as SSNs too (an employee ID of exactly nine digits is lost; names still identify people).
- 2026-11-10: fixed the platform template's copy command (it turned `APP_SLUG` into `APP_my-app`); now a portable perl one-liner.

## Tried and rejected

- `Blob.text()` alone: jsdom lacks it; `readFileText` falls back to FileReader (also older Safari).
- Node `Buffer` in the Playwright spec: no @types/node in the template; the spec hands files over with DataTransfer instead.

## Open questions for the owner

None open. Answered 2026-11-10: saved files allowed (as recommended); free.

## Owner actions

1. Done 2026-11-11 (owner): signed-in save after migration 0002 works
   (sample saved, survived a reload, deleted), and an email link from the
   sign-in-link service arrived and signed in.
2. Done 2026-11-11 08:56 UTC: the Send Email hook is on (owner's yes).

## Next

Milestone 5, "Worksheet and W-2c list" (docs/PLAN.md): a per-employee
worksheet PDF (each workweek: hours, straight-time pay, regular rate,
overtime hours, premium, bonus shares), an employer summary PDF, the W-2c
list CSV (employee, TT reported, TT correct, difference; only flagged
employees), and a print view. Check PDFs with pdfinfo and pdftoppm; totals
must equal the results table. donation-receipts has a small PDF writer to
reuse (Helvetica/WinAnsi).

## Remaining and known issues

- Milestones 2 to 7.
- Toast shifts that run past midnight count in the week of their In Date (no Out Date check yet).
- Duplicate detection without an entry id treats rows identical in every field as the same row.
- The extra overtime a bonus causes is assumed paid with the bonus (no cap on bonus shares); the method text says so.
- Bonus tests use hand-worked figures; the CFR's printed examples were not re-read.
- Template follow-up for the Plabs session: the stale switch-offer fix was made in platform/templates/app too (ff11c02); other apps copied before that keep the old behaviour.
- Phone layout: results and the file list show as cards; the weeks table scrolls sideways (polish day).
- Self-service account deletion is not offered; README says to email builder@hintwise.org (platform milestone).
- supabase-js 2.119 asks for Node 22; the Deploy workflow builds on Node 20 (warning only, build fine).
- The IRS fact sheet FS-2026-13 named in the idea was not re-read this run; the method follows 29 CFR 778 and the idea's evidence summary. Re-check the wording before the polish day.
- Review leftovers judged minor: none open.

## Key files

- `src/core/engine.ts`: workweeks, regular rate, premium, tax year.
- `src/core/compare.ts`: status and likely causes (mistake candidates).
- `src/core/importer.ts`: column guessing, SSN drop, row import; `csv.ts`, `dates.ts`.
- `src/core/codec.ts`: stored form and file summaries; `src/store/stores.ts`: Memory, Local and Supabase stores and the Files manager.
- `supabase/migrations/0001_init.sql`: the schema.
- `src/core/reported.ts`: payroll figures import; `sample.ts`: the sample employer; `export.ts`: CSVs; `clientFile.ts`: the saved file shape.
- `src/ui/app.ts`, `src/ui/dom.ts`, `src/styles.css`: the page.
- `test/`: core, compare, review, app (jsdom); `e2e/walkthrough.spec.ts`.

## Log

- Day 1 (2026-11-10): picked, claimed, planned; milestone 1 built, reviewed, fixed and deployed.
- Day 4 (2026-11-11): milestone 4 (Toast and QuickBooks layouts, typed rates, saved columns, add without duplicates, weekly and pay-period totals); vendor columns researched (Toast confirmed, QuickBooks inferred, EasyACCT not found); code review (high) 10 findings fixed; deployed.
- Day 3 (2026-11-11): sign-in moved to the header with the template's branded button and the sign-in-link service; milestone 3 (bonuses, differentials, tip credit, not-wages, paid cap) built; code review (high) 10 findings and security review 3 low findings fixed; deployed with migration 0002.
- Day 2 security review (security-review, by a subagent; the skill itself failed on the missing origin/HEAD ref, so the diff was reviewed by hand): nothing serious; three low items fixed (owner-scoped primary key, ask before a sign-out copy, SSN header and value gaps).
- Day 2 (2026-11-10, second run the same day at the owner's request): milestone 2, saved client files with sign-in, reviewed, fixed and deployed; first app on the Supabase migrations step; two platform fixes (VITE env in the build, expose-schema wait).
