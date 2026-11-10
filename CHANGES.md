# Changes

Format: `YYYY-MM-DD [type] description` (max 200 chars). Types: decision, plan, doc, scope, code, note.

2026-06-10 [note] Initialized. Two projects shipped: accessibility-lens (WCAG analyzer) and mult-streak/mult-streak-edge (multiplication game on Render + Netlify).
2026-06-10 [code] security(F1): mult-streak + mult-streak-edge config.ts now throws at boot when COOKIE_SECRET missing in production; insecure fallback restricted to non-production only.
2026-06-10 [code] security(F3): accessibility-lens fetchPage.ts: replace redirect:follow with manual hop-by-hop redirect following; each Location URL re-validated by assertSafeUrl; added 100.64.0.0/10 block.
2026-06-10 [code] test: added config.test.ts for mult-streak + mult-streak-edge; 6 redirect/CGN-range tests added to accessibility-lens fetchPage.test.ts; all test suites green.
2026-06-10 [code] ci: rewrote ci.yml - removed stale "move this file" comment, added jobs for mult-streak and mult-streak-edge (were uncovered), no path filters.
2026-06-10 [code] ci: added eslint + typescript-eslint + globals to mult-streak and mult-streak-edge devDeps; created eslint.config.js for each; removed stale eslint-disable in store.ts.
2026-06-10 [doc] ci: added CI badge to README.md.
2026-06-10 [decision] history: adopt Conventional Commits going forward; commit-msg hook added in .git-hooks/commit-msg; git core.hooksPath set.
2026-06-10 [doc] readme: fixed test counts (102→107 accessibility-lens, 34→42 mult-streak/edge); removed stale "activate CI" note; added live URL for accessibility-lens.
2026-06-10 [doc] metadata: added root LICENSE (MIT); set GitHub repo description and 8 topics; created CLAUDE.md with commit convention and project overview.

2026-06-10 [code] security: hardened assertSafeUrl to block IPv6 ULA/link-local (fc00::/7, fe80::/10), IPv4-mapped IPv6 (::ffff:*), and decimal IPv4 encodings; fixed pre-existing [::1] bypass (Node.js URL parser keeps brackets); added 5 new tests.
2026-06-10 [code] security: added schema version field (v:1) to GameState in mult-streak and mult-streak-edge; decodeState rejects cookies where v !== 1, degrading old cookies gracefully; added 3 version tests per package.

2026-06-12 [feat] mult-streak + mult-streak-edge: added factoring mode (factor composites 1000-1000000 into prime factorization). Mode selector shown at streak=0; cookie schema bumped to v:2. 77 tests each, 97.87% coverage.

2026-08-20 [code] schema-storyteller: pinned netlify siteId + accountSlug in deploy/target.yml so deploy skips the create-site fallback once NETLIFY_AUTH_TOKEN is rotated.

2026-08-20 [code] migration-diff-narrator: new package (idea 2026-08-17 n1). Rule-based schema diff for SQL DDL + TS interfaces, 74 vitest tests, 97% stmt coverage; deterministic severity rules replace the suggested Claude API calls.

2026-08-20 [code] shortcut-sprint: new package (idea 2026-08-13 n1). SM-2 shortcut trainer for VS Code/DevTools/Figma/Vim + custom JSON sets, 78 vitest tests, 98.6% stmt coverage; localStorage replaces the suggested Supabase backend.

2026-08-20 [code] ci: deploy workflow now deploys only the target.ymls changed in the push; full redeploy on manual dispatch, runner/workflow changes, or uncomputable diffs.
2026-08-20 [code] ci: shortcut-sprint source changes now select its deployment target so bundled shortcut updates reach Netlify.

2026-08-21 [code] ui-diff-lens: new package (idea 2026-08-16 n1). Classified screenshot diff: YIQ pixel diff + AA detection, clustering, 7-type heuristic classifier; 56 vitest tests, 96.4% stmt coverage.
2026-08-21 [decision] ui-diff-lens: replaced the idea's Claude Vision classification with deterministic heuristics (displacement search, opacity fit, edge correlation); free, offline, private.

2026-08-21 [code] code-review-gauntlet: new package (idea 2026-08-11 n1). Timed bug-spotting game: seeded mutation engine, 11 templates/51 defects, daily challenge, skill radar; 46 vitest tests, 99.8% stmt coverage.
2026-08-21 [decision] code-review-gauntlet: replaced the idea's Claude puzzle generation with a seeded single-line mutation engine and the Supabase leaderboard with a date-seeded daily + localStorage profile.

2026-08-21 [code] sound-sketchpad: new package (idea 2026-08-09 n1). Text-to-sound-effect synthesizer: word-to-DSP lexicon (20 bases, 18 modifiers), pure sample renderer, WAV export; 59 vitest tests, 100% stmt coverage.
2026-08-21 [decision] sound-sketchpad: replaced the idea's Claude API code generation with a deterministic keyword lexicon + seeded DSP engine; same words always yield the same sound, free and offline.

2026-08-21 [code] sql-replay: new package (idea 2026-07-30 n1). Step-by-step SQL SELECT replay: tokenizer/parser/3VL evaluator/staged executor emitting a narrated Step trace; 86 vitest tests, 99.7% stmt coverage.
2026-08-21 [decision] sql-replay: replaced the idea's optional Claude narrator with deterministic per-stage narration generated from execution stats, and Framer Motion with CSS animations; zero runtime deps.

2026-08-23 [code] har-detective: new package (idea 2026-08-21 n1). Client-side HAR analyzer: forgiving parser, 10 deterministic detectors, SVG waterfall, Markdown report; 56 vitest tests, 100% stmt coverage.
2026-08-23 [decision] har-detective: replaced the idea's Claude API analysis with hand-written rule detectors (N+1, caching, compression, redirects, serialized calls, duplicates, errors, TTFB, payload size, HTTP/1.x churn); the HAR never leaves the browser.

2026-08-25 [code] code-analogy-forge: new package (idea 2026-08-25 n1). Audience-calibrated CS analogies: 14 concepts x 3 domains x 4 audiences (168 hand-written texts), keyword + code-shape detector with body-scoped self-call analysis, localStorage library, serverless share links, Markdown export; 61 vitest tests, 99.8% stmt coverage.
2026-08-25 [decision] code-analogy-forge: replaced the idea's Claude API generation with a curated deterministic corpus and Supabase with localStorage + hash-encoded read-only share links; free, offline, reproducible, honest "not detected" outside its 14 concepts.
2026-08-25 [code] code-analogy-forge: fixed audience toggle highlight not moving on click (aria-pressed was set only at creation); verified in headless Chromium, redeployed.
2026-08-25 [code] code-analogy-forge: example button replaced by a 10-example menu (one per concept family, test-pinned to rank its intended concept first); 'function' keyword no longer fires on JS syntax; 74 vitest tests.
2026-08-25 [code] ci: code-analogy-forge source changes now select its deployment target, same as shortcut-sprint.

2026-08-25 [code] code-analogy-forge: corpus grown 14 -> 25 concepts (closures, pointers/references, exceptions, caching, threads/parallelism, Big-O, git, APIs, encryption, binary numbers, graphs): 132 new analogy texts, detector rules for each, examples menu now one per concept (25); 97 vitest tests, 99.9% stmt coverage.

2026-08-26 [code] code-analogy-forge: corpus grown 25 -> 47 concepts (linked lists, sets, heaps, hashing, state machines, boolean logic, scope, abstraction, regex, floating point, compilers, databases, HTTP, DNS, packets, events, debugging, testing, refactoring, GC, randomness, operating systems): 264 new texts, detector rules and a pinned example per concept, menus grouped into ten optgroups; 125 vitest tests, 99.9% stmt coverage.

2026-08-27 [scope] game-palette-inspector: moved in from standalone pisanuw/c1 via git subtree (history preserved). Netlify siteId pinned to the existing site, so the public URL is unchanged.
2026-08-27 [code] ci: added game-palette-inspector job (install/test/build only; app is plain JS with node --test, so no lint/typecheck/coverage scripts exist).
2026-08-27 [scope] pathfinding-playground: moved in from standalone pisanuw/pathfinding-playground via git subtree (history preserved). Netlify siteId pinned to the existing site, so the public URL is unchanged.
2026-08-27 [code] ci: added pathfinding-playground job (install/test/build only; plain JS with vitest, no lint/typecheck/coverage scripts).

2026-08-28 [code] type-witness: new package (idea 2026-08-02 n1). In-browser TypeScript inference visualizer: real compiler (pinned 5.6.3) in a Web Worker over an in-memory FS with the 57-file ES2022 lib closure bundled raw; post-order AST walk emits narrated steps (literals, widening, generic bindings via guarded internal signature.target/mapper, contextual params, narrowing, return inference) with diagnostics threaded in after the offending step; hover-type witness view, autoplay, major-step filter, URL-hash share links. 62 vitest tests, 97.6% stmt coverage.
2026-08-28 [decision] type-witness: the idea had no LLM to replace; kept it fully client-side by bundling the compiler + libs (~1 MB gzipped worker chunk, the one real cost) instead of any server. React swapped for the monorepo's vanilla TS + Vite house pattern.

2026-09-02 [code] cron-cartographer: new package (idea 2026-09-02 n1). Cron/RRULE/GitHub-Actions/plain-English schedule visualizer: calendar heatmap of every firing over 30/90/365 days, dual time-zone pickers backed by exact Intl offset-transition tables (DST gaps reported as skipped, fall-back ambiguity fires once at the earlier instant), plain-English descriptions, next-25 table, query-param share links. 74 vitest tests, 92% stmt coverage.
2026-09-02 [decision] cron-cartographer: replaced the idea's Claude API NL-to-cron with a deterministic rule set that annotates every assumption and returns null honestly, and replaced cronstrue/cron-parser with a hand-written engine; zero runtime dependencies.

2026-09-03 [code] summit-navigator: new package (idea 2026-09-03 n1). Mobile-first conference schedule browser for the ACM AI Leadership Summit: sticky day tabs, track chips, full-text search, localStorage starred agenda, timezone-aware now/next banner, single validated schedule.json. 42 vitest tests, >=85% thresholds.
2026-09-03 [code] ci: added emoji-lingua job (typecheck/coverage/build; package has no lint script).
2026-09-03 [doc] CLAUDE.md: added summit-navigator to the commit scope list.
2026-09-03 [scope] Removed DoProject.md (auto-pick-an-idea prompt); superseded by the weekly build routine, which receives the idea from Yusuf and records it in daily-project-ideas.

2026-09-23 [code] prompt-shrink-ray: new package (idea 2026-09-15 n1). Client-side LLM-prompt compressor: label/heuristic section decomposition, three-level rewrite pipeline (whitespace/filler, verbose-phrase simplification + cross-section duplicate-sentence removal, hedge removal + few-shot trimming), token/cost estimate, word-level LCS diff, and a keyword-retention check (numbers, quotes, inline/fenced code, proper nouns) that names anything dropped. 76 vitest tests, 100% stmt coverage.
2026-09-23 [decision] prompt-shrink-ray: replaced the idea's suggested Claude Haiku compression call and Claude Sonnet equivalence check with a deterministic rule set and a term-retention heuristic; fenced code is hidden behind a placeholder before any rule runs so it is never rewritten.
2026-09-23 [doc] CLAUDE.md: added prompt-shrink-ray to the commit scope list.

2026-09-25 [code] agent-blast-radius: new package (idea 2026-09-23 n1). Client-side scanner for MCP configs (Claude Desktop/Cursor/VS Code/Claude Code), Claude Code permission settings, and browser/VS Code extension manifests; scores filesystem/shell/network/credentials/browser reach with evidence, flags plaintext secrets and risky config. 95 vitest tests, >99% stmt coverage.
2026-09-25 [decision] agent-blast-radius: shipped as a static drop-in-files web app instead of the idea's local CLI, so it deploys to Netlify with zero install; unrecognized local MCP servers are scored as full-privilege code rather than as safe.
2026-09-25 [doc] CLAUDE.md: added agent-blast-radius to the commit scope list; ci: added agent-blast-radius job.

2026-09-28 [code] repo-weight-map: new package (idea 2026-09-28 n1). Browser-only folder walker (File System Access API, webkitdirectory, drag-and-drop), hand-written squarified treemap with zoom, 19 ecosystem-aware junk rules, .gitignore diff, HTML report. 40 vitest tests, 100% stmt coverage on core.
2026-09-28 [decision] repo-weight-map: git history mode (large blobs only in history, filter-repo command) left out; needs a packfile/delta reader and did not fit Weekend size. .git is counted in the treemap but never opened.
2026-09-28 [doc] CLAUDE.md: added repo-weight-map to the commit scope list; ci: added repo-weight-map job.

2026-09-28 [code] cipher-ladder: new package (idea 2026-09-25 n2). Six-rung classical cryptanalysis ladder with frequency/IC/Kasiski workbench, hint budgets, ladder builder encoded in the URL, localStorage progress with JSON export and an instructor dashboard. 65 vitest tests, 100% stmt coverage on core.
2026-09-28 [decision] cipher-ladder: the idea's LLM debrief is a deterministic solver per cipher (chi-squared, IC/Kasiski, permutation search, trigram hill-climb, annealing) with a written step log; Supabase auth/rosters replaced by localStorage plus exported JSON.
2026-09-28 [doc] CLAUDE.md: added cipher-ladder to the commit scope list; ci: added cipher-ladder job.

2026-09-30 [code] where-does-it-say: new package (idea 2026-09-30 n1). Quote-or-refuse course Q&A: verified verbatim spans highlighted in a side-by-side viewer, quote checker with word diff, gap log/report. 91 vitest tests, 99.7% stmt coverage.
2026-09-30 [decision] where-does-it-say: the idea's Claude Haiku proposer is a deterministic BM25 sentence retriever (no API key or server); packs travel deflated in the URL fragment; logs are exported JSON, not a backend.
2026-09-30 [doc] CLAUDE.md: added where-does-it-say to the commit scope list; ci: added where-does-it-say job (Node 22, pdfjs-dist 6 needs it).

2026-10-01 [code] elevator-algorithm-lab: new package (idea 2026-09-29 n2). Student dispatch policies in a Web Worker, seeded scenarios, animated building, side-by-side compare, disk view. 53 vitest tests, 100% stmt coverage.
2026-10-01 [decision] elevator-algorithm-lab: cars stop only where the policy sends them (matches disk scheduling exactly); leaderboard is localStorage + CSV/JSON export, not Supabase; hidden scenarios travel in the share link.
2026-10-01 [doc] CLAUDE.md: added elevator-algorithm-lab to the commit scope list; ci: added elevator-algorithm-lab job.

2026-10-02 [code] reverse-minesweeper-studio: new package (idea 2026-09-29 n1). Mine painter, four-tier no-guess solver, amber stuck/sealed regions, A/B ambiguity layouts, single-edit fix search in a Web Worker, solver replay, URL-fragment play links. 40 vitest tests, 99.9% stmt coverage.
2026-10-02 [decision] reverse-minesweeper-studio: vanilla TS + canvas instead of React/Tailwind; "solved" means every safe cell opened (untouched interior mines need not be identified); frontier search capped at 250k nodes per pass.
2026-10-02 [doc] CLAUDE.md: added reverse-minesweeper-studio to the commit scope list; ci: added reverse-minesweeper-studio job.

2026-10-02 [code] state-space-atlas: new package (idea 2026-10-01 n2). Exhaustive state graphs (Hanoi, tiles, Klotski, Rush Hour) in a Web Worker, layered/radial canvas atlas, steppable BFS/DFS/IDDFS/greedy/A*, heuristic admissibility and consistency checker, challenge links. 65 vitest tests, 99.6% stmt coverage.
2026-10-02 [decision] state-space-atlas: canvas 2D instead of Sigma.js/regl; same-size block pieces and mirror images share one node; IDDFS is the graph variant (skip states reached at the same or smaller depth); all searches test the goal at expansion; state cap 400k.
2026-10-02 [doc] CLAUDE.md: added state-space-atlas to the commit scope list; ci: added state-space-atlas job.

2026-10-03 [code] bombe-bench: new package (idea 2026-10-03 n2). Enigma I with signal-path SVG, crib sliding, menu graph with cycle basis, Bombe search with loop prefilter and diagonal board in a Web Worker, checking machine, hypothesis tracer, challenge links. 55 vitest tests, 98.8% stmt coverage.
2026-10-03 [decision] bombe-bench: vanilla TS + SVG instead of React/Tailwind; loops through the test letter are checked as a fixed-point test before propagation (1M positions in about 1 s); stops report core positions at ring A; single-survivor menu components merge their plugs into the stop.
2026-10-03 [doc] CLAUDE.md: added bombe-bench to the commit scope list; ci: added bombe-bench job.

2026-10-06 [code] heap-arena-replay: new package (idea 2026-10-06 n2). Word-accurate CS:APP-style heap with implicit/explicit/segregated lists, first/next/best/worst fit, immediate/deferred/no coalescing, realloc, mid-replay policy switch, compare tab, simulator-verified quiz with QTI export, student trace diff, share links. 57 vitest tests, 99.1% stmt coverage.
2026-10-06 [decision] heap-arena-replay: vanilla TS + SVG instead of React/Tailwind/Recharts; fixed arena with no sbrk so a failed malloc returns NULL; next-fit only on the implicit list; free lists rebuilt in address order after a policy switch; QTI zip written by a dependency-free stored-zip writer.
2026-10-06 [doc] CLAUDE.md: added heap-arena-replay to the commit scope list; ci: added heap-arena-replay job.

2026-10-17 [code] shortcut-sprint: bundled Excel, Visio, Word, and Acrobat Reader sets (86 shortcuts, Mac bindings from Microsoft/Adobe docs); custom sets reusing a bundled id are hidden. 85 tests.
2026-10-17 [code] accessibility-lens, emoji-lingua: retired claude-sonnet-4-20250514 replaced by claude-sonnet-5-5 (low effort, max_tokens 1024); refusals fall back to the non-AI output.

2026-10-21 [code] code-viva: new package (idea 2026-10-21 n1). Zip/Classroom import, questions from student code and commits, timed link session, scored evidence, flag queue. 79 tests, 99.6% stmt.
2026-10-21 [decision] code-viva: templates and a keyword rubric replace Claude API; no Supabase/Flask (vivas in URL fragment, answers as response codes); mostly pasted replies earn no credit.
2026-10-21 [doc] CLAUDE.md: added code-viva to the commit scope list; ci: added code-viva job.

2026-10-21 [decision] deploy: only main deploys; a missing base diffs the tip commit, not deploy-all; editing deploy.yml alone deploys nothing. New daily workflow deletes merged claude/* branches.

2026-10-21 [code] code-viva: 10 more demo courses (C, C++, C#, Java, Python, JS, TS) in a picker at the top; How it works tab and per-step help; late/single-commit checks from 20 lines; siteId pinned.

2026-10-22 [code] diagram-layout-engine: new package (idea 2026-10-18 n3). Mermaid-subset parser, Sugiyama pipeline, routing, subgraphs, themes, diff, inspector, benchmark. 88 tests, 98.9% stmt.
2026-10-22 [decision] diagram-layout-engine: subgraphs laid out bottom-up as fixed boxes with obstacle-aware legs; barycenter default after the 50-graph benchmark; no dagre/ELK comparison.
2026-10-22 [doc] CLAUDE.md: added diagram-layout-engine to the commit scope list; ci: added diagram-layout-engine job.
2026-10-22 [code] diagram-layout-engine: deployed to diagram-layout-engine.netlify.app; siteId pinned.

2026-10-22 [code] letter-ledger: new package (idea 2026-10-22 n3). Request link with policy, sealed .ledger packets, FERPA release check, deadline dashboard, .ics, status emails, notes, fact outline. 58 tests.
2026-10-22 [decision] letter-ledger: no Supabase/Resend/Stripe/Claude API; packets emailed as files sealed to the professor's ECDH key; reminders as .ics, status as mailto drafts; outline only, no AI drafting.
2026-10-22 [doc] CLAUDE.md: added letter-ledger to the commit scope list; ci: added letter-ledger job.
2026-10-22 [code] letter-ledger: deployed to letter-ledger.netlify.app; siteId pinned.

2026-10-23 [code] brocot-gear-finder: new package (idea 2026-10-05 n1). Product-table train search, continued fraction and Stern-Brocot panel, meshing SVG animation, drift dial, laser-cut SVG. 44 tests.
2026-10-23 [decision] brocot-gear-finder: trains come from an exhaustive smooth-product search (tree shown for teaching); max 3 stages and 200 teeth; plain TypeScript, no React/Tailwind.
2026-10-23 [doc] CLAUDE.md: added brocot-gear-finder to the commit scope list; ci: added brocot-gear-finder job.
2026-10-23 [code] brocot-gear-finder: deployed to brocot-gear-finder.netlify.app; siteId pinned.

2026-10-23 [code] fork-count: new package (idea 2026-10-09 n2). C-subset interpreter, process tree, exhaustive schedule search, possibility checker with happens-before reasons, quiz generator. 94 tests.
2026-10-23 [decision] fork-count: processes run by re-executing main() along fork decisions; canonical-state symmetry reduction plus a 50k-state budget; no D3, no LLM.
2026-10-23 [doc] CLAUDE.md: added fork-count to the commit scope list; ci: added fork-count job.
2026-10-23 [code] fork-count: deployed to fork-count.netlify.app; siteId pinned.

2026-10-23 [code] assignment-stress-test: new package (idea 2026-10-23 n1). Rubric parser, 3 student-style prompts, judge + pytest in Pyodide, report, diff, term history, paste mode. 53 tests.
2026-10-23 [decision] assignment-stress-test: no backend; BYOK Claude API from the browser, paste mode instead of a Gemini client, Pyodide worker as sandbox; refusals score zero, no fallback model.
2026-10-23 [note] assignment-stress-test: demo recorded with the claude CLI in a whitelisted env; Sonnet 5.5 rejected effort high via the CLI, so attempts retry once at default effort.
2026-10-23 [doc] CLAUDE.md: added assignment-stress-test to the commit scope list; ci: added assignment-stress-test job (installs pytest).
2026-10-23 [code] assignment-stress-test: deployed to assignment-stress-test.netlify.app; siteId pinned.

2026-10-24 [code] cache-miss-theater: new package (idea 2026-10-10 n2). C loop-nest parser, exact address trace, set-assoc cache sim, 3C classification, theater, compare, sweep, quiz; 62 tests.

2026-10-24 [decision] cache-miss-theater: interpreter instead of affine-only analysis (supports min() bounds, branches); array contents not modelled; plain DOM + canvas, no React/D3.

2026-10-24 [doc] CLAUDE.md: added cache-miss-theater to the commit scope list; ci: added cache-miss-theater job.

2026-10-24 [code] cache-miss-theater: deployed to cache-miss-theater.netlify.app; siteId pinned.

2026-10-25 [decision] edit-graph-lab: quadratic-space forward Myers so every step and the V array can be replayed; histogram uses a simplified rarest-then-longest rule; no git indent heuristic.

2026-10-25 [doc] CLAUDE.md: added edit-graph-lab to the commit scope list; ci: added edit-graph-lab job.

2026-10-25 [code] edit-graph-lab: deployed to edit-graph-lab.netlify.app; siteId pinned.

2026-10-26 [decision] lockstep-lab: one main-thread sim in 1 ms steps (reproducible from seed) instead of a worker per client; float platforms simulated; grader in a Web Worker.

2026-10-26 [doc] CLAUDE.md: added lockstep-lab to the commit scope list; ci: added lockstep-lab job.

2026-10-26 [code] lockstep-lab: deployed to lockstep-lab.netlify.app; siteId pinned.

2026-10-27 [decision] tetromino-arcade: built on direct user request (not from the ideas list); named Tetromino Arcade to avoid using the Tetris trademark as a product name.

2026-10-27 [decision] tetromino-arcade: deterministic 60 fps core with seeded bag so replays are seed + key log; CPU uses El-Tetris weights over hard-drop placements, no LLM.

2026-10-27 [doc] CLAUDE.md: added tetromino-arcade to the commit scope list; ci: added tetromino-arcade job.

2026-10-27 [code] tetromino-arcade: deployed to tetromino-arcade.netlify.app; siteId pinned.

2026-10-27 [decision] net-units: hand-written lexer instead of tree-sitter, no backend or LLM; AI baselines are bundled hand-written examples (labelled so) or instructor uploads; tests passed entered by hand.

2026-10-27 [doc] CLAUDE.md: added net-units to the commit scope list; ci: added net-units job.

2026-10-27 [code] net-units: deployed to net-units.netlify.app; siteId pinned.

2026-10-27 [decision] study-buddy-matchmaker: deterministic mastery profiles and max-weight matching (exact DP up to 20 students) instead of Claude clustering; no backend, data stays in the browser.

2026-10-27 [doc] CLAUDE.md: added study-buddy-matchmaker to the commit scope list; ci: added study-buddy-matchmaker job.

2026-10-27 [code] study-buddy-matchmaker: deployed to study-buddy-matchmaker.netlify.app; siteId pinned.

2026-10-27 [decision] fork-count: pipes modelled with one writer and one reader per pipe and each write() delivered whole, so reads are schedule-independent; runner suspends and re-runs readers.

2026-10-27 [code] fork-count: added pipe/read/close/dup/dup2, int and char arrays, char * strings, exec filters (wc, sort, grep, tr, ...), deadlock detection, 24 pipe examples, a pipe quiz template.

2026-10-27 [fix] repo-weight-map: findings were gitignore-blind — a rule fired on disk presence, so an already-ignored node_modules/ read as "Committed node_modules" and its bytes landed in the "should not be in git" tile. Added src/core/ignore.ts, a real gitignore matcher (anchoring, **, ?, classes, ! last-match-wins, no descent into excluded dirs), cross-checked against git check-ignore on 27 paths / 17 pattern forms.
2026-10-27 [decision] repo-weight-map: findings now carry coverage none/partial/all from the root .gitignore; fully-covered ones stay visible badged "Already ignored" rather than disappearing, and the headline tile shows actionableBytes (flagged and not yet ignored) instead of all flagged bytes. Root .gitignore only: nested ignores, .git/info/exclude, global excludes and tracked-but-ignored files are out of a browser's reach and documented as such.

2026-10-28 [decision] pluck-lab: vanilla TS + AudioWorklet, one Engine class shared by worklet, ScriptProcessor fallback and tests; views run a seeded mirror of the watched string so they can slow down.

2026-10-28 [decision] pluck-lab: deterministic filter analysis (linearity, randomness, least-squares gain/phase per frequency, predicted T60) replaces the suggested Claude explanation; no backend.

2026-10-28 [doc] CLAUDE.md: added pluck-lab to the commit scope list; ci: added pluck-lab job.

2026-10-28 [code] pluck-lab: deployed to pluck-lab.netlify.app; siteId pinned.

2026-10-29 [decision] pull-the-pin: SAP-1 modules as idealized single chip packages; fault set = consistent-by-waveform-hash over a 3,810 single-fault catalog, computed in a Web Worker.

2026-10-29 [decision] pull-the-pin: deterministic best-next-probe (min expected remaining faults) replaces the suggested Claude hints; attempts kept in localStorage instead of Supabase.

2026-10-29 [doc] CLAUDE.md: added pull-the-pin to the commit scope list; ci: added pull-the-pin job.

2026-10-31 [decision] Shared "built by" footer for every deployed app, injected at deploy time from scripts/site-footer.mjs instead of copied into 45 app sources; one edit changes all sites.

2026-10-31 [code] deploy.mjs injects the footer after each Netlify build (`footer: false` opts out); mult-streak's build runs it for Render; deploy.yml redeploys every target once when it changes.

2026-10-31 [code] emoji-lingua: body flex switched from row to column so the footer sits below the app. Checked footer on all 45 apps (desktop and mobile) in Playwright.

2026-10-31 [decision] Footer wording set by the owner: "I build apps like this one..." signed "Professor Yusuf Pisan"; emitted as ASCII entities so it survives pages without a UTF-8 charset.

2026-10-31 [code] brocot-gear-finder, type-witness: fixed sideways page scroll on phones (convergents table in .table-wrap; wrapping toolbar and step controls). Checked at 320/360/390px.
2026-10-31 [decision] tiny-brains-league: static app; Flask ladder, React viewer and Supabase replaced by in-browser training/ladder (Web Worker) and localStorage; instructor runs the official ladder locally.
2026-10-31 [decision] tiny-brains-league: ratings are a Bradley-Terry fit on the Elo scale (order-independent), Random pinned at 1000; efficiency = Elo above Random per 1k params.

2026-11-01 [code] modulo-bias-microscope: new package (idea 2026-10-08 n2). Exact enumeration over a 1-16 bit source with BigInt fractions, chi-square on 32-bit xoshiro128**, 7-bug gallery, exercise links; 68 tests.
2026-11-01 [decision] modulo-bias-microscope: JavaScript only (Pyodide dropped), no LLM/backend; exercises live in URL fragments; grader is exact-first with a chi-square fallback at a stated false-fail rate.

2026-11-02 [decision] Repo refocused on getting users and custom-build clients: "built by Claude" headline, pisan.me subdomains, pisan-labs org, flagships bombe-bench and cache-miss-theater.

2026-11-02 [doc] README rewritten as a pitch plus a catalog grouped by audience; the per-app write-ups moved unchanged to PROJECTS.md. CLAUDE.md step 3 updated to match.

2026-11-02 [code] Footer text set to the owner-approved wording ("Built by Claude, guided by me..."), signed Yusuf Pisan; still links aiprojects.html.

2026-11-02 [code] Added mirror.yml: subtree-splits bombe-bench and cache-miss-theater to pisan-labs/<app> on push to main; skips until MIRROR_TOKEN exists. Each app carries its own CI for the mirror.

2026-11-02 [code] mirror.yml: checkout with persist-credentials false; the first run pushed as github-actions[bot] and pisan-labs refused it.

2026-11-02 [note] Mirrors live: pisan-labs/bombe-bench and pisan-labs/cache-miss-theater pushed by mirror.yml after MIRROR_TOKEN was scoped to the org.

2026-11-02 [decision] pisan.me DNS moves to Cloudflare, all records DNS-only. App subdomains are named after the package folder (pull-the-pin.pisan.me, mult-streak.pisan.me); cPanel extras and three typo CNAMEs dropped.

2026-11-02 [code] deploy.mjs: netlify.customDomain in target.yml sets the Netlify primary domain and requests its certificate; bombe-bench and cache-miss-theater move to <app>.pisan.me.

2026-11-02 [code] deploy.mjs: with customDomain set, a first _redirects rule 301s <siteName>.netlify.app to the pisan.me domain; Netlify served both. bombe-bench and cache-miss-theater live at <app>.pisan.me.

2026-11-02 [code] deploy.mjs: the netlify.app redirect rule is now written after the SPA fallback, which had been replacing _redirects and erasing it.

2026-11-02 [note] Deploy run 41391791124 failed on 51 Netlify targets with "JSONHTTPError: Forbidden" at netlify deploy; env:set still worked. Four full redeploys today (~200 deploys) likely hit a Netlify account limit. Sites stayed up.

2026-11-02 [decision] Deploys cost Netlify credits: a push now deploys only targets whose target.yml changed. Runner or footer changes need a manual Deploy run naming apps or `all`.

2026-11-02 [code] bombe-bench and cache-miss-theater live at <app>.pisan.me; their .netlify.app addresses 301 there (path and query kept). README links updated.

2026-11-02 [code] All 51 Netlify apps get netlify.customDomain <folder>.pisan.me (mult-streak-edge -> mult-streak.pisan.me); every README link moves to pisan.me. One deploy per app.

2026-11-02 [doc] Demo GIFs (about 15 s, 2.1 MB each) for bombe-bench and cache-miss-theater, in their READMEs and the root "Start here".

2026-11-02 [code] bombe-bench and cache-miss-theater carry their own copy of the MIT LICENSE, so the pisan-labs mirrors are licensed; mirror.yml notes the step.

2026-11-02 [code] Mirroring extended to 50 apps via .github/mirrors.txt (changed apps only per push); each app has LICENSE and its own CI; docs-only app changes no longer deploy. tetromino-arcade left out (trademark).

2026-11-02 [doc] Demo GIFs for 46 of 48 mirrored apps (37 MB total, each under 1.5 MB); none for emoji-lingua (live site always calls Claude) or mult-streak (page load runs the email sweep).

2026-11-02 [doc] scripts/pisan-labs-repos.csv: description, website and topics for all 50 pisan-labs repos; scripts/pisan_labs_setup.py applies it with gh.

2026-11-02 [decision] accessibility-lens: ANTHROPIC_API_KEY removed from the live site (envRemove in target.yml); every scan was sending issues to Claude on the owner key. Rule-based fixes only.

2026-11-02 [doc] Footer wording revised by the owner: "I create tools like this ... Want something like this for your own work?". All sites redeployed once to carry it.

2026-11-02 [doc] HANDOFF.md for the next session; launch drafts saved to docs/launch-drafts.md.

2026-11-02 [decision] emoji-lingua: ANTHROPIC_API_KEY removed from the live site (envRemove); translations use the dictionary engine only.

2026-11-02 [decision] Build routine moved to BUILD_ROUTINE.md: small-business ideas picked first, pisan-labs mirror files per app, first deploy on netlify.app until the owner adds the CNAME.

2026-11-02 [code] mirror.yml skips an app whose pisan-labs repo does not exist yet instead of failing the run.

2026-11-02 [code] Added consent-leak-watch (ideas 2026-11-02 n1): client-side HAR audit of cookie-banner leaks with plugin attribution and saved-check diff. First app in the "Tools for small businesses" table.

2026-11-02 [note] 30-day analytics (owner export): Code Viva 751 visitors, 452 from LinkedIn; most apps 100-180, largely bots; 24 sites have analytics off. Recommended next: Code Viva, Accessibility Lens, Fork Count.

2026-11-02 [decision] Promote next: Code Viva, Accessibility Lens, Fork Count, MyChessMaster (owner). README Start here shows six apps; launch drafts 3-6 added.

2026-11-02 [note] Netlify Analytics off on: accessibility-lens-pisanuw, mult-streak-edge-pisan, data-structure-city, gpu-parallel-puzzler, modulo-bias-microscope, poincare-paint, tamerlane-board, tiny-brains-league, consent-leak-watch.

2026-11-02 [code] Deploy runner checks a custom domain's DNS first: creates the CNAME with CLOUDFLARE_API_TOKEN (DNS only, never edits an existing record), else stays on netlify.app with a warning.

2026-11-02 [doc] Cloudflare token: My Profile > API Tokens > Create Token > "Edit zone DNS" template, zone pisan.me; repo secrets CLOUDFLARE_API_TOKEN and CLOUDFLARE_ZONE_ID (zone Overview page).

2026-11-02 [note] Cloudflare secrets verified read-only (Check Cloudflare token run 41450700693); record creation untested until the next new app deploys.

2026-11-02 [decision] Every site's primary address is <app>.pisan.me (owner); BUILD_ROUTINE.md and CLAUDE.md require customDomain from the first deploy.

2026-11-02 [code] Consent Leak Watch moved to consent-leak-watch.pisan.me; first CNAME created by the deploy runner (run 41452636626).

2026-11-02 [note] Owner turned on Netlify Analytics for the sites that lacked it; the build routine now asks for it on each new site.

2026-11-02 [decision] Build routine writes publicNotes for visitors (what it does, who for, one limitation; no build time, stack or test counts); notes stays technical for the owner.

2026-11-02 [doc] Ideas site now customer-facing (daily-project-ideas 9f5bb63); built apps carry publicNotes; owner notes at daily-project-ideas.pisan.me/notes/ behind a password.

2026-11-02 [doc] README rewritten for visitors (what the apps are, try them, want one built, working with me); build, CI and local-run details moved to DEVELOPING.md.

2026-11-02 [code] ACR Draft (acr-draft/) live at https://acr-draft.pisan.me: axe-core scans plus guided WCAG 2.1 AA review, rule-based VPAT 2.5 WCAG edition export to Word/HTML. 48 tests.

2026-11-02 [decision] BUILD_ROUTINE.md: delete only the run's own claude/* branches (the first run tried to delete other sessions' branches); never invent first-person facts in aiprojects entries.

2026-11-03 [code] scripts/halflife/: daily launchd job for the owner's Mac that runs pisan_labs_setup.py in its own clone and starts Mirror apps (gh workflow run); install.sh installs or removes it.

2026-11-03 [doc] BUILD_ROUTINE.md: owner actions give the direct Netlify analytics link for the new site, and point at the halflife job for the pisan-labs repo.

2026-11-03 [note] halflife pisan-labs sync installed; first run created and mirrored pisan-labs/acr-draft and consent-leak-watch. ACR Draft analytics on.

2026-11-03 [code] pisan_labs_setup.py reports what it did per repo (created, updated, topics) and a summary line; it was silent on changes, so the 2026-11-03 run looked like it skipped the two repos it created.

2026-11-03 [doc] README: "My biggest project" section for Digital Student Assistant (digital-student-assistant.com), above Start here.

2026-11-03 [code] .claude/cloud-setup.sh: warms the npm cache from the newest app's package.json for the shared EnvFull cloud environment; the build routine's install drops from ~21 s to ~10 s.

2026-11-03 [code] Student Journey Check (ideas 2026-11-03 #1, tier a: the only un-built small-business idea) live at https://student-journey-check.pisan.me; static page plus a stateless /api/step function.

2026-11-03 [fix] student-journey-check: removed the esbuild import.meta banner that crashed the function under Netlify's CommonJS re-bundle (first deploy /api/health 502); redeployed, health OK.

2026-11-03 [doc] docs/envfull-setup.sh: the git copy of the setup script of EnvFull, the cloud environment the routines share; it runs each attached repo's .claude/cloud-setup.sh. Caches are kept per repo.

2026-11-03 [code] dossier-comment-reflector: new app (ideas 2026-10-25 #3, tier b: no small-business idea left, Micro-SaaS is the only tier-b category with ideas). Course-evaluation comments to themes, before/after evidence for recorded course changes, balanced redacted quotes and a page-limited reflection draft for Word; browser-only, no AI. Live at https://dossier-comment-reflector.pisan.me (Deploy run 41640581885 created the CNAME and certificate; netlify.app 301s there). Mirror files, CI job, catalog row and PROJECTS.md entry added.

2026-11-03 [doc] README headline count 51 -> 53 apps, matching the catalog (ACR Draft and Student Journey Check had not bumped it).

2026-11-03 [note] Measured in EnvFull: setup 27 s for this repo; a new app's npm install 13.5 s (21 s without the cache on 2026-11-02), not the ~10 s estimated; an existing app's npm ci 4.6 s.

2026-11-04 [note] Routine runs keep their own cache per environment, seeded by their first run after the setup script; the build routine's first EnvFull run installed a new app in 4 s (21 s before).

2026-11-04 [note] Accessibility Fleet Log (ideas 2026-11-04 #2, tier a) built: browser-only fleet dashboard, dated issue log, statements and monthly client reports; 72 tests, 99% coverage.

2026-11-04 [code] Poincaré Paint: brush colour now picked from an HSV colour wheel (hue/saturation disc, brightness slider, hex box); 61 tests.

2026-11-04 [note] Misrepresentation Preflight (ideas 2026-11-03 #2, tier a) built: cross-page consistency check for stores suspended by Merchant Center (contact details, shipping and return windows, prices, stock, product data, feed) with a Netlify function reading one page per call, a sample shop and a dated re-check log; 99 tests, 99% coverage.

2026-11-04 [deploy] Misrepresentation Preflight live on https://misrepresentation-preflight.pisan.me (Deploy run 41894506042); links in README, PROJECTS.md, implemented.json and aiprojects.md.

2026-11-04 [deploy] Accessibility Fleet Log live on https://accessibility-fleet-log.pisan.me (Deploy run 41861381957); links in README, PROJECTS.md, implemented.json and aiprojects.md.

2026-11-05 [code] Attach custom domain workflow (attach-domain.mjs): CNAME, Netlify primary domain and certificate for an existing site, no deploy; first used for chess-tournament-director.pisan.me.

2026-11-05 [code] Popup Check (ideas 2026-11-03 #3, tier a) built in popup-check/: bookmark that checks open popups, age gates, cookie banners and chat buttons with simulated and guided keyboard tests, dated reports in the browser, practice shop; CI job and pisan-labs mirror files added.

2026-11-05 [deploy] Popup Check live on https://popup-check.pisan.me (Deploy run 42017674116: site, CNAME and certificate created); links in README, PROJECTS.md, implemented.json and aiprojects.md. popup-check.netlify.app answered Netlify's 'Page not found' instead of the usual 301 at verification.

2026-11-05 [doc] README: StepWise (stepwise.pisan.me, pisan-labs/visualizing-data-structures) added to Start here with a recorded AVL-insert GIF, and to Interactive CS lessons.

2026-11-06 [doc] Session relay set up (hourly report, 13:56 handover check, 14:52 session start, Europe/Berlin); HANDOFF.md rewritten as the rolling handoff and handed over at 74% context.

2026-11-06 [code] Poincaré Paint: Save PNG and Save JPG (2400 px, page background, same scene code as the canvas); owner-approved deploy. Mirror check: nothing to port.

2026-11-06 [doc] docs/launch-drafts.md: draft 7, Digital Student Assistant (SIGCSE list and LinkedIn), from README and arXiv abstract facts only.

2026-11-06 [code] attach-domain.mjs keeps the old primary domain as a Netlify alias when it sets a new one (chess TD rename to chesstd.pisan.me).

2026-11-06 [code] Health Page Tracker Watch (ideas 2026-11-04 #3, tier a: Small Business Ops) built in health-page-tracker-watch/: HAR or page-source check of a practice site's outside tools against an 82-tool BAA vendor table, health-page levels, monthly diff, .ics reminder. Browser-only.

2026-11-06 [deploy] Health Page Tracker Watch live on https://health-page-tracker-watch.pisan.me (Deploy run 42207616171: site, CNAME and certificate created, netlify.app 301s to it); ideas entry marked implemented, aiprojects section added.

2026-11-06 [note] Ideas routine replaced by an agent-created copy, trig_01K986yzFbf3noGkLA6RgZkn (owner deleted the old trig_01SRpCBczLpJRc3VDeTtyBWG), so a failed run can be re-fired from a session.

2026-11-07 [doc] PROJECTS.md Poincaré Paint entry: add the colour wheel, test count 58 -> 65. Monorepo and pisan-labs/poincare-paint trees already match at 8870751.
2026-11-07 [code] Donation Receipts (ideas 2026-11-07 #1, tier a: buyer is a small organisation or its bookkeeper; no idea anywhere is validated, so picked by score 21) built in donation-receipts/: Xero Account Transactions (.xlsx/CSV) or bank CSV import, donor suggestions learned from bank text, numbered ABN/DGR receipts with void, 30 June statements, register CSV, PDFs. Browser-only; named without "Xero" in the domain.

2026-11-07 [deploy] Donation Receipts live on https://donation-receipts.pisan.me (Deploy run 42375748144: site, CNAME and certificate created, netlify.app 301s to it); ideas entry marked implemented, aiprojects section added (Student Journey Check moved out of Latest; Course & Department Tools split, new group Grades & Evaluations).

2026-11-07 [note] Owner turned on Netlify Analytics for the seven apps built since 3 Nov (through donation-receipts).

2026-11-07 [note] popup-check.pisan.me answers 200 (owner checked); popup-check.netlify.app still 404s, most likely because the Netlify site name is suffixed. Nothing links to it, so closed.

2026-11-07 [code] deploy.mjs uses the Netlify site name it actually gets (a taken name is suffixed, as popup-check-629) and finds existing sites by custom domain, so a later deploy does not create a duplicate site.

2026-11-07 [code] Site footer keeps its line breaks: four lines (<br>) and a no-break space so ":-)" never wraps alone. Not deployed; needs a manual Deploy run.
2026-11-07 [decision] Footer: "Email builder@pisan.me." stays together on phones. Owner: no footer deploy; apps pick it up on their next deploy for another reason.
2026-11-07 [code] popup-check: copy-report UI test waits for the copy instead of two fixed ticks (failed once on CI, run 42400569149).
2026-11-08 [code] Set CNAME workflow (set-cname.mjs): DNS-only CNAME to any host, deletes A/AAAA. Used for chesstd -> chess-td-web.onrender.com (owner request).
2026-11-08 [code] Remove Netlify domain workflow (remove-domain.mjs). Used to take chesstd.pisan.me off chess-tournament-director (owner request; chesstd now on Render).
2026-11-08 [note] chesstd.pisan.me is on no Netlify site: chess-tournament-director no longer exists on Netlify (404) and none of the 87 sites has the domain. chesstd -> Render now.
2026-11-08 [decision] Owner: hourly checks with nothing new produce no output at all, not even a chat line.
2026-11-08 [plan] Move all apps from pisan.me to hintwise.org: docs/hintwise-migration.md (code/docs on branches first, then DNS, then links, then pisan.me redirect rule).
2026-11-08 [decision] Showcase: daily-project-ideas site becomes the HintWise showcase at hintwise.org; ideas stay public as "Next up"; 6 featured apps chosen (docs/hintwise-migration.md).
2026-11-08 [decision] Owner: Resend sends all email from hintwise.org; Google sign-in (Chess TD) must be updated in the move. Steps in docs/hintwise-migration.md.
2026-11-08 [decision] Showcase address is studio.hintwise.org (owner correction); hintwise.org apex will 301 there.
2026-11-08 [decision] Owner answers on the hintwise move: apex->studio, meetme moves, ypdsa stays, Netlify site renamed to hintwise in Phase 2, showcase lists all apps.
2026-11-08 [doc] Docs move app and site addresses from <x>.pisan.me to <x>.hintwise.org and builder@ to hintwise.org (README, PROJECTS, app READMEs, CLAUDE.md, BUILD_ROUTINE, DEVELOPING, HANDOFF, launch drafts); target.yml keeps the pisan.me form, mapped by APP_DOMAIN. Kept: ypdsa, td, mult-streak@, personal site, history.
2026-11-08 [note] Resend: hintwise.org verified by owner; test email from builder@hintwise.org delivered (Test email workflow, Resend id 01a1ba54). Phase 1 combined on branch hintwise (9b694fd); sender target.yml change held on hintwise-apps fcb3044.
2026-11-08 [doc] docs/google-oauth.md: every app using Google sign-in, its redirect URIs / JS origins for the new HintWise Google Cloud client, and where to set the new IDs.
2026-11-08 [note] Pilot: bombe-bench.hintwise.org live (CNAME + Netlify alias; cert needed POST /ssl/renew, fixed 7f70a3a). Switch step blocked: Cloudflare token lacks the redirect-rules permission.
2026-11-08 [code] hintwise merged to main (owner: do the whole move incl. redeploying all Netlify sites). Chess TD hintwise merged; td/chesstd.hintwise.org on Render; WEB_ORIGINS both, SMTP_FROM td@hintwise.org.
2026-11-08 [note] Owner set FROM_EMAIL (daily-project-ideas digest) to an @hintwise.org sender. Hosts step re-run as 8 parallel batches (~4.5 min/app serial was too slow).
2026-11-08 [code] us-duty-price-sheet built by the build routine (ideas 2026-11-08 #1, tier a: small business): US code per product, duty with the 10% UK layer, US postage or price table, what-changed list. Live at https://us-duty-price-sheet.hintwise.org (CNAME and certificate created by the runner).
2026-11-08 [code] hintwise move done for all 64 Netlify hosts: <x>.hintwise.org live (DNS only, direct to Netlify), <x>.pisan.me proxied + one Single Redirect rule (wildcard_replace) 301s with path and query; hintwise.org apex -> studio (rule moved above two older rules); daily-project-ideas site renamed hintwise at studio.hintwise.org. Deploy all started for the new footer.
2026-11-08 [code] Deploy all succeeded (63 jobs): HintWise footer live, netlify.app -> hintwise.org. Google sign-in switched to the HintWise client on 9 hosts (Netlify builds + Render deploys); chess-td-server PUBLIC_URL=https://td.hintwise.org; chesstd.pisan.me now redirects (td.pisan.me does not).
2026-11-08 [code] Sign-in fixes after the move: meetme-2 APP_URL -> meetme.hintwise.org (Env pisan.me workflow); digitalme backend CORS allows ypai.hintwise.org (pisanuw/digitalme f93102b). Owner confirmed DSA Google sign-in works. ypai email uses reply.pisan.me (Resend inbound) - answers the open reply.pisan.me question.

2026-11-08 [code] Google switch incomplete: 6 secret Netlify vars (paste-md, upvoteme AUTH_GOOGLE_*, chatwithdigitalme VITE_GOOGLE_CLIENT_ID) kept old client; PUT asked post_processing scope, 200 no-op. Apply fixed (1e61568); re-run awaits owner yes.

2026-11-08 [note] poincare-paint mirror failure cause: mirror main (6 Nov reset) is a different split than CI's full-history split; files equal but README link. Fix = one force_app run (ecda717), awaits owner yes.

2026-11-08 [code] Owner said yes: Google client re-applied to the 6 secret vars (per deploy context; 3955226), poincare-paint mirror force-reset to fcd51f9. Owner added GOOGLE_SECRET himself. Studio restyled (daily-project-ideas 307ba51).

2026-11-09 [decision] Owner: one substantial project per week instead of one small app per day; fresh daily session resuming from <slug>/HANDOFF.md; up to 7 run-days per project (HANDOFF.md section 14).
2026-11-09 [decision] Owner: reuse and restructure Supabase project arktxlrlyceffyozdwhq (schema per app); Google sign-in + magic link via Resend; LLM bring-your-own-key plus owner key capped $2/day $10/week $20/month per app with usage reports.
2026-11-09 [note] BUILD_ROUTINE.md paused (65466f1) during the rewrite; the notice must go before the 10 Nov 11:49 CET run. Owner paused the session at 95% quota; resume 14:40 Lisbon.
2026-11-09 [note] Supabase project arktxlrlyceffyozdwhq is UpvoteMe's (us-east-1) and hosts live apps (UpvoteMe, a quiz app, chess_kv, WCV Live Together in schema wcv): the platform restructure is additive; shared tables go in schema `platform`.
2026-11-09 [note] Incident: the first Supabase inspect run printed jwt_secret in a public Actions log (6 min); logs deleted, script fixed (9f1efff). Owner asked to rotate the JWT secret and update dependent keys.
2026-11-09 [code] BUILD_ROUTINE.md rewritten for weekly builds (day state machine, pick/plan/slice, one milestone a day with review, polish, finish); pause notice removed; templates docs/templates/PROJECT_HANDOFF.md and PLAN.md; docs/platform.md.
2026-11-09 [code] Platform scaffolding merged (platform/): shared SQL, Supabase admin commands, llm-gateway edge function with tests, LLM usage email workflow, app template, Deploy migrations step for supabase: true targets.
2026-11-09 [code] apply-shared failed safely (no trigger allowed on auth.users); platform.ensure_profile(), called by apps after sign-in, replaces the trigger. Template gains ensureProfile().
2026-11-09 [code] Live Supabase changes (owner: run 1-3): schema platform applied, exposed through PostgREST; auth gains https://*.hintwise.org/** redirects, Resend SMTP from sign-in@hintwise.org, email limit 30/hour.
2026-11-09 [note] Side effect: WCV Live Together and how-of-happiness auth emails now send from HintWise <sign-in@hintwise.org> via Resend instead of Supabase's default sender.
2026-11-09 [code] research-map.hintwise.org set as the primary domain of Netlify site uw-research-maps (owner request; Set Netlify domain workflow).
2026-11-09 [decision] Default taken (owner silent 15 min): Supabase plan for research-map (schema app_research_map, pgvector in extensions, function research-map-search) sent to its session for it to carry out with the owner's yes.
2026-11-09 [doc] README lists Research Map (pisan-labs/research-map) under Tools for teachers; app count corrected to 61 (the catalog had 60 rows under a 58 heading).
2026-11-09 [decision] Owner: Google sign-in through Supabase, with Supabase's custom domain add-on (owner buys it). docs/platform.md section 2 has the order.
2026-11-09 [code] Supabase admin gains check-google (tests the sign-in request without a login) and domain-setup/domain-status/domain-activate; template asks Google for the account chooser and creates profiles after sign-in.
2026-11-09 [note] check-google baseline: the project's Google provider uses client 989071206831-; Google accepts the request. The move to the HintWise client waits for the owner's redirect URIs.
2026-11-09 [code] Supabase Google provider moved to the HintWise client (configure-auth --google, owner added the redirect URIs); check-google passed 17:35 CET.
2026-11-09 [decision] Owner: custom domain add-on delayed; JWT rotation reminder dropped (risk accepted); Anthropic monthly spend limit set.

2026-11-09 [code] LLM gateway live: ANTHROPIC_API_KEY function secret set, llm-gateway deployed, platform/supabase.json committed; smoke test 401 without a session; usage report dry run OK, no apps registered.

2026-11-09 [note] PasteMD Google sign-in fails on paste-md.hintwise.org: APP_URL sends Google back to paste-md.netlify.app, where the state cookie is missing. Hintwise callbacks for PasteMD and UpvoteMe not registered yet.
2026-11-09 [code] Netlify env workflow (netlify-env.mjs): show a site's domains and URL variables; set a plain URL variable, re-creating a secret one.

2026-11-09 [note] Owner: UpvoteMe loads and Google sign-in works; the app still sends Google the upvoteme.netlify.app callback (hintwise.org callback not registered). PasteMD on hintwise.org still fails.

2026-11-09 [code] PasteMD APP_URL and UpvoteMe NEXTAUTH_URL now plain hintwise.org addresses (owner yes); both rebuilt and send Google the hintwise callbacks, which Google accepts.
2026-11-09 [code] pisanuw/pastemd branch feat/supabase-google-signin: Google sign-in through Supabase (PKCE, users kept by email), first old app moved off its own Google client. Not merged.

2026-11-09 [decision] Owner bought the Supabase custom domain add-on: auth.hintwise.org. domain-setup created its CNAME and two TXT records in Cloudflare; verification pending.
2026-11-09 [code] PasteMD PR #2 merged (owner yes) and live: Google sign-in through Supabase; paste-md.netlify.app 301s to paste-md.hintwise.org.

2026-11-09 [code] auth.hintwise.org active (verified 20:03 CET, activated 20:04): Google returns to https://auth.hintwise.org/auth/v1/callback; check-google passed. platform/supabase.json url is auth.hintwise.org; keys writes it while the domain is active.

2026-11-10 [code] qualified-overtime-checker day 1: weekly build picked (2026-11-07 #2, tier a small business; three provisional ideas tied at 19, oldest won), PLAN.md and HANDOFF.md written; milestone 1 live: timesheet CSV import with SSN columns dropped, FLSA workweek engine (weighted-average regular rate, half-time premium, year by pay date), comparison with named likely causes, sample employer, CSV downloads; code review (high) found 13 issues, all fixed. Template copy command fixed (APP_SLUG).

2026-11-10 [note] Owner: PasteMD Google sign-in through Supabase works. Its two Google redirect URIs (paste-md.netlify.app, paste-md.hintwise.org) can be removed from the HintWise client.
2026-11-10 [decision] Owner: Qualified Overtime Checker may save client files in Supabase for signed-in users (browser-only choice, delete button); app stays free. Answered to the build session, which continues with day 2 today.
2026-11-10 [code] UpvoteMe: pisanuw/upvote#3 merged (ce9549c); upvoteme.netlify.app/* now 301s to upvoteme.hintwise.org with path and query kept, so sign-in stays on one host. Checked live 12:37 UTC.
2026-11-10 [code] UpvoteMe signs in to Google through Supabase (pisanuw/upvote#4): NextAuth provider `supabase`, PKCE, users linked by verified email; rollback NEXT_PUBLIC_GOOGLE_AUTH_VIA=direct.
2026-11-10 [doc] Sent StepWise how to use the shared project: auth.hintwise.org, PKCE, schema app_stepwise, shared links via an RPC. Plabs applies its migration after the owner's yes.
2026-11-10 [note] Owner: UpvoteMe Google sign-in through Supabase works. Its two Google redirect URIs (upvoteme.hintwise.org, upvoteme.netlify.app /api/auth/callback/google) can be removed.
2026-11-10 [decision] Owner: yes to applying StepWise's migration (schema app_stepwise) to the shared project and exposing the schema once its SQL arrives.
2026-11-10 [plan] BUILD_ROUTINE.md: "The usual architecture" table (owner: paid Netlify, Render, Supabase, Resend; Google via Supabase); stale supabase.json and migration notes fixed.

2026-11-10 [code] platform: expose-schema now waits until the Data API serves the new schema and re-sends the list once (PostgREST kept the old db_schema for 25 minutes after the qualified-overtime-checker deploy, until expose-schema --reapply); deploy runner passes target.yml env VITE_* values to the local build (they only reached the Netlify site before).

2026-11-10 [code] qualified-overtime-checker day 2: milestone 2 live, saved client files (this browser, or the signed-in account in app_qualified_overtime_checker.client_files with RLS), file list with open/new/move/delete, debounced autosave; code review (high) found 10 issues, all fixed (write queue, failed-save prompt, sign-out and user-switch safety, pagehide save, damaged-file handling). First app through the Deploy migrations step.
2026-11-10 [decision] Owner: auth email limit 30 -> 200 an hour (configure-auth --email-rate=200); backend-hub to Render Starter; magic-link rate limiting with Turnstile approved.
2026-11-10 [plan] BUILD_ROUTINE.md: same-day continue, apps free unless the owner says, security-review on auth/RLS/functions/email milestones. Template: local sign-out, PKCE.
