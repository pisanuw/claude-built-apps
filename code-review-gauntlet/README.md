# Code Review Gauntlet

Race to spot planted bugs, security holes, and code smells in realistic code
snippets before the timer runs out — then get an annotated explainer of
everything you missed.

![A Novice round plants two defects in a JavaScript comment renderer; flagging the innerHTML line and submitting scores 100 points, marks the found XSS line green and the missed div line red, and explains each defect with its fix](demo.gif)

- **Live site:** https://code-review-gauntlet.hintwise.org
- **Source:** https://github.com/pisanuw/Claude-capstone/tree/main/code-review-gauntlet
- **Host:** Netlify (fully static; no backend, no API keys).
- **Idea:** [`pisanuw/daily-project-ideas`](https://github.com/pisanuw/daily-project-ideas), 2026-08-11 idea 1.

## How a round works

1. Pick a tier (novice / intermediate / expert) or play the shared **daily
   challenge**.
2. A snippet appears with 1–3 planted defects and a tier-scaled countdown
   (90/120/150 seconds). Click every line you would flag in review.
3. Submit (or run out of time). Every defect is revealed with its category,
   root cause, and fix; found lines are green, missed lines red, false flags
   amber.
4. Scoring: 100 points per defect found, −25 per clean line flagged, and a
   time bonus **only when you found everything** — so spraying flags or
   racing past bugs both lose. Grades run D to S.

Your **reviewer profile** (localStorage) tracks rounds, best/average score,
daily streak, and a radar chart of accuracy across the five defect
categories: logic, null-safety, security, performance, style.

## The deterministic puzzle engine

The original idea called for Claude API puzzle generation and a Supabase
leaderboard. Both are replaced with deterministic client-side logic:

- A library of **11 hand-written clean templates** (JavaScript, Python, SQL)
  carries a catalogue of **51 single-line mutations**, each tagged with a
  category, tier, title, root-cause explanation, and fix. Defects range from
  off-by-one loops and inverted guards to SQL injection, XSS sinks,
  timing-unsafe comparisons, TOCTOU races, and non-sargable joins.
- A seeded PRNG (mulberry32 over an xmur3 hash) picks a template, guarantees
  at least one defect of the requested tier, fills to the round's defect
  count from allowed tiers, and never plants two defects on one line. Because
  every mutation rewrites exactly one verbatim line, generated code always
  stays syntactically valid.
- The **daily challenge** hashes the local date into the seed, so every
  player gets the same puzzle with no server, and only the first attempt of
  the day is scored.

Same seed → same puzzle: rounds are reproducible, offline, and free.

## Development

```bash
npm install
npm run dev        # local dev server
npm run lint       # eslint
npm run typecheck  # tsc --noEmit
npm run coverage   # vitest with >=85% thresholds (46 tests)
npm run build      # production bundle in dist/
```

No environment variables are needed (see `.env.example`).

## Structure

```
src/core/     rng, puzzle generator, scoring, streaks, profile persistence
src/data/     template + mutation library (the content)
src/ui/       DOM rendering and styles (excluded from coverage; exercised
              by hand and via a headless-Chromium smoke test)
test/         46 vitest cases, including a 900-puzzle generator invariant sweep
deploy/       target.yml for the repo's auto-discovering deploy workflow
```
