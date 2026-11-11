# Handoff: get users, get noticed

Rolling handoff for the Plabs relay (session-relay skill). Rewritten at each handover; the last section has the owner's standing instructions, the relay parameters and Scheduling.

## 1. Goal

Owner's words (2026-11-02): "Get people using these projects, advertise these projects to get customers that may want me to build similar projects for them." "One way to be noticed is for github repos to be noticed, forked and get stars." Paid custom builds are the offer, part-time; "I care more about connections and being useful than money." "Built by Claude" is the headline. Customer priority: small businesses, startups, edtech, universities. Domain: hintwise.org (every app at `<app>.hintwise.org` since 8 Nov; docs/hintwise-migration.md).

Since 9 Nov the build routine builds one substantial project a week on a shared platform (section 14); this relay session runs the platform, the status reports and the owner's requests.

## 2. What is live (11 November)

- **Apps:** claude-built-apps has 63 deploy targets (*/deploy/target.yml); 64 hosts answer 200 (the 62 in platform/src/signin/app-hosts.ts plus upvoteme and paste-md, which live in their own repos). Every app has the shared footer (scripts/site-footer.mjs) except the own-repo apps, which embed the same markup (below). 61 pisan-labs mirrors (.github/mirrors.txt), synced on push and daily by halflife (04:13).
- **Newest app:** Qualified Overtime Checker (qualified-overtime-checker.hintwise.org), the first weekly build, finished 11 Nov (all 7 milestones, final deploy b46ccf1 at 11:13 UTC with its migration 0004). Its own handoff: qualified-overtime-checker/HANDOFF.md ("Remaining").
- **Shared platform** (docs/platform.md; platform/):
  - Supabase project `arktxlrlyceffyozdwhq` (also hosts UpvoteMe, WCV Live Together, how-of-happiness, a quiz app, chess_kv) on the custom domain **auth.hintwise.org** (add-on bought 9 Nov). Schema `platform` (profiles, llm_usage, sign-in log); per-app schemas `app_<slug>` with RLS: app_qualified_overtime_checker, app_stepwise. Migrations go through `supabase-admin.mjs migrate <slug>` (sha256-checked) then `expose-schema` and `check-schema` (the Deploy workflow runs them too).
  - Google sign-in through Supabase on the HintWise Google client; redirect allow-list `https://*.hintwise.org/**`.
  - **sign-in-link** Edge Function: email sign-in links from `HintWise <sign-in@hintwise.org>` via Resend, with a per-mailbox wait ladder (1, 3, 5, 8, 13, 21… min), per-IP and per-browser limits, Turnstile after 10 requests, a hard 100/hour per-IP stop, a project brake, a hashed log and alerts to ADMIN_EMAIL.
  - **Send Email hook ON since 11 Nov 08:56 UTC** (owner's yes; run 42990951896): Supabase Auth's own magic-link, sign-up, email and recovery mail is refused, except for the two external hosts in HOOK_EXTERNAL_HOSTS (how-of-happiness.netlify.app, wcv-live-together.netlify.app), which go through the same ladder. Undo: Supabase admin `email-hook` arg `off`. Owner confirmed email sign-in end to end on Qualified Overtime Checker and StepWise after the switch.
  - **llm-gateway** Edge Function (owner's Anthropic key behind per-app caps $2/day, $10/week, $20/month; BYOK always offered); no app registered yet.
  - Auth email limit 200 an hour (10 Nov).
- **Own-repo apps on the platform:**
  - UpvoteMe (pisanuw/upvote, Next.js on Netlify): Google through Supabase (#4), Google-compliant buttons and the shared footer (#5, 335af9e).
  - PasteMD (pisanuw/pastemd): Google through Supabase (#2), compliant buttons and the footer on every page (#3, 904fe66).
  - StepWise (pisan-labs/visualizing-data-structures, stepwise.hintwise.org): schema app_stepwise (migrations 0001–0003 applied from claude-built-apps/stepwise/), sign-in-link, compliant button and the footer on all 204 pages (b418072); final deploy 70155fe (11 Nov 10:32 Lisbon). **Its session relay ended at the owner's request**: new StepWise work starts by hand from HANDOFF.md on its `next` branch. Don't message that session.
- **backend-hub** on a paid Render instance (0.5c-512mb, owner set it 10 Nov).
- **Brand:** the HintWise logo (owner's choice 11 Nov): lowercase "hintwise", Outfit Regular + Bold, deep indigo #312E81 with coral #FF7A45 four-point sparks over dotless i's; files in platform/brand/ (4331076) with a usage guide. Not yet used anywhere live.
- **Routines (owner's, not relay):** ideas trig_01K986yzFbf3noGkLA6RgZkn 01:51 Pacific (10:51 CET); build trig_01BAP9nsXTtxTdpMiwk5GdXE 02:49 Pacific (11:49 CET). 11 Nov's ideas (cacc9cb) were saved after a CHANGES.md clash; ROUTINE.md now keeps both lines of an append-only CHANGES.md conflict (781948f, owner's default).
- **Heads at handoff:** claude-built-apps main 40b2c04 (before this commit), daily-project-ideas 781948f, upvote 335af9e, pastemd 904fe66, chess-tournament-director c785de7.

## 3. Landed 9 to 11 November (this session, session_01JyJzMZ1aBTZCRkUXLJnRG4)

- **9 Nov:**
  - weekly build model;
  - BUILD_ROUTINE.md rewrite and templates;
  - platform scaffolding (shared SQL, Supabase admin workflow, llm-gateway, usage report);
  - apply-shared, expose-schema, configure-auth (Resend SMTP, hintwise.org redirects);
  - Google provider moved to the HintWise client;
  - auth.hintwise.org;
  - PasteMD on Supabase sign-in;
  - research-map.hintwise.org.
- **10 Nov:**
  - UpvoteMe on Supabase sign-in and its netlify.app redirect;
  - BUILD_ROUTINE.md: the usual architecture, same-day continue, apps free, security review, Google branding rules;
  - StepWise schema and migrations;
  - check-schema in deploys;
  - email limit 200 an hour;
  - backend-hub paid;
  - sign-in-link and auth-email-hook built, reviewed twice, deployed (hook off), secrets set;
  - Google-compliant buttons and the shared footer for UpvoteMe and PasteMD (and StepWise via its session).
- **11 Nov:**
  - the email hook on (owner's yes), verified end to end;
  - Qualified Overtime Checker days 3–7 (by the build routine's sessions);
  - the HintWise logo and brand kit;
  - the email footer, logo header and opt-out built and reviewed (not shipped, section 4);
  - ideas saved and the ROUTINE.md conflict rule.

## 4. Branches not merged

- claude-built-apps **`feat/email-footer-optout`** (head 23fef9e, 18 commits ahead, up to date with main; CI green to c138138, 23fef9e was running). Ready to ship; **waits for the owner's yes** (section 6).
  - What it is:
    - every HintWise email gets a footer (why you got it, support@hintwise.org, the HintWise line with studio.hintwise.org, "Stop all email from HintWise");
    - Reply-To support@hintwise.org;
    - the logo header from EMAIL_LOGO_URL, with an indigo text header when unset;
    - indigo button and links;
    - the "HintWise" sign-off line removed (23fef9e, a separate commit: owner's default at 11:42, undo by dropping it);
    - a global opt-out: a stop-only signed footer link opens the `email-optout` Edge Function page on auth.hintwise.org (GET asks, POST stops, the "Done" page has an Undo valid one hour); sign-in-link answers `suppressed`, and the hook answers opted-out mail as sent and sends nothing;
    - support commands `email-optout status|add|remove` (remove only on a DMARC-passing request from that address or after a confirming reply);
    - `brand-upload` (public bucket `brand`, PNG/ICO only, one-day cache);
    - `optout-ready` deploy guard.
  - Independent security review: no blockers; all 12 points fixed (stop-only and undo tokens, deploy guard, hash-only logs, arg masking, quiet hook answers, no SVG upload, docs).
  - Tests: platform 347 tests, 99.8% coverage; qualified-overtime-checker 254; template 84.
  - Ship order, each a Supabase admin dispatch from main after a squash-merge:
    1. `apply-shared` (0003_email_optout.sql);
    2. `check-schema` with arg `platform`;
    3. `brand-upload` (prints EMAIL_LOGO_URL);
    4. `set-sign-in-secrets` (generates EMAIL_OPTOUT_SECRET once and sets EMAIL_LOGO_URL);
    5. `deploy-function` with arg `email-optout`;
    6. `deploy-function` with arg `sign-in-link` (the guard runs first);
    7. `deploy-function` with arg `auth-email-hook` (the guard runs first);
    8. `email-hook` with arg `check`;
    9. live test: a sign-in link to pisan@uw.edu (logo, footer, Reply-To), Stop, Done, Undo within the hour; `email-optout` with arg `status` and the `email` input, then check the log shows only the hash.
  - Not verified live:
    - Storage's bucket create/upload shapes;
    - the `sb_secret_` key passthrough on the functions gateway;
    - GitHub's masking of the `email` input in a real run.
  - Never rotate EMAIL_OPTOUT_SECRET or SIGN_IN_HASH_KEY: that drops every opt-out and breaks every link already sent.
- Older branches not from this session (`claude/fix-mobile-overflow`, `claude/magical-cray-*`, `claude/wonderful-tesla-lgdegm`): not reviewed. `feat/sign-in-link` and `platform-scaffold` are merged (the git proxy refused to delete them).

## 5. Next, in order

1. **On the owner's yes, ship the email work** (section 4's order), then mark platform/brand/README.md "Where it is used" and CHANGES.md.
2. **Self-service account deletion** (platform). Owner approved it for after this week's build, and the build finished 11 Nov. Asked 11:36 whether to start once the email work ships (recommended yes). Design: a signed-in "Delete my account" that deletes the auth user (rows cascade per app schema), with confirmation; StepWise already has `delete_my_data()` for its own rows.
3. **app-notify sender** (approved 10 Nov "1-3 yes", after account deletion):
   - a daily Edge Function that reads each registered app's releases feed (StepWise `releases.json`, stable ids) and its opt-in rows (StepWise grants service_role select on app_stepwise.preferences and update of notify_new_pages);
   - it sends from `<slug>@hintwise.org` with a one-click unsubscribe (List-Unsubscribe) and the per-app level of the opt-out, and records sends.
   - **It needs a postal address in the footer before its first send** (CAN-SPAM; owner said omit for now).
   - StepWise's side now needs a new StepWise session, which the owner starts by hand.
4. **Logo rollout:** a small mark in the shared site footer (scripts/site-footer.mjs). It reaches each app on its next deploy; don't redeploy all (each Netlify deploy costs credits). Favicons and social images later.
5. **Watch the build routine's next run:** 12 Nov 11:49 CET is day 1 of a new project. It must use the platform template's sign-in (sign-in-link, the branded button), because direct signInWithOtp mail is refused while the hook is on.

## 6. Waiting on the owner

1. **Ship the email footer, logo header and opt-out** (asked 11 Nov 11:43 Lisbon; recommended yes; reply "yes ship"). It deploys to production and changes the shared database, so it waits for an explicit yes.
2. **Start account deletion after the ship** (asked 11:36; recommended yes; not urgent until the ship is done).
3. **Postal address or PO box** for opt-in app emails: only before app-notify's first send.
4. Older, not confirmed since 8 Nov:
   - test Google sign-in on MeetMe, Chess TD and Digital Yusuf;
   - re-run `python3 scripts/pisan_labs_setup.py` locally so pisan-labs repo homepages show hintwise.org;
   - post launch drafts 1–7 (docs/launch-drafts.md), one at a time, days apart.
5. Qualified Overtime Checker follow-ups: qualified-overtime-checker/HANDOFF.md "Owner actions" and "Remaining"; its pisan-labs mirror comes from the halflife job or `scripts/pisan_labs_setup.py` then the Mirror workflow.

## 7. Dated tasks

- 12 Nov 11:49 CET: the build routine starts a new weekly project (day 1); check it uses the platform's sign-in (section 5 item 5).

## 8. Decisions and why

- Monorepo stays the source of truth; pisan-labs repos are `git subtree split` mirrors (mirror.yml + .github/mirrors.txt).
- Each mirrored app folder carries its own LICENSE and `.github/workflows/ci.yml` (inert in the monorepo, active in the mirror).
- tetromino-arcade not mirrored or promoted: Tetris trademark/trade-dress risk.
- Subdomains are named after the package folder, not the Netlify site name.
- **Netlify deploys cost credits.** A push deploys only targets whose target.yml changed (plus shortcut-sprint and code-analogy-forge source changes); runner and footer changes need a manual Deploy run. Docs-only commits carry [skip netlify].
- Every app's primary address is `<app>.hintwise.org`; target.yml keeps `customDomain: <app>.pisan.me` and the runner swaps in APP_DOMAIN (scripts/domains.mjs).
- Footer text and line breaks are the owner's (8 Nov). Own-repo apps embed the exact `footerHtml('<netlify-project-name>')` output with a sha256 test (UpvoteMe, PasteMD, StepWise).
- Public pages are written for customers: no scores, competitors, build time or test counts.
- Small business first for new ideas and builds (owner, 2 Nov).
- **One substantial project a week** (owner, 9 Nov), on the usual architecture (BUILD_ROUTINE.md table): Netlify, Render via backend-hub only when a long-running server is unavoidable, the shared Supabase project (schema per app, RLS), Resend, Google via Supabase. All are paid accounts. Apps are free unless the owner says otherwise. A security review runs on auth, RLS, functions and email milestones.
- **No Resend sending subdomains** (each counts against the plan's domain limit, owner 10 Nov): app mail comes from `<slug>@hintwise.org`; sign-in mail from sign-in@hintwise.org.
- **Google sign-in buttons follow Google's branding guidelines** (owner, 10 Nov): "Continue with Google"/"Sign in with Google", Google's unmodified G (signin-assets.zip, cropped to its 20×20 G), light #FFFFFF/#747775/#1F1F1F or dark #131314/#8E918F/#E3E3E3, Google Sans Medium 14/20, 40px, and the email option no more prominent. The template's button is correct.
- **The email hook is on**; apps send email sign-in through sign-in-link, never `signInWithOtp`.
- **Email footer and opt-out** (owner, 11 Nov):
  - a short footer on every HintWise email, with support@hintwise.org, which reaches the owner through Cloudflare catch-all routing;
  - two levels of opt-out: per app later with app-notify, and "Stop all email from HintWise" now, which includes sign-in links;
  - no postal address until app-notify;
  - logo hosted in a public Supabase bucket on auth.hintwise.org.
- **Logo** (owner, 11 Nov): A1 in deep indigo #312E81 with coral sparks, sparks on tiny icons too (platform/brand/).
- The JWT secret exposure of 9 Nov: the owner accepts the risk; **do not raise rotation again**.
- A deploy needs no yes when the owner asked for the change; any other production deploy, database change or Netlify build waits for a yes.

## 9. Tried and rejected

- GIF of emoji-lingua via a mocked API: it would show output live visitors never get.
- Proxied Cloudflare records for Netlify hosts: Netlify cannot issue certificates through the proxy (a moved `<x>.pisan.me` record is proxied on purpose so the redirect rule answers it).
- Redeploying all apps on every deploy.mjs edit: ran Netlify out of credits on 2 Nov.
- A database trigger on auth.users: Supabase refuses it; apps call `platform.ensure_profile()` after sign-in.
- Resend subdomains per app: rejected for plan limits (above).

## 10. Constraints and gotchas

- User preferences: ask before spending money (Netlify deploys and builds, paid APIs), deploying to production unless asked, writing production data, publishing outside the session, deleting the unrestorable, rotating secrets. Push to main is fine. Number questions with a recommendation; with no answer in 15 minutes take the recommendation and say how to undo it (never for the explicit-yes actions).
- Conventional Commits enforced by `.git-hooks/commit-msg` (`git config core.hooksPath .git-hooks`); merge commits need a conventional message too.
- Other machines and sessions push to main (the build routine daily, the ideas routine): `git fetch` before work and before pushing; merge, never force-push.
- Supabase admin workflow: dispatch one run at a time (the concurrency group replaces a pending run with a newer one); don't dispatch in parallel with the push it depends on. Its logs are public, so nothing secret or personal may be printed.
- Repo settings (description, topics, homepage) can't be written from a cloud session.
- Secrets (names only): NETLIFY_AUTH_TOKEN, RENDER_API_KEY, MIRROR_TOKEN, CLOUDFLARE_API_TOKEN, CLOUDFLARE_ZONE_ID, ANTHROPIC_API_KEY, RESEND_API, ADMIN_EMAIL, COOKIE_SECRET, SUPABASE_ACCESS_TOKEN, SUPABASE_DB_PASSWORD, SUPABASE_SERVICE_ROLE_KEY, TURNSTILE_SECRET (and TURNSTILE_SITE_KEY variable).
- Netlify: a new domain gets its certificate only after POST /sites/{id}/ssl/renew. Cloudflare free plan: wildcard_replace only. Netlify env PATCH can't set the `all` context.
- Render's API refuses free-to-paid plan changes; the owner changes plans in the dashboard.
- Supabase serves HTML from Edge Functions only on the custom domain (auth.hintwise.org), not on *.supabase.co.
- Known small issues not fixed: cron-cartographer's "last day of the month", summit-navigator's now/next bar far east of ET, pull-the-pin's re-render.

## 11. How to run and verify

- Per app (from its folder): `npm ci && npm run lint && npm run typecheck && npm run coverage && npm run build`.
- Platform (platform/): `npm run lint && npm run typecheck && npm run coverage` (plus `npm run check-scripts`, `npm run check-app-hosts`).
- Footer tests: `node --test scripts/site-footer.test.mjs`.
- Supabase admin: Actions > Supabase admin > Run workflow (command, arg, flags, email); commands are listed at the top of .github/workflows/supabase-admin.yml.
- Deploy named apps: Actions > Deploy > targets `app-a app-b`.
- Live check: `curl -s https://<app>.hintwise.org/ | grep -c data-site-footer`.
- Ideas site: `node build.js && node scripts/smoke_pages.js` in daily-project-ideas.

## 12. Key files

- README.md, PROJECTS.md: public pitch and catalog; BUILD_ROUTINE.md: the weekly build routine; docs/templates/.
- docs/platform.md: the platform design and runbook; platform/README.md: first-time order; platform/supabase-admin.mjs + .github/workflows/supabase-admin.yml.
- platform/src/signin/ (sign-in-link, hook, README), platform/supabase/functions/, platform/supabase/shared/*.sql, platform/templates/app/.
- platform/brand/: the logo and usage guide.
- scripts/site-footer.mjs; */deploy/target.yml; accessibility-lens/deploy/deploy.mjs.
- stepwise/: StepWise's migrations and README (applied from here).
- CHANGES.md, BRIEFING.md; daily-project-ideas: ROUTINE.md, studio.json, implemented.json.

## 13. Background jobs

Relay routines (Scheduling below), the owner's ideas and build routines (section 2), and the notify-implemented email at 9:10am Pacific (GitHub Actions). No subagents are running at this handoff.

## 14. Weekly builds and platform

The build routine (BUILD_ROUTINE.md) picks a substantial idea (small business first), builds one milestone a day for up to 7 days in fresh sessions resuming from `<slug>/HANDOFF.md`, and continues the same day when time allows. The first build, Qualified Overtime Checker, finished in 2 days of wall time (10–11 Nov). The relay session supports the builds: applying migrations for own-repo apps, platform features, and reviewing anything touching auth or email.

## Notes for the next session

### Owner's standing instructions
- Ask first, and wait for the answer, before: writing production data; deploying to production unless asked; spending money; deleting the unrestorable; rotating secrets; rewriting shared history; publishing outside the session. Push to main is fine.
- Number questions with a recommendation, in message text (no blocking dialogs). With a recommendation and no answer in 15 minutes, take it and say how to undo it (never for the explicit-yes list). Set a send_later check-in for 15 minutes when something waits on an answer.
- **Times in Lisbon time** (Europe/Lisbon; owner, 9 Nov), in reports and chat. Routines keep their Europe/Berlin crons.
- Hourly check with nothing new: send nothing (no file, no message).
- Public pages are for customers (section 8). Never invent facts about the owner in his voice.
- CHANGES.md is append-only, `YYYY-MM-DD [type] text` (≤200 chars); Conventional Commits; no model names in repo artifacts.
- Never ask the owner to paste tokens or keys in chat; never print secret values.

### Relay parameters (session-relay skill)
| Parameter | Value |
|---|---|
| Repository | pisanuw/claude-built-apps (also daily-project-ideas, pisanorg/yusuf, pisan-labs/chess-tournament-director, pisanuw/upvote, pisanuw/pastemd; read-only dashboards, chess-analyzer) |
| Handoff document | HANDOFF.md (this file) |
| Routine time zone | Europe/Berlin |
| Report time zone | Europe/Lisbon |
| Handover check | 13:56 Europe/Berlin |
| Session start | 14:52 Europe/Berlin |
| Handoff marker | a commit on main titled `docs: the handoff of <D Month>` (this project pushes docs to main, no PR); no other commit may use that subject |
| Merge rule | push to main after `node --test scripts/site-footer.test.mjs` passes |

### Scheduling
- Previous session: session_01JyJzMZ1aBTZCRkUXLJnRG4 ("Plabs: Nov 8"), created 8 Nov 2026 by create_session from session_01JyJzMYaEBiQ8ixgKSDb4Lu, lineage depth 2 of limit 8. Handed over on 11 November 2026 at 66% context (657,961 of 1,000,000 tokens). The 14:52 Europe/Berlin start routine creates the next session (depth 3 of 8).
- Relay routines (currently aimed at the previous session; the new session moves them):
  - trig_01NAfm62qztXkR5RUrYuPXZy: Plabs hourly status report, `46 * * * *`
  - trig_01DDT69peni1JYMUF8dyCCCK: Plabs handoff check, `CRON_TZ=Europe/Berlin 56 13 * * *`
  - trig_01GfNe88huewMUQ7tk5Rxx4t: Plabs session start, `CRON_TZ=Europe/Berlin 52 14 * * *`
- One-shot check-ins from the previous session have all fired; disabled ones (e.g. trig_01GXgEy75jjqyW6uVe5bfDPg, trig_01ATSrYiV8dttFXM3PuaSVof) may be deleted by the new session.
- Not relay, leave alone: the owner's ideas (trig_01K986yzFbf3noGkLA6RgZkn) and build (trig_01BAP9nsXTtxTdpMiwk5GdXE) routines; the Chess TD, Chess Analyzer and DSA relays (other sessions); the StepWise relay has ended (its session is archived); TPT daily product builder; research-map; SIGCSE poster reminder.
