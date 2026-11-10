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

Your data stays in your browser tab. A column of Social Security numbers is
dropped before anything is read. This is a worksheet, not tax advice.

Still being built (week of 10 November 2026): saved client files with
sign-in, bonuses and tip-credit staff, presets for QuickBooks, Toast and
EasyAcct exports, and PDF worksheets. The full write-up comes with the
finished app.

## For developers

```bash
npm ci
npm run lint && npm run typecheck && npm run coverage && npm run build
npm run dev   # http://localhost:5173
npm run e2e   # Playwright walkthrough (PW_CHROMIUM=/path/to/chromium if the bundled browser is missing)
```

Plan: `docs/PLAN.md`. Handoff: `HANDOFF.md`.
