# LLM gateway

The pure logic of the `llm-gateway` Supabase Edge Function (design:
`docs/platform.md`, section 3). The Deno entry point is
`platform/supabase/functions/llm-gateway/index.ts`; it imports these modules
with `.ts` extensions and only wires them to supabase-js and the Anthropic SDK.

| Module | What it does |
|---|---|
| `pricing.ts` | `PRICES`, `KNOWN_MODELS`, `FALLBACK_MODELS`, `costUsd(model, usage)` (Haiku's 100K-token tier, unknown models billed at Opus prices) |
| `caps.ts` | `decide(spend, limits, now)`: allowed, or `{scope, resets_at}` for `app-day`, `app-week`, `app-month`, `user-day`; UTC windows |
| `validate.ts` | `parseBody` (1 MB limit), `appSlug`, `validateRequest` (model in `allowed_models`, `max_tokens` clamped, at most 200 messages) |
| `cors.ts` | `https://*.hintwise.org` and `http://localhost:5173`; `preflight`, `jsonHeaders` |
| `request.ts` | `buildAnthropicParams` (server-side refusal fallback behind `SERVER_SIDE_FALLBACK`, not for Haiku), `usageRow`, `errorRow` |

Tests: `platform/test/*.test.ts` (`npm run coverage` in `platform/`).

## Contract

`POST https://<ref>.supabase.co/functions/v1/llm-gateway` with
`Authorization: Bearer <user session token>` and a JSON body
`{ app, model?, max_tokens?, system?, messages, tools? }`. On success the
Messages API response is returned unchanged (a refusal arrives as
`stop_reason: "refusal"`). Errors are JSON with CORS headers:

| Status | Body |
|---|---|
| 401 | `{ error: 'auth', message }` no or invalid session token |
| 403 | `{ error: 'app', message }` app not in `platform.llm_apps` or disabled |
| 400 / 413 | `{ error: 'request', message }` bad body, disallowed model, too many messages, body over 1 MB |
| 429 | `{ error: 'cap', scope, resets_at, message }` a spending cap is reached |
| 502 | `{ error: 'upstream', name, status, message }` the Anthropic call failed |

## Running locally

Only with the Supabase CLI installed (not needed for the tests):

```bash
cd platform
supabase functions serve llm-gateway --env-file ./supabase/.env.local --no-verify-jwt
```

with `supabase/.env.local` (git-ignored by the root `.env` rule only if named
`.env`; do not commit it) holding `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
and `ANTHROPIC_API_KEY`. `--no-verify-jwt` skips the platform's JWT check; the
function still calls `auth.getUser` itself.

## Deploying

Dispatch the "Supabase admin" workflow with command `deploy-gateway` (project
dir `platform/`, `supabase/config.toml` names the entry point) and
`set-gateway-key` for the `ANTHROPIC_API_KEY` function secret. The
`platform.llm_apps` row for an app is added by the app's migration.
