# HintWise platform: Supabase, sign-in, LLM gateway

The shared infrastructure every weekly build can use. Owner decisions of
9 November 2026: one substantial project per week instead of one small app a
day; reuse and restructure the existing Supabase project; Google sign-in plus
magic link (email through Resend); LLM features either with the visitor's own
key or with the owner's key behind caps, with usage reported to the owner.
Netlify, Render, Supabase and Resend accounts are paid (owner, 10 Nov); the
usual architecture, need by need, is the table in BUILD_ROUTINE.md. The project found on 9 Nov
is shared with live apps, so every platform change is additive (section 1).

Admin tasks run from the **Supabase admin** GitHub Actions workflow
(`.github/workflows/supabase-admin.yml`, script `platform/supabase-admin.mjs`),
which holds the repo secrets `SUPABASE_ACCESS_TOKEN`, `SUPABASE_URL`,
`SUPABASE_DB_PASSWORD`, `SUPABASE_SERVICE_ROLE_KEY` (owner added them 9 Nov).
No cloud session holds them; the script prints names and booleans, never
values.

## 1. One Supabase project, one schema per app

- Project: `arktxlrlyceffyozdwhq` (`https://arktxlrlyceffyozdwhq.supabase.co`),
  named `upvoteme`, region us-east-1, Postgres 17. `inspect` on 9 Nov found it
  **shared with live apps**: UpvoteMe's tables in `public` (Account, Comment,
  Topic, Vote and the other NextAuth/Prisma tables), a quiz app in `public`
  (questions, answer_keys, attempts, quizzes, leaderboard, profiles),
  `public.chess_kv` (17 MB), and the `wcv` schema of the WCV Live Together
  community app (event signups, maintenance requests, posts), with storage
  buckets `deploy`, `upvoteme-files` and four `wcv-*` buckets; 13 auth users,
  none active in 30 days; Google sign-in on a different Google client
  (`989071206831-`), no custom SMTP, email limit 2 an hour, site URL
  how-of-happiness.netlify.app. **The restructure therefore adds and never
  removes:** every existing table, bucket and auth setting stays until the
  owner says otherwise.
- Shared platform tables live in their own schema `platform` (not `public`,
  which already has a `profiles` table). Each app owns a schema named
  `app_<slug with _>` (donation-receipts -> `app_donation_receipts`): dropping
  the schema retires the app, names never collide, and the browser client
  selects it with `createClient(url, anon, { db: { schema: 'app_x' } })`.
  A schema is reachable through the Data API only once it is listed in the
  PostgREST `db_schema` setting, a comma-separated string (today
  `public,graphql_public,wcv`); `expose-schema app_x` appends to it, then waits
  until the Data API serves the schema and sends the list once more if it does
  not (on 10 Nov PostgREST kept the old list for 25 minutes until then;
  `expose-schema app_x --reapply` does it by hand).
- Every app table has `user_id uuid not null default auth.uid() references
  auth.users(id) on delete cascade`, row level security on, and policies
  `using (user_id = auth.uid())` for select/insert/update/delete. `grant usage
  on schema app_x to authenticated; grant all on all tables in schema app_x to
  authenticated;` plus a default privileges line. Anonymous visitors get no
  grants in app schemas.
- Shared tables (`platform/supabase/shared/*.sql`, schema `platform`, exposed
  through PostgREST like an app schema):
  - `platform.profiles (id uuid pk references auth.users, email, display_name,
    created_at)`, created by `platform.ensure_profile()`, which an app calls after
    sign-in (Supabase refused a trigger on `auth.users`: "must be owner of
    relation users", 9 Nov); readable by its owner.
  - `platform.llm_apps (slug pk, enabled, default_model, allowed_models text[],
    cap_day_usd, cap_week_usd, cap_month_usd, cap_user_day_usd, max_tokens,
    created_at)`: one row per app that uses the gateway; the owner changes
    caps with SQL.
  - `platform.llm_usage (id, app, user_id, model, input_tokens, output_tokens,
    cache_read_tokens, cache_write_tokens, cost_usd numeric, ok, error,
    created_at)`: the ledger, written only by the gateway (service role),
    readable by nobody from the browser.
  - `platform.migrations (app, file, sha256, applied_at)`: which migration
    files have run (app `platform` for the shared SQL itself).
- Migrations live in `<slug>/supabase/migrations/NNNN_<name>.sql` and are
  applied in file order by `node platform/supabase-admin.mjs migrate <slug>`
  through the Management API query endpoint (works from IPv4 GitHub runners,
  needs no database password), each recorded in `platform.migrations`. The
  Deploy workflow runs it for every app whose `deploy/target.yml` has
  `supabase: true`, before the Netlify deploy, then `check-schema
  app_<slug_>` (read-only; since 10 Nov): row level security on every
  table, no anon table access, security definer functions with a fixed
  search_path, a signed-in stranger sees no real row, and Supabase's security
  advisor; a finding fails the deploy. Write migrations idempotently
  (`create table if not exists`, `create or replace function`) so a re-run is
  harmless.
- Public client values (URL and anon key) are public by design and live in
  `platform/supabase.json`; an app's Vite build reads them as
  `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (set in `target.yml` `env`).
  The service-role key stays in GitHub secrets and is used only by the usage
  report job.

## 2. Sign-in: Google and magic link, one account for every app

- Supabase Auth with one user pool: a visitor who signs in on one HintWise app
  is known to all of them (same `auth.uid()`), which is also why app data sits
  in per-app schemas rather than per-app projects.
- Providers: **Google**, today through the project's existing client
  (`989071206831-`); to use the HintWise Google Cloud client (ID starts
  `985338662899-`, docs/google-oauth.md) it needs the authorized redirect URI
  `https://arktxlrlyceffyozdwhq.supabase.co/auth/v1/callback` (owner action). **Magic link**: the email provider with a sign-in link, sent
  through Resend's SMTP (`smtp.resend.com`, port 465, user `resend`, password
  the Resend API key, sender `sign-in@hintwise.org`, name `HintWise`).
  Passwords are not offered.
- Auth settings (set by `configure-auth`, PATCH `/v1/projects/{ref}/config/auth`),
  **additive because live apps share the project**: `uri_allow_list` keeps its
  four entries and gains `https://*.hintwise.org/**` (one subdomain label and
  any path; the apex is not matched and is not needed); `site_url` stays
  how-of-happiness.netlify.app until the owner moves that app (every app passes
  its own `redirectTo`, so the site URL only matters as a fallback);
  `external_email_enabled` is already true and `mailer_autoconfirm` false; the
  SMTP fields above are added (they lift the email limit from 2 to 30 an hour,
  `rate_limit_email_sent`, which `configure-auth` sets to 30). The Google
  client is **not** switched by default: the project signs in through client
  `989071206831-`; moving to the HintWise client (`985338662899-`) keeps the
  same Google identities (Google's `sub` is the same for every client) but is
  the owner's call, taken with `configure-auth --google` after the callback
  URI is on the HintWise client.
- In an app: `supabase.auth.signInWithOAuth({ provider: 'google', options:
  { redirectTo: location.origin + location.pathname } })`, and for email the
  platform's `sign-in-link` function, not `signInWithOtp` (next section; the
  template's `sendMagicLink` calls it); `onAuthStateChange` drives the UI.
  The shared template in `platform/templates/app/` has the sign-in panel,
  with a Google button that follows Google's branding guidelines
  (BUILD_ROUTINE.md, "Google sign-in button").
- **Google sign-in goes through Supabase** (owner, 9 Nov): the browser goes
  to Supabase, then Google, then Supabase's callback, then back to the app.
  No per-app Google setup: one callback URL on the Google client and the
  `https://*.hintwise.org/**` allow-list cover every app. The template asks
  Google for the account chooser (`prompt=select_account`) and creates the
  user's `platform.profiles` row after sign-in.
- **Custom domain** (owner will buy Supabase's add-on; delayed, 9 Nov): without it Google's
  screen says the user continues to `arktxlrlyceffyozdwhq.supabase.co`. The
  add-on serves the whole project API on a hintwise.org name (recommended
  `auth.hintwise.org`); the supabase.co address keeps working, and Auth uses
  the new name for OAuth callbacks the moment it is activated.
- Order, each step a "Supabase admin" dispatch unless marked owner:
  1. Owner, Google Cloud console, HintWise OAuth client (`985338662899-`):
     add the Authorized redirect URIs
     `https://arktxlrlyceffyozdwhq.supabase.co/auth/v1/callback` and
     `https://auth.hintwise.org/auth/v1/callback` (keep the existing ones),
     and on the consent screen set the app name HintWise with hintwise.org
     as an authorized domain.
  2. Done 9 Nov 17:34 CET. `configure-auth --google --dry-run`, then `configure-auth --google`:
     the project's Google provider moves from the older client
     (`989071206831-`) to the HintWise client. Existing Google users keep
     their accounts (same Google account id) and see a consent screen once;
     this includes WCV Live Together and how-of-happiness users.
  3. Passed 9 Nov 17:35 CET. `check-google`: starts a sign-in the way a browser does and reports the
     client, the callback URL, whether Google accepts them
     (`redirect_uri_mismatch` shows here) and where Supabase returns the
     user. No login needed; exits 1 when broken.
  4. Done 9 Nov 19:45 CET: the owner bought the custom domain add-on (name
     auth.hintwise.org).
  5. Run 9 Nov 19:49 CET (Cloudflare records created). `domain-setup auth.hintwise.org`: starts the hostname, creates its DNS
     records in Cloudflare (CNAME to `arktxlrlyceffyozdwhq.supabase.co`, DNS
     only, plus the TXT records Supabase lists) and asks Supabase to verify;
     `domain-status` until it reads `4_origin_setup_completed`.
  6. Done 9 Nov 20:04 CET (verified 20:03, status `5_services_reconfigured`).
     `domain-activate --callbacks-ready` (only after step 1's second URI),
     then `check-google --base=https://auth.hintwise.org` (passed 20:05 CET:
     Google is asked to return to `https://auth.hintwise.org/auth/v1/callback`
     through either address, and accepts it).
  7. Done 9 Nov. `url` in `platform/supabase.json` is `https://auth.hintwise.org` so
     new builds use it (and `keys` now writes it while the domain is active);
     apps already built keep working on the old address. The repo secret
     `SUPABASE_URL` stays the supabase.co address: the admin workflow reads the
     project ref from it.
- Branding: a verified Google consent screen also shows the HintWise name and
  logo instead of a domain; that verification is a separate Google review.

## Sign-in links and abuse limits

Approved by the owner on 10 Nov 2026 and revised after a security review the
same day. Built on branch `feat/sign-in-link`; nothing is deployed until the
steps below run.

Supabase's own magic-link limits are coarse: a fixed 60 seconds per
address, a per-IP limit and 200 emails an hour for the whole project, with
no escalation and no alerts. Sign-in links therefore go through the edge
function `sign-in-link` (public, `verify_jwt = false`, CORS only for the
pages of deployed apps). The contract is `platform/src/signin/README.md`. In
short:

- **Request.** `POST <url>/functions/v1/sign-in-link`, JSON body
  `{ email, redirectTo, app, browserId, turnstileToken? }`.
  - `redirectTo` must be a page of an allowed app: a label in
    `platform/src/signin/app-hosts.ts` (generated from the apps' `target.yml`
    by `npm run app-hosts` in `platform/`), or one of the external apps
    (`stepwise`). Never `auth` or another non-app name.
  - Only its origin and path are kept.
  - `browserId` is a random id kept in localStorage `hintwise.browserId`, a
    soft signal.
- **Answers.**
  - `{status:'sent'}` (200).
  - `{status:'suppressed', message}` (200): the address turned HintWise
    email off (next section).
  - `{status:'wait', retryAt}` (429, ISO time).
  - `{status:'challenge', siteKey, failed?}` (403).
  - `{status:'error', message}`.
- **Keys.**
  - The address counts as its canonical mailbox: no `+tag`, and Gmail dots
    and googlemail.com folded. The email still goes to the address as typed.
  - The IP counts by network: IPv4 as it is, IPv6 by its /64. It is read
    from `cf-connecting-ip` when that header is there, else the right-most
    `x-forwarded-for` entry. To be checked live after the deploy.
  - The IP is `unknown` when it does not parse as an address, or when it is
    private, loopback, link-local, CGNAT, reserved or one of Cloudflare's
    published proxy ranges. The list is hard-coded in
    `platform/src/signin/keys.ts`, dated 10 Nov.
- **Ladder per address and per browser.** The wait between links is 1, 3,
  5, 8, 13 and 21 minutes, then the sum of the previous two (34, 55, 89, ...),
  capped at 24 h. Only links since the key's last quiet day count: 24 h
  without any counted request resets it. Invalid and refused requests never
  count toward a ladder or a day count.
- **Per IP.**
  - Lenient, because classrooms and offices share an IP: 20 requests an
    hour pass freely, and above that the challenge is required.
  - Above 100 an hour from one known network, the answer is a wait and no
    row is written. An unknown IP has no hard limit, since all unknown
    requests share one key; it gets the challenge instead.
- **Challenge.** A Cloudflare Turnstile check is required when any of these
  holds:
  - the 10th request in 24 h for one address or one browser;
  - above 20 an hour from one IP network;
  - an unknown IP;
  - more than 100 links sent project-wide in the last hour, a brake that
    applies to every request.

  The widget covers hintwise.org and digital-student-assistant.com; it was
  created by the owner on 10 Nov. Its public site key is
  `platform/supabase.json` `turnstileSiteKey`. The secret is the repo secret
  `TURNSTILE_SECRET_KEY`, set as the function secret `TURNSTILE_SECRET`.

  A token passes only with action `sign-in` on a hintwise.org host. Without
  the secret, a due challenge pauses email sign-in (503 "Email sign-in is
  paused; try Google"); it never sends unchecked.
- **The link.** Auth's admin `generate_link` makes the token; for a
  first-time address GoTrue turns the magic link into a sign-up and creates
  the user. The email, from `HintWise <sign-in@hintwise.org>` through
  Resend, links to the app's own page with
  `?token_hash=<hash>&type=email&email_hint=<a***@example.com>`.

  The app calls `supabase.auth.verifyOtp({ token_hash, type: 'email' })`,
  which works in any browser. The template ignores an `email_hint` of the
  wrong shape. When another account is signed in, it asks "Switch to
  a***@example.com?" first. When the signed-in account has the same masked
  address, it says "Already signed in as a***@example.com" and offers "Use
  the link instead", since masks collide.
- **Log.** Every request is a row in `platform.sign_in_requests`: hashed
  keys (HMAC-SHA256 under the function secret `SIGN_IN_HASH_KEY`), app,
  outcome, detail. Rows are kept 30 days. Only the service role touches it,
  through RPCs in `platform/supabase/shared/0002_sign_in.sql`.
- **Alerts.** These go to `ADMIN_EMAIL` from `builder@hintwise.org`, at most
  one per kind an hour. They fire when:
  - one IP or browser asks for 5 or more addresses in an hour;
  - one address is asked for 5 or more times in an hour;
  - 3 or more checks fail from one IP in an hour;
  - the hook refuses an email;
  - more than 100 links go out in an hour.
- **Closing the side door.** Supabase's Send Email hook, the function
  `auth-email-hook`, takes every auth email once it is switched on.
  - Magic links, sign-ups, sign-in codes and password recovery are sent only
    for the apps outside HintWise on this project, the hosts in
    `HOOK_EXTERNAL_HOSTS`. That list is computed from the auth redirect
    allow-list and site URL by `set-sign-in-secrets`; rerun it after
    changing the allow-list.
  - The same four for a hintwise.org page or an unknown host are refused
    with 403 "Use the HintWise sign-in-link service", logged, and raise the
    bypass alert. HintWise apps send them through sign-in-link.
  - Invite, email change (both messages), reauthentication and account
    notices are sent for every host.
  - Everything the hook sends goes through the same per-address ladder. A
    due wait refuses it.

  **Switching it on changes every app on the shared project.** Every email
  is laddered. qualified-overtime-checker, whose
  `src/lib/auth.ts` still calls `signInWithOtp` (10 Nov), loses its email
  sign-in until it moves to `sign-in-link`.

  `email-hook check` lists every app in this repo that still calls
  `signInWithOtp`, `signUp` or `resend`. `email-hook on` refuses while there
  is one, unless given `--allow-otp-apps`, and refuses with an empty
  `HOOK_EXTERNAL_HOSTS` unless given `--accept-external-breakage`. It also
  prints which types are refused or sent for which hosts.

Deployment order, each step a "Supabase admin" dispatch:

1. `apply-shared`, which runs `0002_sign_in.sql`.
2. `check-schema platform`.
3. `deploy-function sign-in-link`.
4. `deploy-function auth-email-hook`.
5. `external-hosts`, to read the list first, then `set-sign-in-secrets`.
6. After the owner's yes: `email-hook check`, then `email-hook on --dry-run`,
   then `email-hook on`. This sets `hook_send_email_enabled`,
   `hook_send_email_uri` and `hook_send_email_secrets` in the auth config,
   with the same fresh secret as the function. `email-hook off` switches the
   hook off again.

## Email footer, logo and opt-out

Owner decisions of 11 Nov 2026; built on branch `feat/email-footer-optout`.
The contract is `platform/src/signin/README.md`.

- **Every email** (sign-in-link and auth-email-hook) has Reply-To
  `support@hintwise.org` and a header: the logo
  (`hintwise-wordmark-email@2x.png` at 100x28, alt "HintWise") from the one
  setting `EMAIL_LOGO_URL`, or the text wordmark "HintWise" in deep indigo
  `#312E81`, bold, 18px. The button and links are deep indigo, lightened
  in dark mode; coral stays in the logo.
- **Footer** of every visitor email, text and HTML: why this address got it
  (per type), "Questions or trouble signing in? support@hintwise.org (or
  just reply).", "HintWise builds tools for small businesses, startups and
  educators. More apps: studio.hintwise.org", and "Stop all email from
  HintWise (sign-in links too)". No postal address (owner): every
  HintWise email is transactional, app-notify included (only what the
  person opted into about the app they use, never promotion as its
  purpose). Promotional email would first need a PO box in the footer
  (CAN-SPAM).
- **Opt-out, level 2 (global), built now.** The footer link goes to the
  `email-optout` function on `https://auth.hintwise.org/functions/v1/email-optout`
  (the custom domain: Supabase serves HTML from functions only there, see
  [its limits page](https://supabase.com/docs/guides/functions/limits)).
  - The footer's token, `v1.<mailbox hash>.<HMAC under EMAIL_OPTOUT_SECRET>`,
    can only stop email and never expires; no address in the URL.
  - GET only asks (mail scanners open links); the confirm button POSTs, then
    "Done" with an Undo button. Undo carries its own token, signed for undo
    only, that expires after an hour. No JavaScript needed.
  - The list, `platform.email_optouts`, holds the keyed hash of the
    canonical mailbox and a scope (`all`); level 1 (per app, `app:<slug>`)
    comes with the app-notify sender (see "App-notify", built on
    `feat/app-notify`, not deployed).
  - sign-in-link answers `suppressed` instead of sending. auth-email-hook
    sends nothing to the address: sign-in emails and notices are answered as
    sent (so a recovery request does not reveal the opt-out, and a notice
    never fails a change), invite, reauthentication and email change are
    refused. So an opted-out user cannot change their account's email
    address until email is back on.
  - Support: `email-optout status|add|remove` with the address in the
    workflow's `email` input, masked in the log, which shows only the
    action, the time and the hash prefix. `add` on any request. `remove`
    only on a request sent from that address that passes DMARC, or after a
    confirming reply from it. The suppressed messages say "write to
    support@hintwise.org from this address".
- **Brand files.** `brand-upload` puts the PNGs and `favicon.ico` of
  `platform/brand` (no SVG: a public SVG can run script on
  auth.hintwise.org) in the public Storage bucket `brand` with a one-day
  cache, so a changed image takes up to a day to show. The logo is
  `https://auth.hintwise.org/storage/v1/object/public/brand/hintwise-wordmark-email@2x.png`.
- **Where the opt-out does not hold (fail open).**
  - `email-hook off`: Auth sends its own emails again, without the hook,
    and ignores the list (sign-in-link still checks it).
  - Rotating `SIGN_IN_HASH_KEY` or `EMAIL_OPTOUT_SECRET` silently drops
    every opt-out (the list is keyed by the hash) and breaks every stop
    link already sent. Never rotate them without migrating the table; the
    addresses are not stored, so in practice never.
  - Aliases the canonical mailbox does not fold (Yahoo `-` addresses,
    Fastmail subdomains, iCloud aliases) are separate addresses.
- **Failing closed.** Without 0003, sign-in-link and auth-email-hook send
  no email at all, so `deploy-function` refuses to deploy them until
  `optout-ready` sees `platform.email_optout_check` answer.

Ship order, each a "Supabase admin" dispatch after the owner's yes:

1. `apply-shared` (runs `0003_email_optout.sql`), then
   `check-schema platform`. First: without the table, both functions
   send nothing (and the deploy guard refuses them).
2. `brand-upload`: it prints `EMAIL_LOGO_URL=` once the logo is served.
3. `set-sign-in-secrets`: generates `EMAIL_OPTOUT_SECRET` once and sets
   `EMAIL_LOGO_URL`.
4. `deploy-function email-optout`, then `deploy-function sign-in-link`,
   then `deploy-function auth-email-hook`.
5. `email-hook check`.

## App-notify

**Status: not applied, not deployed. It waits for the owner's yes.** The
owner approved the design on 10 and 11 Nov 2026, and it was built on branch
`feat/app-notify` (13 Nov). The contract and the full details are in
`platform/src/notify/README.md`.

- **What it does.** A daily edge function, `app-notify`, handles each
  registered app. It reads the app's public feed
  (`https://<slug>.hintwise.org/releases.json`, shaped as `{ app, items: [{
  id, title, url, date, summary }] }` with stable ids) and the app's opt-in
  rows. Then it emails each opted-in person the items they have not been
  sent yet. Several items go out bundled in one email, and nobody gets more
  than one email per app per day (UTC). Each run sends at most 200 emails.
- **Email.** It comes from `<App name> <<slug>@hintwise.org>` with Reply-To
  `support@hintwise.org`, and has the same header and footer as the other
  emails. The footer has two links: "Turn off <App> emails" (per app) and
  "Stop all email from HintWise". The email also carries the headers
  `List-Unsubscribe` (an https link and `mailto:support@hintwise.org`) and
  `List-Unsubscribe-Post: List-Unsubscribe=One-Click` (RFC 8058). It is
  transactional, so it has no postal address.
- **Opt-out level 1, per app.** It uses scope `app:<slug>` in
  `platform.email_optouts`. The token versions `a1` (stop) and `w1` (undo,
  one hour) carry the slug in the signed text, so a token for one app
  cannot stop another, and a token for one scope cannot be used for another
  scope. `email-optout` handles them alongside the unchanged `v1`/`u1`
  pages, and accepts the one-click POST only for `a1`. A person who opted
  out of `all` or out of `app:<slug>` is skipped.
- **Registry.** `platform.notify_apps` (`0011_app_notify.sql`) holds the
  slug, the display name and the feed URL (https on the app's own host
  only). It also names where the opt-in flag lives: a table in the app's own
  schema `app_<slug>`, a uuid user column and a boolean flag column. These
  identifiers are limited by regex check constraints and quoted with
  `format('%I')` in `platform.notify_opted_in`. Only the Supabase admin
  writes the registry; the service role reads it and sets `seeded_at`. The
  app grants `service_role` `select` on its opt-in table. StepWise's entry
  will be `app_stepwise.preferences` with the flag `notify_new_pages`.
- **First run.** The first run after an app is enabled only records what is
  already in the feed (seed). Only items first seen after that are emailed,
  and only within 14 days.
- **Records.** `platform.notify_items_seen` stores each item id and when it
  was first seen. `platform.notify_sends` has one row per person, app and
  day, holding the item ids, the status and Resend's id or the error.
- **Caller.** The function has `verify_jwt = false` and requires the header
  `x-app-notify-secret` (`APP_NOTIFY_SECRET`, at least 32 characters,
  checked in constant time). The anon key is public, and the service-role
  key does not belong in a scheduler.
- **Feeds.** Each feed is fetched with a 10 s timeout and a 256 KB cap.
  Redirects are followed only on the app's own host, and at most 100 items
  are read. Titles and summaries are cleaned to one line and escaped in the
  HTML.

Ship order, each step a "Supabase admin" dispatch after the owner's yes:

1. `apply-shared` (`0011_app_notify.sql`), then `check-schema platform`.
2. Set the function secret `APP_NOTIFY_SECRET`, generated once.
   `set-sign-in-secrets` does not set it yet.
3. `deploy-function app-notify`.
4. `deploy-function email-optout` (per-app pages and one-click).
5. Register the app with SQL (in `platform/src/notify/README.md`). Then run
   once with `{"dryRun": true}`, and once for real, which only seeds.
6. Later, schedule it daily with pg_cron and pg_net.

## Account deletion

"Delete my account" (platform/templates/app/src/lib/account.ts, shown by
the sign-in panel under Sign out) lets a signed-in person delete their
account. The `delete-account` edge function
(platform/src/account/delete-service.ts) checks the session token, needs a
sign-in from the last 15 minutes and the word DELETE, then runs
`platform.delete_hintwise_data(uid)` (shared/0004_account_deletion.sql):

- In `platform` and every `app_%` schema, each column with a foreign key to
  `auth.users` is handled: its rows are deleted, or set to null where the key
  says `on delete set null` (`llm_usage` keeps its cost rows without the
  person). `platform.email_optouts` is kept: it holds only a keyed hash, and a
  "Stop all email" must outlive the account.
- The project is shared with apps that are not HintWise (the 11 Nov
  inventory, `queries/auth-user-references.sql`: `wcv` with 18 cascading
  columns, `public.profiles`, and `public.attempts.user_id` with no key). The
  function deletes the sign-in (Auth admin API) only when none of their tables
  refer to the person; otherwise the sign-in stays and the person is told to
  email support@hintwise.org to remove it. Columns with no foreign key are
  listed in `platform.account_soft_references`. Tables another app fills
  automatically for every sign-in (a trigger on `auth.users`) do not count:
  they are listed in `platform.account_auto_references` (0005; today
  `public.profiles`, from `public.handle_new_user`), and their rows go with
  the sign-in by cascade.
- Data a HintWise app keeps outside this project (UpvoteMe, PasteMD) is not
  covered yet.
- The log holds counts and outcomes only (an error logs its SQLSTATE code).
- Rules for app schemas: every table holding a person's rows has a foreign
  key to `auth.users(id)`, and a table that points at another app table uses
  `on delete cascade` (a `no action` key there makes the delete fail, and the
  person gets an error until it is fixed); no `force row level security`
  (the function runs as the migration role, which would then delete nothing).
- A sign-in counts as recent from the session's own `amr` timestamp, not the
  user's `last_sign_in_at`. After "data-deleted" the app signs out every
  session of the person (scope global).
- Known small race: if another app creates a row for the person between the
  check and the sign-in's removal, that row cascades away with it.

## 3. LLM calls: bring your own key, or the owner's key behind caps

Two modes, both offered by any app that uses a model; the app works without a
model wherever deterministic code does the job.

- **Bring your own key (BYOK).** The visitor pastes their Anthropic key; it is
  kept in their browser's localStorage and sent only to `api.anthropic.com`
  (the browser SDK with `dangerouslyAllowBrowser`, header
  `anthropic-dangerous-direct-browser-access: true`). Nothing reaches HintWise;
  no sign-in needed; no cost to the owner.
- **HintWise key via the gateway.** Signed-in users only (Google or magic
  link). The browser calls the Supabase Edge Function `llm-gateway`
  (`https://arktxlrlyceffyozdwhq.supabase.co/functions/v1/llm-gateway`) with the
  user's session token and a body `{ app, model?, max_tokens?, system?,
  messages, tools? }` (a subset of the Messages API). The function:
  1. checks the user (`auth.getUser`) and that `llm_apps` has an enabled row
     for `app`, and that `model` is in its `allowed_models` (default:
     `default_model`);
  2. sums `llm_usage.cost_usd` for the app over the current UTC day, ISO week
     and calendar month, for the user over the day (all apps), and for the
     user in this app over the day and week; refuses with HTTP 429 and
     `{ error: 'cap', scope: 'app-day' | 'app-week' | 'app-month' |
     'app-user-week-calls' | 'app-user-week' | 'app-user-day-calls' |
     'app-user-day' | 'user-day', resets_at }` when any cap is reached
     (since 0007 the user's successful calls in the app are counted too);
  3. calls Anthropic with the `ANTHROPIC_API_KEY` function secret,
     `max_tokens` capped at the app's `max_tokens` (default 4096), adaptive
     thinking left at the model default;
  4. writes one `llm_usage` row (tokens, cost from the pricing table below,
     ok/error) and returns the Messages API response unchanged.
  Non-streaming first; streaming with the same accounting is a later
  milestone.
- **Caps (owner, 9 Nov):** per app $2/day, $10/week, $20/month; per user
  $0.25/day (recommendation taken 9 Nov; change in `llm_apps`). Backstop: a
  monthly spend limit in the Anthropic console (owner action).
- **An app's own limits** (owner, 12 Nov: "its own limits inside the HintWise
  gateway"; "the project might have stricter limits"). Every app's row in
  `llm_apps` has its own day, week and month caps; lower them for a stricter
  app. Since `shared/0006_llm_app_user_caps.sql` an app can also cap one
  user's spend in that app alone, per UTC day (`cap_app_user_day_usd`) and per
  ISO week (`cap_app_user_week_usd`); null, the default, means no such cap.
  `cap_user_day_usd` still counts the user across all apps. The gateway sums
  them with `platform.llm_spend_app_user` and refuses with scope
  `app-user-day` or `app-user-week`. Order to ship: `apply-shared`, then
  `deploy-gateway`. Example:
  `update platform.llm_apps set cap_day_usd = 1, cap_app_user_day_usd = 0.10,
  cap_app_user_week_usd = 0.40 where slug = 'photo2pgn';`
- **Caps in readings and check mode** (owner, 13 Nov: "1 check, 2 yes 3/9").
  Since `shared/0007_llm_app_user_call_caps.sql` an app can cap one user's
  successful calls in that app per UTC day (`cap_app_user_day_calls`) and per
  ISO week (`cap_app_user_week_calls`); scopes `app-user-day-calls` and
  `app-user-week-calls`, checked before the dollar caps of the same window.
  The gateway reads sums and counts from `platform.llm_spend_and_calls`
  (the older functions stay). A body `{ app, check: true }` makes no model
  call and returns `allowance()` from `platform/src/gateway/caps.ts`: allowed,
  scope, resets_at, app_open, the person's own limits and `calls_left`.
  photo2pgn: 3 a day, 9 a week (`ops/photo2pgn-llm-caps.sql`).
- **Credits** (owner, 13 Nov: "1 yes"; `shared/0008_credits.sql`):
  `platform.credits` (balance per person per app), `platform.credit_ledger`
  (grant, purchase, spend, refund), `platform.admins`, and
  `llm_usage.paid_with_credit`. When decide() refuses on a person scope and
  the person has a credit, the gateway takes it with `credit_reserve` before
  the call and gives it back with `credit_refund` if the call fails; the app
  scopes are never skipped. The person sums in `llm_spend_and_calls` leave
  out calls paid with a credit. Admins grant with the `credits-grant`
  function (`platform/src/credits/grant.ts`); the workflow's `admin` command
  adds or removes admins. Payment (Paddle) is a later slice.
- **Default model:** `claude-opus-5-5` ($4 in, $20 out per million tokens,
  cache reads $0.20, cache writes 1.25x input), about 100 typical calls per
  $2 day. Apps may allow `claude-sonnet-5-5` ($2 / $10) or `claude-haiku-5-5`
  ($0.10 / $0.50, prompts up to 100K tokens) for bulk work. The pricing table
  is `platform/src/gateway/pricing.ts`; check it against
  https://platform.claude.com/docs/en/about-claude/pricing when a model is
  added.
- Deploying the gateway: `deploy-gateway` in the Supabase admin workflow
  (Supabase CLI via `supabase/setup-cli@v1`, `supabase functions deploy
  llm-gateway`), and `set-gateway-key` writes the `ANTHROPIC_API_KEY` function
  secret from the repo secret of the same name. The gateway's pure logic
  (caps, pricing, request validation) is in plain TypeScript modules with
  vitest tests; the Deno entry point only wires them.

## 4. Usage reporting to the owner

- `llm_usage` is the ledger. `.github/workflows/llm-usage-report.yml` runs
  `platform/llm-usage-report.mjs` daily at 9:10 Pacific (same two-cron pattern
  as daily-project-ideas' digest) with `SUPABASE_URL`,
  `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API`, `ADMIN_EMAIL`. It emails from
  `builder@hintwise.org`: on a day when any app used the owner's key, a table
  per app (yesterday, week to date, month to date, each against its cap,
  calls, distinct users, errors); every Monday a weekly summary even when
  quiet. No usage, no email, except the Monday summary.
- On demand: `usage` in the Supabase admin workflow prints the same table in
  the run log.

## 5. What a weekly build does with this

In `<slug>/deploy/target.yml`: `supabase: true` when the app has a schema
(the Deploy workflow then runs its migrations and exposes the schema), and
`env` with `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` copied from
`platform/supabase.json`. In the app:

- `supabase/migrations/0001_init.sql`: the schema, tables, RLS, grants, and an
  `insert into platform.llm_apps (slug) values ('<slug>') on conflict do
  nothing` row if the app uses the gateway.
- `src/lib/supabase.ts`, `src/lib/auth.ts`, `src/lib/llm.ts` copied from
  `platform/templates/app/` and adjusted: the client with the app's schema,
  the sign-in panel, the BYOK/gateway switch.
- A new app with email sign-in: `npm run app-hosts` in `platform/` (the
  sign-in-link allow-list, `platform/src/signin/app-hosts.ts`; CI fails
  while it is stale), commit, and `deploy-function sign-in-link` after the
  app's first deploy, or its sign-in links are refused.
- Data access behind a small repository interface with an in-memory
  implementation for tests, so vitest never touches the network; the live
  implementation uses supabase-js. A Playwright walkthrough of the main flow
  runs against `vite preview` with the in-memory repository.
- README for the business owner says what is stored, where (Supabase,
  US East), and how to delete an account: "Delete my account" under the
  sign-in panel's Sign out (section "Account deletion"). Every table holding
  a user's rows needs a foreign key to `auth.users(id)` (`on delete cascade`,
  or `set null` for rows to keep), or deletion will not find them.

## 6. Owner actions, one time

1. JWT secret: the first `inspect` run printed it in a public workflow log for
   about six minutes on 9 Nov (log deleted, script fixed). The owner decided
   not to rotate it (9 Nov). If that changes: Dashboard, Project Settings,
   API or JWT Keys, generate a new secret, then update
   `SUPABASE_SERVICE_ROLE_KEY` and the keys in every app on the project.
2. Done 9 Nov: the owner added the redirect URI
   `https://arktxlrlyceffyozdwhq.supabase.co/auth/v1/callback` to the
   HintWise OAuth client, and the project's Google sign-in moved to it.
3. Done 9 Nov: the owner set a monthly spend limit in the Anthropic console
   as the backstop behind the gateway caps.
4. Say whether anything found by `inspect` may be removed (the quiz tables,
   `chess_kv`, the `deploy` bucket); nothing is dropped without that.

## 7. Not confirmed yet

- Whether magic links need any flag beyond `external_email_enabled` (the
  project already sends email sign-in links, so probably not).
- Settled 9 Nov: the current CLI takes `--remote=<ref>` (it calls
  `--project-ref` deprecated) and needs `--yes`, or it refuses to change a
  remote project without a terminal; the workflow passes both.
- `SUPABASE_DB_PASSWORD` is unused while migrations go through the Management
  API; it stays for a future direct-connection need.

Added by the scaffolding (branch `platform-scaffold`, 9 Nov):

- Settled 9 Nov: the CLI bundles the gateway entry's imports from outside
  `supabase/functions` (`index.ts` imports `../../../src/gateway/*.ts`); the
  first deploy went through and the function answers.
- The Management API's `database/query` response for statements that are not
  a select: the script treats any HTTP 2xx as success and reads rows only
  from arrays.
- `GET /v1/projects/{ref}/api-keys`: `keys` expects `[{name, api_key, type?}]`
  and picks the `anon` or `publishable` entry; on another shape it prints the
  key names and stops. `POST /v1/projects/{ref}/secrets` is not used; the
  function secret is set with the CLI (`supabase secrets set`).
- The usage report relies on Resend's `Idempotency-Key` header (key
  `llm-usage-<UTC date>`) to make the second scheduled run of a PDT day a
  no-op; not exercised yet. The scheduled runs pass
  `--not-before-pacific-hour=9` as the digest does; a manual run sends when
  asked, and `--dry-run` renders without sending.
- Deviations from the text above, settled while building: Haiku 5.5 has no
  server-side refusal fallback (a `fallbacks` list even returns a 400), so the
  gateway sends the `server-side-fallback-2026-07-01` beta and
  `fallbacks: 'default'` only for Opus and Sonnet (one switch,
  `SERVER_SIDE_FALLBACK` in `platform/src/gateway/request.ts`). The per-user
  day sum (`user_day` in `platform.llm_spend`) counts the user's spend across
  all apps, so one account cannot drain the key by hopping between apps; the
  per-app `cap_user_day_usd` is the cap it is compared with. `authenticated`
  gets `select` on `platform.profiles` and `update (display_name)` only, so a
  user cannot change the email on their profile row. The cap check names the
  widest app window first (month, week, day), then the user's day.
  `apply-shared` re-runs a shared file whose hash changed (the shared SQL is
  idempotent by contract); `migrate` refuses a changed app migration.
  `platform.llm_usage_report(p_days)` returns one jsonb document with the
  last `p_days` UTC days before today, the ISO week to date and the month to
  date per app, plus the caps; the email and the `usage` command render it.
  The gateway's `config.toml` keeps `verify_jwt = true`: the user's session
  token passes the platform check and the function verifies the user again.
- Unknown models (one the owner adds to `allowed_models` before the pricing
  table, or a fallback model named in the response) are billed at Opus
  prices in the ledger so the caps still bind; add the model to
  `platform/src/gateway/pricing.ts` when it appears.

Added with the sign-in links (10 Nov), not exercised live yet:

- **Client IP.** The function reads `cf-connecting-ip` first, then the
  right-most `x-forwarded-for` entry (security review, 10 Nov; the design
  said the first entry, which a client can forge). Cloudflare sets
  `cf-connecting-ip` and overwrites a client's value. Proxies append to
  `X-Forwarded-For`, so the right-most entry is the last proxy's.

  To check live after the deploy (the parent session): send one request
  with a made-up `X-Forwarded-For` and check that its `ip_hash` is the same
  as an ordinary request's from the same machine (`clientIp` in
  `platform/src/signin/keys.ts`).
- **Env files.** The workflow passes secrets to `supabase secrets set
  --env-file` as `NAME='value'` lines. The CLI's dotenv parser is assumed to
  take single-quoted values literally; values with a quote or a newline are
  refused before writing.
- **First-time addresses.** `generate_link` with `type: 'magiclink'` creates
  the user. GoTrue's `adminGenerateLink` turns it into a signup; source read
  10 Nov. `verifyOtp` with `type: 'email'` accepts both the signup and the
  magic-link hash; `verify.go` was read the same day. If an Auth version
  answers "user not found", the function creates the user
  (`/auth/v1/admin/users`, `email_confirm: false`) and asks once more.
- **Hook errors.** A hook answers HTTP 200 with
  `{error: {http_code, message}}`, and Auth fails the app's request with that
  status and message (GoTrue's `hookserrors.Check`, read 10 Nov; the docs
  only show it for Postgres hooks). Other statuses reach the app as a bare
  500.
- **Function secrets.** `set-sign-in-secrets` reads the secret names from
  `GET /v1/projects/{ref}/secrets`, which `inspect` already uses. The
  secrets themselves are set with the CLI, as for the gateway.

## Files

- `platform/supabase-admin.mjs`, `.github/workflows/supabase-admin.yml`:
  admin commands (inspect, sql, apply-shared, migrate, expose-schema,
  check-schema, configure-auth, keys, usage, email-hook, brand-upload,
  email-optout) and the CLI steps deploy-function, deploy-gateway,
  set-gateway-key and set-sign-in-secrets.
- `platform/supabase/shared/0001_platform.sql`: schema `platform`;
  `0002_sign_in.sql`: the sign-in log, alerts and their RPCs;
  `0003_email_optout.sql`: the email opt-out list and its RPCs;
  `0011_app_notify.sql`: the app-notify registry, seen items and sends (not
  applied yet).
- `platform/supabase/functions/app-notify/index.ts`, `platform/src/notify/`:
  the app-notify sender and its tested logic, `platform/src/notify/README.md`
  the contract (not deployed yet).
- `platform/supabase/config.toml`, `platform/supabase/functions/llm-gateway/index.ts`:
  the edge function; `platform/src/gateway/` (pricing, caps, validate, cors,
  request) its tested logic, `platform/src/gateway/README.md` the contract.
- `platform/supabase/functions/sign-in-link/index.ts`,
  `platform/supabase/functions/auth-email-hook/index.ts`,
  `platform/supabase/functions/email-optout/index.ts`: the sign-in and email
  functions; `platform/src/signin/` their tested logic,
  `platform/src/signin/README.md` the contract.
- `platform/llm-usage-report.mjs`, `platform/src/report/format.mjs`,
  `.github/workflows/llm-usage-report.yml`: the daily email.
- `platform/templates/app/`: the app baseline (README inside).
- `.github/workflows/deploy.yml`: the "Supabase migrations" step for apps with
  `supabase: true`.
- `.github/workflows/ci.yml`: the `platform` job (lint, typecheck, coverage).
- `platform/README.md`: what is here and the first-time command order.
- `platform/supabase.json`: public URL and anon key, committed by the
  Supabase admin workflow's `keys --write` (9 Nov), and the public Turnstile
  site key `turnstileSiteKey` (10 Nov; `keys --write` keeps it).
