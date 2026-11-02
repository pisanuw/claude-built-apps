# Type Witness 🔎

**Watch TypeScript type inference think, one expression at a time.**

Paste a snippet and get the *inference story*: an ordered sequence of steps in
which every literal, reference, call, and declaration shows the type the
compiler computed for it, narrated in plain English. Step through with
prev/next, a slider, or autoplay; hover any expression in the witness view for
its exact type; click it to jump to its step.

Live: [type-witness.pisan.me](https://type-witness.pisan.me)

![Loading the typeof-narrowing example and stepping through its inference story, where the same value is string | number at the check, string inside the if branch and number after it, then hovering each value in the witness view to see its type](demo.gif)

## What it shows

- **Literal types and widening** — `const x = 42` keeps the fresh literal type
  `42`; `let y = 42` widens to `number`, and the step says why.
- **Generic inference** — a call to `wrap<T>` shows the declared signature, the
  binding the compiler chose (`T = string`), and the resolved signature side by
  side.
- **Contextual typing** — the unannotated `word` in
  `["a"].map(word => word.length)` gets its type from the array, and the step
  says so.
- **Control-flow narrowing** — inside `if (typeof v === "string")`, the same
  `v` that was declared `string | number` shows up as `string`, labeled as a
  narrowing step with declared-vs-here detail.
- **Return type inference** — functions without a return annotation get a step
  showing the type assembled from their return statements.
- **Errors, in context** — compiler diagnostics are threaded into the story
  right after the step where inference went astray, and the offending span gets
  a wavy underline, so you can rewind to the exact moment the compiler and the
  code disagreed.

## How it works (and what it is not)

The real TypeScript compiler (pinned at 5.6.3) runs in a **Web Worker** in your
browser against an in-memory file system: your snippet plus the full ES2022
`lib.d.ts` reference closure (57 files) bundled as raw text. Nothing you paste
leaves your machine; there is no server, no account, and no API key. The
narration is generated deterministically from what the checker actually
computed, so it can never disagree with the highlighted code.

Two honest caveats:

- The story is a **source-ordered replay** (children before parents, statements
  in order), which reads like evaluation order — it is not a literal trace of
  the checker's internal work queue.
- Recovering `T = string` bindings for generic calls reads two internal
  compiler fields (`signature.target` and `signature.mapper`). The TypeScript
  version is pinned and the code degrades gracefully (the declared and resolved
  signatures still tell the story) if those fields ever change shape.
- The compiler bundle is large (~1 MB gzipped): the first load costs a real
  download, after which analysis is instant and offline.

There is deliberately no DOM lib: `document` is honestly "Cannot find name",
while a tiny ambient declaration provides `console`.

## Architecture

```
src/core/analyze.ts    walk the AST post-order, emit typed steps + hover spans,
                       thread diagnostics into the story (the heart of the app)
src/core/narrate.ts    one deterministic English sentence per step
src/core/segments.ts   cut source into runs for the witness view
                       (smallest-hover-span attribution, current + error marks)
src/core/examples.ts   8 bundled snippets, each pinned to the step kind it teaches
src/core/share.ts      base64url snippet-in-URL-hash share links
src/core/libs.ts       generated: the 57-file ES2022 lib closure as raw imports
src/worker.ts          Web Worker wrapper around analyze()
src/ui/app.ts          player, step list, witness view, tooltip (DOM only)
```

## Develop

```bash
npm install
npm run dev        # local dev server
npm test           # 62 vitest tests
npm run coverage   # enforces ≥85% on src/core
npm run lint && npm run typecheck && npm run build
```

The UI layer (`src/main.ts`, `src/ui/**`, `src/worker.ts`) is exercised
end-to-end in a browser rather than by unit tests; everything in `src/core` is
unit-tested, including the internal-mapper decoding and the example corpus
(each example must demonstrate the step kind it advertises, and the deliberate
error example must actually error).

## Provenance

Implements idea #1 ("Type Witness") from the
[2026-08-02 ideas day](https://github.com/pisanuw/daily-project-ideas) of
`pisanuw/daily-project-ideas`, built autonomously as part of
[Claude-capstone](https://github.com/pisanuw/Claude-capstone). The idea called
for React; the app follows this monorepo's house pattern instead (vanilla
TypeScript + Vite, zero runtime dependencies beyond the compiler itself).
