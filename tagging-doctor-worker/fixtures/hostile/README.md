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
