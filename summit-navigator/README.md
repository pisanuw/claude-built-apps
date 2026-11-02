# Summit Navigator

**A conference program you can actually use in a hallway.** A mobile-first
schedule browser for the inaugural
[ACM AI Leadership Summit](https://aisummit.acm.org/) (Hyatt Regency
Atlanta, Aug 30 – Sep 2, 2026): sticky day tabs, color-coded track chips,
full-text search, a starred personal agenda saved in your browser, and a
timezone-aware now/next banner.

Live: [summit-navigator.pisan.me](https://summit-navigator.pisan.me)

Implements idea #1 ("Summit Navigator") from the
[2026-09-03 ideas day](https://github.com/pisanuw/daily-project-ideas)
of `pisanuw/daily-project-ideas`.

## What it does

- **Mobile-first navigation.** Sticky day tabs (Sun–Wed), sessions grouped
  by start time, one-thumb 44px tap targets, safe-area padding, and no
  horizontal scroll at 390px. The same layout scales up to desktop.
- **Track chips and search.** Eleven color-coded tracks (Plenary, Rethinking
  the Future, AI for Science, AI for Software Development, Governance &
  Policy, …) filter with a tap; the search box matches titles, speakers,
  rooms, track names, and descriptions, with every term required.
- **My agenda.** Star any session to build a personal agenda; stars persist
  in `localStorage` (and degrade gracefully to in-memory when storage is
  unavailable). A header toggle shows only starred sessions.
- **Now / next.** A banner computes what is on right now and the next group
  of sessions to start, using the conference time zone
  (`America/New_York`) regardless of where the viewer is.
- **Times in your zone.** One toggle flips every listed time between
  Atlanta wall time and the viewer's local time zone, using the browser's
  own IANA database (two-pass offset correction, DST-safe).
- **Reusable by design.** The app never hardcodes the summit: everything
  comes from [`src/data/schedule.json`](./src/data/schedule.json), which is
  validated loudly at startup (`validateSchedule`). Swap that one file to
  get a schedule app for any conference.

## About the bundled schedule data

The build environment for this project could not reach
`aisummit.acm.org` (network egress policy), so the bundled
`schedule.json` is an **unofficial snapshot reconstructed from ACM's public
summit announcements** (April–August 2026): real conference, venue, dates,
tracks, and announced keynote speakers (Yann LeCun, Andrew Barto, Rodney
Brooks, Jaime Teevan, Markus Gross, Amandeep Singh Gill, Gabriela Ramos),
with illustrative session times and rooms. The app says so in its footer
and links to the official program. Dropping in the real detailed program
is a data-only change.

## Run locally

```bash
npm install
npm run dev        # local dev server
npm run coverage   # 42 vitest cases, ≥85% thresholds enforced
npm run lint && npm run typecheck && npm run build
```

## Architecture

```
src/
  core/            tested, DOM-free logic
    types.ts       Session / Track / ScheduleData shapes
    schedule.ts    validation, day grouping, labels
    clock.ts       IANA time-zone math, now/next, time ranges
    filter.ts      query + track + starred filtering
    stars.ts       localStorage-backed star store (injectable)
  data/
    schedule.json  the entire conference, documented shape
  ui/              thin DOM rendering (excluded from coverage)
  main.ts          state + wiring
```

No frameworks, no runtime dependencies, no backend, no accounts: the built
site is ~9 KB gzipped and works offline once loaded.
