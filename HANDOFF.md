# Handoff: get users, get noticed (PManager relay)

This is the rolling handoff for the PManager relay (the session-relay skill; this session was "Plabs" until 18 Nov). Each handover rewrites it; the last section holds the owner's standing instructions, the relay parameters and Scheduling.

- **Written:** 18 November 2026, 05:35 Barcelona time.
- **By:** session_01JyJzMXVbrUAhXw75BNyNCX ("PManager: Nov 18"), on the owner's "/handoff manual". Context was about 58%.
- **The owner starts the next session by hand,** which begins a new lineage. The previous session archives itself once the new one is active and has moved the routines.

## 1. Goal

The owner's words, 2 November 2026: "Get people using these projects, advertise these projects to get customers that may want me to build similar projects for them." "One way to be noticed is for github repos to be noticed, forked and get stars."
- Customers, in order: small businesses, startups, edtech, universities. The owner's order is a strong preference, not absolute (the 18 Nov pick).
- Every app lives at `<app>.hintwise.org`.

The owner's words, 18 November 2026: "I want a more structured approach to my web app development ... help me structure it, choose what models should be used for each entity, define their boundaries and write their instructions."
- The result is the HintWise workflow in **pisan-labs/hintwise-workflow** (private), and this session is its **PManager**: roles/pmanager/ROLE.md.
- "Each new project should get its own folder in the workflow so all the agent/session documents that went into creating that project are inspectable."

## 2. Status

Done on 18 Nov (details in hintwise-workflow `decisions/2026-11.md`, and in CHANGES.md here):
- [x] Took over at 02:36 UTC (725241c). Routine creation is allowed without a prompt (`.claude/settings.json`, 2f76ede).
- [x] The HintWise workflow was drafted and adopted. The owner answered all 11 questions (hintwise-workflow OPEN-QUESTIONS.md).
  - Roles: Finder, Picker, Junior, Senior, Builder, Reviewer, Manager, PManager, Marketer, Monitor, Keeper.
  - Each project gets one folder, `projects/<slug>/`.
- [x] Finder's procedure moved to hintwise-workflow `roles/finder/ROUTINE.md` (045facf). daily-project-ideas ROUTINE.md is now a pointer (405bde9). The ideas routine's prompt points to the new file; its old prompt is in hintwise-workflow `routines/README.md`.
- [x] From 19 Nov, new projects follow hintwise-workflow `routines/build-day.md` (BUILD_ROUTINE.md switch: 514d721, dfb4cef). The build routine's prompt carries the tier map. Delivery Canary still finishes under the old Steps 1 to 5 today.
- [x] New routines: Monitor daily and weekly, Keeper, Marketer. The hourly status report became the "PManager hourly check". The relay's routines now run on Los Angeles schedules.
- [x] The owner's approval gate, `owner-approval` (eacd8f3):
  - it covers Supabase admin writes, the domain and DNS workflows, Retire site, and Render domain;
  - the owner is the required reviewer; a test run waited for review, and was cancelled.
- [x] Weekly email to builder@hintwise.org (hintwise-workflow `.github/workflows/weekly-email.yml`). It uses the org secret RESEND_API_KEY; a check-only run saw the secret.
- [x] Next project: **Tagging Doctor**, picked by the owner (idea 2026-10-29 #2), folder `projects/tagging-doctor/`.
  - The owner approved a free Render service for its compile step.
- [x] Render cleanup:
  - deleted the superseded mult-streak and accessibility-lens services;
  - the inventory is in hintwise-workflow roles/pmanager/KNOWLEDGE.md;
  - chatwithdigitalme cannot move into backend-hub (6ed4d1e).
- [x] Chess TD `analytics`: main merged in (a71021b); `pnpm check` green (1870 tests). Not merged into main.

Remaining:
- [ ] **Today's ideas run (10:51)** is the first from the new Finder file: check it (reminder trig_019zhkmv77qSFuWSa2WbdYTc, 11:12).
- [ ] **Delivery Canary day 7 (11:49):** check its finish, then start Marketer with "delivery-canary" (reminder trig_01HScKA8r6NKjjB2oRJ4sH19, 13:45).
- [ ] **LLM usage report run:** check it (reminder trig_01V26qt8hJGxsys1YahV7rwQ, 17:25).
- [ ] **19 Nov, 11:49:** Tagging Doctor day 1 under build-day.md. Watch it; release requests arrive in hintwise-workflow `inbox/`.
- [ ] **Own-repo analytics branches:** merge only on the owner's word ("2 will do later").
- [ ] **YPai onto the platform** (pisanuw/digitalme, ypai.hintwise.org; owner, 18 Nov):
  - the brief went to its session, session_01JyJzMYC2h8cRGt8cGRNiLz, at 06:05 UTC: gateway behind a reversible switch, Supabase sign-in, footer, analytics, email from ypai@hintwise.org;
  - it works on a branch and does not merge; it first sends its Anthropic call inventory, costs and plan;
  - PManager's part, each after the owner's yes: the "ypai" sign-in label with sign-in-link and delete-account redeployed, the llm_apps row with the owner's caps, anon-setup, analytics-register, then the merge and deploy;
  - the owner, 06:20 UTC: "1b 2ok 3 will do 4 wait, but want higher caps for ypai for anonymous users". So: streaming is built into the gateway; server-side BYOK stays as an exception; the owner makes HINTWISE_APP_KEY; caps wait for measured costs, with more for anonymous visitors;
  - gateway streaming: NOT STARTED. The Keeper run at 06:15 UTC failed at setup (the incident below). The spec, with a thinking-control addendum, is in hintwise-workflow projects/ypai/gateway-streaming.md; deploy-gateway needs the owner's yes;
  - done by 07:16 UTC (each run approved by the owner in GitHub):
    - analytics-register ypai;
    - ypai in llm_apps (default caps, the 5.5 models, max_tokens 8192; ops/ypai-llm-app.sql);
    - anon-setup ypai (stand-in visitors+ypai@hintwise.org, key prefix 218bfd41);
    - sign-in-link redeployed with the "ypai" label (b67f570).
  - **m1 is live:** the footer, analytics and privacy note, through pisanuw/digitalme PR #39, merged at 07:15 UTC (main 4f6a80f) after Reviewer round 3 APPROVE; the release record is in projects/ypai/releases/m1.md;
  - waiting for the owner's approval in GitHub: the delete-account redeploy (claude-built-apps run 44252907821);
  - slices (ii) sign-in and (iii) gateway are on PR #38 (head 031aa14). A Reviewer with security-review is running on b7759b7..f88cd7d. CI is red there (mypy: an unused ignore in llm_client.py), and the YPai session is fixing it. Its release needs the owner's yes (item 15);
  - still open with the owner:
    - T2: 5 models, 7 Turnstile, 8 contacts, 9 the Action's secret (all default 07:15 Barcelona, 19 Nov), and 18 the icon-only Google button on phones (default 08:05 Barcelona, 19 Nov);
    - T3: 16, redeploying the 60 apps with the old footer;
    - 17, the footer audit in Keeper's checks (a rule change);
    - the caps, which need the usage totals from scripts/usage_totals.py on halflife;
    - confirming that "uploadme" is UpvoteMe.
  - the card is hintwise-workflow projects/ypai/README.md.
- [ ] **Footer logo (owner, 18 Nov):** 60 of the 66 claude-built-apps apps serve the footer from before 11 Nov, which has no logo, because the footer is added at deploy time. The audit is in hintwise-workflow projects/platform/README.md. Redeploying them waits for the owner (item 16).
- [ ] **One sign-in look, as on UpvoteMe (owner, 18 Nov; icon-only round buttons on phones, BUILD_ROUTINE.md amended db560d3):** NOT STARTED. The Keeper run failed at setup (see the next item). The spec is hintwise-workflow projects/platform/sign-in-buttons.md. Branches only; not deployed.
- [ ] **Incident, 18 Nov 07:48 UTC: the workflow routines can't reach GitHub.**
  - Monitor daily (08:16 Barcelona) and both Keeper runs (gateway streaming; sign-in buttons) stopped at setup: no `add_repo` tool, and GitHub answered 403.
  - Cause: the routines were created by the previous session, which ran in environment env_0162x…, seeded with repository sources and not in the owner's list. Their fresh sessions get no repositories there.
  - Correction: the environment was not the cause. A routine's session reaches only the repositories attached to the routine in claude.ai; add_repo does not work in a routine run, and create_trigger cannot attach repositories.
    - The owner was asked at 08:00 UTC to attach them to six routines, his ideas and build routines included: both now need pisan-labs/hintwise-workflow.
    - The four workflow routines were recreated in EnvFull anyway ("19 yes") and the old ones deleted.
  - Re-runs ("20 yes"), as subagents of this session: Monitor's digest for 18 Nov; Keeper gateway streaming (branch fix/platform-gateway-streaming); Keeper sign-in buttons (branch fix/platform-sign-in-buttons: the template and the four claude-built-apps apps; apps in their own repositories are a later pass). PManager reviews them afterwards.
  - Record: hintwise-workflow runs/2026-11-18T0750Z-incident-routines.md.

## 3. Current state

- **Commits:**
  - claude-built-apps main 5bb194e, before this handoff commit; CI green through 514d721 (later commits are docs-only and were not re-checked);
  - hintwise-workflow main a30ba3a;
  - daily-project-ideas main 405bde9.
- **Clean:** every checkout, nothing uncommitted or unpushed; no process running.
- **Branches not merged** (each pushed; merging deploys the app):
  - udebt `analytics`, upvote `analytics`, pastemd `analytics` and `csp-fix` (they conflict in netlify.toml and CHANGES.md), photo2pgn `analytics`;
  - chess-tournament-director `analytics` (main merged in);
  - myuni `analytics-masking`;
  - claude-built-apps `analytics-code-analogy-forge`.

## 4. Next step

**First:** move the relay's routines from session_01JyJzMXVbrUAhXw75BNyNCX to yourself (list in Scheduling), record the takeover, then send that session one line saying the routines have moved, so it archives itself. Then work section 2's "Remaining" in time order.

## 5. Decisions and why

- **Workflow** (owner, 18 Nov; the detail is in hintwise-workflow):
  - Roles are separate from vehicles: most roles run as subagents of the build-day routine; Finder, Monitor, Keeper and Marketer are routines; PManager is this relay.
  - Rules change only by the owner's instruction or by a pull request the owner merges. Knowledge is appended freely.
  - Repository files name tiers, never models. The tier map lives only in routine prompts.
  - T2 decisions default to the recommendation after 24 hours. T3 never defaults.
  - Only PManager merges into deploying branches and runs production workflows.
- **Reporting zone** (owner, 18 Nov): Los Angeles by default; Barcelona while the owner travels, until 6 January 2027. Always label times with the zone.
- **Mirrors:** the monorepo is the source of truth; pisan-labs repositories are subtree-split mirrors (mirror.yml).
- **Netlify credits:** a push deploys only targets whose target.yml changed (plus shortcut-sprint and code-analogy-forge source). Docs-only commits carry `[skip netlify]`.
- **Addresses:** `<app>.hintwise.org` everywhere. target.yml keeps `customDomain: <app>.pisan.me`, and the runner swaps in the domain.
- **Runtime:** Node 24. Public pages carry no scores, build times or test counts.
- **Email:** sign-in only through sign-in-link, never `signInWithOtp`. App mail comes from `<slug>@hintwise.org`.
- **Gateway:** dollar caps per app, optional per-person caps. The owner's key only through the gateway.
- **Secrets:** the 9 Nov JWT exposure is accepted: **do not raise rotation again**. Never rotate EMAIL_OPTOUT_SECRET or SIGN_IN_HASH_KEY. Never replace DELIVERY_CANARY_KEY.
- **Analytics** (owner, 17 Nov): first-party and cookieless; nothing is sent under GPC, DNT or webdriver; apps here get it at deploy; app text must not promise "no tracking".
- **Sign-in links** wait for a "Finish signing in" click when nobody is signed in, because mail scanners were using them up.
- **Render:** backend-hub ($7, always on) is only for small Node backends. The other candidates are Python: chatwithdigitalme, Docker with a disk; fide-lookup, about 320 MB.

## 6. Tried and rejected

- A second SQL copy of the gateway cap rules: check mode reuses `decide()` instead.
- Redeploying every app on a runner edit: it ran Netlify out of credits on 2 Nov.
- A database trigger on auth.users: Supabase refuses it.
- Removing Chess TD's CI on main: Render deploys main only after the checks pass.
- A test beacon into production: not done; real visits proved the pipeline.
- Moving chatwithdigitalme, fide-lookup, udebt-api or notreptile-backend into backend-hub:
  - all four are Python, and chatwithdigitalme needs a disk;
  - a Python hub would need more than 512 MB.
- The hourly status report: the owner replaced it on 18 Nov with "Needs you" cards and Monitor's digest.
- Berlin schedules for the relay: they are on Los Angeles schedules now, at the same instants.

## 7. Constraints and gotchas

- **Commits:** Conventional Commits (`git config core.hooksPath .git-hooks`). Fetch before work and before every push; never force-push main.
- **The approval gate:** gated runs show "waiting" until the owner approves them in GitHub. Ask in the "Needs you" card with the run's link. Read-only Supabase admin commands skip the gate; Render domain "show" does not.
- **The Netlify token:** it now answers 401 to account-wide reads (listing sites; the Netlify env script's account call). Single-site reads work, and the 17 Nov deploy succeeded. If a deploy fails with 401, the owner must replace NETLIFY_AUTH_TOKEN.
- **Supabase admin:** one run at a time; its logs are public, so print counts only; `sql` takes a committed file.
- **Never print secrets or put them in workflow inputs.** Never ask the owner to paste a key.
- **Headless Playwright** sets `navigator.webdriver`, so analytics send nothing. The app-events endpoint answers 204 either way; only a stored row proves the pipeline.
- **StepWise:** main moves only when Yusuf says "deploy". **MyUni:** pytest is not installed in this container.
- **Superseded CI runs** show as cancelled, which is not a failure.

## 8. How to run and verify

- **App** (its folder): `npm ci && npm run lint && npm run typecheck && npm run coverage && npm run build`.
- **Platform** (platform/): `npm run lint && npm run typecheck && npx vitest run && npm run check-scripts` (533 tests on 18 Nov).
- **Before pushing docs to main:** `node --test scripts/site-footer.test.mjs` (15 pass on 18 Nov).
- **Inventory:** the List hosts workflow, which is read-only (Netlify part skipped while the token refuses it).
- **Live footer:** `curl -s https://<app>.hintwise.org/ | grep -c data-site-footer` prints 1.

## 9. Key files

- **pisan-labs/hintwise-workflow:**
  - README.md, CHARTER.md, PIPELINE.md;
  - roles/*/ROLE.md;
  - routines/README.md (routine ids, and the earlier prompts for undo);
  - routines/build-day.md;
  - decisions/2026-11.md;
  - projects/tagging-doctor/.
- **BUILD_ROUTINE.md:** the build routine. New projects switch to build-day.md.
- **docs/platform.md and docs/new-app-guide.md:** the platform and the per-app rules, including the approval gate.
- **accessibility-lens/deploy/:** the deploy runner, list-hosts.mjs, and render-domain.mjs (including the guarded delete).
- **backend-hub/README.md:** what can share the hub.
- **CHANGES.md, BRIEFING.md.**

## 10. Background jobs

Times are Barcelona time (the owner's current zone), with LA time for LA schedules.
- **Relay routines** (move them at takeover):
  - PManager hourly check at :46;
  - handoff check 13:56 (04:56 LA);
  - session start 14:52 (05:52 LA);
  - one-shots: 11:12, 13:45, 17:25 today.
- **Owner's routines:** ideas 10:51 (01:51 LA), build 11:49 (02:49 LA), TPT 06:37.
- **Workflow routines:** Monitor daily 08:13; Monitor weekly Mondays 07:37 (the first email is 23 Nov); Keeper Thursdays 08:43 (first on 19 Nov); Marketer Mondays 10:23.
- **Platform:** app-notify 16:17; the LLM usage report 17:10 and 18:10 (often late).

## 11. Open questions

- Own-repo analytics merges: the owner will do them later.
- Whether deploys will hit the Netlify 401: I don't know. The 17 Nov deploy worked; watch today's.
- digitalme (ypai) calls Claude directly: answered 18 Nov, it uses its own Anthropic key (built before HintWise). The owner started session_01JyJzMYC2h8cRGt8cGRNiLz to move it onto the platform (section 2).

## Notes for the next session

### Owner's standing instructions
- **Ask first, and wait, before:** writing production data, deploying to production unless asked, spending money, deleting the unrestorable, rotating secrets, rewriting shared history, publishing outside the session. Pushing to main and deleting merged branches are fine.
- **Questions:** numbered, with a recommendation, in message text. With a recommendation and no answer within 15 minutes in a live chat, take it and say how to undo it (never for the ask-first list). Workflow T2 items default after 24 hours.
- **Times:** the reporting zone is Los Angeles by default. Until 6 January 2027 it is the zone the owner last named, Barcelona now. Label every time.
- **Reports** (owner, 18 Nov): no hourly status report.
  - PManager sends a "Needs you" card at about 09:00 and 18:00 in the reporting zone when something waits on the owner, and at once for an incident.
  - Monitor sends the daily digest, the weekly retrospective, and the weekly email.
- **The HintWise workflow is adopted:** you are its PManager. Owner decisions go in hintwise-workflow `decisions/` verbatim.
- **Repo rules:** CHANGES.md is append-only (`YYYY-MM-DD [type] text`). Conventional Commits. No model names in repository files. Run lint and tests before committing.

### Relay parameters (session-relay skill)
| Parameter | Value |
|---|---|
| Repository | pisanuw/claude-built-apps; also pisan-labs/hintwise-workflow, daily-project-ideas, pisanorg/yusuf, pisan-labs/chess-tournament-director, pisanuw/upvote, pisanuw/pastemd, pisanuw/understanding-debt, pisanuw/myuni, pisan-labs/photo2pgn, pisan-labs/visualizing-data-structures; read-only dashboards, chess-analyzer |
| Handoff document | HANDOFF.md (this file) |
| Routine time zone | America/Los_Angeles |
| Report time zone | America/Los_Angeles by default; Europe/Madrid (Barcelona) while the owner travels, until 6 January 2027 |
| Handover check | 04:56 America/Los_Angeles |
| Session start | 05:52 America/Los_Angeles; new sessions are titled "PManager: <Mon D>" |
| Handoff marker | a commit on main titled `docs: the handoff of <D Month>` |
| Merge rule | push to main after `node --test scripts/site-footer.test.mjs` passes |

### Scheduling
- **Earlier sessions:**
  - session_01JyJzMZ1aBTZCRkUXLJnRG4 (Nov 8, depth 2);
  - session_01JyJzMXxeHu9P7By5BXRNJv (Nov 11, depth 3);
  - session_01JyJzMWixW7SqcHTri4Umng (Nov 13, depth 4);
  - session_01JyJzMVhQhwQ7Ea3HMyJ3FN (Nov 14, depth 5).
- **Previous session: session_01JyJzMXVbrUAhXw75BNyNCX ("PManager: Nov 18"),** depth 6 of limit 8.
  - It took over on 18 Nov at 02:36 UTC and handed over on 18 Nov, by hand, at the owner's request.
  - Its routines were moved on 18 Nov at 05:30 UTC (06:30 Barcelona time), and it was sent one line so it archives itself.
- **Current session: session_01JyJzMXY6RAmKb5w3vkqBjo ("PManager: Nov 18"),** started by hand by the owner.
  - Lineage: depth 0 of limit 8, a new lineage (created 18 Nov 05:28 UTC).
  - It took over on 18 Nov at 05:30 UTC (06:30 Barcelona time; 21:30 on 17 Nov, Los Angeles time), for the handoff of 18 November (f8641db). No session needs starting for that handoff.
- **The relay's routines** (all aimed at the current session):
  - trig_01D3w33bL8kxHA46VLTrnKNc: PManager hourly check, `46 * * * *`;
  - trig_01PwhDWfkjdf2pxLNMyp52a8: Plabs handoff check: hand over only when due, `CRON_TZ=America/Los_Angeles 56 4 * * *`;
  - trig_01Ck5e8Yy3vvwQ1BSF6cJnE2: Plabs daily handoff: start the next session (create_session), `CRON_TZ=America/Los_Angeles 52 5 * * *`;
  - one-shots, due 18 Nov:
    - trig_019zhkmv77qSFuWSa2WbdYTc at 10:12 UTC;
    - trig_01HScKA8r6NKjjB2oRJ4sH19 at 12:45 UTC;
    - trig_01V26qt8hJGxsys1YahV7rwQ at 16:25 UTC.
- **Leave alone:**
  - the owner's routines: ideas trig_01K986yzFbf3noGkLA6RgZkn, build trig_01BAP9nsXTtxTdpMiwk5GdXE, TPT trig_013VN2RNYCwh2k3F2ZjgnK6U;
  - the workflow routines, recreated in EnvFull on 18 Nov (owner, "19 yes"): Monitor daily trig_017ncnNvikFwwEUMzN8k3ix1, Monitor weekly trig_01NMJbSUXu1Pxnb74sQSbFHS, Keeper trig_011fPUzUbmBx8UMYhjtwZCBH, Marketer trig_01Pta3mTcpBNceabkLPScKbi. They reach GitHub only once the owner attaches their repositories in claude.ai (asked 08:00 UTC, 18 Nov);
  - the switched-off Chess TD one-shots and the SIGCSE reminder.
- **Dated task, 6 January 2027:** reports go back to Los Angeles time. Ask the owner for Los Angeles times for Monitor, Keeper and Marketer, and move them.
