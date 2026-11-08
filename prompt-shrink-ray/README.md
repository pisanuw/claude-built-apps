# Prompt Shrink Ray

Paste an LLM prompt and get it compressed with a live token/cost estimate, a
word-level diff of exactly what changed, and a keyword-retention check that
flags anything load-bearing the compressor may have dropped.

![Loading the example prompt, then switching from Light to Medium to Aggressive compression while the token count drops and the word-level diff shows what was cut](demo.gif)

- **Live site:** https://prompt-shrink-ray.hintwise.org
- **Source:** https://github.com/pisanuw/Claude-capstone/tree/main/prompt-shrink-ray
- **Host:** Netlify (fully static, no backend, no API keys)

## What it does

1. **Decomposes** the prompt into labeled sections (system/instructions,
   context, examples, user/task), detected from explicit labels
   (`System:`, `Examples:`, ...) or heuristics (`You are...`, `Q:`/`A:` or
   `Input:`/`Output:` pairs).
2. **Compresses** each section at one of three levels:
   - **Light** — collapse whitespace, drop pure filler words (`please`,
     `kindly`, `simply`, ...).
   - **Medium** — light, plus verbose-phrase simplification (`in order to` →
     `to`, `due to the fact that` → `because`, ...) and cross-section
     duplicate-sentence removal (a repeated instruction is kept once, at its
     first occurrence).
   - **Aggressive** — medium, plus hedge-word removal (`I think`, `sort of`,
     ...) and trimming a long run of numbered few-shot examples down to the
     first two, with a note of how many were omitted.
   - Fenced code blocks (```` ``` ````) are never touched at any level: they
     are hidden behind a placeholder before any rule runs and restored
     byte-for-byte afterward.
3. **Reports**: an estimated token count and per-model cost before/after, a
   word-level diff (deletions struck through, insertions underlined), a
   retention score (what fraction of the numbers, quoted strings, inline
   code, and probable proper nouns in the original still appear in the
   compressed text, with the missing ones named), and a per-section list of
   which rules fired.
4. **Exports**: copy the compressed prompt as plain text, or download it as a
   structured JSON template (`{ sections: [{ kind, text }] }`).

## Why there is no AI in it

The original idea suggested Claude Haiku for compression and Claude Sonnet
for a semantic-equivalence check. Compression here is a fixed, enumerable set
of rewrite rules instead (`src/core/rules.ts`, `src/core/compress.ts`), so the
same prompt always compresses the same way, it works offline, and there is no
key to paste. In place of an LLM-judged equivalence check, the retention
checker (`src/core/retention.ts`) extracts the terms a human would consider
load-bearing — numbers, quoted strings, inline/fenced code, probable proper
nouns — and reports exactly which ones a given compression dropped. It is a
narrower guarantee than "an LLM says these mean the same thing," and it says
so: a 100% retention score means no tracked term was lost, not that the
prose reads identically.

Token counts are an approximation (`characters / 4`, floored by word count),
the same rule of thumb providers give for English text, not a real tokenizer
— useful for comparing before vs. after, not for billing. Per-model pricing
in `src/core/pricing.ts` is a small, static, clearly-labeled-as-illustrative
table; the reported percentage savings do not depend on it being exactly
current.

**Known limitation:** the diff view aligns changes word-by-word (an LCS
diff), which reads cleanly for typical filler/phrase edits but can look
jumbled when a whole block is replaced wholesale (e.g. aggressive example
trimming), since short common words in the replacement note can align with
unrelated words in the deleted text. The compression itself is unaffected;
only the diff's readability suffers in that case.

## Development

```bash
npm install
npm run dev        # local dev server
npm run test       # vitest (76 tests)
npm run coverage   # enforces ≥85% on statements/branches/functions/lines
npm run lint
npm run typecheck
npm run build      # tsc --noEmit + vite build → dist/
```

## Layout

```
src/core/decompose.ts       text -> labeled Section[]
src/core/rules.ts           filler/verbose-phrase/hedge rewrite tables
src/core/sentences.ts       non-lossy sentence splitter (used by dedup)
src/core/codeSafe.ts        hides fenced code blocks from every rule
src/core/compress.ts        the compression pipeline (Section -> CompressedSection)
src/core/tokens.ts          token-count approximation
src/core/pricing.ts         static per-model cost table
src/core/retention.ts       salient-term extraction + retention scoring
src/core/diff.ts            word-level LCS diff (line-level fallback for huge input)
src/core/summary.ts         combines tokens + retention into one summary
src/core/exportTemplate.ts  CompressedSection[] -> JSON prompt template
src/ui/                     render, samples, styles — DOM layer (no framework)
```
