# Qualified Overtime Checker

**Live:** https://qualified-overtime-checker.hintwise.org

For owners of small businesses with hourly staff, and the bookkeepers who run
their payroll. From tax year 2026 every W-2 shows the extra half of overtime
pay on its own line (Box 12, code TT), and your staff can deduct only what is
reported there. Payroll software often gets it wrong when someone works at two
pay rates, when overtime is counted per pay period, or when the whole overtime
pay goes into the box.

This checker rebuilds every workweek from your timesheet export, works out the
correct figure for each employee, compares it with what your payroll
calculated, and tells you who is off, by how much, and the likely reason.

- Upload a timesheet or payroll export (CSV) with dated hours.
- Enter, or upload, the TT figures your payroll shows.
- See each employee's correct figure and a week-by-week worksheet; download
  both as CSV.

Each employer is a client file. Without signing in, files are kept in this
browser only. Sign in with Google or an emailed link to keep them in your
account, so they follow you to another computer; you can move any file back
to "this browser only" at any time.

**What is stored, and where.** A saved file holds the employer's name and
settings, each employee's name and ID, their dated hours and pay rates, and
the TT figures your payroll produced. Social Security numbers are never
read or kept: a column that holds them is dropped before anything else
happens. Files in your account are kept in HintWise's database (Supabase,
United States East) and only your account can read them. **Deleting:** the
Delete button removes a file at once; to remove your account and everything
in it, email builder@hintwise.org from the address you signed in with.

This is a worksheet, not tax advice.

It handles the cases payroll software gets wrong: staff on two or more pay
rates, bonuses and commissions (spread back over the weeks they were earned
in, and reported in the year they were paid), shift differentials, servers
paid a cash wage plus a tip credit, and weeks that straddle pay periods or
the year end. Tips, gifts, discretionary bonuses and expense reimbursements
are left out, as the overtime rules require.

Exports it knows by their columns: Toast time entries (from Toast's
published column list) and QuickBooks Online "Time Activities by Employee
Detail" (an inferred layout; it has hours but no pay rates, so you type each
employee's rate once). Any other CSV works by choosing its columns, and the
file remembers your choice for the next export from the same system. Weekly
totals are checked by week; pay-period totals (two weeks in one row) cannot
be checked per workweek and are refused with an explanation. You can add a
second export to a file without counting rows twice.

Not supported: exports with no dated or weekly hours (payroll summaries, or
EasyACCT's earnings totals).

What you can hand over or keep on file: an employer summary (PDF) with each
employee's figure, what to correct and why; a week-by-week worksheet per
employee (PDF), whose total is the figure; the W-2c list (CSV) of exactly
the employees to correct, with the amount previously reported and the right
one; the results and worksheet as CSV; and a print view.

Still being built (week of 10 November 2026): a final polish pass. The full
write-up comes with the finished app.

## For developers

```bash
npm ci
npm run lint && npm run typecheck && npm run coverage && npm run build
npm run dev   # http://localhost:5173
npm run e2e   # Playwright walkthrough (PW_CHROMIUM=/path/to/chromium if the bundled browser is missing)
```

Plan: `docs/PLAN.md`. Handoff: `HANDOFF.md`.
