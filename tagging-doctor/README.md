# Tagging Doctor

**https://tagging-doctor.hintwise.org**

Tagging Doctor tells you what stops your LaTeX course materials (lecture notes,
problem sets, exams) from producing a tagged PDF, the kind a screen reader can
follow. Drop a zip of a project, or one `.tex` file, and in a few seconds you
see each class and package that blocks tagging, the file and line where it is
loaded, what the LaTeX Project says about it, and a suggested fix.

The scan runs in your browser: nothing is uploaded for it. Sign in (with
Google, or with a link by email) to save scans under a course and see the
whole course at once.

## How to use it

1. Zip the folder that holds your project (the main `.tex` file and everything
   it reads), or pick one `.tex` file.
2. Drop it on the page, or choose it with **Choose files**.
3. If the zip holds several documents (a whole course), pick one, or choose
   **Scan all** for one summary row per document.
4. Read the blockers first, then the warnings. **Download report** gives you a
   single HTML file to hand to your accessibility office; **Download JSON**
   gives the same findings as data.
5. To keep the result, choose **Save** (or **Save all to a course** after
   **Scan all**), sign in, and pick or start a course. Save a new version of a
   project under the same name to see how many blockers were fixed and how many
   are new. **My courses** lists your courses; a course's **Course report** is
   a printable page, and **Download HTML** gives it as one file.

## What the scan checks

- Every file the main file reaches: `\input`, `\include`, `\subfile`,
  `\import`, `\subimport`, `\InputIfFileExists`, and your own class and style
  files (a shared `course.sty` is read too, with what it loads).
- Each class and package, against the LaTeX Project's tagging status list:
  blockers (no support, or not yet compatible), warnings (works in part),
  unknown (not checked, or not in the list; never shown as fine), and those
  that work.
- The preamble: whether `\DocumentMetadata` is there and comes first, the
  pdfTeX-only `inputenc` and `fontenc`, the document language and a title.
- Figures: how many `\includegraphics` and `tikzpicture` uses have no alt text.
- Parts that need a program outside TeX (EPS figures, `svg`, `minted`,
  `pythontex`, `gnuplottex`, `\tikzexternalize`).

## What it does not do

- It does not certify a document. "No known blockers" means none of
  the packages it found is listed as a problem; only a compile with tagging on
  and a PDF/UA check can show how the PDF turns out.
- It does not change your files.
- It does not move Beamer slides to another class. Beamer cannot be tagged; the
  LaTeX Project recommends the `ltx-talk` class for tagged slides.
- Many common packages (`caption`, `pgfplots`, `algorithm2e`, `minted`) are
  blockers today, and others (`amsmath`, `hyperref`, `tikz`) work only in part,
  so most real course documents will show "N blockers found". That is the
  honest state of tagging in LaTeX, and it changes as the LaTeX Project updates
  its list.

## What is stored

- Your files are never stored. Files named like student records (`grades`,
  `gradebook`, `roster`, `students`, any extension), and every file in a folder
  named so (`grades/`), are left out of the scan and never read; remove them
  from course folders.
- When you sign in and save, the app keeps your courses, the project names and,
  for each saved scan, its verdict and counts and, per finding, the file path,
  the line, the package name and an excerpt of at most 200 characters. They are
  kept in HintWise's database at Supabase (US East) until you delete them.
- **Export my data** (on My courses) downloads all of it as one JSON file.
  Delete a project or a course from its page. **Delete my account**, in the
  panel under your name, deletes your sign-in and what every HintWise app keeps
  for you.
- Visits are counted without cookies. The app's **What we keep** page says the
  same, and what the later compile and alt-text steps will send.

## Limits

A zip of at most 20 MB, 2000 files and 100 MB unpacked. Password-protected
zips cannot be read.

## Credits

The package and class data is a converted copy of the LaTeX Project's
[tagging status list](https://latex3.github.io/tagging-project/tagging-status/)
(`latex3/tagging-project`, `_data/tagging-status.yml`), under the LaTeX
Project Public License, version 1.3c or later. The copy's date, commit and
source are in `src/data/tagging-status.json` and on every report.

## For developers

Vite and TypeScript, no framework. The scan is pure TypeScript in `src/core/`:

| File | What it does |
|---|---|
| `zip.ts` | Reads the zip's directory, checks the limits, inflates one entry at a time with a hard stop at its declared size |
| `project.ts` | Which entries may be read (no `..` paths, no student records); reads text lazily |
| `latex.ts` | Comments, commands, arguments, paths |
| `scan.ts` | Main-file detection, the file walk, the status lookups and the preamble checks |
| `status.ts` | The status data and its mapping to groups |
| `report.ts` | The HTML and JSON downloads (`schema/report.schema.json`) |
| `outzip.ts` | The one place that builds a zip of a project (for the later upload and patch) |
| `saved.ts` | What a saved scan holds, the rescan delta, the course report and the export |

Saved data goes through `src/lib/store.ts` (`CourseStore` over a `Db`: Supabase
in the schema `app_tagging_doctor` live, in memory for tests and `vite
preview`). The schema is `supabase/migrations/0001_init.sql`; `test/schema.test.ts`
runs it on PGlite and checks row level security, the composite keys and the
cascades. Without the Supabase env (`vite preview`, `npm run e2e`) sign-in is a
stand-in that signs a preview person in (`src/ui/preview-account.ts`).

```bash
npm ci
npm run lint && npm run typecheck && npm run coverage && npm run build
npm run e2e        # Playwright against vite preview
```

To refresh the status data from a newer commit of the list:

```bash
git ls-remote https://github.com/latex3/tagging-project refs/heads/main
curl -o /tmp/ts.yml https://raw.githubusercontent.com/latex3/tagging-project/<commit>/_data/tagging-status.yml
npm run status-data -- /tmp/ts.yml <commit> <YYYY-MM-DD>
```

Fixtures for the tests are small projects in `test/fixtures/`; the tests zip
them on the fly.
