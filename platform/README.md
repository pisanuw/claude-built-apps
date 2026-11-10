# platform

The shared HintWise platform: one Supabase project with a schema per app,
sign-in by Google or magic link, an LLM gateway with spending caps, and a
daily usage email. The design is `docs/platform.md`; this folder holds the
code. Nothing here holds a secret: the admin workflow has the repo secrets and
prints names and booleans only.

| Piece | Where | Run by |
|---|---|---|
| Admin script | `supabase-admin.mjs` | the "Supabase admin" workflow (`.github/workflows/supabase-admin.yml`) |
| Shared SQL | `supabase/shared/0001_platform.sql` (schema `platform`: profiles, llm_apps, llm_usage, migrations, llm_spend, llm_usage_report); `0002_sign_in.sql` (sign_in_requests, sign_in_alerts and their RPCs) | `apply-shared` |
| LLM gateway | `supabase/functions/llm-gateway/index.ts` (Deno entry) over `src/gateway/` (pure modules, tests in `test/`); `supabase/config.toml` for the CLI | `deploy-gateway`, `set-gateway-key` |
| Sign-in links | `supabase/functions/sign-in-link/index.ts` and `supabase/functions/auth-email-hook/index.ts` (Deno entries) over `src/signin/` (pure modules, contract in `src/signin/README.md`) | `deploy-function sign-in-link`, `deploy-function auth-email-hook`, `set-sign-in-secrets`, `email-hook` |
| Usage report | `llm-usage-report.mjs` over `src/report/format.mjs` | `.github/workflows/llm-usage-report.yml`, daily 9:10 Pacific |
| App template | `templates/app/` | copied by the weekly build (its README says how) |
| Public client values | `supabase.json` (`url`, `anonKey`), written from the `keys` command | every app's `target.yml` `env` |

## Admin workflow commands

Dispatch "Supabase admin" with `command`, optional `arg` and `flags`:

| Command | Arg / flags | What it does |
|---|---|---|
| `inspect` | | project, exposed schemas, auth settings, schemas, tables, buckets, functions, secret names, recorded migrations |
| `sql` | arg: `.sql` path | run one file through the Management API |
| `apply-shared` | | run `platform/supabase/shared/*.sql` in order, skipping files already recorded with the same sha256 in `platform.migrations`; a changed shared file is re-run (they are idempotent) |
| `migrate` | arg: app slug | run `<slug>/supabase/migrations/*.sql` the same way; refuses when an applied file changed (add a new file instead) |
| `expose-schema` | arg: schema | append the schema to PostgREST's `db_schema` (`platform`, then `app_<slug_>` per app) |
| `configure-auth` | flags `--dry-run`, `--google` | additive auth settings: `https://*.hintwise.org/**` in the redirect allow-list, Resend SMTP from `RESEND_API`, email limit raised to 30/hour; `--google` switches the Google client to `HINTWISE_AUTH_GOOGLE_ID/SECRET` |
| `keys` | flag `--write` | print `{url, anonKey}` as `platform/supabase.json` (the anon key is public by design; the service-role key is never printed) |
| `usage` | arg: days | print `platform.llm_usage_report(days)` as the same tables as the email |
| `check-google` | arg: return URL; flag `--base=URL` | start a Google sign-in like a browser and report the client, callback URL, Google's answer and the return address; no login; exits 1 when broken |
| `domain-setup` | arg: host | custom domain add-on: start the host, create its Cloudflare CNAME and TXT records (DNS only), ask Supabase to verify |
| `domain-status` | | where the custom domain stands; re-verifies while waiting |
| `domain-activate` | flag `--callbacks-ready` | switch Auth to the custom domain, only once every OAuth client lists `https://<host>/auth/v1/callback` |
| `deploy-function` | arg: function name | Supabase CLI: `supabase functions deploy <name>` from `platform/`; adds `--no-verify-jwt` when its `config.toml` section says `verify_jwt = false` |
| `deploy-gateway` | | the same as `deploy-function llm-gateway` |
| `set-gateway-key` | | Supabase CLI: `supabase secrets set ANTHROPIC_API_KEY=...` from the repo secret |
| `set-sign-in-secrets` | | function secrets `RESEND_API`, `ADMIN_EMAIL`, `TURNSTILE_SECRET` (repo secret `TURNSTILE_SECRET_KEY`, when present), `TURNSTILE_SITE_KEY` (repo variable or secret, else the committed public key); generates `SIGN_IN_HASH_KEY` and `SEND_EMAIL_HOOK_SECRET` only when the project has none; prints booleans |
| `email-hook` | arg: `status`, `check`, `on`, `off`; flags `--dry-run`, `--allow-otp-apps` | Supabase Auth's Send Email hook. `on` (owner's yes first) checks the function, its secrets and that no app in this repo still calls `signInWithOtp`, sets a fresh `SEND_EMAIL_HOOK_SECRET` and points the hook at `auth-email-hook` with it. It affects every app on the project |

First-time order (after the owner's key rotation): `apply-shared`,
`expose-schema platform`, `configure-auth --dry-run` then `configure-auth`,
`keys` (commit `platform/supabase.json`), `set-gateway-key`, `deploy-gateway`,
then a dry run of the "LLM usage report" workflow. Sign-in links:
`apply-shared`, `check-schema platform`, `deploy-function sign-in-link`,
`deploy-function auth-email-hook`, `set-sign-in-secrets`, and after the
owner's yes `email-hook check`, `email-hook on --dry-run`, `email-hook on`.

## Deploy integration

`.github/workflows/deploy.yml` runs, for a `target.yml` with `supabase: true`,
`node platform/supabase-admin.mjs migrate <slug>` and
`expose-schema app_<slug_>` before the Netlify deploy, with the
`SUPABASE_ACCESS_TOKEN` and `SUPABASE_URL` secrets. A failed migration fails
the deploy job.

## Development

```bash
cd platform
npm ci
npm run lint && npm run typecheck && npm run coverage   # 85% thresholds on src/**
npm run check-scripts                                   # node --check on the .mjs files
```

The Deno entries are not type-checked or covered here (Deno globals,
`npm:` imports); their logic is in `src/gateway/` and `src/signin/` and fully
tested. To check the
app template, see `templates/app/README.md`.
