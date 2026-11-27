# Heard-As Check

https://heard-as-check.hintwise.org

For developers of tools that make tagged PDFs (HTML-to-PDF pipelines, Typst,
LaTeX tagging, report and invoice generators): see what a PDF viewer's tagged
layer hands to a screen reader from your PDF, beside veraPDF's verdict, so the
faults a validator passes are caught before a listener hears them.

Every result says what it is: "Simulated from pdf.js in Chromium; evaluation,
not certification." It is not a real screen reader.

**Status (milestone 1 of 7):** the page, sign-in and the database are in
place; the checker itself is not available yet. The full README (the CI
step, the daily cap, what is stored) comes with milestone 7.

## What is stored

Nothing yet. From milestone 5, saved runs (never your PDF) are kept in
Supabase, US East, only when you choose "Save to history". "Delete my
account", in the account panel at the top right, deletes your account and all
of its rows in every HintWise app.

## Develop

```sh
npm ci
npm run dev            # preview mode without Supabase values
npm run lint && npm run typecheck && npm run coverage && npm run build
npm run e2e            # Playwright: the walkthrough and AC-6's request recording
npm run fixtures       # writes test/fixtures/out/*.pdf
```

The fixtures' veraPDF results are in `test/fixtures/veraPDF.json`; after a
change to the generator, run `test/fixtures/verapdf.ts` with veraPDF 1.30.4
(see `../heard-as-check-worker/spike/README.md`).
