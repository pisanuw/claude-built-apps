# LLM gateway

The pure logic of the `llm-gateway` Supabase Edge Function (design:
`docs/platform.md`, section 3). The Deno entry point is
`platform/supabase/functions/llm-gateway/index.ts`; it imports these modules
with `.ts` extensions and only wires them to supabase-js and the Anthropic SDK.

| Module | What it does |
|---|---|
| `pricing.ts` | `PRICES`, `KNOWN_MODELS`, `FALLBACK_MODELS`, `costUsd(model, usage)` (Haiku's 100K-token tier, unknown models billed at Opus prices) |
| `caps.ts` | `decide(spend, limits, now)`: allowed, or `{scope, resets_at}` for `app-month`, `app-week`, `app-day`, `app-user-week`, `app-user-day` (optional per-app caps for one user, 0006) and `user-day` (one user across all apps); UTC windows |
| `validate.ts` | `parseBody` (1 MB limit), `appSlug`, `validateRequest` (model in `allowed_models`, `max_tokens` clamped, at most 200 messages, `stream` a boolean) |
| `thinking.ts` | `checkThinking`: the allow-list for `thinking.type` and `output_config.effort` per model (`claude-opus-5-5`: adaptive only; `claude-sonnet-5-5`: also `between_tools`; `claude-haiku-5-5`: also `disabled`; thinking off needs effort `high` or below) |
| `cors.ts` | `https://*.hintwise.org` and `http://localhost:5173`; `preflight`, `jsonHeaders`, `sseHeaders` |
| `request.ts` | `buildAnthropicParams` (server-side refusal fallback behind `SERVER_SIDE_FALLBACK`, not for Haiku), `usageRow`, `errorRow` |
| `stream.ts` | `SseMeter` (usage from `message_start` and `message_delta`), `startRelay` (events passed through unchanged; an error before the first event comes back as a JSON failure; caller abort, upstream errors, shutdown), `streamRow`, `refundsCredit` |

Tests: `platform/test/*.test.ts` (`npm run coverage` in `platform/`).

## Contract

`POST https://<ref>.supabase.co/functions/v1/llm-gateway` with
`Authorization: Bearer <user session token>` and a JSON body
`{ app, model?, max_tokens?, system?, messages, tools?, thinking?,
output_config?, stream? }`. On success the Messages API response is returned
unchanged (a refusal arrives as `stop_reason: "refusal"`). With
`"stream": true` the answer is Anthropic's server-sent events, unchanged, as
`text/event-stream`, and one `llm_usage` row is written when the stream ends
(`stream.ts` has the rules). Errors are JSON with CORS headers:

| Status | Body |
|---|---|
| 401 | `{ error: 'auth', message }` no or invalid session token |
| 403 | `{ error: 'app', message }` app not in `platform.llm_apps` or disabled |
| 400 / 413 | `{ error: 'request', message }` bad body, disallowed model, a thinking or effort setting outside the allow-list, too many messages, body over 1 MB |
| 429 | `{ error: 'cap', scope, resets_at, message }` a spending cap is reached |
| 502 | `{ error: 'upstream', name, status, message }` the Anthropic call failed (when streaming: before the first event) |

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
