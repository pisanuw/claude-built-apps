# Delivery Canary: handoff (day 3 of 7, 2026-11-14)

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
- Since day 2 (Deploy run 178, commit 13b8288): the "Late download orders"
  card. Drop Shopify's Orders CSV export; it is read in the browser with an
  allowlist of 12 columns (customer email, names, phones, addresses, notes
  and tags never leave the parser), rows grouped by order name, and paid
  orders whose download items (`Lineitem requires shipping` false) are
  still unfulfilled after the grace period (15 min, 1 h default, 6 h, 24 h)
  are listed with what to do, plus a CSV of the list. Ages run to the file's
  own time (`File.lastModified`, when Shopify made the export), so the same
  file gives the same answer later. Each scan is saved per shop (signed in);
  the same file again (same SHA-256) updates its row; a new file is compared
  with the shop's latest other scan ("Also late on ...", and earlier-late
  orders now sorted out). "Try a sample export" works signed out.
- Since day 3 (Deploy run 181, commit ddcab1a): the "Check your seed inbox"
  card. Signed in, the shop enters its test Gmail address, the sender its
  download emails come from (optional subject words) and a Google app
  password; `/api/seed-check` signs in to imap.gmail.com (read-only:
  EXAMINE, BODY.PEEK), finds the newest email from that sender in the last
  14 days in All Mail and Spam, reads where Gmail put it (Primary,
  Promotions, Social, Updates, Forums, archived, Spam) and returns the
  message; the page runs the milestone 1 check on it with that placement and
  saves it to history (report.seed = where). "Keep the app password" seals
  it (AES-256-GCM, DELIVERY_CANARY_KEY, bound to user, shop, address and
  sender) so later checks need no typing. Signed out, "See a sample seed
  inbox check" shows the sample as found in Promotions.
  `GET /api/seed-reach` answers `{"gmailImap": true}` when the function can
  reach imap.gmail.com (greeting only; cached a minute).
- Not live yet: milestones 4 to 7.

## Milestones (docs/PLAN.md)

| # | Milestone | Status | Day | Notes |
|---|---|---|---|---|
| 1 | Delivery email check | done | 1 | code review (high) and security review run, all findings fixed |
| 2 | Unfulfilled digital order scan | done | 2 | code review (high, 12 findings) and security review (no high/medium; 2 low) fixed |
| 3 | Seed mailbox connection | done | 3 | code review (high, 6 real findings) and security review (1 medium, 4 low) fixed; not yet tried against a real Gmail account (open question 4) |
| 4 | Shopify connection and canary order | next | | the shop's own Dev Dashboard app (answered 12 Nov) |
| 5 | Schedule and alerts | | | needs open question 1; first Netlify Scheduled Function |
| 6 | Polish | | | |
| 7 | Finish | | | |

## How to run and verify

```bash
cd delivery-canary && npm ci && npm run lint && npm run typecheck && npm run coverage && npm run build
npm run dev          # http://localhost:5173 (memory stores, no sign-in)
PW_CHROMIUM=/opt/pw-browsers/chromium npm run e2e   # walkthrough; PW_CHROMIUM only in the cloud sandbox
```

Tests: 301 vitest (99% statements, 95% branches), 3 Playwright walkthroughs
(sample email; sample orders export; sample seed inbox check). The IMAP
client and Gmail logic run against a scripted Gmail session
(`test/gmail-fake.ts`); this sandbox cannot open IMAP connections, so the
live path is unproven until a real seed account is checked.
Migration 0003 was also applied to a throwaway local Postgres 16 with a
Supabase-like auth stub (roles anon/authenticated, auth.uid()) and its
grants, definer functions and both rate limits exercised (day 3).
Live checks:
- `curl -s https://delivery-canary.hintwise.org/ | grep -c "Want something like this"` prints 1 (footer);
- `curl -s https://delivery-canary.hintwise.org/api/health` prints `{"ok":true,"status":"ok","seedKeep":true}` (seedKeep false means DELIVERY_CANARY_KEY did not reach the function);
- `curl -s https://delivery-canary.hintwise.org/api/seed-reach` prints `{"gmailImap":true}`;
- `curl -s -X POST https://delivery-canary.hintwise.org/api/seed-check -d '{}'` answers 401;
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
  Migration `0002_order_scans.sql` (day 2): `order_scans` (file_sha256,
  file_name, grace, counts, summary jsonb < 256 KB: counts and late orders
  with order number, times and product names only), unique (shop_id,
  file_sha256), RLS own rows with own-shop check, cap 200 per account.
- Netlify Function `api` (`src/server/`, bundled by
  `scripts/build-function.mjs` with the public Supabase URL and anon key
  baked in; no secret): `GET /api/health`, `POST /api/link-check` (bearer
  token verified at `/auth/v1/user`, the test recorded first with the
  user's token, then the fetch: http/https on 80/443 only, every redirect
  hop re-checked, at most 6, 8 seconds, 25 MB hashed, 512 KB for a page; the
  connection goes through an undici Agent whose lookup refuses private
  addresses, so DNS rebinding is refused at connect time).
  Migration `0003_seed_inbox.sql` (day 3): `seed_inboxes` (one per shop:
  address, sender, subject_hint, sealed `secret`, generated `has_secret`,
  last outcome; the browser has column SELECT without `secret` and DELETE;
  writes only through security definer `seed_inbox_save(shop, address,
  sender, subject, mode keep|set|clear, secret, outcome)`, which checks the
  shop is the caller's and drops the secret when the address or sender
  changes; the function reads it through definer `seed_inbox_secret(shop)`),
  `seed_checks` (rate-limit log, HMAC tag of the canonical address; definer
  insert trigger: 12 an hour per user, 20 per seed address, rows over a day
  pruned).
- Function `POST /api/seed-check`: verify user, open the kept password if
  none typed, record the check (limit), IMAP within what is left of an 8 s
  request, then save settings and outcome. A typed password is kept only
  when "Keep" is ticked, the key exists and Gmail accepted the sign-in.
  Only 16-letter app passwords are sent; every refused sign-in is one
  outcome (`login-failed`) with all the hints.
- Sign-in: Google and email link (template panel, `sign-in-link`); the app
  host was added to `platform/src/signin/app-hosts.ts` in 80c3150.
- LLM: none. Email: none yet (milestone 5). Files: none (the orders CSV is
  read in the browser and never uploaded).
- Env names (values never here): VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY;
  DELIVERY_CANARY_KEY (repository secret, target.yml envPassthrough, the
  function's runtime only; never replace it once passwords are kept).

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

- 2026-11-13: the orders export is read with an allowlist of columns, not a
  blocklist, so a column Shopify adds later can never carry customer data
  into a scan.
- 2026-11-13: a paid, unfulfilled download order with no readable date is
  its own "no readable date" bucket with a warning, never "late" (a
  spreadsheet re-save turns Shopify's dates into 11/8/2026; code review).
  Times without an offset are read in the browser's time zone.
- 2026-11-13: ages are measured to the file's lastModified time (capped at
  now), not the scan time, so re-scanning the same export later does not
  turn waiting orders into late ones (code review).
- 2026-11-13: partially refunded orders stay "late" with a tag "check the
  refund was not for this item": the export does not say which line was
  refunded.
- 2026-11-13: Supabase scans upsert on (shop_id, file_sha256) with id and
  created_at left to the database, so two tabs scanning one file end with
  one row.
- 2026-11-13: "app-does-not-fulfill" warning when at least 5 and 80% of
  settled paid download orders are unfulfilled: some delivery apps never
  mark orders fulfilled, and then the scan cannot tell.

- 2026-11-14: our own small IMAP client (src/server/imap.ts) instead of
  imapflow: no dependencies to bundle (imapflow pulls pino and more), and
  every byte is testable against a scripted Gmail session.
- 2026-11-14: the server returns the raw message to the page, which runs
  the existing check, so one engine serves .eml, seed inbox and (later) the
  canary order; the server keeps nothing of the email.
- 2026-11-14: placement comes from Gmail itself: Spam folder, the \\Inbox
  label and `category:` searches; archived and the Social, Updates and
  Forums tabs are stored as placement "other" with report.seed.where.
- 2026-11-14 (security review): only 16-letter app passwords are sent, and
  all refused sign-ins look the same, so the endpoint cannot confirm
  someone's normal Google password; senders must not be a bare provider
  domain; the kept password is bound to the sender.
- 2026-11-14 (code review): the Spam search adds `in:spam` (Gmail's search
  skips Spam otherwise, even in the Spam folder).

## Tried and rejected

- Counting recent link tests, then inserting (two HTTP calls): racy under
  parallel requests (security review); the insert trigger is the limit now.
- A substring filter for social links (`x\.com\/`): it dropped Dropbox and
  Box download links (code review); hosts are matched exactly now.
- Using the scan time as "now" for ages: a file scanned again a day later
  flagged orders that were inside the grace period at export (code review).
- Comparing a re-scanned file with its own earlier scan: everything showed
  as "also late"; the comparison is with the shop's latest other file.
- imapflow for IMAP: heavy to bundle (pino, iconv, mailsplit) for six
  commands.
- Distinct outcomes for "app password required" and "sign in through the
  browser": Gmail sends them only for a right normal password, so they made
  the check a password oracle (security review).
- Gmail API for the seed mailbox: gmail.readonly is a restricted scope
  needing Google verification on the shared HintWise client, a shared
  setting; IMAP with an app password on the shop's own seed account is
  planned instead (open question 3).

## Open questions for the owner

4. (day 3) The seed inbox check is tested against a scripted Gmail session
   only; this build sandbox cannot open IMAP connections. Recommendation:
   when convenient, make a test Gmail account, create an app password, place
   a 100%-off order in any test shop to it, and run "Check my seed inbox
   now" on the live site; tell the build session what it says. Default: the
   build continues with milestone 4 and treats the first real report as a
   bug to fix.

**Answered by the owner, 12 Nov 2026 (Lisbon midday):** 1 yes, 2 and 3 the
defaults. The owner added the repository secret `DELIVERY_CANARY_KEY` to
pisanuw/claude-built-apps (Actions secrets) on 12 Nov; never rotate it once
credentials are stored (they could not be decrypted). The Plabs session already maps
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

- Milestones 4 to 7 (PLAN.md). Milestone 4 next: Shopify connection with
  the shop's own Dev Dashboard app (read_orders, write_draft_orders),
  credentials sealed like the app password (secretbox.ts; add a sealed
  column or table in migration 0004), canary draft order to the seed
  address, then the seed check waits for the email. Check Shopify's
  current custom-app steps first (PLAN.md risks).
- Deploy run 181 (day 3): migration 0003 applied, check-schema passed with
  two advisor warnings by design ("Signed-In Users Can Execute SECURITY
  DEFINER Function" for seed_inbox_save and seed_inbox_secret: both check
  auth.uid() and the shop's owner themselves). The stranger check skips
  seed_inboxes because it has column-level SELECT only. Live: health
  `seedKeep: true`, `/api/seed-reach` `{"gmailImap":true}` (the function
  reaches imap.gmail.com:993), the signed-out sample verified in a browser.
- Seed inbox known limits: not yet run against a real Gmail account (open
  question 4); IMAP client memory caps are per literal, not per response (only a
  misbehaving imap.gmail.com could exploit it; security review L4); the
  found email's link is tested automatically even when it sits in Spam.
- Milestone 5 needs the scheduled job to open kept passwords without a
  user token: a signed call to a definer function (key-derived HMAC), as
  open question 1 planned.
- Order scan limits (known): which line of a partially refunded order was
  refunded is not in the export; delivery apps that never mark orders
  fulfilled make every order look late (the scan warns).
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
- `src/core/csv.ts` (parser, defused CSV writer), `orders.ts` (import
  allowlist, buckets, scan, compare, notes), `orders-sample.ts`;
  `src/ui/orders.ts` (the scan card); `ScanStore` in `src/store/stores.ts`.
- `src/server/api.ts` (routes, handleSeedCheck), `fetchfile.ts` (SSRF
  guard, pinned lookup), `supabase-rest.ts`, `netlify.ts`; `imap.ts` (IMAP
  client), `seed.ts` (Gmail seed check), `secretbox.ts` (sealing, address
  tag); `src/core/seedwhere.ts`; `src/ui/seed.ts` (the card),
  `seedclient.ts`; `test/gmail-fake.ts` (scripted Gmail).
- `src/ui/app.ts` (the page), `report.ts`, `linkclient.ts`, `dom.ts`;
  `src/store/stores.ts` (shops, checks with summaries).
- `supabase/migrations/0001_init.sql`, `0002_order_scans.sql`, `0003_seed_inbox.sql`; `deploy/target.yml`;
  `e2e/walkthrough.spec.ts`.

## Log

- Day 1 (2026-11-12): picked and claimed; PLAN and HANDOFF; milestone 1 built
  (email check, link test function, schema), code review (8 findings) and
  security review (4 findings) fixed; first deploy (run 177), sign-in-link
  redeployed; live sample verified in a browser.
- Day 2 (2026-11-13): milestone 2, the late download order scan (Shopify
  Orders CSV, allowlist import, saved and compared scans, migration 0002);
  code review (12) and security review (2 low) fixed; deployed (run 178).
- Day 3 (2026-11-14): milestone 3, the seed inbox check (own IMAP client,
  Gmail placement, sealed app password, migration 0003, reachability probe);
  code review (6) and security review (1 medium, 4 low) fixed; deployed
  (run 181).
