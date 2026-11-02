# Cipher Ladder

**Break six classical ciphers, one rung at a time, then see how a solver did
it.** Students climb from a Caesar shift through affine, Vigenere, columnar
transposition and monoalphabetic substitution to a homophonic cipher, with an
analysis workbench beside the ciphertext: letter and bigram frequencies
against English baselines, index of coincidence per candidate period, a
Kasiski repeat finder, per-column charts, and keyboard-only substitution and
symbol boards that update the decryption live. Each rung unlocks only after a
correct solve. After a solve, a deterministic solver attacks the same
ciphertext and its step-by-step log is shown next to the student's own path,
including where it went wrong, so students critique the machine's reasoning
rather than copy it. Instructors build their own ladder (cipher, key, text,
hint budget per rung) into a share link and read exported progress files in a
dashboard. Everything runs in the browser.

Live: [cipher-ladder.pisan.me](https://cipher-ladder.pisan.me)

![On the Caesar rung the tallest ciphertext bar, A, is taken as E; sliding the shift to 22 turns the decryption into The War of the Worlds, and checking it solves the rung and opens a debrief with the solver's own step-by-step attack](demo.gif)

Implements idea #2 ("Cipher Ladder") from the
[2026-09-25 ideas day](https://github.com/pisanuw/daily-project-ideas)
of `pisanuw/daily-project-ideas`.

## What it does

- **Six ciphers.** Caesar shift, affine (`a*x + b mod 26`, twelve valid
  multipliers), monoalphabetic substitution, Vigenere, irregular columnar
  transposition (columnar rungs are trimmed to whole rows so the read order is
  the only unknown), and homophonic substitution over two-digit symbols with
  frequency-proportional symbol counts (E gets several, Z gets one; 45 symbols
  by default so the histogram is flat but the puzzle stays solvable).
- **Workbench.** Letter frequency chart with the English baseline behind each
  bar, top bigrams and trigrams next to the English ranking, index of
  coincidence for periods 1 to 12 with the English and random reference lines,
  a Kasiski table (repeated trigrams, positions, distances, and how many
  distances each period divides), and for Vigenere a period picker that charts
  one column at a time. Homophonic rungs get a symbol histogram and repeated
  symbol pairs. Every chart is an SVG with a title and description and a
  collapsible data table for screen readers. A notes scratchpad per rung.
- **Key panels.** A shift slider, affine `a`/`b` inputs, a keyword box that
  accepts `?` for unknown letters, a column-count and read-order panel (or a
  keyword that fills it), and 26-cell and per-symbol boards where typing a
  letter moves to the next cell, Backspace moves back, and a plaintext letter
  used twice is flagged.
- **Hints with a budget.** Each rung has an instructor-set number of hints.
  A hint reveals one more piece of the key: the shift; `b` then `a`; the key
  length then one keyword letter; the column count then one chunk's column;
  the most frequent unmapped cipher letter or symbol.
- **Debrief after the solve.** The solver's log for that rung: chi-squared
  over all 26 shifts or all 312 affine keys and whether the "most frequent
  letter is E" guess held; Kasiski versus IC for the period and per-column
  Caesar solves; every read order for up to seven columns and swap
  hill-climbing beyond; frequency-seeded hill-climbing on a trigram model for
  substitution; simulated annealing with a letter-histogram penalty for
  homophonic. The outcome line reports the solver's accuracy against the true
  plaintext, its own confidence, and the first positions it got wrong. The
  student's side shows time on rung, hints, failed checks and tools opened.
- **Ladder builder.** Title, seed, and per rung: cipher, optional title, key
  (or blank for one generated from the seed), plaintext (or blank for a
  bundled public-domain passage), hint budget, and a note. The ladder is
  encoded in the URL fragment, so a link is the whole assignment and nothing
  is stored on a server. A preview line shows the generated key and passage.
- **Progress and dashboard.** Progress (status, time, hints, attempts, tools,
  keys, notes) is kept in `localStorage` per ladder and can be downloaded as
  JSON. The instructor dashboard takes any number of those files, dropped or
  chosen, and shows each student's current rung, solved count, hints, total
  and per-rung time and tools used, plus a per-rung table of how many are
  stuck there and the median time to solve.
- **Fourteen bundled passages** (Lincoln, Jefferson, Carroll, Austen, Dickens,
  Melville, Doyle, Stevenson, Wells, Shelley, Thoreau, Twain, Stoker) serve
  both as default plaintexts and as the training text for the n-gram model.

## What it does not do

- **No LLM debrief.** The idea asked for an LLM's attack on the same
  ciphertext. The solver here is a deterministic program with a written log,
  so the debrief is free, offline, reproducible, and honest about its
  limits: on short substitution or homophonic texts it says its confidence is
  low, and it usually leaves a couple of rare letters swapped on the
  homophonic rung.
- **No accounts or server.** Supabase auth, rosters and live progress are
  replaced by localStorage plus a JSON export the student hands in. The
  dashboard only knows what was uploaded to it.
- **The language model is small.** Bigram and trigram statistics come from
  about eleven thousand letters of the bundled passages, not a large corpus,
  so the solvers are calibrated for texts of a few hundred letters. Instructor
  plaintexts shorter than that make the solver weaker (and the puzzle harder).
- **Hints reveal the truth, not strategy.** They are key fragments, not
  Socratic questions.

## Development

```bash
npm install
npm run dev        # Vite dev server
npm run lint       # eslint
npm run typecheck  # tsc --noEmit
npm run coverage   # vitest with coverage thresholds (85%)
npm run build      # tsc + vite build into dist/
```

No environment variables (see `.env.example`). Deployed to Netlify as a static
site by the monorepo's deploy workflow via `deploy/target.yml`.

## Layout

```
src/core/text.ts       alphabet helpers, English frequencies, chi-squared, IC
src/core/corpus.ts     public-domain passages
src/core/ngram.ts      bigram/trigram model trained on the corpus
src/core/rng.ts        seeded PRNG (mulberry32) so links reproduce puzzles
src/core/ciphers.ts    the six ciphers, full and partial keys, key generation
src/core/analysis.ts   frequency tables, IC by period, Kasiski
src/core/solvers.ts    one deterministic attacker per cipher, with a step log
src/core/ladder.ts     ladder definition, URL encoding, materialization, hints
src/core/progress.ts   progress records, export/import, dashboard rows
src/ui/charts.ts       accessible SVG bar charts
src/main.ts            the page (climb, build, dashboard views)
test/                  65 vitest tests, 100% statement coverage on src/core
```
