# New HintWise app: the standard instructions

Read this before building or deploying any new HintWise app, whether it lives in
this repository or in its own. Hand it to the session that builds the app.
It tells you what deployment systems exist, who can operate each one, and how
the HintWise footer, logo and favicon work.

The details live in the documents it points to: `docs/platform.md` (Supabase,
sign-in, gateway, email), `BUILD_ROUTINE.md` ("The usual architecture", the
Google button rules) and `platform/brand/README.md` (the brand kit). When this
guide and one of those disagree, that document wins; fix this one.

This repository is public, so a session that only needs to read it can run
`git clone --depth 1 https://github.com/pisanuw/claude-built-apps /tmp/cba`.

Written 12 Nov 2026, from the photo2pgn hand-off.

## 1. Where the app lives

| | **A. A folder in this repo (the default)** | **B. Its own repository** |
|---|---|---|
| Examples | the 60+ apps here, Qualified Overtime Checker, Delivery Canary | UpvoteMe (pisanuw/upvote), PasteMD (pisanuw/pastemd), StepWise (pisan-labs/visualizing-data-structures), photo2pgn (pisan-labs/photo2pgn, created as photo2png and renamed before its first deploy) |
| Netlify site, `<slug>.hintwise.org`, Cloudflare DNS | the Deploy workflow creates them from `<slug>/deploy/target.yml` | the owner imports the repo in Netlify once; then the Plabs session runs "Attach custom domain" |
| Footer | injected at deploy time | embedded in the app's HTML, byte for byte, with a sha256 test (section 6) |
| Database migrations | applied by the Deploy workflow (`supabase: true`) | copied byte for byte into `<slug>/supabase/migrations/` here and applied by the Plabs session, the way StepWise's were done (`stepwise/README.md`) |
| Email sign-in allow-list | generated from target.yml (`npm run app-hosts` in `platform/`) | the label added to `EXTERNAL_APP_LABELS` in `platform/src/signin/validate.ts`, then sign-in-link and delete-account redeployed |
| CI | the app's job in `.github/workflows/ci.yml` | the app's own CI |
| Deploys cost credits | only when target.yml changes (or a manual Deploy run) | on every push Netlify builds; turn off Deploy Previews and branch deploys, and put `[skip netlify]` in docs-only commits |
| Public repo | mirrored to `pisan-labs/<repo>` by the Mirror workflow (`.github/mirrors.txt`) | the repo itself |

Choose A unless the owner asks for B. With B:
- **The repository's name is the app's name.** The `<slug>` in `<slug>.hintwise.org` and the repo name must match. Rename a misnamed repo **before the first deploy** (GitHub, Settings, General, Repository name); GitHub redirects the old name, and each clone runs `git remote set-url origin <new url>`.
- The Netlify import is the owner's step, because linking a repository needs the owner's Netlify login.

## 2. The stack

The usual architecture (owner, 10 Nov 2026; the table in BUILD_ROUTINE.md has the details). The owner pays for Netlify, Render, Supabase and Resend. Add no other provider without the owner's yes.

| Need | Use |
|---|---|
| The app | Vite + TypeScript from `platform/templates/app/`, static on Netlify at `https://<slug>.hintwise.org` |
| Server-side code (a secret, a webhook, sending email) | Netlify Functions in the same site (`netlify/functions/`, at `/api/*`). For option A, a secret reaches them through target.yml `envPassthrough`, from a GitHub repo secret mapped in `.github/workflows/deploy.yml`. Functions that touch the database act with the user's token; apps never get the service-role key |
| Sign-in | Supabase Auth at `https://auth.hintwise.org`: Google and email links (section 4) |
| Data | Supabase Postgres, the app's own schema `app_<slug_>`, row level security (section 5) |
| Files | Supabase Storage, one private bucket per app named `<slug>`, signed URLs |
| Model calls | the LLM gateway, plus bring-your-own-key (section 7) |
| App email | Resend from a Netlify Function, sender `<slug>@hintwise.org` (section 8) |
| Scheduled work | Netlify Scheduled Functions for light jobs; Render for heavy ones |
| A long-running server | Render: a path prefix in `backend-hub` first (free instance: sleeps when idle, 512 MB) |
| DNS | Cloudflare, zone hintwise.org |

## 3. Deployment systems and who runs them

The GitHub secrets (Netlify, Render, Cloudflare, Supabase, Resend, Anthropic) live in this repository. No cloud session can read them, so the workflows below do the work. Run them with the GitHub tools (`actions_run_trigger`). A run's inputs and logs are public: never put a secret in an input.

| Workflow | What it does | Who |
|---|---|---|
| **Deploy** (`deploy.yml`) | builds and deploys every changed `*/deploy/target.yml`: Netlify site, env, functions, footer injection, `<slug>.hintwise.org` CNAME, and Supabase migrations for `supabase: true`. Runs on a push to main that changes a target.yml, or by hand with app names or `all` | any session, for option A |
| **Supabase admin** (`supabase-admin.yml`) | `migrate <slug>`, `expose-schema`, `check-schema`, `deploy-function <name>`, `usage`, `sql` and more (`platform/supabase-admin.mjs`) | the Plabs session, with the owner's yes for production changes |
| **Attach custom domain** / **Set Netlify domain** | give an existing Netlify site (any repo) a `<name>.hintwise.org`: CNAME (DNS only), primary domain, certificate | Plabs, for option B |
| **Set CNAME** / **Render domain** | point a hintwise.org name at a Render service; add the domain or an env var on Render | Plabs |
| **Netlify env** | show or set a plain URL variable on a site this repo doesn't deploy | Plabs |
| **List hosts**, **List DNS**, **Check Cloudflare** | read-only inventories | anyone |
| **Mirror apps** | splits each app in `.github/mirrors.txt` into `pisan-labs/<repo>` | automatic on push |
| **Retire Netlify site** | deletes a site and only the CNAMEs pointing at it; refuses while target.yml exists | only on the owner's word |

Rules:
- **Netlify deploys cost credits.** Never redeploy every app for a small change; let each app pick it up on its next deploy unless the owner asks.
- **The owner says yes before any production change:** deploying a function, applying a migration, changing DNS, or a deploy the owner didn't ask for. Pushing to main is fine.
- In option A, write `netlify.customDomain: <slug>.pisan.me` in target.yml. The runner swaps in hintwise.org (`scripts/domains.mjs`). Link only the hintwise.org address.

## 4. Sign-in

Details: docs/platform.md sections 2 and "Sign-in links".

- **Public values** (public by design):
  - `VITE_SUPABASE_URL=https://auth.hintwise.org`
  - `VITE_SUPABASE_ANON_KEY` from `platform/supabase.json`
- **Copy the template** from `platform/templates/app/src/lib/`: `supabase.ts`, `auth.ts`, `account.ts`, `llm.ts`, `repository.ts`, `signin-styles.ts` and `google-g-light.svg`, with their tests. Its README shows the `SLUG` replacement.
- **Google:** `signInWithOAuth` through Supabase. Never add a Google client, a redirect URI or an auth setting for one app. The button follows Google's branding rules (BUILD_ROUTINE.md); the template's button does.
- **Email:** through the platform's `sign-in-link` function (the template's `sendMagicLink`), **never `signInWithOtp`**. The email hook refuses that for hintwise.org pages.
- **New app label:** in option A, run `npm run app-hosts` in `platform/` and commit it (CI fails while it's stale). In option B, add the label to `EXTERNAL_APP_LABELS`. In both cases `sign-in-link` and `delete-account` are then redeployed, or email links and account deletion are refused for the app.
- **"Delete my account" is required** (`account.ts`, under Sign out).
- Sign-in returns only to `https://*.hintwise.org/**`: not localhost, netlify.app or deploy previews. Tests and the Playwright walkthrough use fakes.

## 5. Data

Details: docs/platform.md sections 1 and "Account deletion".

- Schema `app_<slug with _>`, migrations `supabase/migrations/NNNN_<name>.sql`, written idempotently. An applied file never changes; changes go in a new file.
- Every table holding a person's rows has `user_id uuid not null default auth.uid() references auth.users(id) on delete cascade`, row level security with own-row policies, grants to `authenticated`, and nothing for `anon`. `check-schema` fails the deploy otherwise.
- Never touch `public` or another app's schema: the project is shared with live non-HintWise apps.
- The app's README says what is stored (Supabase, US East) and how to delete an account.

## 6. The HintWise footer, logo and favicon

### The footer

Every HintWise app has the same "built by" footer: the HintWise icon, then the owner's own wording (six lines, then his name).

- **One source:** `scripts/site-footer.mjs`.
  - `footerHtml(app)` returns the markup.
  - `app` names the app in the email subject, `mailto:builder@hintwise.org?subject=Project idea (via <app>)`.
  - `LOGO_SVG` is the icon inside it.
  - `FOOTER_STYLE_CSP` is the CSP source for its style.
- **How it renders:** it is a declarative shadow root (`<site-footer data-site-footer><template shadowrootmode="open">...`). The app's CSS can't restyle it, and its CSS can't leak out. It inherits the page's text colour, so it suits light and dark pages, and it hides itself in print.
- **Option A:** the deploy injects it before `</body>` of the built `index.html` (`injectFooterIntoDir`). **Don't add it yourself.** Set `footer: false` in target.yml only if the app can't host it.
- **Option B:** embed the exact output of `footerHtml('<slug>')` in the page's HTML source, just before `</body>`, and test its sha256. UpvoteMe's `src/__tests__/site-footer.test.tsx` is the pattern. Generate it with:

  ```bash
  node -e "import('/tmp/cba/scripts/site-footer.mjs').then(m => process.stdout.write(m.footerHtml('<slug>')))"
  ```

  **Put it in the HTML the server sends** (`index.html` for a Vite app, outside `#root`; the root layout for Next.js). A browser builds a declarative shadow root only while parsing HTML. If React or `innerHTML` inserts it, nothing shows.
- **Layout:** don't make `body` a row flexbox, or the footer sits beside the app. Column flex and grid are fine (`:host` spans every grid column).
- **CSP:** a `style-src` without `'unsafe-inline'` must list `FOOTER_STYLE_CSP` (today `'sha256-4VDViIffTKl8oDDJg58VHCVBOHSQm7GPM7eZ1fAKuzc='`). Otherwise the browser drops the style, and the footer shows unstyled and left-aligned (PasteMD, 11 Nov).
- **Live check:** `curl -s https://<slug>.hintwise.org/ | grep -c data-site-footer` prints 1.
- **Changing the footer:**
  - Only the owner changes the wording. Edit `scripts/site-footer.mjs` and run `node --test scripts/site-footer.test.mjs`.
  - Apps in this repo pick it up on their next deploy; a manual Deploy run with `all` costs credits for every app.
  - Own-repo apps need the new markup and sha256 copied in: UpvoteMe, PasteMD, StepWise, photo2pgn, and Chess TD (pisan-labs/chess-tournament-director, in its `index.html`, live since 12 Nov).
  - A change to the style also changes `FOOTER_STYLE_CSP`, and PasteMD's `netlify.toml` lists it.

### The logo

From `platform/brand/README.md`:
- The wordmark is a lowercase "hintwise" in deep indigo `#312E81` with coral `#FF7A45` sparks over the i's. The icon is a white "h" on an indigo rounded square, with a coral spark.
- Use the files in `platform/brand/`: the SVGs for pages; the PNGs for email, at `https://auth.hintwise.org/storage/v1/object/public/brand/<file>`.
- **Sizes:** the wordmark at least 80 px wide, the icon at least 16 px. Keep clear space at least the height of a spark on every side.
- **Backgrounds:** the indigo wordmark on light backgrounds only; `hintwise-wordmark-white.svg` on dark ones.
- **Don't:** recolour the sparks, stretch, rotate or outline the logo, set the word in another font, or bring back round dots.
- **Text:** in running text the name is "HintWise". Coral is never a text colour.
- **Where it appears today:**
  - every email from the platform, at the top;
  - the opt-out page;
  - the footer icon.

  An app needs nothing more. A small header logo is optional and follows the rules above.

### The favicon

- An app with its own icon keeps it. Chess TD keeps its chess piece, for example.
- An app with none uses the HintWise icon: paste the tag in `platform/brand/favicon-link.html` into `<head>`. It's an inline SVG, so there's no file to serve.
- `platform/brand/favicon.ico`, `hintwise-icon-*.png` and `apple-touch-icon.png` are there if a manifest needs PNGs.

## 7. Model calls

Details: docs/platform.md section 3.

- **The owner's key is used only through the LLM gateway** (`https://auth.hintwise.org/functions/v1/llm-gateway`), for signed-in users, behind caps. **Never put an Anthropic key in Netlify or in an app, and never write a separate rate limiter.**
- **Bring-your-own-key is always offered:** the visitor's key stays in their browser and goes only to api.anthropic.com.
- **The template's `llm.ts`** does both modes, plus `off`. The app works without a model wherever deterministic code does the job.
- **Registering the app:** `insert into platform.llm_apps (slug) values ('<slug>') on conflict do nothing;` in its migration.
- **Default caps:**
  - per app, $2 a day, $10 a week and $20 a month;
  - per user, $0.25 a day across all apps.

  The owner changes them with SQL.
- **An app's own, stricter limits:** lower its own day, week and month caps, and set its optional per-user caps, which count only that app: `cap_app_user_day_usd` and `cap_app_user_week_usd` (since `shared/0006`; null means none). The 429 scopes are `app-user-day` and `app-user-week`.
- **Limits:**
  - the body is at most 1,000,000 bytes, so downscale images in the browser;
  - only `model`, `max_tokens`, `system`, `messages` and `tools` pass through;
  - no streaming, `tool_choice` or `output_config` (the gateway can be extended);
  - `max_tokens` is clamped to the app's limit, 4096 by default;
  - models are the app's `allowed_models`: Opus 5.5, Sonnet 5.5 and Haiku 5.5 by default, with `claude-opus-5-5` used when the request names none.
- **Calling Claude from scripts:** use the local `claude` CLI. Using an Anthropic API key needs the owner's yes.

## 8. Email

Details: docs/platform.md "Email footer, logo and opt-out".

- **Sign-in email:** nothing to build; sign-in-link sends it.
- **App email:** Resend from a Netlify Function, sender `<slug>@hintwise.org`, display name the app's name. No sending subdomains.
- **Transactional only** (owner, 11 Nov): only what the person opted into about the app they use, never promotion as the email's purpose. That is why no postal address is needed (CAN-SPAM). Promotional mail would first need a PO box in the footer and the owner's yes.
- **Recurring mail** is opt-in, carries the platform's unsubscribe, and is capped per user and per day in code. Every app shares hintwise.org's sending reputation.

## 9. Quality and conventions

- **Conventional Commits.** In this repo, add the app's scope to the CLAUDE.md list.
- **Before every push:** `npm run lint && npm run typecheck && npm run coverage && npm run build`. Coverage at least 85%. A Playwright walkthrough of the main flow runs against `vite preview` with fakes.
- **No model identifiers** in commit messages, PRs, code comments or docs, beyond the model id the code calls.
- **The user README:** what it does and for whom, what is stored and where, how to delete the account, and one honest limitation.
- **Option A also needs:**
  - a row in the root README's audience table;
  - a PROJECTS.md section;
  - for a finished app: daily-project-ideas `implemented.json` and `studio.json` entries, and the Studio image (from daily-project-ideas, `node scripts/studio_media.js <claude-built-apps dir> <slug>`).
- `CHANGES.md` is append-only.

## 10. Checklist before the first deploy

1. The slug, the repo name (option B) and `<slug>.hintwise.org` all match.
2. Sign-in comes from the template; email goes through sign-in-link; "Delete my account" is present.
3. The label is on the sign-in allow-list, and sign-in-link and delete-account are redeployed (owner's yes).
4. The migration passes `check-schema`, and includes the `llm_apps` row if the app uses the gateway.
5. No Anthropic key and no service-role key anywhere in the app.
6. The footer is present once (`grep -c data-site-footer` gives 1); the favicon is set; the page doesn't scroll sideways at 375 px.
7. Option B: the owner has imported the repo in Netlify with previews off, and the domain is attached by "Attach custom domain".
8. The app links only `https://<slug>.hintwise.org`.

## 11. Working with the Plabs session

The Plabs session is a long-running cloud session titled "Plabs: <date>". It runs the platform, and its current id is in `HANDOFF.md`, "Scheduling". It applies migrations, redeploys the platform functions, attaches domains and changes gateway settings, each production step after the owner's yes.

Send it, with send_message:
- the migration's commit and sha256;
- "ready for Netlify and the domain";
- any gateway need (caps, models, `max_tokens`, new fields).
