# Qualified Overtime Checker: build plan

Written on day 1 (2026-11-10). The idea is from before 2026-11-10, so it has
no `shape` or `buildPlan`; both are written here to the ROUTINE.md rules.
Kept current: a milestone that grows gets split here, a milestone that proves
unnecessary is struck through with the reason.

## Goal

Check the qualified overtime figure (W-2 Box 12 code TT, tax year 2026) for
every hourly employee before W-2s go out, and give the corrected figure for
anyone who is off. Customer: owners and office managers of small US employers
with 2 to 50 hourly staff (trades, restaurants, clinics, shops), and the
bookkeepers who prepare W-2s for several of them. Idea: daily-project-ideas
`ideas/2026-11-07.json` #2, "Qualified Overtime Checker for W-2 Box 12 TT"
(Small Business Ops, provisional, 19/30).

## Shape

Marks (4 of 5, so substantial):

- **stateful**: a bookkeeper keeps one saved file per client employer
  (settings, employees, weekly hours and pay, the payroll's TT figures,
  results) and comes back to it through the season, December to February,
  and again for W-2c work in spring.
- **connected**: imports the payroll register and timesheet exports the
  customer already has (QuickBooks, Toast, EasyAcct, generic CSV) and exports
  a worksheet and a W-2c list for their W-2 software.
- **engine**: rebuilds FLSA workweeks from dated hours across pay periods and
  the year end, computes the regular rate from all remuneration (blended
  rates, non-discretionary bonuses allocated back to their weeks, shift
  differentials, the full minimum wage for tip-credit staff) and the
  half-time premium per week: real domain rules, not a formula on a form.
- **shared**: the bookkeeper makes the worksheet; the employer files it and
  each employee receives the corrected figure (a per-employee sheet).
- unattended: no. A deadline reminder email (W-2s due 1 February 2027) was
  considered and left out: it adds a scheduled job for one date a year.

Platform needs: **accounts** (Google or magic link, so a bookkeeper's client
files follow them between computers) and **database** (schema
`app_qualified_overtime_checker`, row level security per user). No LLM: every
figure is arithmetic and rules, and a model would only add risk to a number
that goes on a tax form. No backend-hub: the browser does all the work.

Data rule: Social Security numbers are never stored or sent. An SSN column in
an import is dropped at the parser, before anything is kept, and the app says
so. Wages and hours go to the database only for a signed-in user who saves a
client file; without sign-in everything stays in the tab.

## Milestones

Each is about one build day. Milestone 1 is deployable on day 1.

| # | Milestone | Delivers (what a user can do) | Acceptance (testable) |
|---|---|---|---|
| 1 | One employer, checked | Upload a timesheet CSV with dated hours and rates (columns guessed, mapping editable), enter or upload the TT figures the payroll produced, and see per employee the TT the FLSA rules give, the difference and a week-by-week worksheet; a built-in sample employer; results CSV. Deployed. | Engine tests: single rate, two rates in one week (blended), a week split across two pay periods, a week across 31 Dec assigned by pay date, 40 hours exactly, SSN column dropped. The sample's two-rate employee is flagged and the single-rate one is not. Live site 200 with footer. |
| 2 | Saved client files | Sign in (Google or magic link); save, reopen, rename and delete client files; the list of a bookkeeper's clients with their status. | Migration applied by the Deploy workflow; RLS keeps files per user; repository tests with a fake client; a file saved, signed out and in again comes back identical; anonymous use still works in the tab. |
| 3 | The hard cases | Non-discretionary bonuses (lump sums allocated back over their earning period, weekly or by hours), shift differentials and other includable pay, tip-credit staff at the full minimum wage, excluded pay (discretionary bonus, PTO, expense reimbursement) kept out of the regular rate, paid-OT check (flag premium paid below the FLSA figure, cap TT at what was paid). | Worked examples from 29 CFR 778.209 (bonus) and 778.115 (weighted average) reproduce to the cent; a tipped server's week uses the minimum wage, not the cash wage. |
| 4 | Real exports | Presets for QuickBooks Online time activity, Toast labor summary and EasyAcct payroll register layouts, saved column mappings per client, a weekly-hours fallback (no dated days) with a clear "checked by week only" flag, and an import report (rows read, skipped and why). | Fixture files for each preset import with no lost rows; a malformed row is reported with its line number; a re-import of the same file does not duplicate hours. |
| 5 | Worksheet and W-2c list | Per-employee worksheet PDF (each workweek: hours, straight-time pay, regular rate, overtime hours, premium), an employer summary PDF, the W-2c list CSV (employee, TT reported, TT correct, difference), print view. | PDFs open in pdfinfo and render with pdftoppm; totals in the PDF equal the results table; W-2c list contains exactly the flagged employees. |
| 6 | Polish | README for the business owner, phone layout, keyboard and screen-reader pass (accessibility-lens on the live page), empty and error states, Playwright walkthrough, security review, demo screenshot, draft publicNotes. | Playwright walkthrough green; accessibility-lens scan of the live page has no serious issue. |
| 7 | Finish | Catalog row, PROJECTS.md write-up, mirror files, implemented.json, portfolio. | Live check and the finish checklist in BUILD_ROUTINE.md. |

## Method (the rules the engine follows)

- Workweek: a fixed 168-hour week starting on the employer's chosen day
  (default Sunday 00:00), never the pay period (29 CFR 778.104-105).
- Regular rate: all remuneration for employment in the workweek, minus the
  section 7(e) exclusions, divided by all hours worked (29 CFR 778.109); with
  several rates, the weighted average (778.115).
- FLSA overtime premium: hours over 40 in the workweek times half the regular
  rate. This half-time portion is the qualified overtime compensation; any
  overtime paid above what the FLSA requires (double time, daily overtime
  under state law, contractual premiums) is not.
- Tax year: a workweek's premium belongs to the year it is paid (the pay date
  of the period that pays it); without pay dates, the year the workweek ends.
- Rounding: each week's premium is rounded to the cent; the year's figure is
  the sum of the rounded weeks. Differences under $1.00 are shown as "matches
  (rounding)".
- Out of scope: California and other daily-overtime states, the 8-and-80
  hospital system, fluctuating workweek salaried staff, qualified tips (code
  TP), and filing anything. The app says so where a user could expect them.
- Source wording: IRS guidance on qualified overtime compensation (FS-2026-13
  per the idea's evidence) and 29 CFR part 778. The app labels its output a
  worksheet, not tax advice.

## Out of scope

- Direct payroll integrations (OAuth to QuickBooks, Gusto, Toast).
- Payments and per-file pricing (the idea's $49 per file): the showcase is
  free; payments would be a later project.
- Daily-overtime states, code TP (tips), filing W-2 or W-2c.

## Risks

- Payroll exports in the wild differ from the presets: mitigation, a generic
  mapping that always works and an import report that names what it skipped.
- A wrong rule on a tax figure: mitigation, every rule cites its CFR section in
  the code and a test reproduces the regulation's own worked example.
- Wage data on a server: mitigation, sign-in is optional, SSNs are dropped at
  the parser, row level security per user, and the README says what is stored
  and how to delete it.
