# Cron Cartographer

**See exactly when your cron actually fires.** Paste a cron expression, an
RRULE, a GitHub Actions `on.schedule` snippet, or plain English like
"every weekday at 4:15am", and Cron Cartographer renders every firing over
the next 30, 90, or 365 days on an interactive calendar heatmap, converts
between any two time zones, and explains the schedule in plain English.

Live: [cron-cartographer.hintwise.org](https://cron-cartographer.hintwise.org)

![Typing "every 2 hours on weekends" becomes cron 0 */2 * * 0,6 with a weekends-only heatmap, then the 365-day view of 0 0 13 * 5 shows cron firing on every Friday and every 13th, with one day's fire times](demo.gif)

Implements idea #1 ("Cron Cartographer") from the
[2026-09-02 ideas day](https://github.com/pisanuw/daily-project-ideas)
of `pisanuw/daily-project-ideas`.

## What it does

- **Four input formats, auto-detected.** Five-field cron (lists, ranges,
  steps, month/weekday names, `@daily`-style shortcuts, `7`-as-Sunday,
  wrap-around ranges like `FRI-MON`), a practical RFC 5545 RRULE subset
  (`FREQ`, `INTERVAL`, `BYDAY` with ordinals like `1MO`/`-1FR`,
  `BYMONTHDAY`, `BYMONTH`, `BYHOUR`, `BYMINUTE`, `COUNT`, `UNTIL`), pasted
  GitHub Actions `on.schedule` YAML, and deterministic natural language.
- **Calendar heatmap.** One cell per day, color-coded by firing count,
  with exact fire times on hover/click, month labels, and a 30/90/365-day
  preview window.
- **Real cron semantics.** The vixie day-of-month/day-of-week union rule
  (`0 0 13 * 5` fires on the 13th *or* any Friday), `5/15`-style implicit
  ranges, and honest handling of what cron cannot express.
- **Time-zone aware, exactly.** Pick the zone the schedule runs in and a
  separate zone to view it in. Offset transitions are resolved to the
  minute from the browser's own IANA database, so DST is handled honestly:
  firings inside a spring-forward gap are reported as skipped (as system
  cron skips them) and ambiguous fall-back times fire once, at the earlier
  instant.
- **Plain-English descriptions** of every parsed schedule, plus a
  next-25-firings table in both zones with relative countdowns.
- **Shareable URLs.** The input, both zones, and the window are encoded in
  query params; nothing is stored anywhere.

## What replaced the suggested APIs

The original idea suggested the Claude API for natural-language-to-cron and
the `cronstrue`/`cron-parser` npm packages. Everything here is hand-written
and deterministic instead: a rule-based English parser (with explicit notes
about every assumption it makes, and honest `null` for what it cannot
understand), a hand-rolled cron parser/describer, and a transition-table
time-zone engine on top of `Intl`. Zero runtime dependencies, no API keys,
and the same input always produces the same answer, offline.

## Honest limitations

- The natural-language converter is a fixed rule set, not a language model:
  it covers the common phrasings (intervals, times, weekdays, day-of-month,
  months, quarterly) and returns "could not understand" for the rest.
  Phrases like "last Friday of every month" or "second Tuesday of each
  month" become an RRULE (`FREQ=MONTHLY;BYDAY=-1FR;...`) with a note
  explaining why: five-field cron ORs day-of-month with day-of-week, so it
  cannot say them. "The last weekday" and "the last day of the month" are
  refused rather than guessed.
- RRULE support is the subset listed above; `BYSETPOS`, `BYWEEKNO`,
  `BYYEARDAY`, and `WKST`-dependent expansion are not implemented, and a
  pasted RRULE has no `DTSTART`, so expansion anchors at the start of the
  preview window.
- Seconds-resolution (six-field) cron is rejected with an explanatory error.

## Develop

```bash
npm install
npm run dev        # local dev server
npm test           # vitest
npm run coverage   # vitest with v8 coverage (thresholds: 85% everywhere)
npm run lint       # eslint
npm run typecheck  # tsc --noEmit
npm run build      # typecheck + vite build to dist/
```

80 tests cover the cron parser, describer, natural-language converter,
RRULE parser/expander, time-zone engine (including exact 2026 DST
transition instants for America/Los_Angeles), heatmap aggregation, share
links, and input auto-detection.

## Architecture

```
src/core/          pure, dependency-free engine (all unit-tested)
  cron.ts          five-field parser + day/wall matching + GHA extraction
  describe.ts      schedule -> plain English
  nl.ts            English -> cron, or RRULE where cron cannot say it
  rrule.ts         RRULE parser + wall-time expansion
  tz.ts            offset-transition tables over Intl; exact conversions
  expand.ts        firing enumeration + per-day heatmap aggregation
  interpret.ts     input auto-detection (cron / RRULE / GHA / English)
  share.ts         URL query-param state
src/ui/app.ts      vanilla-TS DOM layer (heatmap, tables, controls)
```

The deploy is a static Netlify site configured by
[`deploy/target.yml`](./deploy/target.yml); the monorepo deploy workflow
auto-discovers it.
