# 🎬 SQL Replay

**Watch a SQL SELECT execute one stage at a time, narrated in plain English.**

Live: **<https://sql-replay.hintwise.org>**

![Stepping the Filter and sort demo query through FROM, WHERE (the failing row struck through), SELECT, ORDER BY and the final result, each with its narration](demo.gif)

Type a query, paste sample data (or use the built-in demo tables), and press
Run. Execution unfolds as a replay you can play, pause, and single-step:

```
FROM → JOIN → WHERE → GROUP BY → HAVING → SELECT → DISTINCT → ORDER BY → LIMIT → RESULT
```

Every stage shows the actual rows: joined rows merge with their partners,
LEFT JOIN survivors get amber NULL padding, rows that fail `WHERE` are struck
through with the evaluated condition next to them, groups collapse with their
member lists, and `LIMIT` slices a visible window. A deterministic narrator
explains each stage from the real execution stats ("3 rows pass, while 2 rows
fail and are removed"), so the explanation always matches what is on screen.

Built from idea **2026-07-30 n1** in
[pisanuw/daily-project-ideas](https://github.com/pisanuw/daily-project-ideas).
The idea suggested an optional Claude API narrator; this implementation
replaces it with a rule-based narrator generated from execution statistics,
so the app is free, offline, and always accurate.

## Features

- **Step-by-step replay** of `SELECT` queries with autoplay, pause, single-step,
  restart, keyboard arrows, and a clickable stage timeline.
- **SQL subset that covers the teaching ground**: `SELECT [DISTINCT]` with
  expressions, aliases, `*` and `t.*`; `FROM` with aliases; `[INNER] JOIN` and
  `LEFT [OUTER] JOIN ... ON`; `WHERE`; `GROUP BY`; `HAVING`; `ORDER BY ... [DESC]`
  (multi-key, NULLs last); `LIMIT ... [OFFSET]`; aggregates `COUNT(*)`,
  `COUNT(x)`, `SUM`, `AVG`, `MIN`, `MAX`; operators `AND OR NOT`, comparisons,
  `IN`, `LIKE`, `BETWEEN`, `IS [NOT] NULL`, arithmetic; `--` comments.
- **Honest SQL semantics**: three-valued logic (a NULL condition fails a row),
  Kleene `AND`/`OR`, `COUNT(x)` vs `COUNT(*)`, inclusive `BETWEEN`,
  case-insensitive `LIKE` with `%`/`_`, ungrouped-column errors.
- **Your data**: paste CSV per table (first line = column names, types
  inferred), add or remove tables, or use the bundled `customers`/`orders`
  demo set with five one-click demo queries.
- **Share links**: the whole workspace (query + data) is encoded into the URL
  hash — no server, no account.
- **Friendly errors** with positions: `Unknown column "wat"`,
  `Column "id" is ambiguous; qualify it with a table alias`, and so on.

## What it deliberately is not

This is a *teaching model*, not a database. It replays the **logical** clause
order on small in-browser tables. There is no query planner, no indexes, no
cost-based join reordering, and no subqueries — a real engine would almost
never execute a query this literally. Tables are capped at 200 rows so every
row stays visible; the point is intuition, not throughput.

## Development

```bash
npm install
npm run dev        # local dev server
npm test           # 86 vitest tests
npm run coverage   # coverage with 85% thresholds (currently ~99% statements)
npm run lint
npm run typecheck
npm run build      # typecheck + production bundle in dist/
```

No runtime dependencies; the deployed site is a single small JS bundle.

## Architecture

```
src/core/tokenize.ts   SQL tokenizer (strings, numbers, operators, -- comments)
src/core/parse.ts      recursive-descent parser → typed AST (SelectQuery)
src/core/eval.ts       expression evaluator: 3-valued logic, LIKE, aggregates
src/core/execute.ts    staged executor → Step[] trace (the replay itself)
src/core/narrate.ts    deterministic per-stage English narration
src/core/csv.ts        CSV parse/serialize with type inference
src/core/share.ts      URL-hash workspace encoding (base64url JSON)
src/core/datasets.ts   demo tables + demo queries
src/ui/                DOM rendering, stepper, tabs, autoplay (untested layer)
```

The executor emits a `Step[]` trace — each step carries the SQL clause it ran,
a narration sentence, and one or more row grids with per-row status
(`kept` / `dropped` / `padded`) and notes. The UI is a thin renderer over that
trace, which is what makes the engine fully unit-testable.
