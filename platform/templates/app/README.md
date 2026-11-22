# App template

The baseline for a weekly HintWise app (design: `docs/platform.md`): Vite,
TypeScript, vitest with 85% coverage thresholds, ESLint, Playwright, and the
three platform pieces as small modules under `src/lib/`.

## Copying it

From the repo root, with the new app's slug (lowercase, dashes):

```bash
slug=my-new-app
cp -r platform/templates/app "$slug"
cd "$slug"
# SLUG -> the slug everywhere (APP_SLUG stays a constant name); app_SLUG -> app_ plus the slug with underscores
grep -rl SLUG . | xargs perl -pi -e "s/app_SLUG/app_${slug//-/_}/g; s/(?<!APP_)SLUG/$slug/g"
mv supabase/migrations/0001_init.sql.example supabase/migrations/0001_init.sql
mv deploy/target.yml.example deploy/target.yml
npm install
git add -f package-lock.json   # the root .gitignore excludes lockfiles; npm ci needs it
```

Then edit:

- `package.json` description, `index.html` title, `src/main.ts` (the
  placeholder shell), the `README.md` for the business owner.
- `supabase/migrations/0001_init.sql`: the app's tables (keep `user_id ...
  default auth.uid()`, the RLS policies and the grants on every table).
  Uncomment the `platform.llm_apps` insert if the app uses the gateway.
  Delete the `supabase/` folder and set `supabase: false` (or drop the key)
  in `target.yml` if the app stores nothing server-side.
- `deploy/target.yml`: `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` from
  `platform/supabase.json` (if that file does not exist yet, build behind the
  in-memory repository and list the dependency in HANDOFF.md).
- `.env.example` stays; a local `.env` with the same two values is git-ignored.

## What is in `src/lib/`

| File | What it gives the app |
|---|---|
| `supabase.ts` | `getSupabase()` (one client, `db.schema` = the app's schema), `hasSupabase()`, `APP_SLUG`, `APP_SCHEMA` |
| `auth.ts` | `signInWithGoogle`, `sendMagicLink` (the platform's `sign-in-link` function, never `signInWithOtp`; it asks for the emailed code), `verifySignInCode`, `completeSignInFromUrl`, `signOut`, `onAuth`, `currentToken`, and `mountSignIn(el)`: plain-DOM sign-in for the right of the top bar, as on UpvoteMe ("Sign in with Google" and "Email code", whose panel holds the email form, then the box for the 6-digit code, and the Turnstile check when asked for; signed in, the person, whose panel holds "Delete my account", and "Sign out") |
| `signin-styles.ts`, `google-g-light.svg` | the panel's CSS block (added to the page once) and Google's light G, unmodified from signin-assets.zip |
| `llm.ts` | `ask({system, messages, model?})` in the visitor's mode: `byok` (their key in localStorage `hintwise.anthropicKey`, browser SDK), `gateway` (the owner's key through `llm-gateway` with the session token), `off`; `CapReached` carries the scope and reset time |
| `repository.ts` | `Repository<T>` (list/get/put/remove), `InMemoryRepository` for tests and `vite preview`, `SupabaseRepository` over one table (the database fills `user_id`) |

## Rules

- Tests never touch the network: pass fakes (`AuthClient`, `AskDeps`, a fake
  `SupabaseClient`) as the modules' last arguments, as `test/` does. The
  Playwright walkthrough (`npm run e2e`) runs against `vite preview` built
  without Supabase env, so the app must work with the in-memory repository.
- Bring-your-own-key is always offered; the owner's key only through the
  gateway and its caps; deterministic code wherever it does the job.
- Do not add the "built by" footer; the deploy injects it. Keep `body` a block
  or column layout.
- Quality gates before every push: `npm run lint && npm run typecheck &&
  npm run coverage && npm run build`.

## Checking the template itself

The template is not a package in CI. To check it, copy it somewhere outside
the repo, install, and run the gates:

```bash
cp -r platform/templates/app /tmp/tmpl-check && cd /tmp/tmpl-check
npm install && npm run lint && npm run typecheck && npm run coverage && npm run build
```

## Email sign-in: a 6-digit code (and the link, during the move)

The default for every new app (owner, 22 November 2026: "it should send a 6
digit code like upvoteme, so all hintwise apps have the same approach to
sign-in and magic link/code"). The email carries the code, with the link
below it until every app has the code box. The platform's side, and why it
works this way (decisions D-SC-1 to D-SC-8), is in
`platform/src/signin/README.md`, "Sign-in codes".

`sendMagicLink(email, redirectTo)` posts `{ email, redirectTo, app,
browserId, withCode: true }` to `<VITE_SUPABASE_URL>/functions/v1/sign-in-link`
with the anon key as `apikey` (`withCode: false` leaves the code out, for a
page without the code box). `browserId` is kept in localStorage
`hintwise.browserId`, or in memory for the page when storage is blocked: a
code works only with the id that asked for it. The answer is typed:
`{status:'sent', withCode?}`, `{status:'wait', retryAt}` (shown in the
visitor's local time), `{status:'challenge', siteKey}`,
`{status:'suppressed', message}` (the address used the "Stop all email from
HintWise" link in an email footer: nothing is sent, the panel shows the
message, and Google sign-in still works) or `{status:'error', message}`.

After `{status:'sent', withCode: true}` the panel shows the code step:

- what was sent and to whom, in the panel's status (announced);
- "Sign-in code", a visible label, and the hint "6 digits, from the email.";
- the box: `type="text"`, `inputmode="numeric"`, `autocomplete="one-time-code"`,
  no `maxlength`, so "123 456", "123-456" and full-width digits paste whole
  (`normalizeSignInCode`);
- "Sign in", then "Send a new code" (the same limits as the first email) and
  "Use a different email address";
- an error under the box with `role="alert"`, the box marked
  `aria-invalid` and selected for the next try: a wrong code says how many
  tries are left; after 5 wrong codes, after 10 minutes, or with no code
  from this browser, it says to send a new one.

`verifySignInCode(email, typed)` posts `{ action: 'verify', email, code,
browserId }` to the same function. A right code answers the link's token
hash, and `verifyOtp({ token_hash, type: 'email' })` signs the visitor in,
the same call the link makes. For 10 minutes after asking (a time in
localStorage `hintwise.signInCodeAt`, never the address or the code), the
email form also offers "Type a code I asked for in this browser" for the
address typed in it: the way back the email names after a reload or a
closed tab. `{status:'sent'}` without `withCode` means the email went with
the link only, and the panel says so.

On a challenge, the panel loads Cloudflare Turnstile once
(`api.js?render=explicit`) and renders the widget into the panel with
`action: 'sign-in'`. It sends the request again with the token and resets
the widget after every request. After three failed checks in a row it stops
until the visitor asks again.

The emailed link still works, in any browser. It comes back to the page with
`?token_hash=...&type=email&email_hint=a***@example.com`. `mountSignIn` (or
`completeSignInFromUrl` in an app with its own UI) takes those out of the
address bar, then acts on who is signed in:
- nobody: it calls `verifyOtp`, so the link works in any browser;
- an account with the same masked address: it keeps the session, says
  "Already signed in as a***@example.com" and offers "Use the link instead"
  (masks collide, so the link is never dropped silently);
- another account: it asks first, with the button "Switch to
  a***@example.com?", so a link someone else sent cannot silently swap
  accounts.

An `email_hint` that does not look like `a***@example.com` (`EMAIL_HINT`,
at most 260 characters) is ignored.

`redirectTo` must be a page of a deployed app: sign-in-link only accepts the
labels in `platform/src/signin/app-hosts.ts`. After the new app's first
deploy, run `npm run app-hosts` in `platform/`, commit, and redeploy
sign-in-link. The contract and the limits are in
`platform/src/signin/README.md`.

## The sign-in look

The owner's look is UpvoteMe's (https://upvoteme.hintwise.org; BUILD_ROUTINE.md,
"Google sign-in button", 18 November 2026). Mount `mountSignIn` in an element
at the right of the app's top bar (`src/main.ts` and `index.html` show one):

- Signed out: two separate outlined pill buttons, "Sign in with Google" and
  "Email code" (an envelope; it was "Magic link" until the code, 22 November
  2026, and keeps the class `hw-signin-magic`). "Email code" opens a small
  panel under the buttons with the email form, then the code box; Escape, a
  click elsewhere or the button again closes it. (UpvoteMe has its own
  sign-in page; the panel is here because it also holds the Turnstile check
  and the messages.)
- Signed in: the person (a round badge with their initial, then their
  address) and "Sign out". The person opens a panel with "Signed in as ...",
  any message, and "Delete my account".
- The panel opens on its own when there is something to read or do:
  "Finish signing in", "Switch to ...?", or a message such as the farewell
  after "Delete my account".
- Below 640 px each bar button is a round, bordered, 40px icon button; its
  label is visually hidden and stays its accessible name. This is the one
  `@media` block in `signin-styles.ts`, so showing the labels again is a
  one-block change.
- The panel is absolutely placed under the bar's right edge, 21.5rem wide
  (room for Turnstile's 300px widget) and at most the viewport's width less
  32px. On a phone too narrow for that widget, Turnstile renders its compact
  form. So keep the sign-in element at the right of the bar: in a flex bar,
  `.hw-signin` keeps its width (`flex: none`), and `margin-left: auto` keeps
  it at the right when the bar wraps.
- Escape closes the panel wherever the focus is, and so does the focus
  moving to another part of the page.
- An app with a dark theme restyles the bar's buttons and `.hw-signin-panel`
  too (qualified-overtime-checker and lewis-alt-text show how, with Google's
  dark values and dark G).

## The Google button

It follows Google's branding guidelines (BUILD_ROUTINE.md, "Google sign-in
button"):

- the text "Sign in with Google";
- Google's standard G, unmodified (`src/lib/google-g-light.svg` is the
  light icon from signin-assets.zip, shown through a 20px window);
- the light theme: #FFFFFF fill, 1px #747775 border, #1F1F1F text;
- 14px/20px type at weight 500;
- 12px before the logo, 10px after it, 12px after the text;
- a pill shape;
- the same size and weight as the "Email code" button;
- below 640 px, the G alone in its round bordered button, with "Sign in
  with Google" as its accessible name (the owner's choice for phones;
  whether Google's guidelines allow an icon-only G was not checked).

The font stack is `'Google Sans', Roboto, Arial, sans-serif`. The template
loads no external fonts, so Roboto or Arial stand in unless the app already
loads Google Sans from Google Fonts. Do not restyle the button. For a dark
page, use the guideline's dark values and the dark asset from the same zip.
`test/auth.test.ts` pins the text, the G (byte for byte) and the border.

## Profiles

The platform keeps one `platform.profiles` row per user, but it has no trigger
on Supabase's `auth.users` (the shared project does not allow one). The
sign-in panel (`mountSignIn`) calls `ensureProfile()` from `src/lib/auth.ts`
once per signed-in user; an app with its own sign-in UI calls it itself. It
never throws; a missing profile row does not stop the app.
