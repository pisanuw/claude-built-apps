# Dossier Comment Reflector

**Your promotion dossier wants a reflection on student comments. Start from the evidence, not a blank page.**

Live: [dossier-comment-reflector.hintwise.org](https://dossier-comment-reflector.hintwise.org)

Promotion and tenure dossiers increasingly ask faculty to show how student
feedback changed their teaching, often in a two-page reflection with quotes
that covers every year in rank. That means rereading hundreds of comments
across courses and terms, picking examples that are fair rather than
flattering, and tying them to what you changed, usually in the same month the
rest of the dossier is due.

Dossier Comment Reflector does the sorting and counting so you can spend the
time on the writing:

1. **Bring in your comments.** Upload the CSV your evaluation system exports
   (Blue, EvaluationKIT, SmartEvals, Qualtrics and most others), or paste
   comments copied from a PDF report, one course and term at a time. It finds
   the comment, course and term columns for you and skips "N/A" answers.
2. **See the themes.** Every comment is sorted into themes students actually
   write about (clarity, pace and workload, feedback, grading, exams,
   assignments, availability, engagement, materials, relevance, classroom
   climate, group work) and each mention is read as positive or critical. A
   table shows each theme term by term, per course or across all of them. Add
   your own themes ("Lab TAs", "Python") with a few keywords.
3. **Record what you changed**, in your own words, and the first term it was
   in place. The app ticks the themes your description touches and compares
   the comments before that term with the comments since: how often students
   raised the theme, and what share was critical. If there are too few
   comments to say, it says so.
4. **Pick fair quotes.** For each theme it offers half praise and half
   criticism where the comments allow, spread across terms, with near
   duplicates left out. Pin the ones you want, mark any you never want quoted.
   Names ("Dr. Rivera", your TAs, any you list) become [name].
5. **Get a draft reflection** that fits your page limit: what students said,
   what you changed and why, what the comments show since, what students
   consistently value, and what you are still working on. Edit it in place,
   then download it for Word or copy the text. A spreadsheet of every comment
   with its themes and tone is there for an appendix.

Try it first with the built-in sample: about 230 made-up comments for two
courses over six semesters, with two recorded course changes.

## Your comments stay with you

Everything runs in your browser tab. Nothing is uploaded, nothing is stored,
and no AI service sees your evaluations, which matters on campuses that
restrict putting student evaluations into third-party AI tools. Close the tab
and it is gone; to come back later, save a project file and keep it somewhere
private.

## How it decides (no AI involved)

- **Themes** come from fixed word lists ("midterm", "quiz*", "office hours",
  "rubric"...). A comment can belong to several themes.
- **Tone** comes from a list of praise and criticism words, read clause by
  clause so "great lectures but the exams were brutal" counts as positive on
  clarity and critical on exams. "Not helpful" is flipped, "very clear" is
  strengthened, "too fast" counts against, and "I wish..." leans critical.
- **Before and after** comparisons need at least five mentions on each side;
  otherwise the app reports "too few comments to tell".
- **The draft** uses your words for what you changed and why, and fills in
  counts and verbatim quotes from your comments. Long quotes are cut to the
  sentences about the theme, with an ellipsis at every cut. Parts only you
  can write are left in [brackets]. If the draft runs long it drops, in
  order, extra quotes, a second strength, secondary themes and finally the
  changes with the least visible effect, and tells you what it left out.

## Limitations

- Word lists miss sarcasm, unusual phrasing and subject-specific terms; a
  comment that says "the exams were a joke" may be read as neutral. Read the
  comments behind any number before you cite it, and add your own themes for
  what the lists miss.
- Before/after differences are counts of comments, not proof that your change
  caused them: classes, enrollments and survey questions change too. The
  draft says "fell from 73% to 13%", not "the change worked".
- It reads CSV and pasted text, not vendor PDFs directly; copy the comments
  out of a PDF report and paste them.
- The draft is a starting point. Committees want your voice; rewrite it.

## For developers

TypeScript and Vite, no framework, no backend. The core
(`src/core/`) is plain functions: `importer.ts` (CSV/paste), `terms.ts` (term
labels in calendar order: "Fall 2024", "SP25", "2024-25 Semester 2"),
`themes.ts` and `sentiment.ts` (the word lists), `analysis.ts` (per-course
theme tables and before/after impact), `quotes.ts` (balanced picks and
redaction), `reflection.ts` (the page-limited draft), `exporters.ts` (Word,
lazy-loaded) and `project.ts` (save/open). `src/ui/app.ts` is the interface.

```bash
npm ci
npm run dev        # local server
npm run lint
npm run typecheck
npm run coverage   # vitest with an 85% threshold
npm run build      # static site in dist/
```

Deployed to Netlify as a static site from `deploy/target.yml`; no environment
variables (see `.env.example`).

Built with Claude Code from an idea in
[daily-project-ideas](https://daily-project-ideas.hintwise.org). MIT license.
