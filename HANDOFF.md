# Handoff: get users, get noticed (PManager relay)

This is the rolling handoff for the PManager relay (the session-relay skill). Each handover rewrites it; the last section holds the owner's standing instructions, the relay parameters and Scheduling.

- **Written:** 24 November 2026, about 14:05 Barcelona time (13:05 UTC).
- **By:** session_01JyJzMVBimGQPKqzrxuBkMX ("PManager: Nov 20"), on its handover check (ledger 2026-11-24T12:58Z): used_tokens 521,556 over the 500,000 line (533,018 of 700,000 at 13:00Z; autocompact threshold 544,000 of a 680,000 window), the session 4 days old, lineage depth 2 of limit 8.
- **The session-start routine** (trig_0126nT9H2AUW4zNwczHCG19W, 14:52 Barcelona, 13:52 UTC) starts the next session once the commit `docs: the handoff of 24 November` is on main. The new session moves the six routines aimed at this one (Scheduling) and then archives it.

## 1. Goal

The owner's words, 2 November 2026: "Get people using these projects, advertise these projects to get customers that may want me to build similar projects for them." "One way to be noticed is for github repos to be noticed, forked and get stars."
- Customers, in order: small businesses, startups, edtech, universities. The owner's order is a strong preference, not absolute (the 18 Nov pick).
- Every app lives at `<app>.hintwise.org`.

The owner's words, 18 November 2026: "I want a more structured approach to my web app development ... help me structure it, choose what models should be used for each entity, define their boundaries and write their instructions."
- The result is the HintWise workflow in **pisan-labs/hintwise-workflow** (private), and this session is its **PManager**: roles/pmanager/ROLE.md.
- "Each new project should get its own folder in the workflow so all the agent/session documents that went into creating that project are inspectable."

## 2. Status

Times Barcelona (UTC+1), UTC in brackets where a record uses it. The ledger is hintwise-workflow decisions/2026-11.md.

**Live now, and new today (24 Nov):**
- [x] **Screen Reader Journeys is live,** released today on the owner's "SR release yes" (about 09:13, 08:13Z; ledger 2026-11-24T08:14Z, 10:58Z; record projects/screen-reader-journeys/releases/2026-11-24-first-release.md):
  - Netlify site 33ce0331 at https://screen-reader-journeys.hintwise.org (imported by the owner; domain attached, run 45378551835; certificate working);
  - Render srv-dc2kuiec6qcc73fbmnug (free plan, virginia) at https://screen-reader-journeys.onrender.com, created by Deploy run 45359239841 from claude-built-apps b6982de;
  - schema app_screen_reader_journeys in production with 0001_runs.sql (run 45354673398) and 0002_daily_cap.sql (run 45393896530, on the owner's "approved, merge", about 13:44, 12:44Z) applied; exposed and checked;
  - the worker token's hash pinned (claude-built-apps 454feac, run 45357864827); the owner set WORKER_TOKEN on Render ("WORKER_TOKEN set"), applied by Deploy run 45378019156 at 11:47:54 (10:47:54Z);
  - sign-in label (EXTERNAL_APP_LABELS, claude-built-apps 7f5a4bd; sign-in-link and delete-account redeployed, runs 45359645932, 45359651819) and analytics registered (run 45378558291).
- [x] **"Any public address" is live since 13:48:33 (12:48:33Z) on 44e41bf** (#17, squash-merged at 13:45, head pinned e9f4fd9; round 3 APPROVE at 7be549e): claude-built-apps 99fd41a sets ALLOWED_TARGET_HOSTS "*" with CHROMIUM_SANDBOX "true" (Deploy run 45396881781). The sandbox start-up probe passed on Render's free host, so R7.1's options B and C are not needed. Limits: 10 runs a day per person, 40 in total (per UTC day; the owner's "SR limits yes"). Owner's words: "Also accept any public address when you start the run if the user is logged in" (about 09:37, 08:37Z).
- [x] **The owner's first run passed** (12:07, 11:07Z): https://studio.hintwise.org/, "2 passed, 0 failed, 0 errors". Only studio.hintwise.org was allowed then (claude-built-apps 3ad900d, live 12:04, 11:04:10Z); whether example.com was refused is not in the records (projects/screen-reader-journeys/README.md, 11:07Z: "not yet reported"). The owner was asked to try a public site and private addresses; **their answer is not in yet.** Their feedback ("'The run is running.' not the best message") became #19.
- [x] **The release set aside the one-production-deploy-per-day criterion for this app today,** on the owner's "SR today" (about 12:10, 11:10Z; ledger 2026-11-24T11:11Z). The owner turned off Netlify Deploy Previews for it ("deploy previews turned off", 12:15).
- [x] **The first sign-in fell back to the shared project's site_url** (how-of-happiness); the second try worked. The likely cause is an http page load while the certificate was being provisioned; it is **not verified**, and #18 removes the path.
- [x] **Tagging Doctor m5a and m5b** released in one deploy at 01:50 (00:50:54Z; #23 merged as e572cd2, head pinned 32fb246; Deploy 45300171667; releases/m5a.md, m5b.md).
- [x] **Footer redeploys today:** brocot-gear-finder and cache-miss-theater (run 45393517681), done (projects/platform/footer-redeploys.md rows 11 and 12).

**Landed since the last handoff (20 Nov 05:15):**
- 20 Nov: YPai #47 released (aux cap); MyUni nodemailer fix released.
- 21 Nov: Bundle D merged ("Merge bundle d"); YPai #48 released (gateway retries, ead4555); Tagging Doctor m2 released ("td m2 yes"); standing authorization 13 (resume a routine the usage limit stopped, once, after the reset).
- 22 Nov: the credentials item closed (ANTHROPIC_API_KEY out of the session env file); draft #1 on hintwise-workflow closed by default; Tagging Doctor m3a and m3b released; the emailed sign-in code released on the platform (claude-built-apps #14, #16); hintwise-workflow #8 (routines read the tier map from routines/tier-map.env) opened.
- 23 Nov: #8 merged by the owner; Auth's code length 10 and Auth's templates without the code (claude-built-apps #19) released; own-repo analytics merged and live in all seven own-repo apps ("Merge all the apps"); Tagging Doctor m4a and m4b released (checker moved into backend-hub on Docker, CR-13; the free worker deleted); CR-15 went ahead; MeetMe redeployed with noreply@hintwise.org ("3 yes"); Monitor's proposals #9 to #13 merged by the owner; Screen Reader Journeys joined as a working session outside the roles, never on the top tier ("top: SR only"), on Render's free plan.
- 24 Nov: Screen Reader Journeys #11 to #14, #16 and #17 merged after review at the strong tier, and released (above).

## 3. Current state

- **Commits:** claude-built-apps origin/main 99fd41a before this handoff commit; hintwise-workflow main d25e690 at 12:58Z; pisan-labs/screen-reader-journeys main 44e41bf.
- **Open pull requests:**
  - pisan-labs/screen-reader-journeys, all three for tomorrow's window (section 4, item 1): **#18** "one address for the dashboard" (claude/srj-canonical, head c309d5a); **#19** "a running run's page shows where it is" (claude/srj-progress, head 3232d1c, now targeting main); **#20** R9.1 and R9.3 (claude/srj-r9, head cc127aa). #19 and #20 overlap in server/execute.js and server/run-child.js.
  - pisanuw/claude-built-apps **#24** "tagging-doctor: milestone 6, polish and finish" (build/tagging-doctor, head c629af3): Reviewer round 1 (top tier, with the security review of the whole app) and Manager's launch review, both restarted by day 7 at 13:49 (12:49Z) after the usage limit.
- **Open issue:** pisan-labs/screen-reader-journeys **#15**, the follow-ups still open: R5.2, the rest of R6.3, R9.2, R9.4 to R9.7.
- **Branches not merged** (each pushed; merging deploys): pisan-labs/screen-reader-journeys claude/srj-canonical (#18), claude/srj-progress (#19), claude/srj-r9 (#20); claude-built-apps build/tagging-doctor (#24).
- **Sessions working:** Tagging Doctor day 7, session_01JyJzMY4Zjf2Yhdjatjw3jZ (started by the build routine at 11:49, 10:49Z); the SR-journeys working session, session_01JyJzMV27a4zzcGw3w9f5yh (outside the roles; projects/screen-reader-journeys/README.md).
- **Clean:** nothing uncommitted in this session's checkouts apart from this file.

## 4. Next step

**First:** the takeover prompt's steps: move the six routines aimed at session_01JyJzMVBimGQPKqzrxuBkMX to yourself (Scheduling), record the takeover, send the owner a short card, then archive session_01JyJzMVBimGQPKqzrxuBkMX once you have started work. Re-check each item against git before starting it.

1. **Screen Reader Journeys, tomorrow's window: merge after 2026-11-25T00:00Z (01:00 Barcelona, 25 Nov), all three in one deploy.** Each needs a fresh Reviewer at the strong tier first (Screen Reader Journeys never uses the top tier):
   - #18 (canonical address, head c309d5a);
   - #19 (progress display, head 3232d1c, now targeting main);
   - #20 (R9.1 and R9.3, head cc127aa).

   #19 and #20 overlap in server/execute.js and server/run-child.js, so the second to merge gets main merged in first (re-run CI, pin the new head). Pin each head at merge. After the deploy, check /health, /journeys and the dashboard's sign-in from https://screen-reader-journeys.hintwise.org.
2. **Screen Reader Journeys, the owner's test of a public site and private addresses:** read the answer when it comes; a private address that is not refused is an incident.
3. **Tagging Doctor day 7 and launch.** Day 7 (session_01JyJzMY4Zjf2Yhdjatjw3jZ) stopped at 12:44 (11:44Z) on the five-hour usage limit and was told to continue at 13:48 (12:48Z; ledger 2026-11-24T12:48Z). PR #24 (m6) is under review.
   - CR-16 is a T2 waiting on the owner (inbox/2026-11-24-tagging-doctor-cr16-ac37.md; deadline 2026-11-25T11:05Z, 12:05 Barcelona; recommendation: go ahead, taken at the deadline if no answer).
   - The m6 release is the owner's T3 (merge #24, deploy).
   - After launch: fire the Marketer routine (trig_01753Q4m5drQMFdXXcnPDT5t) with the slug tagging-doctor.
   - DRAFT_COST_ESTIMATE_USD is set from the first live gateway draft (projects/tagging-doctor/HANDOFF.md, S2-12 part 1).
4. **25 Nov 10:40 Barcelona (09:40Z): the QOC Marketer reminder** (trig_011ee4WtPyPAioWz3EL9mxhp). It moves a day if Tagging Doctor's launch campaign is due that day.
5. **The next-project item** (inbox/2026-11-23-next-project.md, T2) is snoozed to 25 Nov; no default ("2 hold for next project"). Put it on the 25 Nov card.
6. **Watchdog:** confirmed working by a hand run on 23 Nov (45282939044), but GitHub did not start its scheduled 12:17Z and 21:17Z runs that day. Its newest runs are scheduled 45293311156 (23 Nov 23:58Z) and 45332459007 (24 Nov 05:19Z), both late; **no run for the 24 Nov 12:17Z slot had started by 13:05Z** (checked at about 13:00Z and again at 13:05Z; the newest run is still 45332459007). Check again; if none, run it by hand (routines/README.md).
7. **A Rules guard fix** (retry while signature verification is pending; the false alarm on #13 of 23 Nov 17:00Z) goes to Monitor's next proposals.
8. **Bundle B** (inbox/2026-11-20-code-review-bundles.md, on PManager) and the **Keeper follow-ups** (inbox/2026-11-21-meetme-ci-and-registry.md for Keeper's Thursday 26 Nov run; inbox/2026-11-23-knowledge-inventories.md, option 1) remain. Also open, PManager's own (T1): inbox/2026-11-20-workflow-h13-rollback-steps.md (before Tagging Doctor's launch), inbox/2026-11-23-analytics-followups.md, inbox/2026-11-23-marketer-older-apps.md.
9. **Monday 30 Nov:** the first weekly visit counts in the relay check (owner, 23 Nov: the counts stay private).
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
- **Email:** sign-in only through sign-in-link (link and code), never `signInWithOtp`. App mail comes from `<slug>@hintwise.org`.
- **Gateway:** dollar caps per app, optional per-person caps. The owner's key only through the gateway.
- **Secrets:** the 9 Nov JWT exposure is accepted: **do not raise rotation again**. Never rotate EMAIL_OPTOUT_SECRET or SIGN_IN_HASH_KEY. Never replace DELIVERY_CANARY_KEY.
- **Analytics** (owner, 17 Nov): first-party and cookieless; nothing is sent under GPC, DNT or webdriver; apps here get it at deploy; app text must not promise "no tracking".
- **Sign-in links** wait for a "Finish signing in" click when nobody is signed in, because mail scanners were using them up.
- **Screen Reader Journeys** (23 to 24 Nov): a working session outside the roles (SR-journeys), its own repository pisan-labs/screen-reader-journeys; the worker on Render's free plan, its own secret WORKER_TOKEN (only its SHA-256 in the database), no service-role key; every PR reviewed by a fresh Reviewer at the strong tier and merged with its head pinned; "*" only behind Chromium's sandbox, checked at start-up and failing closed; 10 runs a day per person and 40 in total under one advisory lock.
- **Tagging Doctor's checker** runs in backend-hub on Docker (CR-13, 23 Nov); backend-hub is the default for new Render backends (owner, 22 Nov).
- **Sign-in:** an emailed code like upvoteme for every app (owner, 21 and 22 Nov); the code is never in the subject; Supabase Auth's own code is never shown (its templates lost it, 23 Nov).
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
- **The Netlify token:** the GitHub secret NETLIFY_AUTH_TOKEN was renewed on 18 Nov, and deploys work. If a deploy fails with 401, the owner must replace it. The copy in the session env file answers 401 (next item).
- **The session env file,** /root/.env-claude, has an unquoted value with angle brackets on line 36, so bash stops sourcing it there. Every Bash call prints a syntax error, and variables after line 36 are not exported. Read names only, never values. Its NETLIFY_AUTH_TOKEN answers 401; its RENDER_API_KEY worked for a read-only deploy-status call.
- **Supabase admin:** one run at a time. Its runs share one concurrency group: one running plus one pending, and a newer pending run cancels the older. Its logs are public, so print counts only; `sql` takes a committed file.
- **Never print secrets or put them in workflow inputs.** Never ask the owner to paste a key.
- **Headless Playwright** sets `navigator.webdriver`, so analytics send nothing. The app-events endpoint answers 204 either way; only a stored row proves the pipeline.
- **Playwright here** needs `chromium.launch({ proxy: { server: process.env.HTTPS_PROXY } })` and a retry on ERR_TUNNEL_CONNECTION_FAILED. The deploy's footer is a `site-footer` element with a shadow root, so page-text checks miss it; check `document.querySelector('site-footer').shadowRoot`.
- **Render deploys:** confirm "live" from Render, not from the Deploy runner's health check.
- **GitHub access:** the GitHub connector can fail to connect after a worker restart; the next call reconnects it. `gh` commands that use GraphQL (`gh pr view`) are refused here; `gh api repos/...` (REST) works for repositories attached to the session.
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

Times are Barcelona time (the owner's current zone), with UTC or Los Angeles time where the schedule uses it. Ids are in Scheduling.
- **Relay routines** (aimed at this session; move them at takeover):
  - PManager check every two hours at :46 of even UTC hours (13:46, 15:46 ... Barcelona; cards at about 09:00 and 18:00);
  - handoff check 13:56 (04:56 LA);
  - session start 14:52 (05:52 LA);
  - footer redeploys 13:23, daily (next 25 Nov);
  - one-shots: QOC Marketer reminder, 25 Nov 10:40 (09:40Z); reporting zone ends, 5 Jan 2027 09:37 (08:37Z).
- **Owner's routines:** Finder (ideas) 10:51 (01:51 LA), build "Build an idea I choose" 11:49 (02:49 LA), TPT 06:37.
- **Workflow routines:** Monitor daily 08:13; Monitor weekly Mondays 07:37 (next 30 Nov); Keeper Thursdays 08:43 (next 26 Nov); Marketer Mondays 10:23 (next 30 Nov).
- **Workflow Actions (hintwise-workflow):** Watchdog 13:17 and 22:17 (12:17 and 21:17 UTC; GitHub often starts it late or not at all, section 4 item 6); Rules guard on each push to a rule file.
- **Platform:** app-notify 16:17; the LLM usage report 17:10 and 18:10 (often late).
- **Account usage:** the weekly usage limit shows a warning and resets on 30 Nov at 04:00 (03:00Z). The owner chose "usage 2" (about 06:24, 05:24Z): carry on as now. The five-hour limit was hit at about 12:44 (11:44Z) today (reset 13:10, 12:10Z); under standing authorization 13, PManager resumes a stopped routine once after the reset and tells the owner.
- No background process runs in this container.

## 11. Open questions

Waiting on the owner:
1. **Screen Reader Journeys, a public site and private addresses:** the owner was asked to try a run on a public site and on private addresses now that "*" is live. No answer yet; a private address must be refused.
2. **Tagging Doctor CR-16 (T2):** may CR-16 go past the change budget (1.49 of 1) to reword AC-37? Raised 2026-11-24T11:05Z; deadline 2026-11-25T11:05Z (12:05 Barcelona); recommendation: go ahead, taken at the deadline.
3. **The next project (T2):** held by the owner ("2 hold for next project", 23 Nov 17:53, 16:53Z); snoozed to 25 Nov; no default.

Also open, no action now:
- Tagging Doctor m6 release (T3) after #24's reviews.
- digitalme's unused ANTHROPIC_API_KEY repository secret: the owner's to delete, and only if discover-and-draft.yml no longer needs it.
- The workflow hand-off's other owner questions: the approval gate (H12) and the rollback drill (H13).

## Notes for the next session

### Owner's standing instructions
- **Ask first, and wait, before:** writing production data, deploying to production unless asked, spending money, deleting the unrestorable, rotating secrets, rewriting shared history, publishing outside the session. Pushing to main and deleting merged branches are fine.
- **Questions:** numbered, with a recommendation, in message text; never a blocking dialog (restated by the owner, 24 Nov). With a recommendation and no answer within 15 minutes in a live chat, take it and say how to undo it (never for the ask-first list). Workflow T2 items default after 24 hours.
- **Approvals typed in another session** (CHARTER.md, Communication, 19 Nov): a yes the owner typed in another session counts when PManager read it in that session's transcript, as a message the owner typed (not one a session relayed), and the ledger names where and when.
- **Times:** the reporting zone is Los Angeles by default. Until 6 January 2027 it is the zone the owner last named, Barcelona now. Label every time. (Barcelona, labelled, restated 24 Nov.)
- **Reports** (owner, 18 Nov): no periodic status report (owner "1", 19 Nov). PManager's check runs every two hours (owner, 20 Nov). A check with nothing to report prints nothing, or exactly one line "HH:MM Nothing to report." (owner, 20 Nov).
  - PManager sends a "Needs you" card at about 09:00 and 18:00 in the reporting zone when something waits on the owner, and at once for an incident.
  - Cards are self-contained and come last in a message (owner, 23 Nov; restated 24 Nov): never point to another message for the text.
  - Monitor sends the daily digest, the weekly retrospective, and the weekly email.
- **Handovers:** the daily handover check hands over at 500,000 used tokens (owner's answer to Q23, 19 Nov, kept on 20 Nov: "No leave 500k in your place"), at 6 days, on request, or on failure. Compaction: the owner set `CLAUDE_CODE_AUTO_COMPACT_WINDOW=700000` and `CLAUDE_CODE_IDLE_COMPACT_MIN_TOKENS=400000` (20 Nov); a new session's window is 680,000 (700,000 less 20,000); its autocompact_state.threshold depends on the percentage the cloud sets, which differs between sessions (this session 80%, threshold 384,000 of 480,000; the previous one 92%, 441,600 of 480,000), so expect 544,000 to about 626,000. Read it at takeover and tell the owner the real figure.
- **Archive after a handover** (owner, 20 Nov): once the new session has taken over and started work, it archives the previous session with archive_session (takeover step (e)), unless that session is still working. Never archive any other session.
- **Top tier:** Screen Reader Journeys never uses the top tier (owner, 23 Nov: "top: SR only"); other roles keep their tiers.
- **Usage this week:** "usage 2" (24 Nov 05:24Z): carry on as now until the weekly reset (30 Nov 03:00Z).
- **The HintWise workflow is adopted:** you are its PManager. Owner decisions go in hintwise-workflow `decisions/` verbatim.
- **Repo rules:** CHANGES.md is append-only (`YYYY-MM-DD [type] text`). Conventional Commits. No model names in repository files. Run lint and tests before committing.

### Relay parameters (session-relay skill)
| Parameter | Value |
|---|---|
| Repository | pisanuw/claude-built-apps; also pisan-labs/hintwise-workflow, pisanuw/digitalme, daily-project-ideas, pisanorg/yusuf, pisan-labs/chess-tournament-director, pisanuw/upvote, pisanuw/pastemd, pisanuw/understanding-debt, pisanuw/myuni, pisan-labs/photo2pgn, pisan-labs/visualizing-data-structures, pisan-labs/screen-reader-journeys, pisanuw/meetme; read-only dashboards, chess-analyzer |
| Handoff document | HANDOFF.md (this file) |
| Routine time zone | America/Los_Angeles |
| Report time zone | America/Los_Angeles by default; Europe/Madrid (Barcelona) while the owner travels, until 6 January 2027 |
| Handover check | 04:56 America/Los_Angeles |
| Session start | 05:52 America/Los_Angeles; new sessions are titled "PManager: <Mon D>" |
| Handoff marker | a commit on main titled `docs: the handoff of <D Month>` |
| Merge rule | push to main after `node --test scripts/site-footer.test.mjs` passes |

### Scheduling
- **Earlier sessions:**
  - session_01JyJzMXY6RAmKb5w3vkqBjo ("PManager: Nov 18", depth 0 of 8, a new lineage started by hand by the owner); archived 20 Nov.
  - session_01JyJzMZdo2cwHjA4hcPLrcu ("PManager: Nov 19", depth 1 of 8); archived 20 Nov 04:18 UTC.
- **Previous session (the one to archive): session_01JyJzMVBimGQPKqzrxuBkMX ("PManager: Nov 20"),** lineage depth 2 of limit 8, parent session_01JyJzMZdo2cwHjA4hcPLrcu. Created 20 Nov 04:15:30 UTC by create_session; took over 20 Nov 04:17 UTC. Handover check of 24 Nov 12:57 UTC: used_tokens 521,556 of 700,000 (over 500,000); autocompact threshold 544,000 of an effective window of 680,000. The session-start routine starts the next session at 13:52 UTC, which should read depth 3 of 8.
- **The relay's routines, aimed at session_01JyJzMVBimGQPKqzrxuBkMX (persistent_session_id): move all six at takeover** (list_triggers, enabled true, 24 Nov 13:00Z):
  - trig_015TdQrJ7Me2MJs5TseXjrqW: PManager check, every 2 hours, `46 */2 * * *`;
  - trig_01QPi2MeFHXc49mpM7Yaukh5: Plabs handoff check: hand over only when due, `CRON_TZ=America/Los_Angeles 56 4 * * *` (hands over at 500,000 used tokens; reads routines/relay-handover.md);
  - trig_0126nT9H2AUW4zNwczHCG19W: Plabs daily handoff: start the next session (create_session), `CRON_TZ=America/Los_Angeles 52 5 * * *` (reads routines/relay-start.md);
  - trig_01WD5ABHbZzUfstmWFzF8NQi: Footer redeploys, two apps a day, `CRON_TZ=Europe/Madrid 23 13 * * *`;
  - one-shot trig_011ee4WtPyPAioWz3EL9mxhp: Start Marketer for Qualified Overtime Checker, 2026-11-25T09:40Z;
  - one-shot trig_015jdG1j83jBvJhCZfU9i7Pn: HintWise: reporting zone ends 6 Jan, 2027-01-05T08:37Z.
- **Leave alone** (not aimed at this session):
  - the owner's routines: Finder trig_01NKR83ysfRfzGnpP4WyHJFk (`CRON_TZ=America/Los_Angeles 51 1 * * *`), build "Build an idea I choose" trig_01BAP9nsXTtxTdpMiwk5GdXE (`CRON_TZ=America/Los_Angeles 49 2 * * *`), TPT daily product builder trig_013VN2RNYCwh2k3F2ZjgnK6U (`CRON_TZ=Europe/Madrid 37 6 * * *`);
  - the workflow routines (each a fresh session): Monitor daily trig_01UYXZfnrmu5nBozbutpwJbq (`CRON_TZ=Europe/Madrid 13 8 * * *`), Monitor weekly trig_01LFVjPSBTNb6QCBKc1r37gg (`CRON_TZ=Europe/Madrid 37 7 * * 1`), Keeper trig_011fPUzUbmBx8UMYhjtwZCBH (`CRON_TZ=Europe/Madrid 43 8 * * 4`), Marketer trig_01753Q4m5drQMFdXXcnPDT5t (`CRON_TZ=Europe/Madrid 23 10 * * 1`);
  - the Elf Calculator (pisanuw/kaggle-) routines, aimed at other sessions: trig_01VYuKDdzXFztTPWhrpNaYRf (status report, `46 */2 * * *`) and one-shot trig_01JNAGkWa6yn7B9k7mWmd7aE (2026-11-24T18:31Z), both on session_01JyJzMVCqUi61jQg66hr3Q3; trig_01WGw1gDbDw4hUiZTdFB8kNo (K2-sub status report, `17 */2 * * *`), trig_01SWvpPzXxLxtzRvmzyT32Y2 (K2-sub handoff check, `CRON_TZ=Europe/Madrid 56 11 * * *`) and trig_01TUTSFW1To63d48EREtpyQs (K2-sub session start, `CRON_TZ=Europe/Madrid 52 12 * * *`), on session_01JyJzMWZAdqEJDYYKwxmq4P.
  - The YPai session's three routines (trig_01XRHaKRimeYQFDsdyzG8QRP, trig_01CqD8KcEJGwvxNuhkspHd3j, trig_01Tng1uFLw5e6RKT1uhE4gbW) were switched off on 22 Nov 05:31Z after the owner archived that session (registry/scheduled-tasks.md); they are not in the enabled list.
- **Registry:** hintwise-workflow registry/scheduled-tasks.md lists every task; update the relay rows' ids after the move.
- **Dated tasks:**
  - 25 Nov 00:00Z onwards: the Screen Reader Journeys window (#18, #19, #20; section 4 item 1);
  - 25 Nov 09:40Z: the QOC Marketer reminder;
  - 25 Nov 11:05Z: CR-16's deadline (default: go ahead);
  - 25 Nov: the next-project item's snooze ends;
  - 26 Nov 07:43Z: Keeper's weekly run (the MeetMe CI and registry item);
  - 30 Nov 03:00Z: the weekly usage limit resets; 30 Nov: Monday visit counts start, Monitor weekly and Marketer run;
  - 5 Jan 2027 08:37Z: the reporting-zone reminder; from 6 January 2027 reports go back to Los Angeles time.
