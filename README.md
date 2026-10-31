# 61 apps built by Claude

Free tools for small businesses, teachers, students and the curious. Every
one is live: click a name below and it opens in your browser. Most need no
sign-up and send nothing anywhere; your files stay on your computer.

Each app started as a one-paragraph idea. [Claude Code](https://claude.com/claude-code)
wrote the code; I picked the ideas, set the bar, reviewed the results and
said no a lot. Claude can write code. Getting it to build the right thing,
check it properly and ship something people can use still takes someone who
knows what good looks like. That part is my job.

**Want one built?** I build tools like these for small businesses, startups
and educators. Email [builder@hintwise.org](mailto:builder@hintwise.org?subject=Project%20idea)
with a paragraph about the problem and I'll tell you honestly whether it fits.
Paid work keeps the lights on, but a useful or interesting problem matters
more to me than the budget. Looking for ideas? I keep a public list of
[600+ things I could build for you](https://studio.hintwise.org/).

Yusuf Pisan

## My biggest project

<a href="https://digital-student-assistant.com/"><img src="docs/images/digital-student-assistant.png" alt="Digital Student Assistant: the sign-in page, where Bo explains and Kit asks you to explain" width="100%"></a>

**[Digital Student Assistant](https://digital-student-assistant.com/)** is the
AI teaching assistant for my data structures courses at UW Bothell, and my
students are using it now. It guides rather than answers: it asks before it
tells, it will not hand over homework solutions, and it teaches from my own
lectures and recordings rather than the internet. How it holds back the answer
is written up in
[Teaching an LLM Tutor to Withhold the Answer](https://arxiv.org/abs/2608.12292).
Its code is private. To look around, sign in with the demo account
`demo@hintwise.org` (no code needed); student accounts are limited to UW
addresses for now.

## Start here

<table>
<tr>
<td width="50%" valign="top">
<a href="https://accessibility-lens.hintwise.org/"><img src="accessibility-lens/demo.gif" alt="Accessibility Lens: scanning the W3C's deliberately inaccessible demo page scores 0, then the page is replayed as a screen reader's linear stream, a blurred low-vision view and a color-blindness filter"></a>
<p><b><a href="https://accessibility-lens.hintwise.org/">Accessibility Lens</a></b>: paste your website's address and see what blind, low-vision, color-blind and keyboard-only visitors get, with a suggested fix for each problem. For small businesses that want to know where their site stands before a customer tells them. <a href="./accessibility-lens">Code</a></p>
</td>
<td width="50%" valign="top">
<a href="https://code-viva.hintwise.org/"><img src="code-viva/demo.gif" alt="Code Viva: the review tab of the demo course puts the student with an unexplained commit and pasted answers at the top of the flag queue"></a>
<p><b><a href="https://code-viva.hintwise.org/">Code Viva</a></b>: short written orals on each student's own code: questions anchored to their functions and commits, with a flag queue so TA time goes to the few who need a conversation. <a href="./code-viva">Code</a></p>
</td>
</tr>
<tr>
<td width="50%" valign="top">
<a href="https://bombe-bench.hintwise.org/"><img src="bombe-bench/demo.gif" alt="Bombe Bench: typing on the Enigma lights each signal path, then the Bombe breaks the message from a crib"></a>
<p><b><a href="https://bombe-bench.hintwise.org/">Bombe Bench</a></b>: an Enigma you can open up, and a working Turing-Welchman Bombe that breaks messages from a crib. <a href="./bombe-bench">Code</a></p>
</td>
<td width="50%" valign="top">
<a href="https://cache-miss-theater.hintwise.org/"><img src="cache-miss-theater/demo.gif" alt="Cache Miss Theater: row order hits three reads in four, column order crowds four cache sets and every read misses"></a>
<p><b><a href="https://cache-miss-theater.hintwise.org/">Cache Miss Theater</a></b>: write a C loop nest and watch every access go through a cache you configure, with each miss labelled compulsory, capacity or conflict. <a href="./cache-miss-theater">Code</a></p>
</td>
</tr>
<tr>
<td width="50%" valign="top">
<a href="https://fork-count.hintwise.org/"><img src="fork-count/demo.gif" alt="Fork Count: the loop-counter example shows 4 processes and 3 possible outputs, and an impossible output is rejected with the edges that rule it out"></a>
<p><b><a href="https://fork-count.hintwise.org/">Fork Count</a></b>: paste a fork/wait/pipe snippet and see every process, every output the scheduler could produce, and why the others are impossible. <a href="./fork-count">Code</a></p>
</td>
<td width="50%" valign="top">
<a href="https://mychessmaster.net/"><img src="docs/images/mychessmaster-report.png" alt="MyChessMaster: a sample player's report with accuracy, critical moments per game, and the three error types to drill first"></a>
<p><b><a href="https://mychessmaster.net/">MyChessMaster</a></b>: a chess coach for tournament players: Stockfish finds where each game went wrong, a coach model explains why, and the mistakes become prep sheets and spaced-repetition drills. Built with Claude Code for tournament players preparing for a specific opponent; its code is in a private repo.</p>
</td>
</tr>
<tr>
<td colspan="2" valign="top">
<a href="https://stepwise.hintwise.org/"><img src="docs/images/stepwise.gif" alt="StepWise: inserting 10 20 30 40 50 25 into an AVL tree, with each step narrated, the running pseudocode line highlighted and the rotations shown" width="100%"></a>
<p><b><a href="https://stepwise.hintwise.org/">StepWise</a></b>: data structures and algorithms one step at a time, for university courses. Pick any of 100+ structures and algorithms, run operations on it, and every step comes with a plain explanation, the pseudocode line that is running and the variables. Step backwards as far as you like, share what you built as a link, or embed it in Canvas. <a href="https://github.com/pisan-labs/visualizing-data-structures">Code</a></p>
</td>
</tr>
</table>

## The catalog

### Tools for small businesses

| App | What it does |
|---|---|
| [Accessibility Fleet Log](https://accessibility-fleet-log.hintwise.org/) ([code](./accessibility-fleet-log)) | For agencies looking after many client sites: everyone's accessibility status on one screen, a dated log of problems found and fixed, a statement per site and a monthly report under your name. |
| [Consent Leak Watch](https://consent-leak-watch.hintwise.org/) ([code](./consent-leak-watch)) | Check that your shop's cookie banner really blocks trackers, and which plugin broke it. |
| [Donation Receipts](https://donation-receipts.hintwise.org/) ([code](./donation-receipts)) | For small charities, churches and community groups: numbered donation receipts with your ABN and the right tax wording, and one 30 June statement per donor, straight from your Xero or bank export. |
| [Health Page Tracker Watch](https://health-page-tracker-watch.hintwise.org/) ([code](./health-page-tracker-watch)) | For therapists, clinics, med spas and wellness studios: every outside tool on your booking, intake and service pages, what it receives, whether its maker signs a BAA, and what is new since last month. |
| [Misrepresentation Preflight](https://misrepresentation-preflight.hintwise.org/) ([code](./misrepresentation-preflight)) | Suspended by Google Shopping for “Misrepresentation”? See every place your store contradicts itself (contact details, shipping and return times, prices, your feed) before your next review request. |
| [Popup Check](https://popup-check.hintwise.org/) ([code](./popup-check)) | A free bookmark that tests your email popup, age gate, cookie banner and chat button with the keyboard and a screen-reader view, and keeps a dated report with a message for the app’s support. |
| [Qualified Overtime Checker](https://qualified-overtime-checker.hintwise.org/) ([code](./qualified-overtime-checker)) | For small businesses with hourly staff and their bookkeepers: checks the new overtime figure on each W-2 (Box 12, code TT) against your timesheets, and lists who needs a correction, by how much and why, with a worksheet to keep. |
| [Student Journey Check](https://student-journey-check.hintwise.org/) ([code](./student-journey-check)) | A test student walks your online course after every update and tells you which step your students would get stuck on. |
| [US Duty Price Sheet](https://us-duty-price-sheet.hintwise.org/) ([code](./us-duty-price-sheet)) | For UK makers who post to US customers duty paid: a US code for every product, a US price and postage table with the duty included, and a list of which prices to change when US duty changes. |

### Developer and web tools

| App | What it does |
|---|---|
| [Accessibility Lens](https://accessibility-lens.hintwise.org/) ([code](./accessibility-lens)) | Scan a public page against WCAG 2.1, then see it the way low-vision, color-blind, keyboard-only and screen-reader users do. |
| [ACR Draft](https://acr-draft.hintwise.org/) ([code](./acr-draft)) | Write the accessibility report (VPAT) a university asks for before it buys your software: scans plus a guided review, exported to Word. |
| [Agent Blast Radius](https://agent-blast-radius.hintwise.org/) ([code](./agent-blast-radius)) | Drop in MCP configs and agent settings to see what each AI tool on your machine can reach. |
| [HAR Detective](https://har-detective.hintwise.org/) ([code](./har-detective)) | Drag in a browser HAR file for a waterfall and a ranked, plain-English performance report. |
| [Cron Cartographer](https://cron-cartographer.hintwise.org/) ([code](./cron-cartographer)) | Any cron expression, RRULE or GitHub Actions schedule as a calendar heatmap of when it fires. |
| [Schema Storyteller](https://schema-storyteller.hintwise.org/) ([code](./schema-storyteller)) | Paste a SQL, Prisma or JSON schema, get the data model in plain English plus missing keys and indexes. |
| [Migration Diff Narrator](https://migration-diff-narrator.hintwise.org/) ([code](./migration-diff-narrator)) | Two versions of a schema in, every change marked safe, caution or breaking out. |
| [Repo Weight Map](https://repo-weight-map.hintwise.org/) ([code](./repo-weight-map)) | Drop a project folder in and see what is bloating it, with the `.gitignore` lines to fix it. |
| [UI Diff Lens](https://ui-diff-lens.hintwise.org/) ([code](./ui-diff-lens)) | Two screenshots in, every changed region classified as layout, spacing, color, text and so on. |
| [Type Witness](https://type-witness.hintwise.org/) ([code](./type-witness)) | Watch the TypeScript compiler infer types, expression by expression. |
| [Net Units](https://net-units.hintwise.org/) ([code](./net-units)) | Measure how much code a change adds in syntax-level units instead of lines. |
| [Prompt Genome](https://prompt-genome.hintwise.org/) ([code](./prompt-genome)) | Split a prompt into color-coded parts (role, task, constraint, format...) and lint it. |
| [Prompt Shrink Ray](https://prompt-shrink-ray.hintwise.org/) ([code](./prompt-shrink-ray)) | Compress an LLM prompt with a live token estimate and a check that the keywords survived. |
| [Game Palette Inspector](https://game-palette-inspector.hintwise.org/) ([code](./game-palette-inspector)) | Check a palette against WCAG contrast and 8 kinds of color blindness, with replacements that keep the art style. |
| [Diagram Layout Engine](https://diagram-layout-engine.hintwise.org/) ([code](./diagram-layout-engine)) | A from-scratch layout engine for Mermaid flowcharts, with every stage of the pipeline visible. |
| [Modulo Bias Microscope](https://modulo-bias-microscope.hintwise.org/) ([code](./modulo-bias-microscope)) | Paste a random sampling function and see exactly how biased it is. |
| [Shortcut Sprint](https://shortcut-sprint.hintwise.org/) ([code](./shortcut-sprint)) | Spaced-repetition drills for keyboard shortcuts in VS Code, Vim, Figma, Excel and more. |

### Tools for teachers

| App | What it does |
|---|---|
| [Letter Ledger](https://letter-ledger.hintwise.org/) ([code](./letter-ledger)) | Recommendation-letter requests: a request link with your policy and FERPA release, encrypted packets, a deadline dashboard. |
| [Code Viva](https://code-viva.hintwise.org/) ([code](./code-viva)) | Short oral checks on each student's own submission, with questions anchored to their functions. |
| [Study Buddy Matchmaker](https://study-buddy-matchmaker.hintwise.org/) ([code](./study-buddy-matchmaker)) | Upload a gradebook CSV and get complementary study pairs with shared agendas. |
| [Where Does It Say](https://where-does-it-say.hintwise.org/) ([code](./where-does-it-say)) | Questions about the syllabus answered only with verbatim quotes, or a refusal. |
| [Code Analogy Forge](https://code-analogy-forge.hintwise.org/) ([code](./code-analogy-forge)) | Three analogies for a piece of code or a CS concept, pitched at the audience you choose. |
| [Dossier Comment Reflector](https://dossier-comment-reflector.hintwise.org/) ([code](./dossier-comment-reflector)) | Years of student evaluation comments in; themes, before-and-after evidence for your course changes, fair quotes and a page-limited tenure reflection draft out. |
| [Research Map](https://research-map.hintwise.org/) ([code](https://github.com/pisan-labs/research-map)) | A school's faculty as a map where people with similar research sit close together; search a topic or paste a project idea to find possible advisors and collaborators. Live for UW Bothell STEM and UW Tacoma. |

### Interactive CS lessons

| App | What it does |
|---|---|
| [StepWise](https://stepwise.hintwise.org/) ([code](https://github.com/pisan-labs/visualizing-data-structures)) | 100+ data structures and algorithms, every step narrated with its pseudocode line and variables; step back, share as a link, embed in Canvas. |
| [Bombe Bench](https://bombe-bench.hintwise.org/) ([code](./bombe-bench)) | Step through an Enigma rotor by rotor, then break it with a working Bombe. |
| [Cache Miss Theater](https://cache-miss-theater.hintwise.org/) ([code](./cache-miss-theater)) | Watch a C loop nest's exact address trace run through a configurable cache. |
| [Fork Count](https://fork-count.hintwise.org/) ([code](./fork-count)) | Every process, pipe and possible output of a fork/wait/pipe C snippet, deadlocks included. |
| [Assignment Stress Test](https://assignment-stress-test.hintwise.org/) ([code](./assignment-stress-test)) | Every output the scheduler could produce for a fork/wait snippet, and why the others are impossible. |
| [Heap Arena Replay](https://heap-arena-replay.hintwise.org/) ([code](./heap-arena-replay)) | Replay a malloc/free trace on a word-accurate heap under different allocator policies. |
| [SQL Replay](https://sql-replay.hintwise.org/) ([code](./sql-replay)) | Watch a SELECT execute step by step, each stage narrated. |
| [Edit Graph Lab](https://edit-graph-lab.hintwise.org/) ([code](./edit-graph-lab)) | Diff as a shortest-path search, with Myers' algorithm animated. |
| [Data Structure City](https://data-structure-city.hintwise.org/) ([code](./data-structure-city)) | A hash map, B-tree, skip list and LRU cache side by side, driven by one Redis-like console. |
| [GPU Parallel Puzzler](https://gpu-parallel-puzzler.hintwise.org/) ([code](./gpu-parallel-puzzler)) | Twelve kernel puzzles on a simulated GPU: warps, divergence, coalescing, bank conflicts. |
| [Pathfinding Playground](https://pathfinding-playground.hintwise.org/) ([code](./pathfinding-playground)) | Draw a grid and race BFS, Dijkstra, A* and friends across it. |
| [Four Ghosts, Four Targets](https://four-ghosts.hintwise.org/) ([code](./four-ghosts)) | Four maze chasers each pick a target tile; see every candidate move and race the greedy rule against BFS and A*. |
| [State Space Atlas](https://state-space-atlas.hintwise.org/) ([code](./state-space-atlas)) | Every reachable state of Hanoi, sliding tiles, Klotski and Rush Hour, drawn as one graph. |
| [Elevator Algorithm Lab](https://elevator-algorithm-lab.hintwise.org/) ([code](./elevator-algorithm-lab)) | Write an elevator dispatch policy in JavaScript and run it against seeded traffic. |
| [Lockstep Lab](https://lockstep-lab.hintwise.org/) ([code](./lockstep-lab)) | Watch deterministic lockstep and rollback netcode work, and fail. |
| [Pull the Pin](https://pull-the-pin.hintwise.org/) ([code](./pull-the-pin)) | An 8-bit SAP-1 computer where the instructor breaks a chip and students find the fault. |
| [Program Alarm 1202](https://program-alarm-1202.hintwise.org/) ([code](./program-alarm-1202)) | A playable model of the Apollo Guidance Computer's executive during the lunar descent. |
| [Leap Second Lab](https://leap-second-lab.hintwise.org/) ([code](./leap-second-lab)) | TAI, UTC, GPS, Unix and UT1 on one timeline, and what 23:59:60 does to your code. |
| [Cipher Ladder](https://cipher-ladder.hintwise.org/) ([code](./cipher-ladder)) | Climb from Caesar to Vigenère to homophonic ciphers with live cryptanalysis tools. |
| [Code Review Gauntlet](https://code-review-gauntlet.hintwise.org/) ([code](./code-review-gauntlet)) | Race the clock to spot planted bugs and security holes. |
| [Pluck Lab](https://pluck-lab.hintwise.org/) ([code](./pluck-lab)) | A keyboard guitar synthesized live by Karplus-Strong, with the filter on screen. |
| [Tiny Brains League](https://tiny-brains-league.hintwise.org/) ([code](./tiny-brains-league)) | Train the smallest Connect Four network you can and climb a ladder. |
| [Brocot Gear Finder](https://brocot-gear-finder.hintwise.org/) ([code](./brocot-gear-finder)) | Gear trains for any ratio with continued fractions and the Stern-Brocot tree. |

### Games and toys

| App | What it does |
|---|---|
| [Poincaré Paint](https://poincare-paint.hintwise.org/) ([code](./poincare-paint)) | Draw in the hyperbolic disk and watch every stroke tile to infinity. |
| [Tamerlane Board](https://tamerlane-board.hintwise.org/) ([code](./tamerlane-board)) | Timur's 14th-century chess with giraffes, war engines and citadels. |
| [Reverse Minesweeper Studio](https://reverse-minesweeper-studio.hintwise.org/) ([code](./reverse-minesweeper-studio)) | Paint a picture with mines and find out if it can be solved without guessing. |
| [Outguess Me](https://outguess-me.hintwise.org/) ([code](./outguess-me)) | Press F or J as randomly as you can while an oracle predicts you. You are less random than you think. |
| [Sound Sketchpad](https://sound-sketchpad.hintwise.org/) ([code](./sound-sketchpad)) | Describe a sound effect in words and get playable audio with WAV export. |
| [Emoji Lingua](https://emoji-lingua.hintwise.org/) ([code](./emoji-lingua)) | English to emoji and back. |
| [Mult Streak](https://mult-streak.hintwise.org/) ([code](./mult-streak)) | Ten multiplications in a row wins a 24-hour crown. |

For the technical side of each app (how it works, design decisions and what
it deliberately leaves out), see [PROJECTS.md](./PROJECTS.md). Each app also has its own
repository in [pisan-labs](https://github.com/pisan-labs), if you want to star,
fork or reuse just one.

## Working with me

Tell me the problem, not the solution: who is stuck, what they do today and
what it costs them. I'll say whether software is the right answer, and if it
is, what a first version would do and what it would leave out. Every app
here was built the same way: a small, working first version that real people
can try, then improvements from what they say.

## Free to use and reuse

Every app is free to use, and the code is [MIT licensed](./LICENSE), so you
can copy it, change it and use it in your own work. Developers: how the
repository is organized, tested and deployed is in
[DEVELOPING.md](./DEVELOPING.md).
