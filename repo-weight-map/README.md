# Repo Weight Map

**What is bloating this repo, and what should never have been committed?**
Drop a project folder into the browser and get a zoomable treemap of where the
bytes are, colored by what they are (source, dependencies, generated output,
data, media, git internals), plus a rules engine that spots the classic
mistakes (a virtualenv, `node_modules`, `dist/`, `__pycache__`, a `.env` full
of keys, a 180 MB CSV) and writes the `.gitignore` lines to fix them. Your root
`.gitignore` is read and applied, so anything it already excludes is marked
*already ignored* rather than counted against you. Nothing leaves the tab: the
folder is walked for names and sizes only.

Live: [repo-weight-map.hintwise.org](https://repo-weight-map.hintwise.org)
(add `?sample` to load the demo repo straight away).

![Loading the sample student repo as a treemap, zooming into its data folder, then unticking the virtualenv finding so its lines leave the proposed .gitignore](demo.gif)

Implements idea #1 ("Repo Weight Map") from the
[2026-09-28 ideas day](https://github.com/pisanuw/daily-project-ideas)
of `pisanuw/daily-project-ideas`.

## What it does

- **Folder in, nothing out.** Uses the File System Access API in Chromium
  browsers (`showDirectoryPicker`), the `webkitdirectory` file input
  elsewhere, and drag-and-drop of a folder anywhere. Only paths and sizes are
  collected; the one file whose contents are read is the root `.gitignore`.
- **Squarified treemap.** A hand-written Bruls/Huizing/van Wijk layout (no
  d3) draws two nested levels, folds anything past the 40 largest entries into
  one "n more items" cell so huge trees stay legible, and zooms on click with a
  breadcrumb and an "Up one level" button. Cells are keyboard-focusable and
  carry a tooltip with size, share, file count, and category.
- **Category coloring.** Files are classified by location first, then
  extension: a PNG inside `node_modules/` is a dependency, because that is
  what you would delete. Ten categories, from source code to `.git` internals.
- **Junk detector.** Nineteen ordered rules covering Python (venv via
  `pyvenv.cfg` or name, conda, `__pycache__`, egg-info, wheels), Node
  (`node_modules`, `.next`, `.parcel-cache`, yarn cache), JVM (`target/`
  next to a `pom.xml`, `build/` next to a `build.gradle`, `.gradle/`), .NET
  (`bin/` and `obj/` next to a `.csproj`), Unity (`Library/`, `Temp/`,
  `Build/` under a folder with both `Assets/` and `ProjectSettings/`), C/C++
  objects and CMake output, Cargo `target/`, generic build output, coverage,
  logs, Finder and Explorer metadata, editor swap files, Terraform, secrets
  (`.env`, keys, service-account JSON), and files over 10 MB. A file counts
  toward the first rule that matches it, so nothing is double-counted.
- **`.gitignore`-aware findings.** A rule fires on what is on disk, which is a
  different question from what git is carrying, so every finding is checked
  against your root `.gitignore` with a real matcher (anchoring, `**`, `?`,
  character classes, `!` re-includes, last-match-wins, and the rule that git
  never descends into an excluded directory). A finding whose files are all
  excluded is badged **Already ignored** and its bytes are kept out of the
  headline to-do number; a partly-covered one says how much is left. The
  matcher is cross-checked against `git check-ignore`.
- **Before/after estimate and `.gitignore` diff.** Untick a finding to leave
  it out. Copy the lines, copy a unified diff against your existing
  `.gitignore`, or download a self-contained HTML report a student can attach
  to a help request.
- **Sample repo.** "Try a sample student repo" loads a synthetic 8,847-file
  capstone project with every classic mistake, so the page demos without a
  folder.

## What it does not do

- **No history mode.** The idea also asked for a scan of `.git` for large
  blobs that only live in history, with the matching `git filter-repo`
  command. That needs a packfile and delta reader in the browser and did not
  fit the weekend. The `.git` directory is counted (and it is often bigger
  than the cleaned tree, which the summary tile points out) but not opened.
- **Rules are pattern matches**, so a `build/` folder you wrote by hand will
  be flagged; that is what the tick boxes are for. Sizes are what the file
  system reports.
- **"Already ignored" comes from the root `.gitignore` only.** A browser cannot
  read nested `.gitignore` files further down the tree, `.git/info/exclude`, or
  your global `core.excludesFile`; nor can it run `git ls-files` to tell an
  ignored file from one that is ignored *and* still tracked because it was
  committed before the rule existed. `git status --ignored` is the
  authoritative answer; this is a good-enough read of the common case.
- **Firefox and Safari** get the `webkitdirectory` fallback, which reads the
  whole selection into memory before the walk starts; very large folders are
  faster in a Chromium browser.

## Run locally

```bash
npm install
npm run dev        # local dev server
npm run coverage   # 54 vitest cases, ≥85% thresholds enforced (core is at 100% statements)
npm run lint && npm run typecheck && npm run build
```

## Architecture

```
src/core/           pure, DOM-free, fully unit-tested
  types.ts          FileRecord, TreeNode, Rule, Finding, Analysis
  format.ts         bytes/percent formatting, path helpers
  classify.ts       category per path (location first, then extension)
  tree.ts           flat list -> directory tree, dominant category, "n more" folding
  treemap.ts        squarified layout
  rules.ts          the junk rules and the context they consult (venv/Unity/.NET roots)
  gitignore.ts      parse existing .gitignore, dedupe, block + unified diff
  ignore.ts         gitignore pattern matcher: does git already exclude this path?
  analyze.ts        one call: tree, totals, findings, largest files, estimate, diff
  report.ts         HTML fragments shared by the page and the standalone report
  sample.ts         deterministic synthetic student repo
src/ui/
  walk.ts           File System Access API, webkitdirectory, and drag-and-drop walkers
  treemapView.ts    SVG rendering, breadcrumb
  styles.css
src/main.ts         page wiring
test/               vitest, one file per core module
deploy/target.yml   Netlify static deploy (auto-discovered by the monorepo workflow)
```

No runtime dependencies, no backend, no API keys.
