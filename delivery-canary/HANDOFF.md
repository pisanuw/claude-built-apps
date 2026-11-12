# Delivery Canary: handoff (day 1 of 7, 2026-11-12)

Rewritten at the end of every build day by the build routine
(BUILD_ROUTINE.md). It is the only state the next day's session has, and the
document the owner pastes into any other session to continue the work.

## Resume prompt

> Continue building `delivery-canary` in pisanuw/claude-built-apps (branch
> main; run `git config core.hooksPath .git-hooks`). Read
> `delivery-canary/HANDOFF.md`, `delivery-canary/docs/PLAN.md`,
> `docs/platform.md` and the repo CLAUDE.md, then work the next milestone as
> BUILD_ROUTINE.md "Step 3" describes: implement with tests, review, push to
> main, update this handoff.

## Goal and customer

Idea: daily-project-ideas `ideas/2026-11-08.json` idea 3, "Delivery Canary
for Digital Shops". Buyer: the Shopify shop owner who sells digital files
(patterns, ebooks, presets, printables). Promise: "It tells me when my
download emails land in spam or the link breaks, before a customer does."
Shape marks: stateful, connected, unattended, engine (PLAN.md "Shape").

## What is live

- https://delivery-canary.hintwise.org (first deploy 2026-11-12, Deploy run
  177, commit 80c3150): drop in a delivery email (.eml or pasted "Show
  original" source), say where it landed (or let Takeout's X-Gmail-Labels
  say), and get findings with fixes: placement, SPF, DKIM, DMARC, DKIM
  alignment with the From domain, free-mailbox sender, transit time,
  delivery app, the download link test (status, type, size, SHA-256) and the
  comparison with the shop's baseline file. The sample email works signed
  out (its link is `/sample/canary-pattern.pdf`, tested in the browser).
  Signed in (Google or email link), the shop, baseline and every check are
  saved; history lists the latest 50 per shop.
- Not live yet: milestones 2 to 7.

## Milestones (docs/PLAN.md)

| # | Milestone | Status | Day | Notes |
|---|---|---|---|---|
| 1 | Delivery email check | done | 1 | code review (high) and security review run, all findings fixed |
| 2 | Unfulfilled digital order scan | next | | Shopify Orders CSV export; drop Email/address columns at import |
| 3 | Seed mailbox connection | | | needs open question 1 (key) |
| 4 | Shopify connection and canary order | | | open question 2 |
| 5 | Schedule and alerts | | | needs open question 1; first Netlify Scheduled Function |
| 6 | Polish | | | |
| 7 | Finish | | | |

## How to run and verify

```bash
cd delivery-canary && npm ci && npm run lint && npm run typecheck && npm run coverage && npm run build
npm run dev          # http://localhost:5173 (memory stores, no sign-in)
PW_CHROMIUM=/opt/pw-browsers/chromium npm run e2e   # walkthrough; PW_CHROMIUM only in the cloud sandbox
```

Tests: 202 vitest (99% statements, 95% branches), 1 Playwright walkthrough.
Live checks:
- `curl -s https://delivery-canary.hintwise.org/ | grep -c "Want something like this"` prints 1 (footer);
- `curl -s https://delivery-canary.hintwise.org/api/health` prints `{"ok":true}` (`{"ok":true,"status":"ok"}` after the day 2 deploy);
- `curl -s -X POST https://delivery-canary.hintwise.org/api/link-check -d '{"url":"https://example.com"}'` answers 401 (sign-in required).

## Platform use

- Supabase schema `app_delivery_canary` (migration `0001_init.sql`, applied
  by the Deploy workflow on 2026-11-12): `shops` (name, delivery app,
  baseline jsonb: size and hash only), `checks` (verdict, placement, subject,
  report jsonb: hosts only, never the raw email or a full download URL),
  `link_tests` (rate-limit log). RLS own rows on all three; a check's
  `shop_id` must be the user's own shop; caps 20 shops and 2,000 checks per
  account (per-user advisory lock); `link_tests_limit` trigger: 30 tests an
  hour per user (SQLSTATE PT429 -> HTTP 429), created_at forced to now(),
  rows over a day old pruned. No anon grants.
- Netlify Function `api` (`src/server/`, bundled by
  `scripts/build-function.mjs` with the public Supabase URL and anon key
  baked in; no secret): `GET /api/health`, `POST /api/link-check` (bearer
  token verified at `/auth/v1/user`, the test recorded first with the
  user's token, then the fetch: http/https on 80/443 only, every redirect
  hop re-checked, at most 6, 8 seconds, 25 MB hashed, 512 KB for a page; the
  connection goes through an undici Agent whose lookup refuses private
  addresses, so DNS rebinding is refused at connect time).
- Sign-in: Google and email link (template panel, `sign-in-link`); the app
  host was added to `platform/src/signin/app-hosts.ts` in 80c3150.
- LLM: none. Email: none yet (milestone 5). Files: none.
- Env names (values never here): VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY.

## Decisions and why

- 2026-11-12: picked from tier a by score (19); no eligible idea is
  validated. Folder and subdomain `delivery-canary` (no marketplace name).
- 2026-11-12: the email is parsed in the browser (postal-mime 4.2.0) and
  never uploaded; only the download link goes to the server. Shops trust a
  tool more that never holds their mail.
- 2026-11-12: milestone 1 asks for an .eml instead of reading a mailbox, so
  the engine ships before any credential storage exists; milestones 3 and 4
  feed the same engine.
- 2026-11-12: the saved report keeps link hosts only, and link text has any
  URL reduced to its host (security review): a per-order download URL grants
  access to the shop's file.
- 2026-11-12: tester failures (429, 503, offline) show as "Link not tested",
  never as "the download link did not work" (code review).
- 2026-11-12: the sample's download link is a 685-byte PDF this app serves,
  so the demo needs neither sign-in nor the server.
- 2026-11-12: deploy/target.yml and the app-hosts entry were held back from
  the first two pushes until both reviews were applied, so the day has one
  production deploy.

## Tried and rejected

- Counting recent link tests, then inserting (two HTTP calls): racy under
  parallel requests (security review); the insert trigger is the limit now.
- A substring filter for social links (`x\.com\/`): it dropped Dropbox and
  Box download links (code review); hosts are matched exactly now.
- Gmail API for the seed mailbox: gmail.readonly is a restricted scope
  needing Google verification on the shared HintWise client, a shared
  setting; IMAP with an app password on the shop's own seed account is
  planned instead (open question 3).

## Open questions for the owner

**Answered by the owner, 12 Nov 2026 (Lisbon midday):** 1 yes, 2 and 3 the
defaults. The owner adds the repository secret `DELIVERY_CANARY_KEY` to
pisanuw/claude-built-apps (Actions secrets). The Plabs session already maps
it in `.github/workflows/deploy.yml` (Deploy step env), so the build only
needs `envPassthrough: [DELIVERY_CANARY_KEY]` in `deploy/target.yml`. Until
the secret exists the runner logs "passthrough env ... is not set" and the
app must fall back to "check now" only. Shopify: the shop's own app. Seed
mailbox: IMAP with a Google app password.


1. Milestones 3 and 5 keep a shop's seed-mailbox app password (and later its
   Shopify app credentials) so the scheduled check can run while nobody is
   signed in. Recommendation: one new GitHub repo secret
   `DELIVERY_CANARY_KEY` (32 random bytes, `openssl rand -base64 32`),
   passed to the Netlify function through target.yml `envPassthrough`. It
   encrypts those credentials (AES-GCM) before they reach the database and
   signs the scheduled job's calls to a security definer function, so the
   app never needs the service-role key. Default if unanswered by day 3:
   build milestone 3 with "check now" only (the password is used once and
   not stored) and leave the schedule until the secret exists.
2. Shopify connection (milestone 4). Recommendation: the shop creates its own
   app in Shopify's Dev Dashboard with read_orders and write_draft_orders and
   pastes its credentials, so no HintWise Shopify Partner account is needed.
   The alternative is an unlisted Shopify app under a HintWise Partner
   account (one-click install, two more secrets). Default: the shop's own
   app.
3. Seed mailbox (milestone 3). Recommendation: IMAP with a Google app
   password on a Gmail account the shop keeps for testing; it reads the
   Inbox, Promotions and Spam placement without changing the shared Google
   client. Default: IMAP.

## Remaining and known issues

- Milestones 2 to 7 (PLAN.md).
- Done 2026-11-12: "Supabase admin" `deploy-function sign-in-link` (run 69,
  success), so the platform accepts this app's sign-in links.
- The first Deploy (run 177) ended with an error annotation: the runner's
  health check looks for `"status"` in `/api/health`, which then answered
  `{"ok":true}` (the function and its routing work). Fixed on main the same
  day (`{"ok":true,"status":"ok"}`); it reaches the live site with the next
  deploy (day 2). The Supabase migrations step and check-schema passed.
- In `vite preview` (http://localhost) the sample shows "Download link is not
  secure (http)"; on the live https site it does not.
- Polish day: README for the shop owner (a stub now), Google button check,
  accessibility-lens scan, demo GIF.

## Key files

- `src/core/email.ts`: .eml / "Show original" reading; `headers.ts`:
  Authentication-Results, DKIM d=, Received times, X-Gmail-Labels,
  alignment; `links.ts`: link extraction and scoring, delivery-app guess;
  `findings.ts`: the rules, verdict, saved report, baseline; `linkcheck.ts`:
  shared link-test helpers; `sample.ts`: the sample email.
- `src/server/api.ts`, `fetchfile.ts` (SSRF guard, pinned lookup),
  `supabase-rest.ts`, `netlify.ts`.
- `src/ui/app.ts` (the page), `report.ts`, `linkclient.ts`, `dom.ts`;
  `src/store/stores.ts` (shops, checks with summaries).
- `supabase/migrations/0001_init.sql`; `deploy/target.yml`;
  `e2e/walkthrough.spec.ts`.

## Log

- Day 1 (2026-11-12): picked and claimed; PLAN and HANDOFF; milestone 1 built
  (email check, link test function, schema), code review (8 findings) and
  security review (4 findings) fixed; first deploy (run 177), sign-in-link
  redeployed; live sample verified in a browser.
