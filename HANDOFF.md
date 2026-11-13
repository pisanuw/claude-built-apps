# Handoff: get users, get noticed

Rolling handoff for the Plabs relay (session-relay skill). Rewritten at each handover; the last section has the owner's standing instructions, the relay parameters and Scheduling.

Written 13 November 2026 by session_01JyJzMXxeHu9P7By5BXRNJv and fact-checked the same day by a separate agent against git, the Actions runs, the routines list and the live hosts. Not verified: signed-in gateway calls (check, reading, grant) and photo2pgn "My games" from a real account — the owner tests those; the halflife sync time.

## 1. Goal

Owner's words (2026-11-02): "Get people using these projects, advertise these projects to get customers that may want me to build similar projects for them." "One way to be noticed is for github repos to be noticed, forked and get stars." Paid custom builds are the offer, part-time; "I care more about connections and being useful than money." "Built by Claude" is the headline. Customer priority: small businesses, startups, edtech, universities. Domain: hintwise.org (every app at `<app>.hintwise.org` since 8 Nov; docs/hintwise-migration.md).

Since 9 Nov the build routine builds one substantial project a week on a shared platform (section 14); this relay session runs the platform, the status reports and the owner's requests.

## 2. What is live (13 November)

- **Apps:** claude-built-apps has 65 deploy targets (*/deploy/target.yml); the apps answer 200 under `<app>.hintwise.org`. Every monorepo app has the shared footer (scripts/site-footer.mjs) injected at deploy; own-repo apps embed the same markup with a sha256 test. pisan-labs mirrors sync on push and daily by halflife (04:13).
- **Shared platform** (docs/platform.md; platform/): all tests green, 404 at this handoff.
  - Supabase project `arktxlrlyceffyozdwhq` on **auth.hintwise.org**. Schema `platform`; per-app schemas `app_<slug>` with RLS. Migrations through `supabase-admin.mjs migrate <slug>` then `expose-schema` and `check-schema`.
  - Google and email sign-in (sign-in-link Edge Function, branded button, wait ladder, limits, hashed log). Send Email hook ON since 11 Nov.
  - **llm-gateway** Edge Function (owner's Anthropic key behind caps; BYOK always offered). Since 13 Nov it also: counts a person's successful calls per app (reading caps, `shared/0007`); answers a **check mode** `{app, check: true}` with `allowance()` (no model call, no cost); **spends credits** once the free allowance is used up, reserving before the call and refunding on failure (`shared/0008`); and records who used each app on every check and call (`platform.app_users`, `shared/0009`).
  - **credits-grant** Edge Function: a HintWise admin grants credits by email `{app, email, credits, note?}`, or lists an app's people `{app, list: true, limit?}` (email, first/last seen, free_left, free_resets_at, credits, readings). Non-admins 403. Admins are in `platform.admins`, changed only by the Supabase admin `admin add|remove|list` command (address masked in the log). **The owner is the first and only admin** (13 Nov 09:13 UTC).
- **photo2pgn** (pisan-labs/photo2pgn, own repo; its own relay session_01JyJzMW9Bz6EAJvfv2NPJQd): live at **photo2pgn.hintwise.org** (main 3f3f41c and later), listed on HintWise Studio (Photo to PGN). See section 4.
- **delivery-canary** (delivery-canary.hintwise.org): the weekly build in progress, day 2 done 13 Nov (unfulfilled digital-order scan). Footer present. Its own handoff: delivery-canary/HANDOFF.md.
- **Own-repo apps on the platform:** UpvoteMe (pisanuw/upvote), PasteMD (pisanuw/pastemd), StepWise (stepwise.hintwise.org; its relay ended, new work by hand) — all with Supabase sign-in, compliant Google button and the footer.
- **Brand:** the HintWise logo and kit in platform/brand/; the footer mark reaches apps on each deploy.
- **Heads at handoff:** claude-built-apps main 52f0bfa (before this commit), daily-project-ideas 02b2135, upvote f4bcacb, pastemd 111fd72, chess-tournament-director (its relay).

## 3. Landed 12–13 November (this session, session_01JyJzMXxeHu9P7By5BXRNJv)

- **12 Nov:** photo2pgn platform support (sign-in functions redeployed, domain attached, its own gateway caps, migration applied, max_tokens 8000→12000); gateway per-app **user caps** (shared/0006, caps.ts); the **new-app guide** (docs/new-app-guide.md) with its Spending-limits section; Delivery Canary key wiring and day 1; Chess TD footer (its session); Photo to PGN added to HintWise Studio (daily-project-ideas 0181ff9); the launchd-agent installer for photo2pgn's CLI reader; Four Ghosts (11 Nov, finished).
- **13 Nov:**
  - gateway **reading caps + check mode** (shared/0007, `app-user-day-calls`/`app-user-week-calls`, `allowance()`); photo2pgn set to 3 readings/day, 9/week, cross-app $1/day;
  - **credits slice 1** (shared/0008): platform.credits, credit_ledger, platform.admins, `paid_with_credit`; the gateway spends/reserves/refunds credits; credits-grant function; the Supabase admin `admin` command; owner made first admin;
  - **admin list of an app's people** (shared/0009 platform.app_users, recorded by the gateway + backfill; credits-grant `{list: true}`);
  - photo2pgn's no-truncation engine, gateway-only public readings, credits screen and admin panel (all by its session, on the owner's yes);
  - fixed a flaky popup-check test (fc1e1b6) and check-schema's treatment of platform.llm_apps as shared by design (a4a13f7);
  - resumed the stalled ideas routine (pushed 02b2135); read-only credits-status ops query.

## 4. photo2pgn (its own session drives it; Plabs does the platform)

Live and listed. The owner's choices this cycle, all applied:
- **max_tokens 12000** (readings no longer truncate; 8000 failed past ~75 moves; measured ~$0.12 a sheet on Opus).
- **Caps:** per person 3 readings/day, 9/week (reading caps, not dollars); cross-app per-person $1.00/day so a long game can't cut the 3 short; app ceiling $1/day, $5/week, $10/month unchanged.
- **Saved games** (`app_photo2pgn.games`, own-row RLS) applied and exposed; check-schema passed; anon refused (42501).
- **Public readings gateway-only** (VITE_FREE_READER=gateway, main 3f3f41c): the halflife CLI reader gets no jobs (keep it, or `bash ~/install-pgn-worker-agent.sh uninstall`); the subscription-terms question no longer applies to public traffic.
- **Credits:** 1 credit = 1 sheet, photo2pgn only; its credits screen ("Use my N credits") and admin panel are live; the "List users" button is built on its branch (d1fd765), waiting for the owner's yes to deploy.

Still open / waiting on the owner:
- **Test from a real account:** a check, a reading, and a grant (grant self 1 credit → "Check balance" → read a sheet); and **"My games"** on a second device. The owner confirmed the credits screen and admin panel show, but not a grant's resulting balance or a saved-game round trip.
- **Deploy photo2pgn's "List users"** (d1fd765) — its session waits for the owner's yes.
- **Paddle (slice 2):** needs the owner's account and prices (proposed 20 credits/$5, 50/$10, never expire). Before selling, raise the $1/day app cap, since paid readings count against it.
- Chess TD asked photo2pgn for a scoresheet-reading API; photo2pgn recommends sharing its reading code instead (a server-side reading would need a key in a function). Undecided; if Chess TD reads through the gateway it needs its own llm_apps row and caps (owner's numbers).

## 5. Next, in order

1. **photo2pgn:** on the owner's yes, its session deploys "List users"; then confirm the live list shows the owner with his credits. Verify a real grant and reading when the owner tests.
2. **Older photo2pgn asks** carried from the platform side are all done; nothing Plabs owns is blocked.
3. **app-notify sender** (approved 10 Nov, transactional only, no postal address): a daily Edge Function reading each app's releases feed and opt-in rows, from `<slug>@hintwise.org` with one-click unsubscribe. Not started; StepWise's side needs a new StepWise session the owner starts by hand.
4. **Logo rollout** in the shared footer reaches apps on each deploy; don't redeploy all (credits). Favicons and social images later.
5. **Watch the build routine** (11:49 CET daily): Delivery Canary day 3 next. It must use the platform template's sign-in.

## 6. Waiting on the owner

1. **Test photo2pgn from a real account** (section 4): a grant + reading, and "My games" on two devices.
2. **Yes to deploy photo2pgn's "List users"** (d1fd765) — relayed to its session, not to Plabs; no Plabs action.
3. Older, not confirmed since 8 Nov: test Google sign-in on MeetMe, Chess TD and Digital Yusuf; re-run `scripts/pisan_labs_setup.py` locally for pisan-labs homepages; post launch drafts 1–7 (docs/launch-drafts.md), one at a time.
4. Qualified Overtime Checker follow-ups: qualified-overtime-checker/HANDOFF.md.

## 7. Dated tasks

- Each day 11:49 CET: the build routine advances the weekly project (Delivery Canary); check it uses the platform's sign-in.

## 8. Decisions and why

- Monorepo is the source of truth; pisan-labs repos are `git subtree split` mirrors (mirror.yml + .github/mirrors.txt). Each mirrored folder carries its own LICENSE and inert ci.yml.
- **Netlify deploys cost credits.** A push deploys only targets whose target.yml changed (plus shortcut-sprint and code-analogy-forge source); runner/footer changes need a manual Deploy run. Docs-only commits carry `[skip netlify]`.
- Every app's primary address is `<app>.hintwise.org`; target.yml keeps `customDomain: <app>.pisan.me` and the runner swaps in APP_DOMAIN.
- Public pages are written for customers: no scores, competitors, build time or test counts.
- Small business first for ideas and builds. One substantial project a week on the usual architecture (BUILD_ROUTINE.md); all accounts paid; a security review on auth/RLS/functions/email.
- No Resend sending subdomains; app mail from `<slug>@hintwise.org`, sign-in mail from sign-in@hintwise.org.
- Google sign-in buttons follow Google's branding guidelines; the template's button is correct.
- The email hook is on; apps send sign-in through sign-in-link, never `signInWithOtp`.
- **Gateway spending** (owner, 12–13 Nov): each app has dollar caps (day/week/month) as a ceiling and optional per-person caps in dollars or **readings** (successful calls). **Credits** pay once the free allowance is used up, never past the app ceiling; taken before the call, refunded on failure; calls paid with a credit don't count against the free allowance. The gateway checks spend-so-far (no reservation of an estimate), so one call can overshoot a dollar cap. `platform.llm_apps` is readable by any signed-in user by design (apps and caps, no secrets); check-schema treats it as shared (SHARED_TABLES).
- **Admins** (`platform.admins`) may grant credits and list an app's people; changed only by the Supabase admin workflow, never by apps; the email never leaves the database in a grant/list (looked up server-side).
- The JWT secret exposure of 9 Nov: the owner accepts the risk; **do not raise rotation again**. Never rotate EMAIL_OPTOUT_SECRET or SIGN_IN_HASH_KEY. Never replace DELIVERY_CANARY_KEY once stored.
- A deploy needs no yes when the owner asked for the change; any other production deploy, database change or Netlify build waits for a yes.

## 9. Tried and rejected

- A second SQL copy of the cap rules for the check mode: rejected; the gateway's check mode reuses `decide()`/`allowance()` so the list and the page can't drift from what the gateway enforces.
- A separate `seen()` RPC for photo2pgn to call on sign-in (photo2pgn's proposal): not needed; the gateway records each visit on every check and reading from the verified token.
- Redeploying all apps on every deploy.mjs edit: ran Netlify out of credits on 2 Nov.
- A database trigger on auth.users: Supabase refuses it; apps call `platform.ensure_profile()` after sign-in.

## 10. Constraints and gotchas

- User preferences: ask before spending money, deploying to production unless asked, writing production data, publishing outside the session, deleting the unrestorable, rotating secrets, rewriting shared history. Push to main is fine. Number questions with a recommendation; with no answer in 15 minutes take it and say how to undo it (never for the explicit-yes actions).
- Conventional Commits enforced by `.git-hooks/commit-msg` (`git config core.hooksPath .git-hooks`).
- Other machines and sessions push to main (build and ideas routines): `git fetch` before work and before pushing; merge, never force-push.
- Supabase admin workflow: dispatch one run at a time; its logs are public, so nothing secret or personal may be printed. The `sql` command prints only the **last** statement's result (combine with UNION, as credits-status.sql does).
- Repo settings can't be written from a cloud session. Secrets are set in the repo, never pasted in chat.
- Netlify: a new domain gets its certificate after the ssl request (Netlify retries; the runner's HTTP 200 over real TLS is the live check). Supabase serves Edge Function HTML only on auth.hintwise.org.

## 11. How to run and verify

- Per app (from its folder): `npm ci && npm run lint && npm run typecheck && npm run coverage && npm run build`.
- Platform (platform/): `npm run lint && npm run typecheck && npm run coverage` (plus `npm run check-scripts`, `npm run check-app-hosts`).
- Footer tests: `node --test scripts/site-footer.test.mjs`.
- Supabase admin: Actions > Supabase admin > Run workflow (command, arg, flags, email); commands listed atop .github/workflows/supabase-admin.yml. Credits totals: `sql` with `platform/supabase/ops/credits-status.sql` (no names/emails).
- Live check: `curl -s https://<app>.hintwise.org/ | grep -c data-site-footer`.
- Gateway check mode (a signed-in token): POST auth.hintwise.org/functions/v1/llm-gateway `{app, check: true}`.

## 12. Key files

- README.md, PROJECTS.md, BUILD_ROUTINE.md, docs/new-app-guide.md (standard new-app instructions), docs/platform.md.
- platform/supabase-admin.mjs + .github/workflows/supabase-admin.yml; platform/supabase/shared/*.sql (0006 user caps, 0007 reading caps + check, 0008 credits, 0009 app_users); platform/supabase/ops/ (photo2pgn caps, backfills, credits-status).
- platform/src/gateway/ (caps.ts: decide/allowance/funding; request.ts; pricing.ts), platform/src/credits/ (grant.ts, list.ts), platform/supabase/functions/ (llm-gateway, credits-grant, sign-in-link, …).
- photo2pgn/ (migrations copied here, README, halflife/install-pgn-worker-agent.sh).
- scripts/site-footer.mjs; */deploy/target.yml; CHANGES.md, BRIEFING.md; daily-project-ideas: ROUTINE.md, studio.json.

## 13. Background jobs

Relay routines (Scheduling below), the owner's ideas (10:51 CET) and build (11:49 CET) routines, the halflife pisan-labs sync (04:13), and the notify-implemented email (9:10am Pacific). No subagents running at this handoff (the fact-check subagent for this handoff aside).

## 14. Weekly builds and platform

The build routine (BUILD_ROUTINE.md) picks a substantial idea (small business first), builds one milestone a day for up to 7 days in fresh sessions resuming from `<slug>/HANDOFF.md`. The relay session supports the builds: applying migrations for own-repo apps, platform features, and reviewing anything touching auth or email.

**Aborted builds (do not pick or resume):** daily-project-ideas `ideas/2026-11-10.json` #1, "Off-TPT Catalog Kit" (folder `teacher-catalog-kit/`): aborted and taken down 11 Nov; the folder stays as the record that keeps the idea from being picked again.

## Notes for the next session

### Owner's standing instructions
- Ask first, and wait for the answer, before: writing production data; deploying to production unless asked; spending money; deleting the unrestorable; rotating secrets; rewriting shared history; publishing outside the session. Push to main is fine; deleting already-merged branches is fine.
- Number questions with a recommendation, in message text (no blocking dialogs). With a recommendation and no answer in 15 minutes, take it and say how to undo it (never for the explicit-yes list). Set a send_later check-in for 15 minutes when something waits on an answer.
- **Times in Lisbon time** (Europe/Lisbon) in reports and chat. Routines keep their Europe/Berlin crons.
- **Quiet hours are silent:** when an hourly check finds nothing new, print nothing at all — no file, no message, not even a "nothing changed" line.
- Public pages are for customers. Never invent facts about the owner in his voice.
- CHANGES.md is append-only, `YYYY-MM-DD [type] text` (≤200 chars); Conventional Commits; no model names in repo artifacts. Run the repo's lint/tests before committing.
- Never ask the owner to paste tokens or keys in chat; never print secret values; never put a secret in a workflow input (inputs and logs are public).
- The owner's key is used only through the gateway: no Anthropic key in Netlify or in apps.

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
- Previous session: session_01JyJzMZ1aBTZCRkUXLJnRG4 ("Plabs: Nov 8"), lineage depth 2 of 8, handed over 11 November.
- **Current session: session_01JyJzMXxeHu9P7By5BXRNJv ("Plabs: Nov 11")**, took over 11 November 2026 (created 13:53 UTC by the start routine), lineage **depth 3 of limit 8**. Handed over on **13 November 2026 at 57% context** (573,007 of 1,000,000 tokens). The 14:52 Europe/Berlin start routine creates the next session (depth 4 of 8; depth + 1 = 4 ≤ 8, so create_session will not refuse).
- Relay routines (aimed at the current session; the next session re-aims them at itself and deletes these):
  - trig_01DF97CqMqhDtJLS2LiVwjc5: Plabs hourly status report, `46 * * * *`
  - trig_01Wxj14aKZPbxNMZZ4cFqDy5: Plabs handoff check, `CRON_TZ=Europe/Berlin 56 13 * * *`
  - trig_01FBwDwP9XRuBfkaCzyRPVg4: Plabs session start, `CRON_TZ=Europe/Berlin 52 14 * * *`
- Not relay, leave alone: the owner's ideas (trig_01K986yzFbf3noGkLA6RgZkn) and build (trig_01BAP9nsXTtxTdpMiwk5GdXE) routines; the Chess TD, Chess Analyzer and DSA relays (other sessions); the StepWise relay has ended; TPT daily product builder; research-map; SIGCSE poster reminder.
