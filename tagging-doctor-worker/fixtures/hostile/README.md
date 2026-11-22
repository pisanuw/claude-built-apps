# Hostile fixtures (AC-31)

Each file is a main.tex that tries one thing a job must not do, and writes
"HOSTILE-RESULT: ..." lines into its log. `test/image/hostile.test.ts` runs
them against the built image and checks, after each, that no command ran, that
nothing was written outside the job's folder, and that neither the PDF's text
nor the log tail holds a marker planted in three places: a file only the
server user can read (`/srv/planted/secret.tex`), a queued second job's file,
and a file the previous job left behind. Paths a job cannot learn by itself
reach it through `/srv/hint/hint.txt`, which the test writes (the "known path"
of AC-31).

Added in review round 1 of milestone 3a: `biber-remote.tex` and `bibtex-remote.tex`
name a bibliography at a URL (`@URL@`, filled in by the test with a listener of
its own), which must never be fetched (R3a.1-2); `biber-local.tex`,
`bibtex-local.tex` and `refs.bib` are ordinary bibliographies that must still
work; `empty-with-pdf.tex` is uploaded beside a `main.pdf` that must not be
served as the result (R3a.1-7).

Added after review round 3 of milestone 3a (R3a.3-1): `bcf-flood.tex` writes its
own `main.bcf` as 1 MB of unclosed `<datasource ` tags, and `log-flood.tex`
fills its log with "Output written on " and no page count and writes its own
`main.pdf`. The server reads both files on its only thread; the test asks the
health route every 200 ms during each job and requires every answer within 2 s.
