# ACR Draft

**A university wants your VPAT before it will buy. Write an honest one yourself.**

Colleges, schools and public agencies now ask software vendors for an
Accessibility Conformance Report (ACR): the VPAT® template filled in,
criterion by criterion, saying how well your product meets WCAG. In the US the
ADA Title II rule requires public universities to meet WCAG 2.1 AA (deadlines
April 2027 and April 2028), and it reaches the software they buy, so
purchasing offices are checking. Agencies charge around $350 for the report
plus $100 to $250 per screen for the audit behind it, and you pay again after
every major release.

ACR Draft gets a small team most of the way there in an afternoon:

1. **Describe your product** and answer twelve yes/no questions ("Does it
   have video?", "Is anything timed?"). Criteria that cannot apply are marked
   Not Applicable with a plain reason.
2. **Scan your key screens** with the free axe-core checker: paste a short
   snippet into your browser's console on each signed-in screen, or run one
   command for public pages, or paste the page's HTML into the app.
3. **Do the guided review.** For each of the 50 WCAG 2.1 Level A and AA
   criteria you get one sentence on what it asks, a short test you can do
   without accessibility training, the scan's findings for it, and a place to
   record what you found.
4. **Export the report** in the VPAT 2.5 WCAG edition layout as a Word file,
   an HTML page, or a PDF, with an evidence appendix a procurement reviewer
   can check.
5. **Next release**, open your saved project file, re-scan, and compare: it
   shows which criteria got better or worse and which scan failures are new.

Everything happens in your browser tab. Nothing you type or scan is uploaded.

**Live:** https://acr-draft.hintwise.org · **Try it without your own product:**
click "Try the example" for QuizNest, a made-up quiz platform that is part
way through its review.

## It keeps you honest

An ACR is a statement to a buyer. An inflated one loses trust the first time a
student with a screen reader logs in. ACR Draft is strict on purpose:

- **No "Supports" from a scan alone.** Automated checkers catch only part of
  what goes wrong, and little of what matters most (keyboard traps, confusing
  focus order, unhelpful labels). A clean scan leaves a criterion "Not
  Evaluated" until a person has tested it.
- **Your answer has to match the scan.** If you mark a criterion as passing
  but the scan found failures, the report says Partially Supports and tells
  you which screens to fix.
- **Every claim needs a note.** "Supports", "Partially", "Fails" and "Doesn't
  apply" each need a sentence of evidence, which becomes the remark buyers
  read.
- **No "Not Evaluated" in a final report.** VPAT 2.5 allows it only for AAA
  criteria, so the report is stamped DRAFT until every A and AA criterion has
  an answer.
- 4.1.1 Parsing is marked Supports with the reason WCAG 2.1's 2023 errata
  give (it is always satisfied for HTML).

## What it covers, and what it does not

- WCAG 2.0 and 2.1, Levels A and AA (the 50 criteria Title II and most
  university procurement offices ask about). AAA is listed as not evaluated.
- The WCAG edition of the VPAT 2.5 layout. The Section 508 and EN 301 549
  editions, which repeat the same WCAG tables with extra chapters, are not
  generated.
- Web products. Native mobile apps and PDFs you ship are out of scope.
- It does not fix code, certify anything, or give legal advice. The report is
  your own representation, and it says so.

## Getting scan results

**Console snippet (signed-in screens).** On the screen, open DevTools (F12),
choose Console, paste the snippet the app shows you, and press Enter. It loads
axe-core 4.11.0 from cdnjs (or jsDelivr if cdnjs is blocked), runs the WCAG
2.1 A and AA rules, and copies the results to your clipboard. Paste them into
the screen's "Paste axe results" box. If your app's Content Security Policy
blocks loading the script, use the HTML method.

**Command line (public pages).**

```bash
npx @axe-core/cli@4.11.0 https://your-product.example/page --tags wcag2a,wcag2aa,wcag21a,wcag21aa --save axe-results.json
```

List several addresses in one command; "Import a command-line file" adds one
screen per page.

**Paste the HTML.** In the console on the screen, run
`copy(document.documentElement.outerHTML)` and paste the result into "Scan
page HTML". ACR Draft removes the page's scripts and event handlers, renders
it in a hidden frame with your stylesheets (fill in the screen's address so
they load), and runs the same bundled axe-core there.

## Limitations

- You still have to do the manual tests. The app tells you how and records
  what you find; it cannot press Tab for you.
- Scans are of the screens and states you choose. A dialog that was closed
  when you ran the snippet was not scanned.
- Remarks are built from your notes and the scan findings with fixed rules,
  not written by AI. Read them once as a buyer would before you send the
  report.
- Work is saved in this browser automatically, but clearing site data erases
  it. Save the project file with each release.

## For developers

Static TypeScript app (Vite, no framework). axe-core is bundled for the HTML
scan and lazy-loaded with the docx library only when used. Run from this
folder:

```bash
npm ci
npm run dev        # local server
npm run lint && npm run typecheck && npm run coverage && npm run build
```

- `src/core/wcag.ts`: the 50 criteria, product questions and guided tests
- `src/core/axe.ts`: axe-core result import, console snippet, CLI command
- `src/core/conformance.ts`: the rules that set each conformance level,
  remark and warning
- `src/core/report.ts`, `src/core/docx.ts`: VPAT 2.5 WCAG edition model, HTML
  and Word output
- `src/core/diff.ts`: release-to-release comparison
- `src/core/sanitize.ts`, `src/ui/frame.ts`: preparing and scanning pasted
  HTML in a sandboxed iframe

No environment variables and no backend. Deployed to Netlify by the
monorepo's deploy workflow from `deploy/target.yml`.

VPAT® is a registered service mark of the Information Technology Industry
Council (ITI). ACR Draft is not affiliated with ITI. axe-core is © Deque
Systems, MPL-2.0.

## License

MIT. See [LICENSE](./LICENSE).
