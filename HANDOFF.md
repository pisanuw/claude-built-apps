# Handoff: get users, get noticed

This is the rolling handoff for the Plabs relay (session-relay skill). Each handover rewrites it. The last section holds the owner's standing instructions, the relay parameters and Scheduling.

Written 14 November 2026 by session_01JyJzMWixW7SqcHTri4Umng, on the owner's "do handoff", and fact-checked the same day by a subagent against git, the Actions runs and the routines list.

Times carry their zone. Commit times are Europe/Berlin (the routine time zone); reports to the owner use Europe/Lisbon.

Not verified:
- upvote's Netlify build on Node 24 (the site answers 200);
- live-together's deploy (its live address is unknown here);
- Resend accepting app-notify's List-Unsubscribe headers (first real email).

## 1. Goal

Owner's words (2026-11-02): "Get people using these projects, advertise these projects to get customers that may want me to build similar projects for them." "One way to be noticed is for github repos to be noticed, forked and get stars."

- The offer is paid custom builds, part-time: "I care more about connections and being useful than money."
- "Built by Claude" is the headline.
- Customer priority: small businesses, startups, edtech, universities.
- Domain: hintwise.org. Every app has been at `<app>.hintwise.org` since 8 Nov (docs/hintwise-migration.md).

Since 9 Nov the build routine builds one substantial project a week on a shared platform (section 14). This relay session runs the platform, the status reports and the owner's requests.

## 2. What is live (14 November)

- **Apps:**
  - claude-built-apps has 65 deploy targets (*/deploy/target.yml), and the apps answer 200 under `<app>.hintwise.org`.
  - Every monorepo app gets the shared footer (scripts/site-footer.mjs) at deploy. Own-repo apps embed the same markup, checked by a sha256 test.
  - pisan-labs mirrors sync on each push, and daily from halflife (04:13, zone not recorded; unverified).
- **Toolchain:** CI, the deploy job and all ops workflows run on Node 24, with actions/checkout, setup-node and setup-python v7 and supabase/setup-cli v2.
  - The first production deploy on Node 24 was Delivery Canary day 3: Deploy run 181, 14 Nov 12:16 Berlin.
  - CI has a concurrency group (`ci-<ref>`, cancel-in-progress): a superseded run on main shows as cancelled, which is not a failure.
  - CI on main is green at f8909ae.
- **Shared platform** (docs/platform.md; platform/):
  - **Supabase** project `arktxlrlyceffyozdwhq`, served on **auth.hintwise.org**.
    - Schema `platform`, and per-app schemas `app_<slug>` with RLS.
    - Migrations go through `supabase-admin.mjs migrate <slug>`, then `expose-schema` and `check-schema`.
  - **Sign-in:** Google and email, through the sign-in-link Edge Function. The Send Email hook has been on since 11 Nov.
  - **llm-gateway:** the owner's Anthropic key behind caps; bring-your-own-key is always offered. It has:
    - reading caps (shared/0007);
    - check mode `{app, check: true}`, which makes no model call;
    - credits, reserved before the call and refunded on failure (shared/0008);
    - `platform.app_users`, recording who used each app (shared/0009).
  - **credits-grant:** admins grant credits or list an app's people (shared/0010). The owner is the only admin.
  - **app-notify** (shared/0011, 0012):
    - The email-optout and app-notify functions are deployed.
    - pg_cron job app-notify-daily runs at 15:17 UTC.
    - **StepWise is registered and enabled**, with `seeded_at` null until the first run.
    - The feed is https://stepwise.hintwise.org/notify-feed.json: 4 items, the newest being the AI and LLMs release of 14 Nov. The first run absorbs all four silently.
- **photo2pgn** (pisan-labs/photo2pgn, its own repo and its own relay session_01JyJzMW9Bz6EAJvfv2NPJQd) is live at photo2pgn.hintwise.org. See section 4.
- **delivery-canary** (delivery-canary.hintwise.org) is the weekly build, day 3 of 7 done on 14 Nov:
  - day 1: delivery-email check;
  - day 2: late download orders;
  - day 3: seed inbox check over IMAP, with a sealed app password and migration 0003.

  Its own handoff is delivery-canary/HANDOFF.md.
- **Own-repo apps on the platform:**
  - UpvoteMe (pisanuw/upvote, main af3c376, now on Node 24);
  - PasteMD (pisanuw/pastemd);
  - StepWise (stepwise.hintwise.org, its own session session_01JyJzMZ3W1yMJWwuFJ1PTXM). StepWise's live footer still lacks the logo mark; the fix waits on StepWise's `next` (section 5).
- **MeetMe:** its Resend webhook is at https://meetme.hintwise.org/api/webhooks/resend.
  - The owner changed it on 14 Nov after Resend disabled the pisan.me one, and a bounce test passed.
  - Digital Yusuf's inbound webhook (chatwithdigitalme.onrender.com) never used pisan.me and answers correctly.
- **Brand:** the HintWise logo and kit are in platform/brand/. The footer mark reaches each app on its next deploy.
- **Heads at handoff:** claude-built-apps main f8909ae (before this commit), upvote af3c376, live-together 9abd470.

## 3. Landed since the last handoff (13 Nov 14:29 Berlin → 14 Nov), this session

- **13 Nov:**
  - Names and app counts in the admin list (15:33, 1b6fc57). photo2pgn's "List users" was deployed by its session.
  - **app-notify:**
    - per-app email opt-out tokens with RFC 8058 one-click, and the sender (merged 16:06, 0de473e);
    - the notify_opted_in fix (16:14, fb53875);
    - the notify-schedule command (16:45, dbb4259), and the daily schedule turned on;
    - the StepWise opt-in count and registration SQL (20:50, 2cfaaaa), and StepWise switched on (~21:50).
  - fide-lookup.hintwise.org (19:06, docs).
  - **GitHub Actions off Node 20** (owner's yes):
    - action versions to v7, and setup-cli to v2 (22:38, e035174);
    - Node 22 for the 24 app jobs still on Node 20 (one commit each), site-footer, the deploy job and 13 ops workflows (22:41–22:45, cb09594..831fa2f). The other 43 jobs were already on 22.
- **14 Nov:**
  - Node 20 leftovers moved to 22 (08:15, dedd348).
  - The **CI concurrency group** (08:21, b6c27dc), which the owner asked for.
  - **Node 24 everywhere in the monorepo** (owner's yes; Node 22 support ends April 2027). Commits fcab628..33e852c at 08:32–08:33:
    - 67 app jobs, one commit each, 61 of them with the app's mirror CI file;
    - site-footer, the deploy job and all ops/admin workflows;
    - .env.example, and accessibility-lens's .nvmrc, render.yaml and Dockerfile;
    - heap-arena-replay and program-alarm-1202 lockfiles regenerated for npm 11 (platform entries only).
  - **upvote** af3c376 (08:20): the Netlify build and CI on Node 24, actions v7. It has no concurrency group yet.
  - **live-together** (08:23):
    - 179813c fixes CI, which had failed on every run since its first (9 Sep), by running `next typegen` before tsc;
    - 9abd470 moves the actions to v7.
  - **StepWise's AI and LLMs pathway** (33 pages) went live. Its session did this. Its release is in the feed, and app-notify's first run seeds it, so it is never emailed.
  - **Delivery Canary day 3** (build routine, 12:07–12:19; Deploy run 181, ddcab1a): seed inbox check over IMAP and `/api/seed-reach`.
  - **StepWise footer fix:** the StepWise session committed the logo markup (2234 bytes, sha256 487cb295…491e) on StepWise's `next` (2b57417).
    - The owner chose to ship it with the wave-10 deploy rather than deploy it alone.
  - The **MeetMe webhook diagnosis** (owner fixed it in Resend). The migration doc now warns that outside webhooks don't follow the 301 (13:42, f8909ae).
  - The owner received the HintWise logo files from platform/brand/.

## 4. photo2pgn (its own session drives it; Plabs does the platform)

The app is live and listed. The owner's choices are all applied:
- max_tokens 12000;
- per person, 3 readings a day and 9 a week; cross-app $1.00/day per person;
- app ceiling $1/day, $5/week, $10/month;
- saved games (`app_photo2pgn.games`, own-row RLS);
- public readings through the gateway only;
- credits: 1 credit = 1 sheet;
- the admin panel with "List users" (names and games counts).

On 13 Nov the owner confirmed a real grant, a reading and "My games" on two devices.

Still open, none of it blocking Plabs:
- **Paddle (slice 2)** needs the owner's account and prices (proposed: 20 credits for $5, 50 for $10, never expire). Before selling, raise the $1/day app cap, since paid readings count against it.
- **Chess TD's request for a scoresheet-reading API.** photo2pgn recommends sharing its reading code instead. If Chess TD reads through the gateway, it needs its own llm_apps row and caps (the owner's numbers).
- **The halflife CLI reader** gets no jobs now. The owner handles its charge; Plabs builds no charge or refund mode.

## 5. Next, in order

1. **Done 14 Nov:** app-notify's first StepWise run (15:17 UTC) answered 200, seeded 4 items, sent 0 (`ops/notify-status.sql`). Kept for the record:
   app-notify's first StepWise run (14 Nov 15:17 UTC). The check is the one-shot scheduled task at **15:35 UTC** (trig_015eWrrXcnGemydViFztasop; the takeover moves it). Expected:
   - `notify-schedule status`: the cron job succeeded and app-notify answered HTTP 200;
   - `platform.notify_apps.seeded_at` is set for stepwise;
   - 4 rows in `notify_items_seen` and 0 in `notify_sends`. The feed gained the AI and LLMs release on 14 Nov; the scheduled task's prompt was updated from 3 to 4.

   If not, find the root cause and tell the owner. Seeding done is news once.
2. **StepWise wave 10 and the footer logo.**
   - The StepWise session is building wave 10: 39 pages, on the owner's "Implement all and then merge and deploy". Its scheduled check, "Wave 10 build check (every 30 min)", runs until done or 21 Nov. It is a chain of one-shots, each with a new id.
   - When all pages are merged, that session adds a release to src/releases.ts, moves main and runs the live check. Then it messages **session_01JyJzMWixW7SqcHTri4Umng, the previous Plabs session**, which won't be working any more.
   - So check it yourself. In an hourly check, run `curl -s https://stepwise.hintwise.org/ | grep -c 'class="mark"'`: 1 means the footer logo is live (and `data-site-footer` must still count 1). Tell the owner once.
   - **That release is app-notify's first real email.** After it goes live, the next 15:17 UTC run should send to the opted-in people (0 opted in on 13 Nov, so possibly nobody).
   - Check `notify_sends` and the app-notify answer, and whether Resend accepted the List-Unsubscribe headers.
3. **upvote:** add the CI concurrency group with its next real change, never alone, because a push triggers a Netlify build.
4. **Watch the build routine** (11:49 CET daily). Delivery Canary day 4 is next, on 15 Nov.
5. **Logo rollout:** the shared footer mark reaches apps on each deploy. Don't redeploy all apps (credits). Favicons and social images come later.

## 6. Waiting on the owner

Nothing is due now. These offers were made on 14 Nov and are unanswered; they have no default, so don't build them unasked:
1. A weekly drift check comparing own-repo apps' live footers with `footerHtml(slug)`.
2. A redirect from the old fide-lookup.onrender.com address.

Older, not confirmed since 8 Nov:
- test Google sign-in on MeetMe, Chess TD and Digital Yusuf;
- re-run `scripts/pisan_labs_setup.py` locally for the pisan-labs homepages;
- post launch drafts 1–7 (docs/launch-drafts.md), one at a time;
- Qualified Overtime Checker follow-ups (qualified-overtime-checker/HANDOFF.md).

## 7. Dated tasks

- **14 Nov 15:35 UTC** (one-shot scheduled task trig_015eWrrXcnGemydViFztasop): check that app-notify's first StepWise run seeded (item 1 of section 5).
- **Each day 11:49 CET:** the build routine advances the weekly project (Delivery Canary day 4 on 15 Nov).
- **By 21 Nov:** StepWise's wave 10 ends (its session's scheduled check). Then the footer logo goes live and app-notify sends its first email (item 2 of section 5).

## 8. Decisions and why

- **Mirrors:** the monorepo is the source of truth. pisan-labs repos are `git subtree split` mirrors (mirror.yml + .github/mirrors.txt). Each mirrored folder carries its own LICENSE and an inert ci.yml.
- **Netlify deploys cost credits.**
  - A push deploys only targets whose target.yml changed, plus the shortcut-sprint and code-analogy-forge source.
  - Runner and footer changes need a manual Deploy run.
  - Docs-only commits carry `[skip netlify]`.
- **Addresses:** every app's primary address is `<app>.hintwise.org`. target.yml keeps `customDomain: <app>.pisan.me`, and the runner swaps in APP_DOMAIN.
  - **Webhooks and callbacks registered in outside services must use the hintwise.org address.** Senders like Resend (Svix) don't follow the pisan.me 301 (docs/hintwise-migration.md, "Known side effects").
- **Node 24** is the runtime for CI, the deploy job, upvote's Netlify build and the ops workflows. Support for Node 24 ends April 2028. Owner's yes, 14 Nov.
  - live-together stays on Node 22.
  - npm 11 rejects lockfiles that lack the per-platform optional entries; regenerate with npm 11 and check that only platform entries change.
- **Public pages** are written for customers: no scores, competitors, build time or test counts.
- **Builds:** small business first for ideas and builds. One substantial project a week on the usual architecture (BUILD_ROUTINE.md). All accounts are paid. Auth, RLS, functions and email get a security review.
- **Email:** no Resend sending subdomains. App mail comes from `<slug>@hintwise.org`, sign-in mail from sign-in@hintwise.org.
- **Google sign-in buttons** follow Google's branding guidelines; the template's button is correct.
- **Sign-in mail:** the email hook is on. Apps send sign-in through sign-in-link, never `signInWithOtp`.
- **Gateway spending** (owner, 12–13 Nov):
  - Each app has dollar caps (day, week, month) as a ceiling, plus optional per-person caps in dollars or readings.
  - Credits pay once the free allowance is used up, never past the app ceiling. They are taken before the call and refunded on failure.
  - `platform.llm_apps` is readable by any signed-in user by design; check-schema treats it as shared.
- **Admins** (`platform.admins`) may grant credits and list an app's people. They are changed only by the Supabase admin workflow, never by apps.
- **Secrets:** the JWT secret exposure of 9 Nov is a risk the owner accepts; **do not raise rotation again**. Never rotate EMAIL_OPTOUT_SECRET or SIGN_IN_HASH_KEY. Never replace DELIVERY_CANARY_KEY once stored.
- **What needs a yes:** a deploy needs no yes when the owner asked for the change. Any other production deploy, database change or Netlify build waits for a yes.

## 9. Tried and rejected

- **A second SQL copy of the cap rules** for the check mode: rejected. The check mode reuses `decide()`/`allowance()`.
- **A separate `seen()` RPC** for photo2pgn: not needed. The gateway records each visit on every check and reading.
- **Redeploying all apps on every deploy.mjs edit:** it ran Netlify out of credits on 2 Nov.
- **A database trigger on auth.users:** Supabase refuses it. Apps call `platform.ensure_profile()` after sign-in.
- **Deploying the StepWise footer fix alone:** the owner chose to ship it with wave 10 (14 Nov).

## 10. Constraints and gotchas

- **Commits:** Conventional Commits, enforced by `.git-hooks/commit-msg` (`git config core.hooksPath .git-hooks`).
- **Pushing:** other machines and sessions push to main. `git fetch` before work and before pushing; merge, never force-push.
- **Supabase admin workflow:**
  - Dispatch one run at a time.
  - Its logs are public: nothing secret or personal may be printed.
  - `sql` prints only the **last** statement's result.
- **Settings and secrets:** repo settings can't be written from a cloud session. Secrets are set in the repo, never pasted in chat.
- **Never import the deploy runner (accessibility-lens/deploy/deploy.mjs) to test it:** it calls `main()` on import. Use `node --check`.
- **Reading CI conclusions:** with the concurrency group, a superseded run's jobs show as cancelled. A helper that counts every non-success as failed will mislead; read each job's conclusion.
- **Netlify:** a new domain gets its certificate after the ssl request. The live check is the runner's HTTP 200 over real TLS.
- **Edge Function HTML:** Supabase serves it only on auth.hintwise.org.
- **Unmerged remote branches** (old, none needed now; not for deletion):
  - claude/magical-cray-8vo07d (1 Nov 00:41 Berlin; Four Ghosts shipped another way);
  - feat/account-deletion and feat/email-footer-optout (11 Nov).

## 11. How to run and verify

- **Per app** (from its folder): `npm ci && npm run lint && npm run typecheck && npm run coverage && npm run build`.
- **Platform** (platform/): `npm run lint && npm run typecheck && npm run coverage`, plus `npm run check-scripts` and `npm run check-app-hosts`.
- **Footer tests:** `node --test scripts/site-footer.test.mjs`.
- **Supabase admin:** Actions > Supabase admin > Run workflow. The commands are listed atop .github/workflows/supabase-admin.yml.
  - app-notify: `notify-schedule status|on|off`.
  - Credits totals: `sql` with `platform/supabase/ops/credits-status.sql`.
- **Live check:** `curl -s https://<app>.hintwise.org/ | grep -c data-site-footer`.

## 12. Key files

- **Top level:** README.md, PROJECTS.md, BUILD_ROUTINE.md, docs/new-app-guide.md, docs/platform.md, docs/hintwise-migration.md.
- **Supabase admin:** platform/supabase-admin.mjs + .github/workflows/supabase-admin.yml.
- **SQL:**
  - platform/supabase/shared/*.sql (0001–0012; 0006–0012 added this cycle);
  - platform/supabase/ops/ (caps, backfills, credits-status, notify-stepwise-optins, notify-register-stepwise).
- **Code:**
  - platform/src/gateway/, platform/src/credits/, platform/src/notify/;
  - platform/supabase/functions/ (llm-gateway, credits-grant, sign-in-link, email-optout, app-notify, …).
- **Footer and brand:** scripts/site-footer.mjs (`footerHtml(slug)`, LOGO_SVG); platform/brand/.
- **Records:** */deploy/target.yml; CHANGES.md, BRIEFING.md.

## 13. Background jobs

- **Relay routines** (Scheduling below).
- The owner's **ideas** (10:51 CET) and **build** (11:49 CET) routines.
- The **halflife** pisan-labs sync (04:13, zone not recorded).
- The **notify-implemented email** (9:10am Pacific; not in list_triggers, probably a local Cowork task, unverified).
- **pg_cron** app-notify-daily (15:17 UTC).
- **StepWise's wave-10 check** (its session, every 30 min).

No subagents are running at this handoff, apart from this handoff's fact-check.

## 14. Weekly builds and platform

The build routine (BUILD_ROUTINE.md) picks a substantial idea, small business first. It builds one milestone a day for up to 7 days, in fresh sessions resuming from `<slug>/HANDOFF.md`.

The relay session supports the builds: migrations for own-repo apps, platform features, and reviews of anything touching auth or email.

**Aborted builds (do not pick or resume):** daily-project-ideas `ideas/2026-11-10.json` #1, "Off-TPT Catalog Kit" (folder `teacher-catalog-kit/`).

## Notes for the next session

### Owner's standing instructions
- **Ask first, and wait for the answer, before:**
  - writing production data;
  - deploying to production, unless asked;
  - spending money;
  - deleting the unrestorable;
  - rotating secrets;
  - rewriting shared history;
  - publishing outside the session.

  Pushing to main and deleting already-merged branches are fine.
- **Questions:** number them, with a recommendation, in message text (no blocking dialogs).
  - With a recommendation and no answer in 15 minutes, take it and say how to undo it (never for the explicit-yes list).
  - Set a send_later check-in for 15 minutes when something waits on an answer.
- **Times in Lisbon time** (Europe/Lisbon) in reports and chat. Routines keep their Europe/Berlin crons.
- **Quiet hours are silent.** When an hourly check finds nothing new, print nothing at all: no file, no message, not even a "nothing changed" line.
- **Public pages** are for customers. Never invent facts about the owner in his voice.
- **Repo rules:**
  - CHANGES.md is append-only, `YYYY-MM-DD [type] text` (≤200 chars).
  - Conventional Commits.
  - No model names in repo artifacts.
  - Run the repo's lint and tests before committing.
- **Secrets:** never ask the owner to paste tokens or keys in chat. Never print secret values. Never put a secret in a workflow input (inputs and logs are public).
- **The owner's key** is used only through the gateway: no Anthropic key in Netlify or in apps.

### Relay parameters (session-relay skill)
| Parameter | Value |
|---|---|
| Repository | pisanuw/claude-built-apps (also daily-project-ideas, pisanorg/yusuf, pisan-labs/chess-tournament-director, pisanuw/upvote, pisanuw/pastemd, pisanuw/live-together; read-only: dashboards, chess-analyzer, meetme) |
| Handoff document | HANDOFF.md (this file) |
| Routine time zone | Europe/Berlin |
| Report time zone | Europe/Lisbon |
| Handover check | 13:56 Europe/Berlin |
| Session start | 14:52 Europe/Berlin |
| Handoff marker | a commit on main titled `docs: the handoff of <D Month>` (this project pushes docs to main, no PR); no other commit may use that subject |
| Merge rule | push to main after `node --test scripts/site-footer.test.mjs` passes |

### Scheduling
- **Earlier sessions:**
  - session_01JyJzMZ1aBTZCRkUXLJnRG4 ("Plabs: Nov 8"), depth 2, handed over 11 Nov.
  - session_01JyJzMXxeHu9P7By5BXRNJv ("Plabs: Nov 11"), depth 3, handed over 13 Nov.
- **Previous session: session_01JyJzMWixW7SqcHTri4Umng ("Plabs: Nov 13")**, lineage **depth 4 of limit 8**.
  - It took over 13 Nov (created 14:42 UTC).
  - It handed over on **14 November 2026** on the owner's "do handoff". Context was 17% (172,317 of 1,000,000 tokens) after a compaction, about 40% just before it.
  - The next session is depth 5 of 8.
- **Current session: session_01JyJzMVhQhwQ7Ea3HMyJ3FN ("Plabs: Nov 14")**, depth 5 of limit 8, created by the session-start routine at 13:52 UTC; took over on **14 November 2026** (~14:55 Berlin). It moved the relay routines to itself:
  - trig_01LvzA4YK1HANnbjfntihccc: Plabs hourly status report, `46 * * * *`
  - trig_01DYgx6NLAWauCztLtCdzwBd: Plabs handoff check, `CRON_TZ=Europe/Berlin 56 13 * * *`
  - trig_016QHHijGtC5VWcSzZUN4nuQ: Plabs session start, `CRON_TZ=Europe/Berlin 52 14 * * *`
  - trig_01YQvQ3KNT6JZYj7ht5YGFCe: one-shot, 14 Nov 15:35 UTC, check app-notify's first StepWise run

  The previous session's four routines below and its three switched-off one-shots were deleted at the takeover.
- **Relay routines** aimed at the previous session. The new session re-aims them at itself and deletes these:
  - trig_01Ha16psPae9zfPmEzUyXpbf: Plabs hourly status report, `46 * * * *`
  - trig_01D4x4ngY3WRG9wZYV3dA5j6: "Plabs handoff check: hand over only when due", `CRON_TZ=Europe/Berlin 56 13 * * *`
  - trig_017bkQRUNEsvvyRBTV36EasF: "Plabs daily handoff: start the next session (create_session)", `CRON_TZ=Europe/Berlin 52 14 * * *`
  - trig_015eWrrXcnGemydViFztasop: one-shot, 14 Nov 15:35 UTC, check app-notify's first StepWise run (move it; it is due after the takeover)
- **One-shots switched off before firing** aimed at the previous session. Don't copy them; their times are past and create_trigger would refuse. Delete them if allowed, otherwise leave them:
  - trig_01TTez9ePuDawBi6pWBRi4fF (Check StepWise footer; superseded by the wave-10 choice);
  - trig_01Gb4mMS4eb2LgSv3qUoGFhs (Node 24 default; done);
  - trig_01GYK6xXv1n2nkzJXfmA9YMa (Actions upgrade default; done).
- **The routines of session_01JyJzMXxeHu9P7By5BXRNJv are switched off, not deleted:** trig_01DF97CqMqhDtJLS2LiVwjc5, trig_01Wxj14aKZPbxNMZZ4cFqDy5 and trig_01FBwDwP9XRuBfkaCzyRPVg4. They are harmless; the owner can delete them in the scheduled-tasks list.
- **Not relay, leave alone:**
  - the owner's ideas (trig_01K986yzFbf3noGkLA6RgZkn) and build (trig_01BAP9nsXTtxTdpMiwk5GdXE) routines;
  - StepWise's "Wave 10 build check (every 30 min)" (a chain of one-shots aimed at session_01JyJzMZ3W1yMJWwuFJ1PTXM);
  - the Chess Analyzer relay (session_01JyJzMW2LydoTGLuH3HbqJj) and the DSA relay (session_01JyJzMZHUPmTC2BduJoFef2);
  - the Chess TD routines (all switched off);
  - TPT daily product builder, the research-map one-shot (off), and the SIGCSE poster reminder.
