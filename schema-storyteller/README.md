# Schema Storyteller

Paste a database schema and read what it actually means. Schema Storyteller
takes **SQL DDL**, a **Prisma schema**, or a **JSON Schema**, and produces:

1. a plain-English **entity-relationship narrative** ("each post belongs to a
   user; `post_tags` is a join table linking posts and tags"),
2. **business-vocabulary suggestions** for cryptically named tables and columns
   (`tbl_usr_acct` reads as "user account"; `acct_no` -> `account_number`), and
3. a rule-based **review** flagging likely-missing primary keys, foreign-key
   indexes, unconstrained foreign keys, nullable booleans, and more.

The result exports as a Markdown document you can drop straight into an
onboarding wiki.

**Live:** https://schema-storyteller.pisan.me/

## Why it is deterministic (no LLM)

The original project idea proposed sending the schema to an LLM. Schema
Storyteller instead does everything with a hand-written parser and a fixed rule
set. That means it is:

- **Free and offline** - no API key, nothing uploaded, runs entirely in your
  browser tab.
- **Reproducible** - the same schema always produces exactly the same story and
  the same findings, which matters when the output is committed to docs.
- **Explainable** - every finding names the rule that produced it, so you can
  argue with it.

The tradeoff is honesty about scope: it understands *structure*, not *business
meaning*. It can tell you `orders.user_id` is an unindexed foreign key; it
cannot tell you that your company treats cancelled orders specially. See
[Limitations](#limitations).

## How it works

```
input text
   │
   ▼
detectFormat ──▶ parseSql / parsePrisma / parseJsonSchema
   │                         │
   │                         ▼
   │                   Schema (intermediate representation)
   │                         │
   │            ┌────────────┼───────────────┐
   │            ▼            ▼                ▼
   │        classify     narrate            lint
   │       (roles &   (the story)     (review findings)
   │      cardinality)
   ▼
Analysis ──▶ render (DOM)  +  toMarkdown (export)
```

Every parser normalizes into one intermediate representation (`src/core/types.ts`),
so the narration, classification, and lint stages are dialect-agnostic. The
core (`src/core/`) never touches the DOM and is fully unit-tested; the UI
(`src/ui/`, `src/main.ts`) is the only browser-facing layer.

### Supported input

| Format | Recognized constructs |
|---|---|
| SQL DDL | `CREATE TABLE` (columns, types, `NOT NULL`, `DEFAULT`, `PRIMARY KEY`, `UNIQUE`, `CHECK`, inline & table `FOREIGN KEY`), `CREATE INDEX`, `ALTER TABLE ADD CONSTRAINT`. Postgres / MySQL / generic dialects. |
| Prisma | `model` and `enum` blocks, scalar & relation fields, `@id`, `@unique`, `@default`, `@relation(fields/references)`, `@@id`, `@@unique`. |
| JSON Schema | object schemas, `properties`, `required`, `type`/`format`, `enum`, `$ref` (as relationships), `$defs`/`definitions`, `allOf` merge. |

### Review rules

`missing-primary-key`, `unindexed-foreign-key`, `implied-foreign-key`
(a `*_id` column with no FK constraint), `unbounded-string`,
`temporal-name-wrong-type`, `nullable-boolean`, `cryptic-name`,
`cryptic-table-name`, `missing-audit-columns`. Each has a severity
(high / medium / low / info) and an explanation.

## Development

```bash
npm install
npm run dev        # Vite dev server
npm test           # vitest
npm run coverage   # vitest with coverage thresholds (85%)
npm run typecheck  # tsc --noEmit
npm run lint       # eslint
npm run build      # tsc check + vite production build -> dist/
```

There are **71 unit tests** covering the three parsers, classification,
narration, the lint rules, vocabulary, and Markdown export.

## Limitations

- It reads **structure, not semantics**. Vocabulary suggestions come from an
  abbreviation dictionary and word-splitting, not domain knowledge, so a table
  named `wip` becomes "work in progress" only if that abbreviation is in the
  dictionary; otherwise the name passes through unchanged.
- The SQL parser targets the common `CREATE TABLE` / `ALTER TABLE` subset. It
  deliberately ignores views, triggers, stored procedures, partitioning, and
  vendor-specific storage clauses rather than guessing at them.
- "Missing index" and "missing audit column" findings are **heuristics**. A
  reporting table with no writes may not need the index the linter suggests;
  treat findings as prompts, not commands.

## License

MIT. Part of the [Claude-capstone](https://github.com/pisanuw/Claude-capstone)
monorepo.
