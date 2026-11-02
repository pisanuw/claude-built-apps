# 50 apps built by Claude

[![CI](https://github.com/pisanuw/claude-built-apps/actions/workflows/ci.yml/badge.svg)](https://github.com/pisanuw/claude-built-apps/actions/workflows/ci.yml)

Every app in this repo was built by [Claude Code](https://claude.com/claude-code)
from a one-paragraph idea. Claude wrote the code, the tests and the deploy
scripts. I picked the ideas, set the rules, reviewed the results and said no
a lot.

Claude can write the code. Getting it to build the right thing, test it
properly and ship something people can use still takes someone who knows
what good looks like. That part is my job.

All of them are live, most run entirely in your browser (no sign-up, nothing
uploaded), and every one has its own tests and CI.

**Want one built?** I build tools like these for small businesses, startups
and educators. Email [builder@pisan.me](mailto:builder@pisan.me?subject=Project%20idea)
with a paragraph about the problem and I'll tell you honestly whether it fits.
Paid work keeps the lights on, but a useful or interesting problem matters
more to me than the budget. If you just want ideas, I keep a public list of
[600+ things I could build for you](https://daily-project-ideas.netlify.app/).

Yusuf Pisan

## Start here

<table>
<tr>
<td width="50%" valign="top">
<a href="https://bombe-bench.pisan.me/"><img src="bombe-bench/desktop.png" alt="Bombe Bench: an Enigma machine with the signal path of one keypress drawn through plugboard, rotors and reflector"></a>
<p><b><a href="https://bombe-bench.pisan.me/">Bombe Bench</a></b>: an Enigma you can open up, and a working Turing-Welchman Bombe that breaks messages from a crib. <a href="./bombe-bench">Code</a></p>
</td>
<td width="50%" valign="top">
<a href="https://cache-miss-theater.pisan.me/"><img src="cache-miss-theater/desktop.png" alt="Cache Miss Theater: a matrix multiply trace with a conflict miss highlighted in the cache sets"></a>
<p><b><a href="https://cache-miss-theater.pisan.me/">Cache Miss Theater</a></b>: write a C loop nest and watch every access go through a cache you configure, with each miss labelled compulsory, capacity or conflict. <a href="./cache-miss-theater">Code</a></p>
</td>
</tr>
</table>

## The catalog

### Developer and web tools

| App | What it does |
|---|---|
| [Accessibility Lens](https://accessibility-lens-pisanuw.netlify.app/) ([code](./accessibility-lens)) | Scan a public page against WCAG 2.1, then see it the way low-vision, color-blind, keyboard-only and screen-reader users do. |
| [Agent Blast Radius](https://agent-blast-radius.netlify.app/) ([code](./agent-blast-radius)) | Drop in MCP configs and agent settings to see what each AI tool on your machine can reach. |
| [HAR Detective](https://har-detective.netlify.app/) ([code](./har-detective)) | Drag in a browser HAR file for a waterfall and a ranked, plain-English performance report. |
| [Cron Cartographer](https://cron-cartographer.netlify.app/) ([code](./cron-cartographer)) | Any cron expression, RRULE or GitHub Actions schedule as a calendar heatmap of when it fires. |
| [Schema Storyteller](https://schema-storyteller.netlify.app/) ([code](./schema-storyteller)) | Paste a SQL, Prisma or JSON schema, get the data model in plain English plus missing keys and indexes. |
| [Migration Diff Narrator](https://migration-diff-narrator.netlify.app/) ([code](./migration-diff-narrator)) | Two versions of a schema in, every change marked safe, caution or breaking out. |
| [Repo Weight Map](https://repo-weight-map.netlify.app/) ([code](./repo-weight-map)) | Drop a project folder in and see what is bloating it, with the `.gitignore` lines to fix it. |
| [UI Diff Lens](https://ui-diff-lens.netlify.app/) ([code](./ui-diff-lens)) | Two screenshots in, every changed region classified as layout, spacing, color, text and so on. |
| [Type Witness](https://type-witness.netlify.app/) ([code](./type-witness)) | Watch the TypeScript compiler infer types, expression by expression. |
| [Net Units](https://net-units.netlify.app/) ([code](./net-units)) | Measure how much code a change adds in syntax-level units instead of lines. |
| [Prompt Genome](https://prompt-genome.netlify.app/) ([code](./prompt-genome)) | Split a prompt into color-coded parts (role, task, constraint, format...) and lint it. |
| [Prompt Shrink Ray](https://prompt-shrink-ray.netlify.app/) ([code](./prompt-shrink-ray)) | Compress an LLM prompt with a live token estimate and a check that the keywords survived. |
| [Game Palette Inspector](https://game-palette-inspector.netlify.app/) ([code](./game-palette-inspector)) | Check a palette against WCAG contrast and 8 kinds of color blindness, with replacements that keep the art style. |
| [Diagram Layout Engine](https://diagram-layout-engine.netlify.app/) ([code](./diagram-layout-engine)) | A from-scratch layout engine for Mermaid flowcharts, with every stage of the pipeline visible. |
| [Modulo Bias Microscope](https://modulo-bias-microscope.netlify.app/) ([code](./modulo-bias-microscope)) | Paste a random sampling function and see exactly how biased it is. |
| [Shortcut Sprint](https://shortcut-sprint.netlify.app/) ([code](./shortcut-sprint)) | Spaced-repetition drills for keyboard shortcuts in VS Code, Vim, Figma, Excel and more. |

### Tools for teachers

| App | What it does |
|---|---|
| [Letter Ledger](https://letter-ledger.netlify.app/) ([code](./letter-ledger)) | Recommendation-letter requests: a request link with your policy and FERPA release, encrypted packets, a deadline dashboard. |
| [Code Viva](https://code-viva.netlify.app/) ([code](./code-viva)) | Short oral checks on each student's own submission, with questions anchored to their functions. |
| [Study Buddy Matchmaker](https://study-buddy-matchmaker.netlify.app/) ([code](./study-buddy-matchmaker)) | Upload a gradebook CSV and get complementary study pairs with shared agendas. |
| [Where Does It Say](https://where-does-it-say.netlify.app/) ([code](./where-does-it-say)) | Questions about the syllabus answered only with verbatim quotes, or a refusal. |
| [Code Analogy Forge](https://code-analogy-forge.netlify.app/) ([code](./code-analogy-forge)) | Three analogies for a piece of code or a CS concept, pitched at the audience you choose. |

### Interactive CS lessons

| App | What it does |
|---|---|
| [Bombe Bench](https://bombe-bench.pisan.me/) ([code](./bombe-bench)) | Step through an Enigma rotor by rotor, then break it with a working Bombe. |
| [Cache Miss Theater](https://cache-miss-theater.pisan.me/) ([code](./cache-miss-theater)) | Watch a C loop nest's exact address trace run through a configurable cache. |
| [Fork Count](https://fork-count.netlify.app/) ([code](./fork-count)) | Every process, pipe and possible output of a fork/wait/pipe C snippet, deadlocks included. |
| [Assignment Stress Test](https://assignment-stress-test.netlify.app/) ([code](./assignment-stress-test)) | Every output the scheduler could produce for a fork/wait snippet, and why the others are impossible. |
| [Heap Arena Replay](https://heap-arena-replay.netlify.app/) ([code](./heap-arena-replay)) | Replay a malloc/free trace on a word-accurate heap under different allocator policies. |
| [SQL Replay](https://sql-replay.netlify.app/) ([code](./sql-replay)) | Watch a SELECT execute step by step, each stage narrated. |
| [Edit Graph Lab](https://edit-graph-lab.netlify.app/) ([code](./edit-graph-lab)) | Diff as a shortest-path search, with Myers' algorithm animated. |
| [Data Structure City](https://data-structure-city.netlify.app/) ([code](./data-structure-city)) | A hash map, B-tree, skip list and LRU cache side by side, driven by one Redis-like console. |
| [GPU Parallel Puzzler](https://gpu-parallel-puzzler.netlify.app/) ([code](./gpu-parallel-puzzler)) | Twelve kernel puzzles on a simulated GPU: warps, divergence, coalescing, bank conflicts. |
| [Pathfinding Playground](https://pathfinding-playground-pisanuw.netlify.app/) ([code](./pathfinding-playground)) | Draw a grid and race BFS, Dijkstra, A* and friends across it. |
| [State Space Atlas](https://state-space-atlas.netlify.app/) ([code](./state-space-atlas)) | Every reachable state of Hanoi, sliding tiles, Klotski and Rush Hour, drawn as one graph. |
| [Elevator Algorithm Lab](https://elevator-algorithm-lab.netlify.app/) ([code](./elevator-algorithm-lab)) | Write an elevator dispatch policy in JavaScript and run it against seeded traffic. |
| [Lockstep Lab](https://lockstep-lab.netlify.app/) ([code](./lockstep-lab)) | Watch deterministic lockstep and rollback netcode work, and fail. |
| [Pull the Pin](https://pull-the-pin-lab.netlify.app/) ([code](./pull-the-pin)) | An 8-bit SAP-1 computer where the instructor breaks a chip and students find the fault. |
| [Program Alarm 1202](https://program-alarm-1202.netlify.app/) ([code](./program-alarm-1202)) | A playable model of the Apollo Guidance Computer's executive during the lunar descent. |
| [Leap Second Lab](https://leap-second-lab.netlify.app/) ([code](./leap-second-lab)) | TAI, UTC, GPS, Unix and UT1 on one timeline, and what 23:59:60 does to your code. |
| [Cipher Ladder](https://cipher-ladder.netlify.app/) ([code](./cipher-ladder)) | Climb from Caesar to Vigenère to homophonic ciphers with live cryptanalysis tools. |
| [Code Review Gauntlet](https://code-review-gauntlet.netlify.app/) ([code](./code-review-gauntlet)) | Race the clock to spot planted bugs and security holes. |
| [Pluck Lab](https://pluck-lab.netlify.app/) ([code](./pluck-lab)) | A keyboard guitar synthesized live by Karplus-Strong, with the filter on screen. |
| [Tiny Brains League](https://tiny-brains-league.netlify.app/) ([code](./tiny-brains-league)) | Train the smallest Connect Four network you can and climb a ladder. |
| [Brocot Gear Finder](https://brocot-gear-finder.netlify.app/) ([code](./brocot-gear-finder)) | Gear trains for any ratio with continued fractions and the Stern-Brocot tree. |

### Games and toys

| App | What it does |
|---|---|
| [Poincaré Paint](https://poincare-paint.netlify.app/) ([code](./poincare-paint)) | Draw in the hyperbolic disk and watch every stroke tile to infinity. |
| [Tamerlane Board](https://tamerlane-board.netlify.app/) ([code](./tamerlane-board)) | Timur's 14th-century chess with giraffes, war engines and citadels. |
| [Reverse Minesweeper Studio](https://reverse-minesweeper-studio.netlify.app/) ([code](./reverse-minesweeper-studio)) | Paint a picture with mines and find out if it can be solved without guessing. |
| [Outguess Me](https://outguess-me.netlify.app/) ([code](./outguess-me)) | Press F or J as randomly as you can while an oracle predicts you. You are less random than you think. |
| [Sound Sketchpad](https://sound-sketchpad.netlify.app/) ([code](./sound-sketchpad)) | Describe a sound effect in words and get playable audio with WAV export. |
| [Emoji Lingua](https://emoji-lingua-pisan.netlify.app/) ([code](./emoji-lingua)) | English to emoji and back. |
| [Mult Streak](https://mult-streak-edge-pisan.netlify.app/) ([code](./mult-streak)) | Ten multiplications in a row wins a 24-hour crown. |

Also in the repo: [`backend-hub`](./backend-hub) (several small backends on one
Render service), [`summit-navigator`](./summit-navigator) (schedule for a
conference that has now happened) and [`tetromino-arcade`](./tetromino-arcade).

Longer write-ups of every app, including what each one deliberately leaves
out, are in [PROJECTS.md](./PROJECTS.md).

## How they get built

1. A scheduled Claude routine in
   [`daily-project-ideas`](https://github.com/pisanuw/daily-project-ideas)
   looks for real demand (complaints, feature requests, people paying for
   similar tools) and writes up a few ideas each morning.
2. I pick one. Claude builds it in its own folder here: TypeScript, vitest
   with at least 85% coverage, lint, typecheck, and a `deploy/target.yml`.
3. CI checks every package on every push. The deploy workflow finds every
   `*/deploy/target.yml` and ships changed apps to Netlify or Render.
4. A shared footer from [`scripts/site-footer.mjs`](./scripts/site-footer.mjs)
   is added to every app at deploy time.

Most apps replace the idea's suggested LLM calls with deterministic code where
that works, so they are free to run, work offline and give the same answer
twice. The design decisions for each app are in its README.

## Running one locally

```bash
cd bombe-bench
npm ci
npm run dev
```

Every package also has `npm run lint`, `npm run typecheck`, `npm run coverage`
and `npm run build`.

## License

[MIT](./LICENSE)
