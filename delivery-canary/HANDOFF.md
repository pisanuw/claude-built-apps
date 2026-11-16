# Delivery Canary: handoff (day 5 of 7, 2026-11-16)

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
- Since day 4 (Deploy run 182, commit 539f685): the
  "Canary orders from Shopify" card. Signed in, the shop connects its own
  Shopify app (made in the Dev Dashboard with read_orders,
  write_draft_orders and optionally read_products) by pasting the store
  address, client ID and client secret; `/api/shopify/connect` trades them
  for a 24-hour Admin API token (client credentials grant; same Shopify
  organization only), refuses missing or extra scopes, reads the shop's
  name and keeps the secret sealed. The seed address at that moment is
  sealed with it: canaries only ever go to that address, and changing the
  seed inbox means pasting the secret again (security review). The owner
  picks a download product (search, or paste a variant ID) and "Place a
  canary order now" makes a draft order for it (100% off, tag
  `delivery-canary`, email = the sealed seed address), deletes and refuses
  it unless the total is 0 and the item needs no shipping, then completes
  it. The page looks in the seed inbox (kept app password) 45 s, 90 s,
  2.5, 4, 6 and 9 minutes after the order, only for mail after the order
  time (`after:` in the Gmail search), records transit time and placement on
  the canary row and runs the full check on the email. "Scan the last 30
  days of orders from Shopify" feeds the late order scan from the Admin API
  (no customer fields asked for; canaries excluded). Signed out, "See a
  sample canary order" shows a result.
- Since day 5 (Deploy run 184, commit 0efebfc): the "Scheduled canaries
  and alerts" card. Signed in, connected, with the seed app password kept
  and a canary product picked, the owner turns on a weekly or daily canary
  at a local hour (stored as UTC), ticks alerts (on by default) and a weekly
  digest, and saves (`POST /api/schedule`). The Netlify Scheduled Function
  `canary-run` (every 10 minutes, `netlify/functions/canary-run/`) places
  each due canary, looks in the seed inbox on the next runs, runs the full
  check server side (same engine, saved to history), and calls it "no
  email" 40 minutes after the order. Alerts (Resend, from
  delivery-canary@hintwise.org, to the account's confirmed address): Spam,
  a failed check, no email, an order Shopify refused, and a schedule that
  cannot run or hit the 5-a-day limit. Weekly digest a week after it is
  turned on. Every email has a one-click unsubscribe
  (`/api/unsubscribe/<HMAC token>`: GET asks, POST stops that shop's alerts
  and digest). The card shows the placement table of the last 8 weeks;
  scheduled canaries are marked "(scheduled)". Signed out, "See a sample
  schedule" shows the card with sample weeks. `/api/health` adds
  `scheduleLastRun` and `jobTokenSha256`.
- Not live yet: milestones 6 (polish) and 7 (finish).

## Milestones (docs/PLAN.md)

| # | Milestone | Status | Day | Notes |
|---|---|---|---|---|
| 1 | Delivery email check | done | 1 | code review (high) and security review run, all findings fixed |
| 2 | Unfulfilled digital order scan | done | 2 | code review (high, 12 findings) and security review (no high/medium; 2 low) fixed |
| 3 | Seed mailbox connection | done | 3 | code review (high, 6 real findings) and security review (1 medium, 4 low) fixed; not yet tried against a real Gmail account (open question 4) |
| 4 | Shopify connection and canary order | done | 4 | code review (high, 10 findings) and security review (1 medium, 1 low) fixed; not yet tried against a real shop (open question 5) |
| 5 | Schedule and alerts | done | 5 | code review (high, 10 findings) and security review (1 medium, 5 low, 3 info) fixed, except the medium's last step (open question 6); first Scheduled Function with this runner |
| 6 | Polish | next | | |
| 7 | Finish | | | |

## How to run and verify

```bash
cd delivery-canary && npm ci && npm run lint && npm run typecheck && npm run coverage && npm run build
npm run dev          # http://localhost:5173 (memory stores, no sign-in)
PW_CHROMIUM=/opt/pw-browsers/chromium npm run e2e   # walkthrough; PW_CHROMIUM only in the cloud sandbox
```

Tests: 551 vitest (99% statements, 95% branches), 5 Playwright walkthroughs
(sample email; sample orders export; sample seed inbox check; sample canary;
sample schedule). The scheduled job runs against an in-memory copy of the
job_* functions (`test/job.test.ts`, MemJob), including a simulated week of
10-minute runs (one weekly canary, seven daily), the alert cap and dedupe,
and the digest timing. Migrations 0001 to 0005 were applied twice to a
throwaway local Postgres 16 with an auth stub on day 5, and the job_*
functions exercised as two users and anon (claim once per slot, busy and
limit, foreign tokens see only their own tag, caps, dedupe, unsubscribe,
job_config pinning, the disconnect trigger, column grants).
Netlify's own bundler (@netlify/zip-it-and-ship-it, listFunctions with
parseISC) reads `canary-run` as a v2 function with schedule `*/10 * * * *`.
The Shopify client runs against a scripted Admin API (`test/shopify-fake.ts`:
token endpoint, products, draft orders, orders paging). Test fixtures must
never look like real Shopify secrets (`shpss_`/`shpat_` prefixes): GitHub
push protection rejects the push (day 4). The IMAP
client and Gmail logic run against a scripted Gmail session
(`test/gmail-fake.ts`); this sandbox cannot open IMAP connections, so the
live path is unproven until a real seed account is checked.
Migrations 0001 to 0004 were applied twice (idempotent) to a throwaway
local Postgres 16 with an auth stub on day 4, and the shop_connections
grants, both definer functions, the canary limits (5 a day not counting
refused ones; none while one is placing or unknown; PT409/PT429) and the
shopify_calls limit exercised as two users and anon.
Migration 0003 was also applied to a throwaway local Postgres 16 with a
Supabase-like auth stub (roles anon/authenticated, auth.uid()) and its
grants, definer functions and both rate limits exercised (day 3).
Live checks:
- `curl -s https://delivery-canary.hintwise.org/ | grep -c "Want something like this"` prints 1 (footer);
- `curl -s https://delivery-canary.hintwise.org/api/health` prints `{"ok":true,"status":"ok","seedKeep":true,"scheduleLastRun":"<ISO>","jobTokenSha256":"<hex>"}` (seedKeep false means DELIVERY_CANARY_KEY did not reach the function; scheduleLastRun null more than 10 minutes after a deploy means the Scheduled Function is not running; it is cached a minute);
- `curl -s -X POST https://delivery-canary.hintwise.org/api/schedule -d '{}'` answers 401;
- `curl -s https://delivery-canary.hintwise.org/api/unsubscribe/u1.bad` answers 400 with the "This link does not work" page;
- `curl -s https://delivery-canary.hintwise.org/api/seed-reach` prints `{"gmailImap":true}`;
- `curl -s -X POST https://delivery-canary.hintwise.org/api/seed-check -d '{}'` answers 401;
- `curl -s -X POST https://delivery-canary.hintwise.org/api/link-check -d '{"url":"https://example.com"}'` answers 401 (sign-in required).
- `curl -s -X POST https://delivery-canary.hintwise.org/api/shopify/connect -d '{}'` answers 401.

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
  Migration `0004_shopify_canary.sql` (day 4): `shop_connections` (one per
  shop: myshopify domain, client ID, scopes, shop name, `canary_email`,
  sealed `secret`; column SELECT without `secret`, DELETE; writes only
  through definer `shop_connection_save(shop, domain, client_id, secret,
  scopes, shop_name, canary_email)`; the function reads it through definer
  `shop_connection_secret(shop)`), `shopify_calls` (rate-limit log: 60 Admin
  API requests an hour per user), `canary_orders` (variant, status placing |
  placed | failed | unknown | arrived | no-email, order id and name, placed
  and arrived times, transit seconds, placement, seed_where, check_id,
  error; inserted by the function, insert trigger resets the outcome
  fields, 5 a day per user not counting failed, none while the shop's last
  is placing or unknown and under 10 minutes old (PT409), 500 kept; the
  page updates status and outcome columns only).
- Functions `POST /api/shopify/{connect,products,orders,canary}`
  (`src/server/shopapi.ts`, client in `shopify.ts`): Admin API 2026-10,
  only `<name>.myshopify.com` hosts, token fetched per request (never
  kept), 8.5 s budget; the canary keeps 800 ms to record its result and
  needs 2.5 s left before completing the draft; a timeout while completing
  is recorded as "unknown", never "not placed".
- Sign-in: Google and email link (template panel, `sign-in-link`); the app
  host was added to `platform/src/signin/app-hosts.ts` in 80c3150.
- Migration `0005_schedule_alerts.sql` (day 5): `canary_schedules` (one
  per shop: enabled, cadence, UTC weekday and hour, variant, alerts,
  digest, `tag`, next/last run, last outcome, digest times; browser column
  SELECT without `tag`, DELETE; written only by definer
  `canary_schedule_save` with the user's token), `email_sends` (caps and
  dedupe, unique (shop_id, kind, dedupe); no address stored), `job_runs`
  (heartbeat by token hash, 20 kept), `job_config` (the job token's
  SHA-256 once pinned; empty now), `canary_orders.source` ('page' |
  'schedule', set by trigger). Anon gets schema USAGE and EXECUTE on the
  job_* definer functions only (claim, canary_start, canary_update,
  waiting, outcome, mail_reserve, mail_done, digest_due, unsubscribe,
  heartbeat, last_run); each takes p_token and touches only schedules whose
  tag = hex HMAC-SHA256(shop id) under it. Deleting a shop connection
  deletes its schedule (trigger).
- The job token: `jobToken(key)` = HMAC(DELIVERY_CANARY_KEY,
  'delivery-canary/job/v1') in `secretbox.ts`; never logged, only in POST
  bodies. Unsubscribe tokens are a separate HMAC of the shop id.
- Netlify Scheduled Function `canary-run` (`src/server/scheduled.ts`,
  `job.ts`; `scripts/build-function.mjs` writes a literal wrapper
  `canary-run.mjs` with `config.schedule` and bundles `job.mjs`): 25 s
  budget of Netlify's 30 s; looks first, then claims, then digests, then the
  heartbeat.
- LLM: none. Email: Resend from the Scheduled Function only (RESEND_API
  through target.yml envPassthrough), sender `Delivery Canary
  <delivery-canary@hintwise.org>`, Reply-To support@hintwise.org,
  List-Unsubscribe and List-Unsubscribe-Post; caps 4 a day per user and 300
  a day for the app, in SQL.
- Shopify: the shop's own Dev Dashboard app; no HintWise Partner account,
  no Shopify secret of ours. Files: none (the orders CSV is
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

- 2026-11-15: the client credentials grant (Shopify's route since legacy
  custom apps ended on 1 Jan 2026): the shop pastes client ID and secret;
  tokens last 24 hours, so the function fetches one per request and keeps
  none. Shopify's own-organization custom apps get protected customer data
  access by default; the app still never asks for customer fields.
- 2026-11-15: connecting refuses an app with scopes beyond read_orders,
  write_draft_orders, read_products (and the implied read_draft_orders), so
  a leaked secret could do no more than this app does.
- 2026-11-15 (security review): the canary's address is sealed with the
  client secret at connect time; a stolen session could otherwise point the
  seed inbox at its own mailbox and receive free downloads. Canary items
  must need no shipping, not just cost 0.
- 2026-11-15 (code review): a canary whose completion timed out is
  "unknown" (the order may exist), blocks another canary for 10 minutes,
  and the page tells the owner to look in Shopify; refused canaries do not
  count against the 5 a day; the orders scan leaves out canaries; product
  search uses the products query with `title:word*` (variant titles are
  usually "Default Title"); every seed look gets a fresh session token.
- 2026-11-15: the page, not the server, waits for the email: a function
  has 10 seconds, the wait is up to 9 minutes. The scheduled run
  (milestone 5) will do the same looks from a scheduled function.

- 2026-11-16: the scheduled job proves itself with an HMAC of the key
  checked against a per-schedule tag, not the service-role key (the app
  never gets it) and not a stored user refresh token (sharing one with the
  browser session would trip Supabase's refresh-token reuse detection and
  sign the owner out; it would also be a full session for every HintWise
  app).
- 2026-11-16: the canary is placed on one run and looked for on the next
  ones (a scheduled function has 30 seconds; delivery takes minutes);
  transit time comes from Gmail's INTERNALDATE, so the 10-minute gap does
  not blur it. "No email" after 40 minutes.
- 2026-11-16: a claim moves next_run_at on from now, so a missed run is
  never made up in a burst; a slot that finds another canary unresolved
  retries 15 minutes later (code review).
- 2026-11-16: Promotions is not an alert (receipts often land there) but
  is in the digest and the table.
- 2026-11-16: the schedule's wrapper file is hand-written so Netlify reads
  `export const config = { schedule }` as a literal (checked with
  zip-it-and-ship-it); job.mjs is the bundle.
- 2026-11-16: in half-hour time zones the UTC hour rounds down on save and
  up on display, so the form never drifts; the canary then runs half an
  hour early (UI test review).
- 2026-11-16 (security review): alert email only to a confirmed,
  non-anonymous address; dedupe keys are per shop; the job's link test
  gets 5 s, not 8.

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
- `productVariants(query: "title:*word*")` for product search: matches the
  variant's own title ("Default Title") and Shopify has no leading
  wildcard, so it found nothing (code review).
- Using the seed inbox's current address for canaries: a session alone
  could change it (security review).
- One global (kind, dedupe) key for email sends: a user with a made-up job
  token could pre-empt another shop's alert by guessing its key (security
  review); keys are per shop now.
- Refusing new heartbeat rows once 20 exist: junk tokens could lock the
  real job out (code review); the stalest rows are evicted instead.
- Gmail API for the seed mailbox: gmail.readonly is a restricted scope
  needing Google verification on the shared HintWise client, a shared
  setting; IMAP with an app password on the shop's own seed account is
  planned instead (open question 3).

## Open questions for the owner

6. (day 5) Security review, medium: until the database knows the real job
   token, a signed-in user can tag their own schedule with a token they
   made up and call the job_* functions for their own shop. That never
   reaches another user's data or sends mail (only our function sends),
   but many such accounts could fill the app-wide cap of 300 alert
   reservations a day and so delay real alerts. Fix, built in today:
   `job_config` holds the SHA-256 of the real token, and the live
   `/api/health` shows it (`jobTokenSha256`, not secret). Recommendation:
   tomorrow's build adds migration 0006 inserting that hash (one row), which
   makes every other token fail. Default: day 6 does it with its deploy;
   nothing for the owner to do.

**Answered by the owner, 15 Nov 2026 (Lisbon ~11:55, in the Plabs session):** questions 4 and 5: "skip them, continue build on Delivery Canary". No live Shopify or seed-inbox test before the remaining milestones; build on, and treat the first real report as a bug to fix.

5. (day 4) The Shopify connection and canary are tested against a scripted
   Admin API only. Recommendation: when convenient, in a development store
   of the same Shopify organization, create the Dev Dashboard app (steps in
   the card's "How to connect"), connect it, set a cheap download product
   as the canary and place one; tell the build session what the card says.
   Default: milestone 5 goes ahead and the first real report is treated as a
   bug to fix. (One risk to confirm: whether the shop's delivery app sends
   its email for orders made from draft orders; the card says so when no
   email arrives.)

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

- Milestones 6 and 7 (PLAN.md). Day 6 (polish) first: migration
  `0006_job_token.sql` with `insert into app_delivery_canary.job_config
  (token_sha256) values ('<jobTokenSha256 from /api/health>') on conflict
  (id) do update set token_sha256 = excluded.token_sha256;` (open question
  6; the live hash on 16 Nov was 136d9c79...82d0f8, see Deploy run 184
  below). After its deploy, confirm `scheduleLastRun` still moves (a wrong
  hash would make every job call fail). Then the polish list below.
- Schedule known limits: one serial queue per run (a shop whose download
  link is slow costs up to 5 s of the 25 s; no per-user fairness yet); a
  scheduled canary left 'placed' more than a day (job down) drops out of
  the looks without a "no email" alert; an alert whose send fails twice is
  lost (the canary is settled); the platform's global email opt-out list
  is not checked (its check needs the service role), only this app's own
  unsubscribe; DST shifts a schedule by an hour until it is saved again.
- First real run unproven: the Scheduled Function, IMAP and Shopify paths
  have never run against a real shop or seed inbox (open questions 4 and 5
  answered "build on").
- Canary known limits: completion timeouts leave status "unknown" with no
  automatic lookup by tag (the owner looks in Shopify); the page must stay
  open for the 9-minute wait (or use "Look for its email now" later);
  variant search shows up to 5 variants of 10 products.
- Deploy run 184 (day 5, commit 0efebfc): migration 0005 applied,
  check-schema passed with advisor warnings by design ("Public Can Execute
  SECURITY DEFINER Function" for the 11 job_* functions: each takes the job
  token and touches only schedules tagged with it; plus the five
  signed-in definer functions as before). RESEND_API forwarded. The
  Scheduled Function ran on its own at 11:30:24 UTC (`scheduleLastRun`), so
  Netlify registered it: first Scheduled Function with this runner works.
  Live job token hash for migration 0006: `jobTokenSha256` =
  136d9c797f35161b6fb0f2e1aefe504106844e7ec45875e3a73d6e736482d0f8 (re-read
  it from /api/health before writing 0006). Live: /api/schedule 401 signed
  out, /api/unsubscribe/u1.bad and a malformed %-link 400 with the CSP
  page, footer present, the signed-out sample schedule checked in a browser
  (8 weeks, no page errors).
- Deploy run 182 (day 4): migration 0004 applied, check-schema passed
  with four advisor warnings by design (signed-in users can execute the
  definer functions seed_inbox_save, seed_inbox_secret,
  shop_connection_save, shop_connection_secret; each checks auth.uid() and
  the shop's owner itself). Live: the four /api/shopify/* routes answer 401
  signed out; the signed-out sample canary verified in a browser (no page
  errors); health `seedKeep: true`.
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
- `src/server/shopify.ts` (Admin API client: token, scopes, products,
  canary draft order, orders), `shopapi.ts` (routes); `src/core/canary.ts`
  (variant IDs, wait schedule, transit text); `src/ui/shopify.ts` (the
  card), `shopclient.ts`; `test/shopify-fake.ts` (scripted Admin API).
- `src/ui/app.ts` (the page), `report.ts`, `linkclient.ts`, `dom.ts`;
  `src/store/stores.ts` (shops, checks with summaries).
- `src/core/schedule.ts` (next slot, UTC conversion, trend); `src/server/job.ts`
  (the scheduled run), `jobrest.ts` (job_* calls), `mail.ts` (alert, digest,
  Resend), `schedapi.ts` (/api/schedule, /api/unsubscribe), `scheduled.ts`
  (entry); `src/ui/schedule.ts` (the card); tests `test/job.test.ts`
  (MemJob), `schedapi.test.ts`, `schedule-ui.test.ts`.
- `supabase/migrations/0001_init.sql`, `0002_order_scans.sql`, `0003_seed_inbox.sql`, `0004_shopify_canary.sql`, `0005_schedule_alerts.sql`; `deploy/target.yml`;
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
- Day 4 (2026-11-15): milestone 4, canary orders from Shopify (the shop's
  own Dev Dashboard app, client credentials grant, sealed secret and canary
  address, free tagged draft order, timed seed inbox looks, orders from the
  Admin API, migration 0004); code review (10) and security review (1
  medium, 1 low) fixed; deployed.
- Day 5 (2026-11-16): milestone 5, scheduled canaries and alerts (the
  canary-run Scheduled Function, key-proved job_* functions, Resend alerts
  and digest with one-click unsubscribe, the 8-week table, migration 0005);
  code review (10) and security review (1 medium, 5 low) fixed; deployed
  (run 184).
