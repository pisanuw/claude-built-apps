# Project write-ups

One section per app, in the order they were built. The [README](./README.md) has the short catalog.


### [`accessibility-lens/`](./accessibility-lens)

**Accessibility Lens** implements idea #2 ("Code Blindfold") from the ideas day of
2026-05-12. Paste a public URL and it analyzes the page against a deterministic
subset of WCAG 2.1, then replays it the way users with low vision, color blindness,
keyboard-only navigation, and screen readers experience it, with a suggested fix for
every issue and optional Claude-generated code rewrites.

TypeScript monorepo (Express + a pure analysis engine on the server, React + Vite +
Tailwind on the client), 107 tests, deployable as a single Node service.
Live: [accessibility-lens.pisan.me](https://accessibility-lens.pisan.me).
See its [README](./accessibility-lens/README.md) and
[ASSUMPTIONS](./accessibility-lens/ASSUMPTIONS.md).

### [`mult-streak/`](./mult-streak) and [`mult-streak-edge/`](./mult-streak-edge)

A multiplication-streak game: solve two 2-3 digit factors, ten correct in a row
wins a 24-hour crown, a wrong answer resets the streak. Anonymous cookie identity,
game state in a signed cookie, and a "player stopped" email to the admin via
Resend. `mult-streak` runs on **Render** behind the shared
[`backend-hub`](./backend-hub) service at `/mult-streak/` (where the idle email
is reliable); `mult-streak-edge` is the same game on **Netlify** (game works
fully; email is Render-only, by the nature of serverless). Both built from the
config-driven deploy pipeline.

### [`backend-hub/`](./backend-hub)

One **Render** web service hosting several low-traffic backends behind path
prefixes, because Render bills per idle service instance. Currently serves
`mult-streak` at `/mult-streak/`; `/chat` (chatwithdigitalme) and `/dsa`
(dsa-instructor) are documented, reserved mount points for future moves.

### [`emoji-lingua/`](./emoji-lingua)

Translate English into emoji and emoji back into English, with a hybrid engine: a
curated dictionary (deterministic, always available) plus optional Claude-powered
translation for context-aware results and interpretive readings. Deployed on
**Netlify** (static page + serverless API).

### [`schema-storyteller/`](./schema-storyteller)

Paste a SQL, Prisma, or JSON Schema and get a plain-English entity-relationship
narrative plus a rule-based review of likely-missing primary keys, foreign-key
indexes, and constraints, exportable as Markdown. Everything runs client-side: a
hand-written parser and a fixed rule set replace the idea's suggested LLM calls,
so the output is free, offline, and reproducible. Deployed on **Netlify**
(static site, no backend).

Live: [schema-storyteller.pisan.me](https://schema-storyteller.pisan.me).
See its [README](./schema-storyteller/README.md).

### [`migration-diff-narrator/`](./migration-diff-narrator)

Paste two versions of a SQL schema or TypeScript interfaces and get an
annotated breaking-change diff: every change classified safe / caution /
breaking with a one-sentence migration note, plus rename detection and a
Markdown-checklist export for PR descriptions. A deterministic rule set
replaces the idea's suggested Claude API classification, so verdicts are
instant, offline, and reproducible. Deployed on **Netlify** (static site, no
backend).

Live: [migration-diff-narrator.pisan.me](https://migration-diff-narrator.pisan.me).
See its [README](./migration-diff-narrator/README.md).

### [`shortcut-sprint/`](./shortcut-sprint)

A Duolingo-style trainer for keyboard shortcuts: a task prompt ("Go to
definition"), you press the shortcut, and an SM-2 spaced-repetition scheduler
decides when you see it again. Bundled libraries for VS Code, Chrome DevTools,
Figma, Vim (multi-chord sequences included), Emacs, Excel, Visio, Word, and
Acrobat Reader, custom JSON sets uploadable, per-tool mastery radar chart and
a daily streak. Entirely client-side: SM-2 replaces the idea's suggested
backend, progress lives in localStorage.
Deployed on **Netlify** (static site, no backend).

Live: [shortcut-sprint.pisan.me](https://shortcut-sprint.pisan.me).
See its [README](./shortcut-sprint/README.md).

### [`ui-diff-lens/`](./ui-diff-lens)

Drag two UI screenshots into the browser and get a classified visual diff:
every changed region labeled as layout shift, spacing nudge, color restyle,
text edit, visibility fade, added, or removed element, each with a confidence
and the measured evidence. A perceptual pixel diff with anti-aliasing
detection, region clustering, and structural heuristics (displacement search,
opacity fit, edge correlation) replace the idea's suggested Claude Vision
calls, so results are deterministic and screenshots never leave the machine.
Exports an annotated PNG or a standalone HTML report. Deployed on **Netlify**
(static site, no backend).

Live: [ui-diff-lens.pisan.me](https://ui-diff-lens.pisan.me).
See its [README](./ui-diff-lens/README.md).

### [`code-review-gauntlet/`](./code-review-gauntlet)

A code-review reflex game: a realistic snippet appears with 1-3 planted
defects and a countdown; click every line you would flag, then get an
annotated explainer of every bug, security hole, and code smell — found or
missed. A seeded mutation engine over 11 hand-written templates (JavaScript,
Python, SQL; 51 catalogued single-line defects) replaces the idea's suggested
Claude API generation, and a date-seeded daily challenge plus localStorage
skill radar replace the suggested Supabase leaderboard, so the game is
deterministic, offline, and free. Deployed on **Netlify** (static site, no
backend).

Live: [code-review-gauntlet.pisan.me](https://code-review-gauntlet.pisan.me).
See its [README](./code-review-gauntlet/README.md).

### [`sound-sketchpad/`](./sound-sketchpad)

**Sound Sketchpad** implements idea #1 ("Procedural Sound Sketchpad") from the
ideas day of 2026-08-09. Describe a sound effect in plain words ("muffled
explosion heard from underground", "tiny retro laser") and hear it synthesized
instantly: a deterministic word-to-DSP recipe book (20 base sounds, 18
modifiers) replaces the idea's suggested Claude API code generation, and a
pure sample-by-sample DSP engine (oscillators, seeded noise, ADSR, biquad
filters, echo, bit crush) replaces Web Audio graphs, so tests assert on the
exact samples the user hears. Oscilloscope, signal-chain view, tuning
sliders, and 16/24-bit WAV export. Deployed on **Netlify** (static site, no
backend).

Live: [sound-sketchpad.pisan.me](https://sound-sketchpad.pisan.me).
See its [README](./sound-sketchpad/README.md).

### [`sql-replay/`](./sql-replay)

**SQL Replay** implements idea #1 ("SQL Replay") from the ideas day of
2026-07-30. Type a SQL SELECT, paste sample CSV data (or use the built-in
demo tables), and watch execution unfold one stage at a time: rows
materialize at FROM, pair up at JOIN (LEFT JOIN survivors get NULL padding),
fail WHERE with the evaluated condition shown, collapse into groups, get
filtered by HAVING, projected, deduplicated, ordered, and trimmed by LIMIT.
A deterministic narrator generates a plain-English sentence per stage from
the real execution stats, replacing the idea's suggested Claude API narrator,
and share links encode the whole workspace into the URL hash. Deployed on
**Netlify** (static site, no backend).

Live: [sql-replay.pisan.me](https://sql-replay.pisan.me).
See its [README](./sql-replay/README.md).

### [`har-detective/`](./har-detective)

**HAR Detective** implements idea #1 ("HAR Detective") from the ideas day of
2026-08-21. Drop a browser HAR file on the page and get an interactive
request waterfall plus a ranked, plain-English performance report: N+1 call
patterns, missing cache headers, uncompressed responses, redirect chains,
serialized API waterfalls, duplicate fetches, failing requests, slow server
think-time, oversized payloads, and HTTP/1.x connection churn. Ten
hand-written deterministic detectors replace the idea's suggested Claude API
analysis, so results are instant, reproducible, and the HAR never leaves the
browser. Deployed on **Netlify** (static site, no backend).

Live: [har-detective.pisan.me](https://har-detective.pisan.me).
See its [README](./har-detective/README.md).

### [`code-analogy-forge/`](./code-analogy-forge)

**Code Analogy Forge** implements idea #1 ("Code Analogy Forge") from the ideas
day of 2026-08-25. Paste code or name a CS concept, pick your audience (curious
child, high school student, CS undergraduate, or non-technical adult), and get
three hand-written analogies from three different everyday domains, each with a
"this maps to that" table. A keyword + code-shape detector (including real
self-call analysis for recursion) picks the concept; a curated corpus of 47
concepts x 3 domains x 4 audience variants (564 hand-written texts) replaces
the idea's suggested Claude API generation, and a localStorage library with tags, search, Markdown export,
and serverless read-only share links replaces Supabase; a 47-example menu
covers every concept, grouped into ten themed sections. Deployed on **Netlify**
(static site, no backend).

Live: [code-analogy-forge.pisan.me](https://code-analogy-forge.pisan.me).
See its [README](./code-analogy-forge/README.md).

### [`prompt-genome/`](./prompt-genome)

**Prompt Genome** implements idea #1 ("Prompt Genome") from the ideas day of
2026-08-23. Paste any AI prompt and see it as a DNA strand of typed,
color-coded genes: role, persona, context, task, constraint, format, example.
A rule-based classifier (explicit section labels plus sentence-level cue
patterns, each gene showing why it got its label) replaces the idea's
suggested Claude API parsing; three hand-written deterministic mutations per
gene type replace "AI suggests three alternatives"; and a word-level LCS diff
of the prompt itself replaces model-response diffing. A lint pass scores the
genome 0-100 (missing task, vague wording, brevity-vs-depth conflicts,
negative-only constraints, and more), genes can be edited, reclassified, and
reordered, a localStorage library keeps reusable genes with tags and search,
and share links carry the whole genome in the URL hash. Deployed on
**Netlify** (static site, no backend).

Live: [prompt-genome.pisan.me](https://prompt-genome.pisan.me).
See its [README](./prompt-genome/README.md).

### [`type-witness/`](./type-witness)

**Type Witness** implements idea #1 ("Type Witness") from the ideas day of
2026-08-02. Paste a TypeScript snippet and watch type inference unfold as an
ordered, narrated story: literal types and let/const widening, generic calls
showing the declared signature, the inferred binding (`T = string`), and the
resolved signature, unannotated callback parameters typed from context,
control-flow narrowing with declared-vs-here detail, inferred return types,
and compiler errors threaded in right after the step where inference went
astray. The real TypeScript compiler (pinned 5.6.3) runs in a Web Worker
against an in-memory file system with the full ES2022 lib closure bundled as
raw text, so analysis is exact, offline, and nothing leaves the browser. Hover
any expression for its type, click to jump to its step, autoplay the story, or
share a snippet via a URL-hash link. Deployed on **Netlify** (static site, no
backend).

Live: [type-witness.pisan.me](https://type-witness.pisan.me).
See its [README](./type-witness/README.md).

### [`cron-cartographer/`](./cron-cartographer)

**Cron Cartographer** implements idea #1 ("Cron Cartographer") from the ideas
day of 2026-09-02. Paste a cron expression, an RRULE, a GitHub Actions
`on.schedule` snippet, or plain English like "every weekday at 4:15am", and
see every firing over the next 30, 90, or 365 days on a calendar heatmap,
with exact fire times on hover, a plain-English description of the schedule,
and a next-25-firings table. Separate "runs in" and "view in" time-zone
pickers convert exactly: offset transitions are resolved to the minute from
the browser's IANA database, spring-forward gaps are reported as skipped
(like system cron), and ambiguous fall-back times fire once. A deterministic
rule-based English parser replaces the idea's suggested Claude API call, and
a hand-written cron/RRULE engine replaces the suggested npm packages, so the
app has zero runtime dependencies and works offline. Share links carry the
whole state in query params. Deployed on **Netlify** (static site, no
backend).

Live: [cron-cartographer.pisan.me](https://cron-cartographer.pisan.me).
See its [README](./cron-cartographer/README.md).

### [`summit-navigator/`](./summit-navigator)

**Summit Navigator** implements idea #1 ("Summit Navigator") from the ideas day
of 2026-09-03: a mobile-first schedule browser for the inaugural ACM AI
Leadership Summit (Hyatt Regency Atlanta, Aug 30 – Sep 2, 2026). Sticky day
tabs, sessions grouped by start time, eleven color-coded track chips,
every-term full-text search across titles/speakers/rooms/descriptions, a
starred "My agenda" persisted in localStorage, and a now/next banner plus a
one-tap toggle between Atlanta wall time and the viewer's own time zone
(exact IANA math, DST-safe). The entire conference lives in one validated
`schedule.json`, so the app doubles as a drop-in template for any conference.
The build environment could not reach the official program page, so the
bundled data is an unofficial snapshot reconstructed from ACM's public
announcements, and the app's footer says so. Deployed on **Netlify** (static
site, no backend).

Live: [summit-navigator.pisan.me](https://summit-navigator.pisan.me).
See its [README](./summit-navigator/README.md).

### [`game-palette-inspector/`](./game-palette-inspector)

**Game Palette Inspector** implements idea #1 from the ideas day of 2026-06-19.
Check a game palette against WCAG contrast and eight kinds of colour vision
deficiency, then get replacement colours that keep the art style: build a palette
by hand, load a preset, or drop a screenshot and have its eight dominant colours
extracted. The confusion report measures pairs perceptually in OKLab and names the
worst-case vision type; the fix studio repairs a failing colour by binary-searching
OKLCH lightness with hue pinned, and says so honestly when a contrast target is
unreachable. Simulation is Machado, Oliveira and Fernandes (2009) applied in linear
sRGB, verified against the colour-science reference data.

Moved here on 2026-08-27 from the standalone `pisanuw/c1` repo, with its history,
so every capstone project now lives in one place. The Netlify site id is pinned in
its `deploy/target.yml`, so the public URL did not change.

The one deviation from the house layout: this app predates it and is plain
JavaScript with `node --test`, not TypeScript with vitest, so it has no `lint`,
`typecheck`, or `coverage` script and its CI job runs install, test, and build
only. 11 tests, no backend, no runtime dependencies beyond React.
Live: [game-palette-inspector.pisan.me](https://game-palette-inspector.pisan.me).
See its [README](./game-palette-inspector/README.md).

### [`pathfinding-playground/`](./pathfinding-playground)

**Pathfinding Playground** implements idea #1 from the ideas day of 2026-07-26.
Draw a grid map, drop in walls and mud (mud costs 5 to enter), then watch A*,
Dijkstra, BFS, DFS, and greedy best-first think one expansion at a time, each
step narrated from the live algorithm state: which cell got picked, why, and what
its g, h, and f values were. The idea suggested Claude API calls for narration;
every line is instead a template filled with the numbers the algorithm just
computed, so it is free, offline, and cannot drift from what the search did. Each
algorithm is a generator emitting one uniform event trace that the canvas
renderer and the narrator both consume. Compare mode runs two algorithms side by
side, and the whole puzzle (map, start, goal, picks) run-length encodes into the
URL hash, so a class exercise is shareable as a plain link.

Moved here on 2026-08-27 from the standalone `pisanuw/pathfinding-playground`
repo, with its history. The Netlify site id is pinned in its `deploy/target.yml`,
so the public URL did not change.

Like `game-palette-inspector`, this app predates the TypeScript house style: it
is plain JavaScript, and while it does use vitest it has no `lint`, `typecheck`,
or `coverage` script, so its CI job runs install, test, and build only. 20 tests
covering optimality, path validity, maze solvability, and trace determinism.
Live: [pathfinding-playground.pisan.me](https://pathfinding-playground.pisan.me).
See its [README](./pathfinding-playground/README.md).

### [`prompt-shrink-ray/`](./prompt-shrink-ray)

Paste an LLM prompt and get it compressed with a live token/cost estimate: a
word-level diff of exactly what changed, and a retention check flagging any
number, quoted string, inline/fenced code, or probable proper noun the
compression dropped. Three levels (light/medium/aggressive) run filler-word
removal, verbose-phrase simplification, cross-section duplicate-instruction
removal, and few-shot example trimming; fenced code blocks are never touched.
A deterministic rule set replaces the idea's suggested Claude Haiku
compression call and Claude Sonnet equivalence check, so results are instant,
offline, and reproducible. Deployed on **Netlify** (static site, no backend).

76 vitest tests, 100% statement coverage.
Live: [prompt-shrink-ray.pisan.me](https://prompt-shrink-ray.pisan.me).
See its [README](./prompt-shrink-ray/README.md).

### [`agent-blast-radius/`](./agent-blast-radius)

Drop in MCP configs (Claude Desktop, Cursor, VS Code, Claude Code), Claude Code
settings, and browser or VS Code extension manifests to see what each AI tool
can reach: filesystem, shell/code execution, network egress, credentials, and
browser data, scored 0-100 with a plain-English explanation and the exact
config evidence per capability. It also flags plaintext secrets, unpinned
`npx`/`uvx` packages, auto-approved tools, `bypassPermissions`, Docker socket
mounts, and all-sites extension access. Files are parsed in the tab and never
uploaded; a self-contained HTML report can be downloaded. The idea's suggested
local CLI became a static web app (no install, but you pick the files).
Deployed on **Netlify** (static site, no backend).

95 vitest tests, >99% statement coverage.
Live: [agent-blast-radius.pisan.me](https://agent-blast-radius.pisan.me).
See its [README](./agent-blast-radius/README.md).

### [`repo-weight-map/`](./repo-weight-map)

Drop a project folder into the browser and see a zoomable squarified treemap
of where the bytes are, colored by category (source, dependencies, generated
output, data, media, `.git` internals), plus a nineteen-rule junk detector for
committed virtualenvs, `node_modules`, build output, caches, secrets, and
files over 10 MB, each with an explanation and the `.gitignore` lines to fix
it. Untick findings to refine a before/after estimate, copy the lines or a
unified diff against the existing `.gitignore`, or download a standalone HTML
report. The folder is walked for names and sizes only and nothing is
uploaded; the treemap layout is hand-written (no d3). The idea's git history
mode was left out. Deployed on **Netlify** (static site, no backend).

40 vitest tests, 100% statement coverage on the core.
Live: [repo-weight-map.pisan.me](https://repo-weight-map.pisan.me).
See its [README](./repo-weight-map/README.md).

### [`cipher-ladder/`](./cipher-ladder)

A classical cryptanalysis ladder: Caesar, affine, Vigenere, columnar
transposition, monoalphabetic substitution and homophonic substitution, each
rung unlocking after a correct solve. The workbench has letter, bigram and
trigram frequencies against English, index of coincidence per period with
per-column charts, a Kasiski table, and keyboard-only substitution and symbol
boards that decrypt live; hints come from an instructor-set budget. After a
solve, a deterministic solver's step-by-step attack on the same ciphertext is
shown beside the student's path, including where it went wrong, in place of
the idea's LLM debrief. Instructors build a ladder into a share link and read
exported progress files in a dashboard (no Supabase, no accounts). Deployed on
**Netlify** (static site, no backend).

65 vitest tests, 100% statement coverage on the core.
Live: [cipher-ladder.pisan.me](https://cipher-ladder.pisan.me).
See its [README](./cipher-ladder/README.md).

### [`where-does-it-say/`](./where-does-it-say)

A course Q&A box that can only answer by pointing at the exact sentence: the
instructor drops in the syllabus, specs and policies (PDF, Markdown or text),
and every answer is a passage from them, verified word for word (after
whitespace and typography folding) and highlighted in a side-by-side viewer.
If no passage qualifies it says "Not stated in the course documents" and logs
the question; exported logs become an instructor gap report grouped by week
and wording. A "Check a quote" mode verifies quotes pasted from anywhere and
diffs altered ones against the closest passage. A deterministic BM25 proposer
with numbered-item matching ("lab 3" against "labs 1 to 4") replaces the
idea's Claude Haiku function; course packs travel compressed in the share
link. Deployed on **Netlify** (static site, no backend).

91 vitest tests, 99.7% statement coverage on the core.
Live: [where-does-it-say.pisan.me](https://where-does-it-say.pisan.me).
See its [README](./where-does-it-say/README.md).

### [`elevator-algorithm-lab/`](./elevator-algorithm-lab)

A browser sandbox where students write an elevator dispatch policy in
JavaScript (`dispatch(car, state)` returns the next floor) and run it against
seeded traffic scenarios in an animated building: morning rush, lunch spike,
a starvation trap and the textbook disk trace. Each run reports mean, p95 and
max wait (starvation), energy and more; two policies replay side by side on
the same trace; and a disk view redraws the identical run as a head sweeping
across cylinders with time flowing down, so FCFS, SSTF, SCAN and LOOK (all
included as editable presets, with the textbook head-movement numbers pinned
in tests) are visibly elevator algorithms. Instructors author scenarios as
JSON with deterministic generators, mark them hidden for grading and share
them by link; the class leaderboard stores only scores and policy hashes,
locally, with CSV/JSON export and import in place of the idea's Supabase.
Deployed on **Netlify** (static site, no backend).

53 vitest tests, 100% statement coverage on the core.
Live: [elevator-algorithm-lab.pisan.me](https://elevator-algorithm-lab.pisan.me).
See its [README](./elevator-algorithm-lab/README.md).

### [`reverse-minesweeper-studio/`](./reverse-minesweeper-studio)

Paint a picture with mines, pick a safe opening, and a tiered client-side
solver (single-cell rules, pairwise overlap, exhaustive frontier search, then
the global mine count) plays the board without ever guessing. Stuck regions
turn amber, two mine layouts that both fit the visible numbers can be toggled
side by side, and a Web Worker searches single-cell edits for the smallest fix
that makes the board guess-free. A slider replays the deduction step by step,
a difficulty meter reports the hardest tier needed, and finished boards travel
as playable URL-fragment links that reveal the drawing on a win. Deployed on
**Netlify** (static site, no backend).

41 vitest tests, 99.9% statement coverage on the core.
Live: [reverse-minesweeper-studio.pisan.me](https://reverse-minesweeper-studio.pisan.me).
See its [README](./reverse-minesweeper-studio/README.md).

### [`heap-arena-replay/`](./heap-arena-replay)

A malloc you can watch. Paste or generate a malloc/free/realloc trace and
replay it on a word-accurate CS:APP-style heap (header and footer boundary
tags, prologue and epilogue, alignment padding, pred/succ pointers stored in
free payloads) under first-fit, next-fit, best-fit or worst-fit on an
implicit list, an explicit list or segregated size classes, with immediate,
deferred or no coalescing. Each step draws the strip, highlights what the
search examined and returned, and explains the adjusted size, the split and
the coalescing case in a sentence; the policy can be switched mid-replay with
the blocks left in place. A compare tab replays the same trace under eight
policies with fragmentation and search-cost charts, a quiz generator reads
verified answers off the simulator and exports Markdown or a Canvas QTI zip,
and a diff mode finds the first op where a student allocator's addresses
diverge and flags misalignment, overlap and bounds bugs. Deployed on
**Netlify** (static site, no backend).

57 vitest tests, 99.1% statement coverage on the core.
Live: [heap-arena-replay.pisan.me](https://heap-arena-replay.pisan.me).
See its [README](./heap-arena-replay/README.md).

### [`bombe-bench/`](./bombe-bench)

An Enigma I you can open up (rotors I-V, reflectors A/B/C, ring settings,
plugboard, double stepping) with every keypress drawn as a path through
plugboard, rotors and reflector, paired with a working Turing-Welchman
Bombe. Slide a crib along the ciphertext to discard positions where a letter
would encipher to itself, build the menu graph and see its loops, then run
the Bombe over all 60 rotor orders and 17,576 positions in a Web Worker with
a live count of rejected positions and stops; a checking-machine pass thins
the stops, and a tracer follows one hypothesis implication by implication
until the test register is lit twice. Instructors generate challenge
messages with hidden settings as links; answers are graded in the page.
Deployed on **Netlify** (static site, no backend).

55 vitest tests, 98.8% statement coverage on the core.
Live: [bombe-bench.pisan.me](https://bombe-bench.pisan.me/).
See its [README](./bombe-bench/README.md).

### [`state-space-atlas/`](./state-space-atlas)

Enumerates every reachable state of a small puzzle (Towers of Hanoi, sliding
tiles up to the 8-puzzle, the classic Klotski, Rush Hour) in a Web Worker,
draws the whole state graph on a canvas with every state in the column of
its distance from the start, and animates BFS, DFS, IDDFS, greedy and A*
across it with live expansion, frontier and peak-memory counters. Students
type a heuristic in JavaScript and, because the atlas knows the true distance
of every state, it is checked for admissibility and consistency on all of
them, with overestimating states painted red. Same-size pieces and mirror
images collapse into one node, hover shows a picture of any state, and
instructors export "expand fewer than N nodes" challenges as links. Deployed
on **Netlify** (static site, no backend).

65 vitest tests, 99.6% statement coverage on the core.
Live: [state-space-atlas.pisan.me](https://state-space-atlas.pisan.me).
See its [README](./state-space-atlas/README.md).

### [`program-alarm-1202/`](./program-alarm-1202)

A playable model of the Apollo Guidance Computer's priority Executive during
the lunar descent, built as a tribute to Margaret Hamilton. A cycle-stealing
radar fault makes low-priority jobs pile up in the real pools of 7 core sets
and 5 VAC areas until a request finds nothing free and 1202 (or 1201) fires;
the restart then flushes everything, re-establishes only the restart-protected
jobs at their last phase, and guidance keeps flying a 1D descent to touchdown.
The same load replays on a halt-on-overflow Executive and a naive round-robin
scheduler, with a DSKY panel, live slot gauges, a guidance timeline, a steal
sweep and the real Apollo 11 alarm timeline. Deployed on **Netlify** (static
site, no backend).

36 vitest tests, 100% statement coverage on the core.
Live: [program-alarm-1202.pisan.me](https://program-alarm-1202.pisan.me).
See its [README](./program-alarm-1202/README.md).

### [`outguess-me/`](./outguess-me)

A take on Scott Aaronson's oracle demo: press F or J as unpredictably as you
can while an n-gram oracle predicts each key and seals its guess with a
SHA-256 commitment before you press, then reveals it with the nonce so the
page can verify it. Easy mode is the classic 6-gram table with back-off; hard
mode is a weighted-majority mixture of 1- to 6-gram experts. Live hit rate
against a coin-flip band, then a breakdown with a Wilson interval and
binomial p-value, the 6-gram table that read you, run lengths, alternation
rate and Krichevsky-Trofimov bits per press. Paste any two-symbol sequence or
run 200 real coin flips as a control; share links replay the oracle on open.
Deployed on **Netlify** (static site, no backend).

43 vitest tests, 100% statement coverage on the core.
Live: [outguess-me.pisan.me](https://outguess-me.pisan.me).
See its [README](./outguess-me/README.md).

### [`code-viva/`](./code-viva)

Short written orals about each student's own code. Import a Gradescope or
Canvas zip or a GitHub Classroom assignment (browser straight to the GitHub
API), and a source analyser plus commit statistics write 4 to 6 questions per
student anchored to their own functions, guards, data structures, vague names
and unusual commits (one-commit submissions, late-night bulk adds, deadline
rushes). Students answer in a timed text session from a personal link (the
questions travel in the URL fragment), with up to two follow-ups aimed at what
a vague answer is missing, and send back a response code. The review tab shows
transcripts with proposed 0-3 rubric scores quoting their evidence, a flag
queue (low scores, pasting, an unexplained commit, focus loss, restarts),
instructor overrides and approval, and CSV exports. Eleven demo courses (C, C++,
C#, Java, Python, JavaScript, TypeScript) load from the top of the page, and a
"How it works" tab walks through the whole workflow. Deterministic templates and
a keyword rubric replace the idea's Claude API calls. Deployed on **Netlify**
(static site, no backend).

117 vitest tests, 99.7% statement coverage on the core.
Live: [code-viva.pisan.me](https://code-viva.pisan.me).
See its [README](./code-viva/README.md).

### [`diagram-layout-engine/`](./diagram-layout-engine)

A from-scratch layout engine for a Mermaid flowchart subset, built as the
reference solution for the "Build Your Own Diagram Layout Engine" assignment. A
hand-written recursive-descent parser (14 shapes, labelled links in both forms,
chains, `&` groups, nested subgraphs with their own `direction`, `classDef`,
`style`, `linkStyle`) reports the first error with line, column and a caret.
Layout is the full Sugiyama pipeline: greedy feedback arcs, longest-path or
network-simplex layering, dummy nodes, barycenter/median sweeps with
transposition scored by an accumulator-tree crossing count, Brandes-Koepf or
priority coordinates, then spline, polyline or orthogonal routing. Subgraphs
are laid out bottom-up in their own direction; edges into them get legs that
bend around sibling nodes. Six CSS-variable themes, SVG/PNG export, share
links, a stable-layout visual diff (one union layout, added/removed/changed
colouring), a stage-by-stage pipeline inspector and a 50-graph benchmark that
ranks five configurations. Ten bundled examples. Deployed on **Netlify**
(static site, no backend).

88 vitest tests, 98.9% statement coverage on the core.
Live: [diagram-layout-engine.pisan.me](https://diagram-layout-engine.pisan.me).
See its [README](./diagram-layout-engine/README.md).

### [`letter-ledger/`](./letter-ledger)

Recommendation-letter requests for professors. A personal request link carries
the professor's policy (notice period, grade rule, required documents,
questions) and public key; the student form collects programs and letter
deadlines, courses, documents and a signed FERPA release, and seals it all into
one `.ledger` file (ECDH P-256, AES-256-GCM) the student emails. The professor's
dashboard files requests by student, checks them against the policy and the
release, sorts every letter by deadline, exports calendar reminders (.ics) and
writes status emails for the mail app. A notes timeline (with quick capture
during the term) feeds a Markdown fact outline per program that leaves grades
out unless the release covers them. Encrypted backups, deletion on request, a
demo ledger. Deployed on **Netlify** (static site, no backend).

Live: [letter-ledger.pisan.me](https://letter-ledger.pisan.me).
See its [README](./letter-ledger/README.md).

### [`brocot-gear-finder/`](./brocot-gear-finder)

Gear trains for any ratio with whole-number teeth. Type a target reduction
(an expression or a:b) and an exhaustive search over a product table lists the
most accurate 1 to 3 stage compound trains in your tooth range, with error in
ppm/ppb and as clock drift in s/day. A continued-fraction panel shows the
Stern-Brocot path and which convergents are buildable (Brocot's point: the
best fraction often has a prime factor no gear can carry). The chosen train is
animated in SVG with involute teeth phased to mesh, a dial shows drift against
an ideal hand, and an SVG cut sheet exports for laser cutting. Share links in
the URL fragment. Deployed on **Netlify** (static site, no backend).

44 vitest tests, 100% statement coverage on the core.
Live: [brocot-gear-finder.pisan.me](https://brocot-gear-finder.pisan.me).
See its [README](./brocot-gear-finder/README.md).

### [`fork-count/`](./fork-count)

Fork-output questions for OS courses, answered exhaustively. Paste a short
fork/wait/exit/printf/pipe C snippet: a hand-written interpreter runs every
process (by re-executing main() along each process's fork decisions, so stdio
buffers copied at fork come out right), draws the process tree with an arrow
for each pipe, and enumerates every output any schedule can print, with
symmetry reduction so 16 identical processes need a few hundred states. Pipes,
`dup2`, `exec` of small filters (`wc`, `sort`, `grep`, `tr`, ...) and the
deadlocks a missing `close` causes are modelled. Type an output to learn
whether it is possible and, if not, which fork, wait or pipe edge rules it
out. 37 examples (24 on pipes). A seeded generator writes exam questions whose
answers are verified against every schedule and exports Markdown or QTI 1.2.
Deployed on **Netlify** (static site, no backend).

165 vitest tests (including a brute-force soundness check), 99% statement coverage on the core.
Live: [fork-count.pisan.me](https://fork-count.pisan.me).
See its [README](./fork-count/README.md).

### [`assignment-stress-test/`](./assignment-stress-test)

See how AI scores on your assignment before students find out. Paste the
prompt and rubric (one row per line or a Markdown table, rows tagged `{tests}`
go to the autograder), and each Claude model makes three student-style
attempts: a lazy paste, a rubric-aware request and a careful plan/write/revise
conversation. Your pytest suite runs in the browser in Pyodide with a time
limit; the other rows are scored by a judge model against your rubric. The
report shows a model by style matrix, which rows AI meets, gets partway or
cannot meet, editable scores and full transcripts, and exports as a one-page
HTML report. History keeps runs term over term with re-test diffs and flags
assignments that aged badly. Instructors bring their own API key (calls go
straight from the browser to Anthropic) or paste replies from any chat tool.
Ships with a real recorded demo on two sample assignments. Deployed on
**Netlify** (static site, no backend).

53 vitest tests (the pytest harness runs for real under CPython), 99.8% statement coverage on the core.
Live: [assignment-stress-test.pisan.me](https://assignment-stress-test.pisan.me).
See its [README](./assignment-stress-test/README.md).

### [`cache-miss-theater/`](./cache-miss-theater)

Watch a loop nest miss. Write a small C kernel (arrays, #define constants,
for/while/if, min/max bounds) and a hand-written interpreter produces its
exact address trace, which runs through a configurable cache (size, line
size, associativity, LRU/FIFO/random, write-allocate, write-back). Every miss
is classified as compulsory, capacity or conflict by running an infinite and
a fully associative cache alongside. Step or play through the trace with an
animated sets × ways grid and a memory map of each array, compare two kernels
side by side, sweep a block size or cache parameter, and generate exam
questions answered by the simulator (Markdown or QTI 1.2). Deployed on
**Netlify** (static site, no backend).

62 vitest tests (the cache is cross-checked against a naive reference), 99.7% statement coverage on the core.
Live: [cache-miss-theater.pisan.me](https://cache-miss-theater.pisan.me/).
See its [README](./cache-miss-theater/README.md).

### [`edit-graph-lab/`](./edit-graph-lab)

Diff as a shortest-path search. Type two texts (lines or characters) and see
their edit graph, with Myers' O(ND) algorithm animated step by step: the
furthest-reaching d-paths spread across the grid while the V array fills in,
and the final path becomes a unified diff whose hunks light up their stretch
of the path. A comparison view runs LCS dynamic programming, Myers, patience
and histogram diff on the same input and outlines the hunks where they
disagree, with seven curated "readability trap" examples. A seeded exercise
generator (predict D, fill in V[k], spot the patience diff, count the hunks)
exports Markdown or QTI 1.2. Deployed on **Netlify** (static site, no backend).

36 vitest tests (cross-checked against the `diff` npm package), 99.4% statement coverage on the core.
Live: [edit-graph-lab.pisan.me](https://edit-graph-lab.pisan.me).
See its [README](./edit-graph-lab/README.md).

### [`lockstep-lab/`](./lockstep-lab)

Deterministic lockstep and rollback netcode, made visible. Two to four
simulated RTS clients run side by side over a seeded fake network (latency,
jitter, loss, reordering). Toggle a source of nondeterminism (float32 across
two platforms, an unseeded RNG, Map iteration order, frame-rate timestep) and
watch the per-tick state hashes split, with a diff naming the first unit and
field that differ. A sweep compares input-delay lockstep with GGPO-style
rollback (input lag, stalls, re-simulation cost), and five autograded
exercises ask students to make a step function survive 10,000 ticks on two
simulated machines. Deployed on **Netlify** (static site, no backend).

46 vitest tests (rollback's confirmed states are checked against lockstep's), 100% statement coverage on the core.
Live: [lockstep-lab.pisan.me](https://lockstep-lab.pisan.me).
See its [README](./lockstep-lab/README.md).

### [`tetromino-arcade/`](./tetromino-arcade)

A feature-rich, Tetris-style falling-block game, built on request rather than
from the ideas list. Guideline rules (SRS kicks, 7-bag, hold, ghost, lock
delay with move reset, T-spins, back-to-back, combos, perfect clears) in a
deterministic 60 fps core; Marathon, Sprint 40L, Ultra, Dig, Master 20G, Zen,
a Daily Sprint and Versus against a Dellacherie/El-Tetris CPU with garbage
exchange. Rebindable keys with DAS/ARR, gamepad and touch controls, themes,
synthesised sound, records, and exact replays from seed plus key log.
58 vitest tests, 99% statement coverage on the core.
Live: [tetromino-arcade.pisan.me](https://tetromino-arcade.pisan.me).
See its [README](./tetromino-arcade/README.md).

### [`net-units/`](./net-units)

Measures how much code each solution adds in coding units (names, keywords,
literals and operators on added lines minus deleted lines) rather than lines,
so cramming does not help. Size vs tests-passed scatter with complexity and
duplication overlays, side-by-side diffs with every counted unit highlighted,
a per-function breakdown, and a guess-the-author round with an anonymized
annotation export. Hand-written lexer for Python, JavaScript/TypeScript, Java
and C/C++; no backend or LLM. 39 vitest tests, 99% statement coverage on the
core.
Live: [net-units.pisan.me](https://net-units.pisan.me).
See its [README](./net-units/README.md).

### [`study-buddy-matchmaker/`](./study-buddy-matchmaker)

Complementary study pairs from a gradebook. Upload a CSV (topics and maxima
read from headers like `Q3 [recursion] /5`, every guess editable), see each
student's mastery per topic in a colour-coded class table, and get pairs where
each student is strong in what the other is still learning: maximum-weight
matching, exact by subset DP up to 20 students and greedy plus pair swaps
above, with one trio for odd classes and keep-apart constraints. Each group
gets an agenda (who leads which topic, with links) and each student a private
printable card that never shows a groupmate's scores. No backend or LLM;
nothing leaves the browser. 29 vitest tests, 100% statement coverage on the
core.
Live: [study-buddy-matchmaker.pisan.me](https://study-buddy-matchmaker.pisan.me).
See its [README](./study-buddy-matchmaker/README.md).

### [`pluck-lab/`](./pluck-lab)

A guitar strummed from the QWERTY keyboard (chord keys plus H/J strums) where
every note is synthesized live by Karplus-Strong in an AudioWorklet: a delay
line of seeded noise, a weighted two-point average, a first-order allpass for
fractional tuning and a comb-filtered pick position. Shows the watched
string's delay line, its harmonics and output, slowed down to one sample per
frame if you like, with seven lecture scenes (noise to note, pitch
quantization at 48 and 8 kHz, why high notes die faster, tone, pick position,
strum timing) and an editable loop filter that is analysed deterministically
(linearity, gain and delay per frequency, predicted ring times) instead of by
an LLM. No samples, no backend. 53 vitest tests, 100% statement coverage on
the core.
Live: [pluck-lab.pisan.me](https://pluck-lab.pisan.me).
See its [README](./pluck-lab/README.md).

### [`pull-the-pin/`](./pull-the-pin)

A Ben Eater style SAP-1 8-bit computer simulated pin by pin (11 chip packages,
168 pins, 52 nets, 0/1/Z with wired-AND contention) with one hidden fault:
a stuck net, an open pin, a bus short, a flipped microcode ROM bit or a dead
chip. Students run test programs for free, spend a probe budget on a logic
analyzer, and watch the set of the 3,810 catalog faults still consistent with
their measurements shrink (every fault simulated per program in a Web Worker
and compared by waveform hash). A deterministic "next probe" suggestion
replaces the LLM tutor. Sandbox with healthy-vs-faulty diffs, seeded and
hand-picked challenge links, local attempt log. No backend. 74 vitest tests,
99% statement coverage on the core.
Live: [pull-the-pin.pisan.me](https://pull-the-pin.pisan.me).
See its [README](./pull-the-pin/README.md).

### [`leap-second-lab/`](./leap-second-lab)

23:59:60, a timekeeping lab: TAI, UTC, GPS, Unix and UT1 on one zoomable
timeline with a continuous-UTC projection, a step vs 24 h smear vs UTC-SLS vs
monotonic simulator with a seeded two-host log replay (reordered lines,
receives before sends, backwards clocks), and a library bench of ten
leap-second edge cases recorded from real JS Date, Temporal, Python and
Postgres runs. Four fix-the-bug exercises run hidden tests in a Web Worker.
Hand-written notes replace the LLM explainer. No backend. 47 vitest tests,
99.7% statement coverage on the core.
Live: [leap-second-lab.pisan.me](https://leap-second-lab.pisan.me).
See its [README](./leap-second-lab/README.md).

### [`data-structure-city/`](./data-structure-city)

Data Structure City: a hash map, a B-tree, a skip list and an LRU cache driven
by one Redis-like console (SET/GET/DEL/EXPIRE/TICK/RANGE). Rehashes, node
splits and merges, tower promotions and evictions are highlighted and narrated,
and each building has a cost meter with last, amortized and worst-case figures.
Five predict-then-reveal guided tours; instructors share their own as JSON in
a URL fragment. Keyboard navigation and a text narration mode. No backend.
71 vitest tests, 99.8% statement coverage on the core.
Live: [data-structure-city.pisan.me](https://data-structure-city.pisan.me).
See its [README](./data-structure-city/README.md).

### [`poincare-paint/`](./poincare-paint)

Poincaré Paint, a drawing toy in the Poincaré disk: every stroke is folded
into the fundamental triangle of a {p,q} reflection group and redrawn under
every tile with Möbius maps, so doodles become Circle Limit patterns.
Rotation or kaleidoscope symmetry, any hyperbolic {p,q} up to 20, a geodesic
brush, drag to translate the plane (the view is rebased onto a group element
after each step so precision holds however far you go), double-click to glide
a point to the centre, and a measure tool for hyperbolic distance and
triangle angle sum and area. SVG export and share links that carry the whole
drawing in the URL. No backend. 58 vitest tests, 100% statement coverage on
the core.
Live: [poincare-paint.pisan.me](https://poincare-paint.pisan.me).
See its [README](./poincare-paint/README.md).

### [`tamerlane-board/`](./tamerlane-board)

Tamerlane Board: Timur's fourteenth-century chess on its 11×10 board with
giraffes, war engines and citadels, against an alpha-beta engine in a Web
Worker. Every piece is one line of a Betza-like notation (the giraffe is
`F>R{3,}`), read by the move generator, the overlay and the engine alike. A
piece lab animates a new piece's reach with optional blockers, estimates its
value from mobility, drops it into Timur or classic chess, runs
engine-vs-engine balance games and shares it as a link. The LLM
English-to-notation step is replaced by examples and a syntax table. No
backend. 82 vitest tests, 99% statement coverage on the core.
Live: [tamerlane-board.pisan.me](https://tamerlane-board.pisan.me).
See its [README](./tamerlane-board/README.md).

### [`tiny-brains-league/`](./tiny-brains-league)

Tiny Brains League, a classroom ML assignment kit: train the smallest Connect
Four policy network you can under a 5,000-parameter budget, by imitating a
house bot (Adam on a legal-masked softmax, mirrored data) or by an evolution
strategy, in a Web Worker. Submissions are plain JSON weight files validated
against a fixed 84-in/7-out interface, so no student code runs. A round-robin
ladder over fixed openings with colour swaps rates bots by a Bradley-Terry
Elo fit plus an Elo-per-1k-parameters board, with milestone badges, a replay
viewer that flags missed wins and blocks, an ablation log export, and a NumPy
reference runtime checked against the browser by a parity fixture. No
backend. 46 vitest tests, 100% statement coverage on the core.
Live: [tiny-brains-league.pisan.me](https://tiny-brains-league.pisan.me).
See its [README](./tiny-brains-league/README.md).

### [`gpu-parallel-puzzler/`](./gpu-parallel-puzzler)

GPU Parallel Puzzler: twelve CUDA-style kernel puzzles on a simulated SIMT
GPU (warps, divergence, coalescing, shared memory and bank conflicts,
barriers, atomics) with a cost model, a CPU-vs-GPU estimate, a race
detector, star grading against par, a warp inspector and deterministic hints
in place of the suggested Claude tutor. Students export progress files and
instructors load them into a class table. No backend. 36 vitest tests, 99.2%
statement coverage on the core.
Live: [gpu-parallel-puzzler.pisan.me](https://gpu-parallel-puzzler.pisan.me).
See its [README](./gpu-parallel-puzzler/README.md).

### [`modulo-bias-microscope/`](./modulo-bias-microscope)

Modulo Bias Microscope: paste a JavaScript sampling function (pick an
element, shuffle, weighted choice) and see how far its distribution drifts
from the one intended. Exact mode enumerates every draw sequence from a tiny
random source (1 to 16 bits) and reports each probability as a BigInt
fraction; statistical mode runs a chi-square test on a 32-bit xoshiro128**
stream. Seven-bug gallery with fixes, a shuffle position heat map,
permalinks, and instructor exercise links with an exact-first autograder.
JavaScript only (no Pyodide), no LLM, no backend. 68 vitest tests, 100%
statement coverage on the core.
Live: [modulo-bias-microscope.pisan.me](https://modulo-bias-microscope.pisan.me).
See its [README](./modulo-bias-microscope/README.md).


### [`consent-leak-watch/`](./consent-leak-watch)

Consent Leak Watch: for small WooCommerce and WordPress shops and the agencies
that maintain them. The owner records two short visits in Chrome (banner left
alone, and after Reject all), saves them as HAR files and drops them in. The
app finds cookies and requests from about 25 advertising, analytics and embed
services that fired before consent or after the rejection, splits the
recording at the click by reading the banner's own consent cookie (Complianz,
CookieYes, Cookiebot, OneTrust, Borlabs, Real Cookie Banner), and treats a
Google Consent Mode hit sent with consent denied as a note rather than a leak.
Each leak is traced to a plugin by following Chrome's `_initiator` chain back
to a `/wp-content/plugins/<slug>/` file, or by the WordPress handle id of the
inline snippet in the page HTML; when a speed plugin has combined the files,
or PHP set the cookie, it says so instead of guessing. A saved check can be
compared with a later one, which names the plugin that changed version and
now sits behind a new leak. The idea's hosted headless-Chromium scanner with
weekly rescans and email diffs was replaced by this do-it-yourself, fully
client-side core: nothing is uploaded and nothing runs on a schedule. 44
vitest tests, 100% statement coverage.
Live: [consent-leak-watch.pisan.me](https://consent-leak-watch.pisan.me).
See its [README](./consent-leak-watch/README.md).


### [`acr-draft/`](./acr-draft)

ACR Draft: for small software companies, edtech especially, that are asked
for a VPAT before a university will buy. The vendor describes the product,
answers twelve yes/no questions that settle Not Applicable criteria (video,
live streams, time limits, gestures, forms, payments or test submissions...),
and attaches axe-core results to each key screen: from a console snippet that
loads axe-core 4.11.0 from cdnjs on a signed-in screen and copies the
results, from an `@axe-core/cli` file covering several pages, or by pasting
the page HTML, which the app strips of scripts and handlers and scans in a
sandboxed iframe with the bundled axe-core. A guided review covers all 50
WCAG 2.1 A and AA criteria, each with a plain-language test, the scan's
findings and an outcome plus evidence note. Fixed rules then set each
conformance level and remark: no Supports from a scan alone, a pass that
contradicts scan failures becomes Partially Supports, every claim needs a
note, Not Evaluated (not allowed for A/AA in VPAT 2.5) stamps the report
DRAFT, and 4.1.1 Parsing is Supports per the 2023 errata. Export is the VPAT
2.5 WCAG edition layout as Word (docx library, lazy-loaded), HTML or print to
PDF, with screens tested and an evidence appendix. Saved project files can be
compared release to release (level changes, new and fixed failures, screens
dropped). The idea's hosted Playwright crawler, Supabase storage and Claude
remark drafting were replaced by this fully client-side, rule-based core.
48 vitest tests, 99% statement coverage.
Live: [acr-draft.pisan.me](https://acr-draft.pisan.me).
See its [README](./acr-draft/README.md).


### [`student-journey-check/`](./student-journey-check)

Student Journey Check: for coaches, tutors and small academies that sell
courses from their own WordPress site with Tutor LMS. A test student walks
eight steps the way real students do: the site opens (critical error,
maintenance, database error, PHP warnings), login through `/wp-login.php` or
a custom page (wrong password, CAPTCHA, two-factor and silent failures told
apart), the dashboard (bounced back to login, a popup already open, course
not listed), the course page (enrolled or offered "Enroll Now"), a lesson and
its video (access denied, YouTube embeds that hit Error 153 because of a
`no-referrer` policy, empty players), the quiz page (opened, never taken),
the certificate page ("Nonce not matched") and the price a logged-out visitor
sees (struck-through sale prices, missing or changed prices, several
currency formats). Each step reports Works, Look at this, Broken or Not
checked with the page's own words and what to try, plus a ready-to-forward
alert email, a text report and new/fixed/still-broken changes against the
last check on the same device. A demo tab runs the same checker in the
browser against a pretend Tutor LMS academy with seven switchable breakages
taken from 2026 support-forum reports. Real sites are read by one stateless
Netlify function, `POST /api/step`, called once per step so each call fits
the 10-second limit; the session cookies travel with the browser, the
password goes only to the login step and nothing is stored. Requests stay on
the host the owner typed, every hop is DNS-checked against private and
reserved addresses, and redirects are followed by hand. The idea's
Playwright worker, screenshots, Supabase schedules and daily email alerts
were replaced by this on-demand, HTML-reading core: no browser runs, so
script-only problems and actual video playback are out of reach. 141 vitest
tests, 99% statement coverage.
Live: [student-journey-check.pisan.me](https://student-journey-check.pisan.me).
See its [README](./student-journey-check/README.md).


### [`dossier-comment-reflector/`](./dossier-comment-reflector)

Dossier Comment Reflector: for faculty preparing a promotion, tenure or
post-tenure dossier that asks how student comments changed their teaching.
Comments come in as CSV exports (the comment, course and term columns are
guessed, several comment columns per file are kept with their question, "N/A"
answers skipped) or as pasted text, one course and term at a time. Term labels
in any common form ("Fall 2024", "SP25", "2024-25 Semester 2") are put in
calendar order. Each comment is split into clauses and sorted into thirteen
built-in themes plus any the user adds by keyword; tone comes from a word list
with negation, intensifiers, "too <word>" and contrast handling, so one comment
can be positive on clarity and critical on exams. A theme-by-term table shows
mentions and critical counts per course. The user records each course change
in their own words with its first term; the app ticks matching themes and
compares mention share and critical share before and after, refusing to judge
with fewer than five mentions on a side. The quote picker balances praise and
criticism, spreads picks across terms, drops near-duplicates, honours pins and
exclusions, and replaces titled names, listed names and emails with
[name]/[email]. The reflection draft (intro, one paragraph per change with
before/after numbers and verbatim excerpts, strengths, still working on) fits
a pages x words-per-page budget by dropping material in a fixed order and saying
what it dropped; bracketed placeholders mark what only the author can write.
It exports to Word (docx, lazy-loaded), plain text, and a coded-comments CSV;
projects save to a local JSON file and nothing is stored or uploaded. The idea's
Claude clustering and drafting, Supabase and Stripe were replaced by this
deterministic, browser-only core. 101 vitest tests, 99% statement coverage;
zero axe WCAG 2.1 AA violations in light and dark mode.
Live: [dossier-comment-reflector.pisan.me](https://dossier-comment-reflector.pisan.me).
See its [README](./dossier-comment-reflector/README.md).
