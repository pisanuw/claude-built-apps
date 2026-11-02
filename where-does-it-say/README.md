# Where Does It Say

**A course Q&A box that can only answer by pointing at the exact sentence.**
Students ask logistics questions ("can I use AI on lab 3?", "is the late
penalty per day?") and get back sentences copied from the syllabus,
assignment specs and course policies, each checked word for word against the
document and highlighted in place in a side-by-side viewer. If nothing in the
documents answers the question, it says **"Not stated in the course
documents"** instead of guessing, and logs the question. The instructor loads
those logs into a gap report: the questions the syllabus does not answer,
grouped by week and by similar wording, plus the words students used that the
documents never contain. Everything runs in the browser; nothing is uploaded.

Live: [where-does-it-say.pisan.me](https://where-does-it-say.pisan.me)

Implements idea #1 ("Where Does It Say") from the
[2026-09-30 ideas day](https://github.com/pisanuw/daily-project-ideas)
of `pisanuw/daily-project-ideas`.

## What it does

- **Quote or refuse.** An answer is one to three passages from the documents,
  each labelled with its document and section (and page, for PDFs) and a
  "Verified" line saying how it matched. There is no generated prose at all.
  When nothing qualifies, the refusal names the question words the documents
  never use and offers the closest passages under "not an answer".
- **The verifier.** Every candidate passage, from any proposer, must be a
  substring of one document after folding whitespace and typography (curly
  quotes, dashes, ellipses, ligatures, soft hyphens). Two relaxations are
  allowed and labelled: a capitalization change, and an ellipsis joining
  fragments that appear in order within 600 characters in the same document.
  Quotes under four words are rejected as too short to be evidence.
- **Side-by-side viewer.** The documents as students see them, with headings,
  lists, table rows and page markers, each quote highlighted in its own colour
  and scrolled into view. The viewer, the index and the verifier all read the
  same display text, so a highlight is always exactly what was quoted.
- **Check a quote.** Paste an answer from anywhere (a chatbot, a classmate, a
  forum post). Text in quotation marks and `>` blockquote lines are checked as
  quotes (every sentence, if there are none). Real quotes are highlighted;
  altered ones show the closest passage with a word diff (struck words appear
  only in the quote, underlined words are what the document says), so "10% per
  week" against "10% per day" is caught and shown.
- **Gap log and report.** Every question is logged in the student's browser
  with its outcome, and "No, log it as a gap" marks an answer that did not
  help. Students export the log as JSON; the instructor loads any number of
  logs and gets counts, gaps by week, similar questions grouped together, and
  the words the documents never contain, downloadable as Markdown or CSV.
- **Instructor setup.** Drop in PDF, Markdown or text files (or paste text).
  PDF text is extracted in the browser with pdf.js: lines are rebuilt from
  positioned runs, paragraphs split on vertical gaps and font changes, words
  hyphenated across lines rejoined, and running headers, footers and page
  numbers dropped. Scanned PDFs without a text layer are refused with a note.
- **Sharing without a server.** "Create student link" compresses the whole
  course pack (deflate, base64url) into the URL fragment, which browsers never
  send to a server; the sample course's link is about 4.4k characters. Long packs can
  be downloaded as JSON, hosted anywhere with CORS, and opened with
  `?pack=<url>`. `?q=<question>` pre-asks a question.

## How answers are found

The idea suggested Claude Haiku proposing quotes through a Netlify function.
This build ships a deterministic proposer instead, so there is no API key, no
per-question cost, no server, and the same question always gets the same
answer. The verifier does not care where candidates come from: the retriever's
passages go through `verifyQuote` exactly as a pasted chatbot quote does.

1. **Parsing** (`src/core/docs.ts`): Markdown (headings, lists, pipe tables
   read as "Component; Weight: 25%" rows, code, blockquotes) or plain text
   (heading heuristics, bullets, form-feed page breaks) becomes one display
   text split into blocks, each with its heading path.
2. **Sentences** (`sentences.ts`): split on terminal punctuation followed by a
   capital, not on abbreviations ("Dr.", "e.g.", "p.m.") or initials.
3. **Terms** (`terms.ts`): a light stemmer with irregular forms, stop words,
   and a course-logistics synonym table (ChatGPT/Copilot/LLM to "ai",
   midterm/final to "exam", deduction/lose to "penalty"). Numbered course
   items become exact terms: "labs 1 to 4" indexes lab#1..lab#4, "lab 5
   onward" reaches 15 further, so "lab 3" finds the first and "lab 6" the
   second.
4. **Retrieval** (`search.ts`): BM25 over sentences, with the section headings
   (weight 0.6) and document title (0.3) as weaker fields. A passage that
   names other numbers of the same kind ("labs 5 to 8" for "lab 3") is marked
   as a conflict and cannot answer.
5. **Answer or refuse** (`answer.ts`): a passage must cover at least 55% of
   the question's weighted terms (rare words weigh more, "course" and
   "policy" less, "allowed"/"required" half) and match at least one specific
   term. A sentence ending in a colon takes the list after it; a following
   sentence starting "This", "However", "Unless" and similar joins it.

## Limits (read before trusting it)

- **A verified quote is real, not necessarily relevant.** The guarantee is
  that every word shown is in the documents. Keyword retrieval can still pick
  a real sentence that misses the point, which is why every answer asks "Did
  this answer your question?" and a "no" is logged as a gap.
- **Paraphrased questions can be missed.** Retrieval matches words, stems
  and a small synonym table, so a question worded very differently from the
  document may be refused even though the documents answer it. The refusal is logged, so the
  report shows the instructor both real gaps and vocabulary mismatches.
- **The synonym table is English and course-logistics specific.**
- **PDF extraction is text-only.** The viewer shows the extracted text with
  page markers, not the rendered PDF page. Multi-column layouts and tables
  in PDFs can come out in reading order that needs checking in the viewer.
- **Logs stay in each student's browser** until they export them; there is no
  central collection (the idea's weekly instructor list needs a backend).

## Architecture

```
src/
  core/            pure, unit-tested (no DOM)
    text.ts        whitespace/typography folding with an offset map, hashing
    docs.ts        Markdown and plain-text parsing into display text + blocks
    sentences.ts   sentence segmentation within blocks
    terms.ts       stemming, stop words, synonyms, numbered course items
    search.ts      sentence index, BM25, coverage and conflict scoring
    verify.ts      quote verification, elision, closest passage, word diff
    answer.ts      quote-or-refuse answering, passage extension
    gaps.ts        question log, clustering, weekly gap report, Markdown/CSV
    pack.ts        course pack validation and URL-fragment encoding
    pdftext.ts     pdf.js text items to paragraphs, header/footer removal
    highlight.ts   highlight segments for the viewer
    sample.ts      the bundled sample course
  samples/         the sample course's Markdown documents (fictional)
  ui/pdf.ts        pdf.js loader (lazy, only when a PDF is added)
  main.ts          DOM rendering and events
```

No framework: plain TypeScript and Vite, like the other packages here. pdf.js
is the only runtime dependency and is loaded only when a PDF is added (the
main bundle is about 25 kB gzipped).

## Development

```bash
npm install
npm run dev        # http://localhost:5173
npm run lint
npm run typecheck
npm run coverage   # vitest with 85% thresholds on src/core
npm run build      # dist/
```

## Tests

91 vitest tests, 99.7% statement coverage on `src/core`: folding and offset
maps, Markdown and plain-text parsing, sentence splitting, stemming and
numbered items, retrieval and refusal on the sample course (including
conflicting lab numbers and open-ended ranges), every relaxation and
rejection in the verifier, the word diff, the gap report, pack round-trips
through the URL fragment, and PDF text reconstruction. The DOM layer was
checked end to end in headless Chromium: asking, refusing, feedback, checking
quotes, adding a Chromium-printed two-page PDF, creating a student link and
opening it at phone width.
