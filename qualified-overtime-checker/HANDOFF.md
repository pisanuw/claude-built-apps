# Qualified Overtime Checker: handoff (day 7 of 7, finished, 2026-11-11)

Rewritten at the end of every build day by the build routine
(BUILD_ROUTINE.md). It is the only state the next day's session has, and the
document the owner pastes into any other session to continue the work.

## Resume prompt

> Continue `qualified-overtime-checker` in pisanuw/claude-built-apps (branch
> main; run `git config core.hooksPath .git-hooks`). It is finished and marked
> implemented; this is follow-up work. Read
> `qualified-overtime-checker/HANDOFF.md` (start at "Remaining"),
> `qualified-overtime-checker/docs/PLAN.md`, `docs/platform.md` and the repo
> CLAUDE.md. Take an item from "Remaining", implement it with tests, review,
> push to main (deploy by touching `deploy/target.yml`, at most once a day),
> and update this handoff. For more build days through the routine, the owner
> sends `continue qualified-overtime-checker`.

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

- https://qualified-overtime-checker.hintwise.org (final deploy 2026-11-11
  about 11:13 UTC, commit b46ccf1, with migration 0004): all seven milestones.
  - Checker, client files (browser or account), bonuses, differentials,
    tip credit, paid cap; Toast and QuickBooks exports, typed rates, saved
    columns, add without duplicates, weekly and pay-period totals.
  - Employer summary PDF, worksheet PDFs, W-2c list CSV, results and
    worksheet CSVs, print view; README for the owner with a screenshot.
  - Day 7: final whole-app review fixes (see Log) and dev tooling on vitest 4.
- Catalog: root README "Tools for small businesses" row, PROJECTS.md
  write-up, implemented.json entry with publicNotes, aiprojects.md section
  (pisanorg/yusuf), pisan-labs mirror files (LICENSE, .github/workflows/ci.yml,
  `.github/mirrors.txt`, `scripts/pisan-labs-repos.csv`).
- Verified live 2026-11-11: Deploy run 43010071826 green (0004 applied, 3
  skipped; schema security check passed, a signed-in stranger sees 0 rows);
  200 with the footer; at 390px the sample loads with results and no
  sideways scroll; the worksheet CSV carries the "On the 2026 W-2" column;
  no console errors. CI green on the catalog push (run 43007599804).

## Milestones (docs/PLAN.md)

| # | Milestone | Status | Day | Notes |
|---|---|---|---|---|
| 1 | One employer, checked | done | 1 | reviewed (high), 13 findings fixed |
| 2 | Saved client files | done | 2 | reviewed (high) and security-reviewed; owner confirmed signed-in save 10 Nov |
| 3 | The hard cases | done | 3 | reviewed (high), 10 findings fixed; security review of the sign-in move: nothing serious, 3 low fixed |
| 4 | Real exports | done | 4 | Toast (confirmed) and QuickBooks (inferred) presets, typed rates, saved mappings, add without duplicates, weekly totals; EasyACCT not supported (no dated hours); reviewed (high), 10 findings fixed |
| 5 | Worksheet and W-2c list | done | 5 | own PDF writer (Letter landscape, Helvetica, tables across pages); checked with pdfinfo/pdftotext/pdftoppm; reviewed (high), 11 findings fixed | PDFs, W-2c CSV, print |
| 6 | Polish | done | 6 | accessibility-lens 93, no serious; axe serious (scrollable region) fixed; security review: nothing serious, 3 of 5 low fixed |
| 7 | Finish | done | 7 | whole-app review (high): 11 findings fixed; second review of the fixes (code and security): 8 more fixed, security nothing; catalog, mirror, implemented, portfolio |

## How to run and verify

```bash
cd qualified-overtime-checker && npm ci && npm run lint && npm run typecheck && npm run coverage && npm run build
npm run dev          # http://localhost:5173
PW_CHROMIUM=/opt/pw-browsers/chromium npm run e2e   # cloud session: the bundled Playwright browser is missing
```

Tests: 252 vitest (core, compare, hard cases, presets with Toast and
QuickBooks fixtures, layouts, reports and PDF structure, review regressions,
codec and stores, jsdom UI, security and day-7 review regressions),
coverage 98.6% statements, 93.5% branches; 4 Playwright tests (sample, Toast, saved file,
QuickBooks with typed rates, PDF downloads and add mode).

## Platform use

- Supabase schema `app_qualified_overtime_checker`: table `client_files` (id
  uuid, user_id default auth.uid(), name, tax_year, summary jsonb, data jsonb
  in the compact codec form, timestamps), RLS select/insert/update/delete own
  rows, grants select/insert/update/delete to authenticated only. Migration
  `supabase/migrations/0001_init.sql` applied by the Deploy workflow on
  2026-11-10 12:41 UTC; 0002 (owner key) and 0003 (data under 10 MB per row,
  500 files per account, by a before-insert trigger that leaves out the row
  being upserted) applied by later deploys. 0004 (name up to 200
  characters, summary under 4 KB, NOT VALID so old rows are not rechecked;
  the store cuts names to 200 on save) applied by the final deploy. Never
  edit an applied migration; add 0005_*.sql.
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

- 2026-11-11: imported cells are cut at 200 characters (MAX_CELL); CSVs over 50 MB are refused; an import that finishes after another file opened (or the account changed) is discarded.
- 2026-11-11 (day 7): dev tooling on vitest 4 and coverage-v8 4 (critical tinypool and vite 5 dev-server advisories gone); 7 moderate advisories remain in typescript-eslint's minimatch (already its newest release; lint only). The lockfile had to be regenerated with npm 11: npm 10.9 fails with "Cannot read properties of null (reading 'edgesOut')"; `npm ci` with npm 10 works on the result.
- 2026-11-11 (day 7): the worksheet CSV lists the same weeks as the worksheet PDF, with an "On the <year> W-2" column that adds up to each figure (it used to list every week of every year with the week's whole premium).
- 2026-11-11 (day 7): both totals on the results leave out employees waiting for a pay rate, as the PDF does.
- 2026-11-11 (day 7): an import whose stored form would be too big to save is refused up front: 3.5 million JSON characters for an account file (the database's 10 MB cap is on jsonb, about 2.7 times the text, measured by the reviewer) and 4 million for a browser file.
- 2026-11-11 (day 7): Google's dark-theme G (from signin-assets.zip, unmodified) is bundled next to the light one; CSS shows it on a dark page.
- 2026-11-11: security headers (CSP, frame-ancestors) are a platform change for every app, not this app's; listed for the owner.

## Tried and rejected

- `Blob.text()` alone: jsdom lacks it; `readFileText` falls back to FileReader (also older Safari).
- A binary-search cut in the PDF wrap: still too slow under coverage for a 20,000-character cell; replaced by one pass over per-character widths.
- Node `Buffer` in the Playwright spec: no @types/node in the template; the spec hands files over with DataTransfer instead.

## Open questions for the owner

None open. Answered 2026-11-10: saved files allowed (as recommended); free.

## Owner actions

Finish actions (BUILD_ROUTINE Step 5):

- a. DNS: nothing; the app serves on hintwise.org.
- b. pisan-labs repo: nothing if the halflife job (04:13) runs; it creates
  pisan-labs/qualified-overtime-checker and mirrors it. Manual fallback on
  the Mac: `git pull && python3 scripts/pisan_labs_setup.py && gh workflow run mirror.yml --repo pisanuw/claude-built-apps --ref main`.
- c. Netlify web analytics:
  https://app.netlify.com/projects/qualified-overtime-checker/analytics-and-metrics/analytics
- d. Gateway: nothing (no LLM).

Done earlier:


1. Done 2026-11-11 (owner): signed-in save after migration 0002 works
   (sample saved, survived a reload, deleted), and an email link from the
   sign-in-link service arrived and signed in.
2. Done 2026-11-11 08:56 UTC: the Send Email hook is on (owner's yes).

## Next

Finished on day 7. Follow-up work, if any, comes from "Remaining" below,
through `continue qualified-overtime-checker` or any session.

## Remaining and known issues

- Owner actions b and c above (pisan-labs repo, Netlify analytics).
- QuickBooks Online columns are inferred from documentation; confirm against a real export.
- Review leftovers (low): the size check runs at import, not when a file is moved from the browser to the account (a 3.5 to 4 million character browser file would fail to move with a clear error).
- Toast shifts that run past midnight count in the week of their In Date (no Out Date check yet).
- Duplicate detection without an entry id treats rows identical in every field as the same row.
- The extra overtime a bonus causes is assumed paid with the bonus (no cap on bonus shares); the method text says so.
- Bonus tests use hand-worked figures; the CFR's printed examples were not re-read.
- Template follow-up for the Plabs session: the stale switch-offer fix was made in platform/templates/app too (ff11c02); other apps copied before that keep the old behaviour.
- Self-service account deletion is not offered; README says to email builder@hintwise.org (platform milestone).
- supabase-js 2.119 asks for Node 22; the Deploy workflow builds on Node 20 (warning only, build fine).
- FS-2026-13 re-read on day 6 (6 August 2026 version); the method matches Q3, Q10, Q12 and Q16. Bonus figures still rest on hand-worked examples.
- Security review leftovers: 7 moderate dev-only advisories (typescript-eslint's minimatch); no CSP or frame-ancestors on any app (platform).
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

- Day 7 (2026-11-11): finish. Dev tooling on vitest 4; whole-app review (high) found 11 issues, all fixed (typed rates and figures orphaned when an employee gains an ID, worksheet CSV year column, reported total, too-big imports, name and summary caps in migration 0004, import races, add-mode report, unclosed quotes, dark Google G, sign-in wording without sign-in); a second review of the fixes found 8 more, fixed, and a security pass found nothing; catalog, mirror files, implemented.json, aiprojects.md; deployed.
- Day 1 (2026-11-10): picked, claimed, planned; milestone 1 built, reviewed, fixed and deployed.
- Day 6 (2026-11-11): milestone 6, polish (README for the owner, screenshot, phone weeks cards, keyboard and screen-reader fixes, dark Google button, storage-blocked notice, FS-2026-13 citations); accessibility-lens 93 with no serious issues; security review (whole app) nothing serious, fixes for long cells, stale imports, upload size and storage caps (migration 0003); deployed.
- Day 5 (2026-11-11): milestone 5 (summary and worksheet PDFs with a new small PDF writer, W-2c list, print view); code review (high) 11 findings fixed (W-2c sign, rate-needed worksheet, other-year weeks, UTF-16 title, long rows, transliteration, local date, totals, SSN-shaped IDs); deployed and checked live.
- Day 4 (2026-11-11): milestone 4 (Toast and QuickBooks layouts, typed rates, saved columns, add without duplicates, weekly and pay-period totals); vendor columns researched (Toast confirmed, QuickBooks inferred, EasyACCT not found); code review (high) 10 findings fixed; deployed.
- Day 3 (2026-11-11): sign-in moved to the header with the template's branded button and the sign-in-link service; milestone 3 (bonuses, differentials, tip credit, not-wages, paid cap) built; code review (high) 10 findings and security review 3 low findings fixed; deployed with migration 0002.
- Day 2 security review (security-review, by a subagent; the skill itself failed on the missing origin/HEAD ref, so the diff was reviewed by hand): nothing serious; three low items fixed (owner-scoped primary key, ask before a sign-out copy, SSN header and value gaps).
- Day 2 (2026-11-10, second run the same day at the owner's request): milestone 2, saved client files with sign-in, reviewed, fixed and deployed; first app on the Supabase migrations step; two platform fixes (VITE env in the build, expose-schema wait).
