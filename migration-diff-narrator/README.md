# Migration Diff Narrator

Paste two versions of a schema and get an annotated breaking-change diff:
every change classified **safe / caution / breaking** with a one-sentence
migration note, exportable as a Markdown checklist for a PR description.

![Typing NOT NULL onto a new column in the AFTER schema flips it from safe to breaking and raises the breaking count to 4, then the TypeScript example shows interface changes classified the same way](demo.gif)

- **Live site:** https://migration-diff-narrator.pisan.me
- **Source:** https://github.com/pisanuw/Claude-capstone/tree/main/migration-diff-narrator
- **Host:** Netlify (fully static, no backend, no API keys)

## What it does

Two side-by-side panes: paste the "before" and "after" of either

- **SQL DDL** — `CREATE TABLE`, `CREATE INDEX`, `ALTER TABLE ... ADD/DROP
  COLUMN / ADD CONSTRAINT`, Postgres `CREATE TYPE ... AS ENUM`, MySQL inline
  `ENUM(...)` and `KEY (...)`; or
- **TypeScript** — `interface` and object-shape `type` declarations, including
  `extends`, `readonly`, optional members, and multi-line union types.

The format is auto-detected (overridable). The tool then reports, per table or
type:

| Change | Example verdict |
| --- | --- |
| Column/field added | nullable → **safe**; `NOT NULL` without default → **breaking** |
| Column/field removed, table/type removed | **breaking** |
| Rename (table or column) | **caution**, with a `RENAME` hint so data is not dropped |
| Type changed | widening (`INT → BIGINT`, `VARCHAR(50) → VARCHAR(100)`, `DATE → TIMESTAMP`) → **safe**; narrowing → **breaking**; cross-family → judged case by case |
| Enum / literal-union members | added → **caution**; removed → **breaking**, names the members |
| `NOT NULL` / optionality | tightened without default → **breaking**; with default → **caution**; loosened → safe (SQL) or caution (TS consumers) |
| DEFAULT added / changed / removed | severity tied to nullability |
| Primary key changed | **breaking** |
| Unique constraint added/removed | **caution** (duplicate check / lost invariant) |
| Index added/removed | **safe** / **caution** |
| Foreign key added/removed | **caution** (orphan check / lost integrity) |
| `readonly` (TS) | tightened → **caution**; loosened → **safe** |
| Auto-increment / SERIAL toggled | **caution** (sequence seeding) |

Renames are inferred rather than guessed at random: a removed and an added
column pair up only when they share a type family and either a near-identical
name or the same position with an identical type; tables pair up when at least
two column names (and 60% of the smaller table) overlap.

**Export**: one button copies a Markdown checklist grouped by severity, ready
to paste into a PR description. If the clipboard is blocked it downloads
`migration-diff.md` instead.

## Why there is no AI in it

The original prompt suggested having the Claude API classify each change. The
change taxonomy of a schema diff is small and enumerable, so this
implementation uses a deterministic rule set instead (`src/core/typeChange.ts`
and `src/core/diff.ts`): the same diff always gets the same verdict, it works
offline, and there is nothing to configure and no key to paste. The trade-off
is honesty about scope: the parsers cover the common subset of DDL and
TypeScript described above, not every dialect corner (see warnings surfaced in
the UI when something is skipped).

## Development

```bash
npm install
npm run dev        # local dev server
npm run test       # vitest (74 tests)
npm run coverage   # enforces ≥85% on statements/branches/functions/lines
npm run lint
npm run typecheck
npm run build      # tsc --noEmit + vite build → dist/
```

## Layout

```
src/core/parse/   sqlLexer, sql, typescript, detect  — text → SchemaModel IR
src/core/         diff, typeChange                   — IR × IR → classified changes
src/core/         markdown, analyze                  — export + the one UI entry point
src/ui/           render, samples, styles            — DOM layer (no framework)
```
