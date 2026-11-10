# HAR Detective 🕵️

Drop a browser HAR file into the page and get an interactive request waterfall
plus a ranked, plain-English performance report: N+1 call patterns, missing
cache headers, uncompressed responses, redirect chains, serialized API
waterfalls, duplicate fetches, failing requests, slow server think-time,
oversized payloads, and HTTP/1.x connection churn.

**Live:** <https://har-detective.hintwise.org>

![Loading the sample session lists 13 ranked findings; opening the N+1 finding and pressing Show in waterfall highlights the eight /api/products/{id} calls running one after another](demo.gif)

Built from the 2026-08-21 idea in
[pisanuw/daily-project-ideas](https://github.com/pisanuw/daily-project-ideas).
The idea suggested running Claude over the request data; this implementation
replaces the LLM with ten hand-written, deterministic detectors, so the
analysis is instant, free, reproducible, and works offline. The HAR file never
leaves the browser.

## Using it

1. In Chrome/Edge/Firefox DevTools, open the **Network** panel, load the pages
   you care about, then right-click the request list and choose **“Save all as
   HAR”**.
2. Drop the `.har` file on the page (or click the drop zone to browse).
3. Read the ranked findings, jump from a finding to its rows in the waterfall,
   and export the whole report as Markdown for an issue or PR.

No account, no upload, no API key. A bundled synthetic e-commerce session
(“Try the sample session”) trips every detector for a quick tour.

## The detectors

| Detector | What it flags | Typical fix |
| --- | --- | --- |
| `failed-requests` | 4xx/5xx responses and aborted requests, grouped by endpoint | fix the request or the server |
| `repeated-calls` | N+1 patterns: many calls to one endpoint template (`/api/items/{id}`) | batch endpoint / embed data |
| `sequential-chain` | API calls that run strictly one-after-another | `Promise.all` or a combined endpoint |
| `redirect-chain` | 3xx chains reconstructed hop by hop | link to the final URL, add HSTS |
| `missing-cache-headers` | static assets without usable `Cache-Control` | `public, max-age=31536000, immutable` |
| `uncompressed-responses` | large text bodies with no `Content-Encoding` | enable gzip/brotli |
| `duplicate-requests` | the same GET URL downloaded repeatedly with a full body | client-side dedup + ETag |
| `large-payloads` / `large-json` | >1 MB responses, >250 KB JSON | resize, code-split, paginate |
| `slow-ttfb` | requests dominated by server think-time | profile the backend |
| `http1-connection-churn` | HTTP/1.x origins re-paying DNS/TCP/TLS per request | enable HTTP/2 |

Each finding carries the concrete evidence (affected requests, wasted bytes or
milliseconds) and a copy-paste remediation. Ranking is severity first, then
estimated impact.

## Design notes

- **Everything interesting is pure.** `src/core/` (parser, detectors,
  analyzer, waterfall SVG builder, Markdown reporter) has no DOM dependencies
  and is fully unit-tested; `src/ui/` is a thin DOM shell.
- **Forgiving parser.** Real-world HARs are sloppy: entries missing timings,
  `-1` phase durations, invalid URLs, absent `_transferSize`. Malformed
  entries are skipped with a visible warning instead of failing the file, and
  wire size falls back through `_transferSize` → `bodySize + headersSize` →
  `content.size`.
- **The waterfall is a string.** `waterfallSvg()` returns SVG markup, so the
  renderer is testable in Node and the UI just injects it. Rows are capped at
  400 with the omission disclosed (the report still covers every entry).
- **Honest heuristics.** The compression detector will not flag a response
  whose wire size is already far below its decoded size (the export merely
  dropped the header), and HTTP/1.1 alone is not flagged unless connections
  are actually being re-opened.

## Development

```bash
npm install
npm run dev        # local dev server
npm run test       # vitest (56 tests)
npm run coverage   # enforces ≥85% on src/core (currently 100% statements)
npm run lint
npm run typecheck
npm run build      # typecheck + vite build to dist/
```

Deployment is handled by the repo's auto-discovering GitHub Actions workflow
via [`deploy/target.yml`](deploy/target.yml) (Netlify, static, no functions,
no environment variables).
