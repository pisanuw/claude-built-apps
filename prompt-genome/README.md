# Prompt Genome

Paste any AI prompt and see it as a DNA strand of typed genes. Edit, lint,
mutate, and reassemble it, then keep the genes worth reusing.

- **Live site:** https://prompt-genome.pisan.me
- **Source:** https://github.com/pisanuw/Claude-capstone/tree/main/prompt-genome
- **Host:** Netlify (static site; no backend).
- **Idea:** [`pisanuw/daily-project-ideas`](https://github.com/pisanuw/daily-project-ideas), 2026-08-23 idea 1.

## What it does

- **Sequence.** Paste a prompt and it is segmented into typed, color-coded
  genes: `role`, `persona`, `context`, `task`, `constraint`, `format`,
  `example`. Explicit section labels (`Constraints:`, `## Format`) are
  honored; free prose is classified sentence by sentence, and every gene
  shows *why* it got its label ("forbids something", "imperative verb").
- **Lint.** A rule set scores the genome 0-100 and reports findings with
  severities: no task gene, competing tasks, vague wording ("various things,
  etc."), subjective quality words ("engaging", "high-quality"), brevity vs
  depth conflicts, negative-only constraints, duplicate genes, missing
  format/example, overlong genes.
- **Mutate.** Every gene offers three labeled, deterministic rewrites
  (e.g. for a constraint: *Harden it*, *Soften it*, *Make it checkable*),
  each with a one-line rationale and an inline preview highlighting what
  would change. Same gene in, same three mutations out.
- **Edit and rearrange.** Genes can be edited in place, reclassified,
  duplicated, reordered, and deleted; a strand bar shows the genome at a
  glance and jumps to a gene on click.
- **Diff.** A side-by-side word-level diff (LCS) compares the prompt as
  pasted with the genome as edited.
- **Library.** Save genes with tags to a localStorage library; search,
  filter by tag, and insert into the current genome. No accounts.
- **Export and share.** Copy the assembled prompt, a Markdown version
  grouped by gene type, or machine-readable JSON. Share links encode the
  whole genome into the URL hash (base64url), so a link needs no server and
  opens read-only.

## Where it deviates from the idea (and why)

The idea suggested Claude API calls for gene mutation and response diffing,
with React + Tailwind. This implementation is deterministic and fully
client-side instead:

- **Rule-based segmentation** replaces LLM parsing: cue patterns plus
  explicit label detection. Same paste, same genome, offline, free.
- **Template mutations** replace "AI suggests three alternatives": each gene
  type has three hand-written transforms (with case-aware word swaps such as
  should→must). They are honest about being mechanical, and being mechanical
  is what makes them predictable teaching material.
- **Prompt diffing** replaces response diffing: without API calls there are
  no model responses to compare, so the diff shows how the *prompt* changed
  instead. The lint panel fills the "did it get better?" role.
- **Vanilla TypeScript + Vite** replaces React + Tailwind, matching the rest
  of this monorepo: zero runtime dependencies.

The trade-off: the classifier only knows the cues it ships with; an unusual
sentence falls back to `context` with an honest "no strong signal" note, and
one-click reclassification is the escape hatch.

## Architecture

```
src/
  core/            pure logic, unit-tested
    types.ts       gene types, metadata, findings
    segment.ts     label + cue-based prompt segmentation
    mutate.ts      3 deterministic rewrites per gene type
    lint.ts        genome health rules + 0-100 score
    diff.ts        word-level LCS diff with large-input fallback
    assemble.ts    reassembly + text/Markdown/JSON export + JSON import
    share.ts       base64url URL-hash share links
    library.ts     localStorage gene library (storage injected for tests)
    examples.ts    bundled sample prompts
  ui/
    app.ts         DOM rendering and state (no framework)
    styles.css
  main.ts          entry point + hashchange handling
test/              vitest suites, one per core module
```

## Development

```bash
npm install
npm run dev        # local dev server
npm run lint       # eslint
npm run typecheck  # tsc --noEmit
npm run coverage   # vitest with 85% thresholds
npm run build      # typecheck + vite build to dist/
```

87 tests; coverage of the core is ~99% statements (the DOM layer is
exercised end-to-end in headless Chromium instead of unit tests).

## Deploy

`deploy/target.yml` is auto-discovered by the repo's deploy workflow; a push
that touches it (or this package) deploys the site to Netlify.
