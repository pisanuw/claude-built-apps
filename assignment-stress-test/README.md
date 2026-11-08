# Assignment Stress Test

Instructors are told to "test your assignment with AI" before they assign it.
Doing that by hand across several models, then grading each reply against your
own rubric, takes an evening. This app does it in a few minutes and gives you a
one-page report of which rubric rows AI already meets.

Live: [assignment-stress-test.hintwise.org](https://assignment-stress-test.hintwise.org)

![Opening the recorded demo for a run-length-encoding lab shows a score matrix for three Claude models by three prompt styles, a verdict per rubric row, and one attempt's judge reasons and passing pytest results](demo.gif)

Built from the 2026-10-23 idea in
[`pisanuw/daily-project-ideas`](https://github.com/pisanuw/daily-project-ideas).

## What it does

1. **Assignment.** Paste the prompt students see and your rubric. The rubric
   parser accepts one row per line with its points (`Thesis (10)`, `[10]`,
   `10 pts`, `: 10`), indented description lines, or a Markdown table. For a
   programming assignment, add pytest files (never shown to the models) and
   optional starter files, and tag rubric rows `{tests}` (all tests) or
   `{tests: test_empty*, test_neg*}` (matching tests). You can check the
   autograder against your reference solution before running anything.
2. **Run.** Each chosen model gets three student-style attempts:
   - **Lazy paste**: the assignment text, nothing else (effort `low`).
   - **Rubric-aware**: assignment plus rubric, "get full marks on every row"
     (effort `medium`).
   - **Careful multi-turn**: plan against the rubric, write, then self-check
     and revise, three turns (effort `high`).

   Rows tagged `{tests}` are scored by the share of your tests that pass, run
   in the browser by Pyodide in a Web Worker with a 20 s limit per attempt
   (runaway code kills the worker, and a fresh one starts). Every other row is
   scored by a judge model with your rubric, using structured outputs.
3. **Report.** A model by style score matrix, per-row lazy/mean/best scores,
   and a verdict per row, bucketed on the best attempt (a student needs only
   one attempt to work): **AI meets it** (85% or more), **AI gets partway**
   (50 to 85%), **Holds up** (under 50%). You can override any score, read
   every transcript and test result, download a standalone one-page HTML
   report (prints to one page), and export the run as JSON.
4. **History.** Runs are kept per assignment and term. Re-test after editing
   and pick an earlier run to see a row-by-row diff plus a line diff of the
   prompt and rubric. The coordinator view lists each assignment's best AI
   score by term and flags assignments that **aged badly** (best score up 15
   points or more since the first term). Export and import history files to
   merge several instructors' runs.

Two ways to get replies:

- **Claude API with your key.** Claude Opus 5.5, Sonnet 5.5 and Haiku 5.5 by
  default, plus any other model id. The key goes from your browser straight to
  `api.anthropic.com` (the official SDK with `dangerouslyAllowBrowser`), is
  kept in the tab only if you tick "remember", and the run is billed to your
  account.
- **Paste mode**, for ChatGPT, Gemini, a campus Copilot or anything else. The
  app hands out the exact messages each style sends and a judge block to send
  to any model; you paste back the final reply and the judge's JSON.

The bundled **demo** has real replies from the three Claude models on the two
sample assignments (a CS1 run-length-encoding lab with a 10-test pytest suite,
and a policy memo that must engage an in-class debate), recorded with
`scripts/record-demo.ts`.

## Honest limits

- **Scores are a lower bound.** Three prompt styles, one judge pass. A student
  with more attempts or tools can do better. The report says so on its face.
- **The judge is a model.** It can be wrong; scores are editable and every
  reason is shown.
- **Refusals count as zero** and are not retried on another model:
  answering with a different model would put the wrong name on the score.
- **Effort fallback.** If a model rejects an effort level (Sonnet 5.5 rejected
  `high` through the CLI when the demo was recorded; I have not checked whether
  the API does the same), the attempt is retried once at the model's default
  effort and the report notes it.
- **Demo recording is not the API.** The demo was recorded with the `claude`
  CLI (subscription, no API key) with the system prompt replaced and tools
  off. The CLI still prepends a one-line agent preamble and the date, so the
  demo replies are close to, not identical with, what the API path produces.
- **Python only** for autograding, and only what Pyodide can run (no network,
  no native extensions outside Pyodide's package set). Pyodide 0.26.4 (about
  10 MB) loads from jsDelivr the first time tests run.
- **No server, no accounts.** History is in `localStorage` until exported.
  There is no LMS integration and no automatic rewriting (both out of scope).

## Changes from the idea

The idea proposed React + Tailwind, Supabase, a Flask worker with a container
sandbox, and the Claude and Gemini APIs. This build is plain TypeScript +
Vite with no backend: the sandbox is Pyodide in a Web Worker, history is
local with JSON export, and other vendors are covered by paste mode instead of
a Gemini API client. The "one-page PDF" is a standalone HTML page with print
styles.

## Development

```bash
npm install
python3 -m pip install pytest   # the harness tests run under CPython
npm run dev        # http://localhost:5173
npm run lint
npm run typecheck
npm run coverage   # vitest, 85% thresholds on src/core
npm run build      # dist/
npx vite-node scripts/record-demo.ts          # re-record the demo (needs the claude CLI)
npx vite-node scripts/record-demo.ts --retry  # re-run only attempts that errored
```

Layout: `src/core/` is the tested logic (rubric parser, prompt styles, judge
prompt and reply parser, pytest harness, runner, report, export, diff,
history, paste mode); `src/worker/` is the Pyodide worker and its page-side
queue; `src/ui/` is the DOM layer; `src/data/demo-runs.json` is the recorded
demo.
