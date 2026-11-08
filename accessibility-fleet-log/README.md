# Accessibility Fleet Log

**Live:** https://accessibility-fleet-log.hintwise.org

For web agencies and freelancers who look after a few dozen small-business
websites. Every client site's accessibility status on one screen, a dated log
of each problem (when it was found, when it was fixed), a draft accessibility
statement for every site, and a monthly report with your name on it, ready to
send.

Nothing is installed on your clients' sites and nothing is uploaded: the app
runs in your browser and keeps its data there.

## Who it is for

You maintain WordPress (or any other) sites for small businesses on a care
plan. Clients, especially those selling into the EU since the European
Accessibility Act, ask whether their site is accessible and want proof you
are keeping on top of it. The plugin route puts upsells and someone else's
branding on their dashboards, and the tools that track many sites at once are
priced for large companies.

## How it works

1. **Add your client sites** on the *All sites* tab: name, client and address.
2. **Run a free checker on each site once a month** and paste the results in
   on *Add results*. Ways to get results without installing anything:
   - a **bookmark** you drag to your bookmarks bar (click it on any page);
   - a **console snippet** (F12 > Console > paste);
   - the **terminal**: `@axe-core/cli` or `pa11y-ci` for many pages at once;
   - files you already have: **axe-core JSON** (browser extension),
     **pa11y / pa11y-ci JSON**, **Lighthouse JSON**, or a **CSV** from any
     other checker or spreadsheet (you pick which column is the page, the
     issue, the WCAG rule and the severity).

   The app matches the results to the right site by address and keeps only
   the failing rule, the WCAG rule it breaks, the number of elements and the
   page address. No page content and no visitor data.
3. **The log does the dates.** Each problem is one rule failing on one page.
   It is *found* the first time a check reports it, *fixed* the first time a
   later check of the same page no longer does, and marked *came back* if it
   returns. A check that skipped a page never marks that page's problems
   fixed. Add a note to any problem ("third-party booking widget, vendor
   asked"); notes appear in the statement.
4. **All sites** shows, per client: last check (and "check due" after 35
   days), open issues, critical issues, the change since the previous check,
   fixes in the last 30 days, and whether the statement needs updating. It
   also lists the problems that come up on several sites, which often means
   one shared theme or plugin to fix.
5. **Statement.** Each site gets a draft accessibility statement built from
   its log: the standard (WCAG 2.1 AA or 2.2 AA), the status, the known
   problems in plain words, how it was checked, and how visitors report a
   problem. Pick EU (European Accessibility Act, BFSG in Germany), US (ADA) or
   both for the right wording. Copy it as HTML or text, and save dated
   versions; each version shows what changed since the last one.
6. **Client report.** Pick a site and a month: open issues at month end,
   what was fixed, what is new, problems grouped by WCAG rule, and the
   statement status, under your business name and color. Print it or save it
   as PDF, or download it as HTML.
7. **Backup.** *Your details and backup* saves the whole fleet as one file;
   open it on another computer to carry on there.

Try **the demo fleet** on the first screen: six made-up client sites with four
months of checks.

## Honest wording

The statement never claims more than the checks show:

- any open problem against the chosen standard makes it **Partially
  conformant**;
- a clean automated check alone gives **Not yet confirmed**, because
  automated tools find only some kinds of problems;
- **Meets the standard as far as we know** needs a clean check *and* a review
  by a person in the last year (you enter its date).

Problems under WCAG 2.2-only rules are tracked but not counted against a
WCAG 2.1 target; best-practice rules with no WCAG rule are tracked separately.
Every report says it is a record of what was checked, not a certificate. The
statement is a draft for the site owner to adopt, not legal advice.

## Limitations

- It does not run checks on a schedule or crawl sites: you run the checker and
  paste the results. The "check due" badge is the monthly reminder.
- Automated checks find only part of what matters (keyboard use, screen
  reader flow and captions need a person).
- Data lives in one browser. Save a fleet file regularly; there is no shared
  team account.

## For developers

TypeScript + Vite, no framework and no backend. `src/core/` holds the
importers (axe-core, pa11y, pa11y-ci, Lighthouse, CSV), the issue log
(`log.ts`), the statement (`statement.ts`) and the report (`report.ts`);
`src/ui/app.ts` is the page.

```bash
npm ci
npm run dev        # local server
npm run lint
npm run typecheck
npm run coverage   # vitest, 85% thresholds
npm run build      # dist/
```

The console snippet and bookmarklet load axe-core 4.11.0 from cdnjs (with a
jsDelivr fallback) inside the page being checked, and drop element HTML and
selectors before copying the results.

Deployed to Netlify from `deploy/target.yml` by the monorepo's deploy
workflow. MIT licensed (see LICENSE).
