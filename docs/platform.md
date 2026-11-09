# HintWise platform: Supabase, sign-in, LLM gateway

The shared infrastructure every weekly build can use. Owner decisions of
9 November 2026: one substantial project per week instead of one small app a
day; reuse and restructure the existing Supabase project; Google sign-in plus
magic link (email through Resend); LLM features either with the visitor's own
key or with the owner's key behind caps, with usage reported to the owner.
Netlify, Supabase and Render subscriptions exist. The project found on 9 Nov
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
  `public,graphql_public,wcv`); `expose-schema app_x` appends to it.
- Every app table has `user_id uuid not null default auth.uid() references
  auth.users(id) on delete cascade`, row level security on, and policies
  `using (user_id = auth.uid())` for select/insert/update/delete. `grant usage
  on schema app_x to authenticated; grant all on all tables in schema app_x to
  authenticated;` plus a default privileges line. Anonymous visitors get no
  grants in app schemas.
- Shared tables (`platform/supabase/shared/*.sql`, schema `platform`, exposed
  through PostgREST like an app schema):
  - `platform.profiles (id uuid pk references auth.users, email, display_name,
    created_at)`, filled by a trigger on `auth.users`; readable by its owner.
  - `platform.llm_apps (slug pk, enabled, default_model, allowed_models text[],
    cap_day_usd, cap_week_usd, cap_month_usd, cap_user_day_usd, max_tokens,
    created_at)`: one row per app that uses the gateway; the owner changes
    caps with SQL.
  - `platform.llm_usage (id, app, user_id, model, input_tokens, output_tokens,
    cache_read_tokens, cache_write_tokens, cost_usd numeric, ok, error,
    created_at)`: the ledger, written only by the gateway (service role),
    readable by nobody from the browser.
  - `platform.migrations (app, file, sha256, applied_at)`: which migration
    files have run.
- Migrations live in `<slug>/supabase/migrations/NNNN_<name>.sql` and are
  applied in file order by `node platform/supabase-admin.mjs migrate <slug>`
  through the Management API query endpoint (works from IPv4 GitHub runners,
  needs no database password), each recorded in `platform.migrations`. The
  Deploy workflow runs it for every app whose `deploy/target.yml` has
  `supabase: true`, before the Netlify deploy. Write migrations idempotently
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
  { redirectTo: location.origin + location.pathname } })` and
  `supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: ... } })`;
  `onAuthStateChange` drives the UI. The shared template in
  `platform/templates/app/` has the sign-in panel.
- Later, optional: Supabase's custom auth domain add-on (paid) so Google's
  consent screen names hintwise.org instead of supabase.co.

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
     and calendar month, and for the user over the day; refuses with HTTP 429
     and `{ error: 'cap', scope: 'app-day' | 'app-week' | 'app-month' |
     'user-day', resets_at }` when any cap is reached;
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
- **Default model:** `claude-opus-5-5` ($4 in, $20 out per million tokens,
  cache reads $0.20, cache writes 1.25x input), about 100 typical calls per
  $2 day. Apps may allow `claude-sonnet-5-5` ($2 / $10) or `claude-haiku-5-5`
  ($0.10 / $0.50, prompts up to 100K tokens) for bulk work. The pricing table
  is `platform/supabase/functions/llm-gateway/pricing.ts`; check it against
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
  `insert into public.llm_apps ... on conflict do nothing` row if the app uses
  the gateway.
- `src/lib/supabase.ts`, `src/lib/auth.ts`, `src/lib/llm.ts` copied from
  `platform/templates/app/` and adjusted: the client with the app's schema,
  the sign-in panel, the BYOK/gateway switch.
- Data access behind a small repository interface with an in-memory
  implementation for tests, so vitest never touches the network; the live
  implementation uses supabase-js. A Playwright walkthrough of the main flow
  runs against `vite preview` with the in-memory repository.
- README for the business owner says what is stored, where (Supabase,
  US East), and how to delete an account
  (`supabase.auth` sign-out plus a delete request to builder@hintwise.org for
  now; self-service deletion is a platform milestone).

## 6. Owner actions, one time

1. **Rotate the project's JWT secret** (9 Nov incident: the first `inspect`
   run printed it in a public workflow log for about six minutes; the log is
   deleted and the script fixed). Dashboard, Project Settings, API or JWT
   Keys, generate a new secret; then update `SUPABASE_SERVICE_ROLE_KEY` in the
   repo secrets and the anon/service keys in UpvoteMe, WCV Live Together,
   how-of-happiness and whatever writes `chess_kv`.
2. Google Cloud console, HintWise OAuth client: add the authorized redirect
   URI `https://arktxlrlyceffyozdwhq.supabase.co/auth/v1/callback` (only if
   the project's Google sign-in should move to the HintWise client).
3. Anthropic console: set a monthly spend limit (for example $50) as the
   backstop behind the gateway caps.
4. Say whether anything found by `inspect` may be removed (the quiz tables,
   `chess_kv`, the `deploy` bucket); nothing is dropped without that.

## 7. Not confirmed yet

- Whether magic links need any flag beyond `external_email_enabled` (the
  project already sends email sign-in links, so probably not).
- `supabase functions deploy` flags on the current CLI (`--project-ref` vs
  `--remote`); the first `deploy-gateway` run settles it.
- `SUPABASE_DB_PASSWORD` is unused while migrations go through the Management
  API; it stays for a future direct-connection need.
