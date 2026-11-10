# Sign-in links

The pure logic of two Supabase Edge Functions (design: `docs/platform.md`,
"Sign-in links and abuse limits"):

- `sign-in-link` (`platform/supabase/functions/sign-in-link/index.ts`): apps
  call it instead of `supabase.auth.signInWithOtp`. It spaces out links,
  asks for a Cloudflare Turnstile check when one address, browser or network
  asks too often, creates the link with Auth's admin API and emails it
  through Resend.
- `auth-email-hook` (`platform/supabase/functions/auth-email-hook/index.ts`):
  Supabase Auth's Send Email hook. Once it is switched on, Auth hands it every
  auth email. It refuses direct magic links and sign-ups, so nothing gets
  around the limits, and sends the other emails itself.

The Deno entries only pass `Deno.env`, `fetch` and `EdgeRuntime.waitUntil`
to the handlers here. Tests: `platform/test/signin-*.test.ts`.

| Module | What it does |
|---|---|
| `validate.ts` | `parseSignInRequest`: the body, email (trimmed, lower-cased), `redirectTo` (one `https://<label>.hintwise.org/` page), app slug, browser id |
| `keys.ts` | `clientIp` (`cf-connecting-ip`, else the first `x-forwarded-for` entry, else `unknown`; Cloudflare overwrites the first, a client can forge the second), `hashKeys` (HMAC-SHA256 under `SIGN_IN_HASH_KEY`) |
| `ladder.ts` | `gapMinutes`, `nextAllowed`: the wait between links |
| `policy.ts` | `decide`: wait, send, or send after a challenge |
| `turnstile.ts` | `verifyTurnstile` (siteverify) and the hostname allowlist; `TURNSTILE_SITE_KEY` |
| `link.ts` | `createLinkToken` (`generate_link`, creating the user once if Auth says it does not exist), `signInLink` |
| `email.ts` | the sign-in email and the hook's emails, as text and HTML |
| `resend.ts` | `sendEmail` |
| `alerts.ts` | the alert rules and the owner's alert emails |
| `db.ts` | `restDb`: PostgREST RPCs in schema `platform` with the service-role key |
| `service.ts` | `handleSignInLink`: the whole sign-in-link request |
| `hook.ts`, `hook-service.ts` | Standard Webhooks check, what to do with each email type, `handleEmailHook` |

## Request and answers

`POST <SUPABASE_URL>/functions/v1/sign-in-link` from a page on
`https://<label>.hintwise.org`. The template sends the anon key as `apikey`,
but the function needs no JWT (`verify_jwt = false`). JSON body:

```json
{ "email": "ann@example.com", "redirectTo": "https://paste-md.hintwise.org/app",
  "app": "paste-md", "browserId": "<localStorage hintwise.browserId>", "turnstileToken": "<optional>" }
```

| HTTP | Body | When |
|---|---|---|
| 200 | `{ status: 'sent' }` | the email went out |
| 429 | `{ status: 'wait', retryAt }` | too early for this address or browser; `retryAt` is an ISO time |
| 403 | `{ status: 'challenge', siteKey, failed? }` | a Turnstile check is needed; `failed: true` when the token did not pass |
| 400 / 413 | `{ status: 'error', message }` | bad body |
| 403 | `{ status: 'error', message }` | the Origin is not a hintwise.org app |
| 500 / 502 / 503 | `{ status: 'error', message }` | database, Auth or Resend trouble, or the function is not configured |

The link in the email is `redirectTo` with `token_hash=<hashed_token>&type=email`
added (other query parameters and the hash are kept). The app calls
`supabase.auth.verifyOtp({ token_hash, type: 'email' })`. That works in any
browser, and the link expires when Auth's `mailer_otp_exp` says (about an
hour).

## Limits

- **Ladder per address and per browser.** Between links the wait is 1, 3, 5,
  8, 13 and 21 minutes, then the sum of the previous two (34, 55, 89, ...),
  capped at 24 hours. Only links sent since the key's last quiet day count:
  24 hours with no request of any outcome for the key resets it. A request
  that is still being decided (`pending`, for at most 5 minutes) counts as a
  link being sent, and `sign_in_begin` locks the address and the browser
  first, so parallel requests cannot send several links at once. The later
  of the two waits wins. A wait is answered before any challenge.
- **Challenge.** It is needed when this request is the 10th or later in 24
  hours (any outcome) for the address, or for the browser, or the 21st or
  later in an hour from the IP. The IP rule is the lenient one, because
  classrooms and offices share an IP. A request with no IP header skips the
  IP rule and is logged with `ip unknown`.
- **The check.** It is a form POST to Cloudflare's siteverify with `secret`,
  `response` and `remoteip` and a 10-second timeout. A token passes only
  when `success` is true, `action` is `sign-in` and `hostname` is
  `hintwise.org` or ends in `.hintwise.org`. A token over 2048 characters is
  refused without a call. Tokens are single-use, so a token is never checked
  twice. Any failure, including Cloudflare not answering, is
  `challenge_failed` with HTTP 403, and the visitor solves the widget again.
  The site key is public: `TURNSTILE_SITE_KEY` in `turnstile.ts`, the same as
  `platform/supabase.json` `turnstileSiteKey`; the env may override it. While
  the function secret `TURNSTILE_SECRET` is unset, a due challenge is
  skipped. The link is sent and the row's detail says
  `warning: challenge skipped`.

## Log and alerts

Every request is one row in `platform.sign_in_requests`, written through RPCs
(`platform/supabase/shared/0002_sign_in.sql`). A row holds `created_at`, `app`,
`outcome` (`sent`, `wait`, `challenge`, `challenge_failed`, `refused`, `error`,
`invalid`), `detail`, and the HMAC-SHA256 hashes of the email, the IP and the
browser id. No address, IP or browser id is stored, and rows older than 30
days are deleted, up to 200 per logged request. The owner finds an
address's rows by hashing `email:<address>` with `SIGN_IN_HASH_KEY`.

RPCs and not table writes: each step is one round trip and one transaction,
which the per-address lock needs. The functions are security invoker with
`search_path = ''`, executable only by `service_role`. Anon and authenticated
have no access to the tables or the functions.

Alerts go to `ADMIN_EMAIL` from `builder@hintwise.org`, at most one per kind
an hour (`platform.sign_in_alerts`):

| Kind | Rule |
|---|---|
| `many-addresses` | one IP or one browser asked for links to 5 or more different addresses in an hour |
| `address-repeated` | one address was asked for 5 or more times in an hour |
| `challenge-failures` | 3 or more failed checks from one IP in an hour |
| `volume` | more than 100 links sent across all apps in an hour |
| `bypass` | `auth-email-hook` refused a direct magic link or sign-up |

The emails show counts, the first 16 characters of the hashes, and a query
for the rows. Only `address-repeated` names the address, so the owner can
tell a visitor who cannot find the email from someone filling a stranger's
inbox. Once a link has gone out, the address is in `auth.users` anyway.

## Send Email hook

Auth signs each call with Standard Webhooks (`webhook-id`,
`webhook-timestamp`, `webhook-signature`). The secret, `SEND_EMAIL_HOOK_SECRET`,
is in the `v1,whsec_<base64>` form, and a timestamp more than five minutes
off is refused. The hook answers HTTP 200 with
`{ error: { http_code, message } }` when Auth should fail the app's request
with that status and message, and `{}` when the email went out. Any other
status reaches the app only as a bare 500.

| `email_action_type` | What the hook does |
|---|---|
| `magiclink`, `signup`, `email` | refuses with 403 "Use the HintWise sign-in-link service", logs `refused`, raises `bypass` |
| `recovery`, `invite` | emails `<SUPABASE_URL>/auth/v1/verify?token=<token_hash>&type=<type>&redirect_to=<redirect_to>` |
| `email_change` | `token_hash_new` to the current address and `token_hash` to the new one (Supabase's names are reversed); one email to the new address when secure change is off |
| `reauthentication` | emails the code |
| `*_notification` | a short notice |
| anything else | 500 "not supported" |

## Function secrets

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` come with every function. The
"Supabase admin" workflow's `set-sign-in-secrets` sets the rest:

- `RESEND_API` and `ADMIN_EMAIL`, from the repo secrets of the same names.
- `TURNSTILE_SECRET`, from the repo secret `TURNSTILE_SECRET_KEY`.
- `TURNSTILE_SITE_KEY`, from the repo variable or secret of that name, else
  the committed public key.
- `SIGN_IN_HASH_KEY` and `SEND_EMAIL_HOOK_SECRET`, generated once.

`email-hook on` replaces `SEND_EMAIL_HOOK_SECRET` with a fresh value that it
also gives to Auth.
