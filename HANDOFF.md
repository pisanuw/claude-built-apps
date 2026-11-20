# Handoff: get users, get noticed (PManager relay)

This is the rolling handoff for the PManager relay (the session-relay skill; this session was "Plabs" until 18 Nov). Each handover rewrites it; the last section holds the owner's standing instructions, the relay parameters and Scheduling.

- **Written:** 20 November 2026, about 05:15 Barcelona time (04:15 UTC; 19 November in Los Angeles, the routine zone).
- **By:** session_01JyJzMZdo2cwHjA4hcPLrcu ("PManager: Nov 19"), at the owner's request: "Do a handoff now once the above tasks are complete" (ledger 2026-11-20T04:08Z). Context was about 340,000 used, with this session still compacting at 384,000 (it predates the owner's new settings).
- **This session starts the next one now** with create_session and the session-start routine's takeover prompt (which now has step (e): archive the previous session). The new session moves the routines and then archives this one; this session starts no new work.

## 1. Goal

The owner's words, 2 November 2026: "Get people using these projects, advertise these projects to get customers that may want me to build similar projects for them." "One way to be noticed is for github repos to be noticed, forked and get stars."
- Customers, in order: small businesses, startups, edtech, universities. The owner's order is a strong preference, not absolute (the 18 Nov pick).
- Every app lives at `<app>.hintwise.org`.

The owner's words, 18 November 2026: "I want a more structured approach to my web app development ... help me structure it, choose what models should be used for each entity, define their boundaries and write their instructions."
- The result is the HintWise workflow in **pisan-labs/hintwise-workflow** (private), and this session is its **PManager**: roles/pmanager/ROLE.md.
- "Each new project should get its own folder in the workflow so all the agent/session documents that went into creating that project are inspectable."

## 2. Status

Done since the last handoff (19 Nov 19:40 Barcelona; times Barcelona, UTC in brackets where a record uses it):
- [x] **Takeover** at 19:47 (18:47Z); five routines moved; c22ab21. The YPai relay handed over too: "YPai: Nov 19" is session_01JyJzMYdcL21t1LrX7eujSq (routines moved 19:53).
- [x] **Workflow review:** PR #1 split into PR #2 (guards; Reviewer APPROVE r1) and PR #3 (the rest; CHANGES r1, APPROVE r2). **The owner merged #2 at 20:07:55 (ee6b882) and #3 at 20:08:26 (5ed82cd).** Reviews saved in projects/workflow/review-pr2-r1.md, review-pr3-r1.md, review-pr3-r2.md. Hand-off H1 (ledger, 589e6c8), H2 (Rules guard runs green; owner: "emails received"), H3 (Watchdog dry run 44601972208 green; local replay in projects/workflow/README.md) done. PR #1 (draft) is left open as the source; the owner may close it.
- [x] **The owner's yes to changing the hourly task** (21:16): it writes PManager's daily record (step 4) and the Watchdog's PManager check is live (4f2860f). First record: runs/2026/11/2026-11-20T0047Z-pmanager.json (cd020b5); the Watchdog's local morning check finds it.
- [x] **Platform:** deploy.mjs waits for a Render deploy to go live before the health check (c32ad8c, fresh Reviewer APPROVE, pushed to main at 20:14 (19:14Z) as a fast-forward, no app redeployed). Three minor follow-ups in hintwise-workflow projects/platform/README.md (the line stamped 2026-11-19T19:45Z, written at about 19:16Z).
- [x] **Ledger:** the lewis-alt-text manual deploy of 19 Nov (its own session, on the owner's "Yes deploy"), the takeover, the merges.
- [x] **Owner's instructions of 20 Nov (04:06 to 05:08):**
  - quiet checks print nothing or exactly "HH:MM Nothing to report." (3d764f6);
  - environment: `CLAUDE_CODE_AUTO_COMPACT_WINDOW=700000`, `CLAUDE_CODE_IDLE_COMPACT_MIN_TOKENS=400000` (a08d379);
  - "No leave 500k in your place": the handover check still hands over at 500,000 used tokens;
  - the check runs every two hours (`46 */2 * * *`), renamed "PManager check, every 2 hours";
  - the new relay session archives the previous one once it has taken over and started work (takeover step (e); check step 6; ROLE.md) (3004b49);
  - hand over now (this handoff).

Still open (section 4 has the next steps):
- [ ] **Credentials (T3, no default):** inbox/2026-11-19-session-credentials.md; on the 20:06 card as 3a (an environment without production tokens for Finder, Marketer, Monitor; recommendation yes) and 3b (drop the dead Netlify copy now, keep RENDER_API_KEY as a written exception; recommendation yes).
- [ ] **Hand-off H5, H7, H10 to H16, H18 to H21, H23, H24** (H8 needs nothing, H17 is dropped, H22 is done) (hintwise-workflow projects/workflow/pmanager-handoff.md). H5 and H3's follow-up are in the one-shot of 20 Nov 20:10.
- [ ] **Own-repo analytics branches:** merge only on the owner's word ("2 will do later").
- [ ] **Sign-in look, own-repo apps:** udebt, photo2pgn, StepWise, then PasteMD (with the Q22 default). Not started.
- [ ] **Footer redeploys:** 56 apps left, two a day (hintwise-workflow projects/platform/footer-redeploys.md).
- [ ] **YPai follow-ups,** through PManager: after #47, its own PR for Compact Instructions in digitalme's CLAUDE.md; after #48, R47.3-3 (link a signed-out conversation to the account at sign-in) then the other follow-ups of #45 and #47 (ledger 2026-11-18T21:22Z, 2026-11-19T08:10Z, 08:22Z). The voice comparison (default 5) runs on halflife this week, as a draft PR not for merging.
- [ ] **Gateway follow-up (R48.1-10):** a lost credit_reserve answer returns 500 without a refund (index.ts:179-180).
- [ ] **Delivery Canary, the owner's actions:** Netlify analytics; pisan-labs/delivery-canary through the halflife job; a first real canary.
- [ ] **Chess TD `analytics`:** not merged into main.

## 3. Current state

- **Commits:** claude-built-apps main 7fafdd5 before this handoff commit; hintwise-workflow main 3004b49; daily-project-ideas main not re-checked since bce54fc.
- **Live, and what changed since the last handoff:** nothing deployed except the deploy runner's code (c32ad8c), which redeploys no app. YPai, UpvoteMe, PasteMD, Tagging Doctor m1, backend-hub (express updates) as in the last handoff.
- **Open pull requests:** pisan-labs/hintwise-workflow #1 (draft, source of #2 and #3); pisanuw/myuni #6 (draft, 706aa10); pisanuw/digitalme #47 (5da03a6, APPROVE, frozen; releases today) and #48 (7af6120, round 3 after #47).
- **Clean:** every checkout; nothing uncommitted or unpushed apart from this file; no process running; no subagent running.
- **Branches not merged** (each pushed; merging deploys the app): udebt `analytics`; upvote `analytics`; pastemd `analytics` and `csp-fix`; photo2pgn `analytics`; chess-tournament-director `analytics`; myuni `analytics-masking` and `fix/myuni-nodemailer` (PR #6); claude-built-apps `analytics-code-analogy-forge`; digitalme `claude/upbeat-hopper-78i32m` (#47) and `claude/gateway-retries` (#48); hintwise-workflow `claude/gifted-cannon-883cr9` (PR #1).

## 4. Next step

**First:** the takeover prompt's steps (a) to (c): move the relay's routines from session_01JyJzMZdo2cwHjA4hcPLrcu to yourself (ids in Scheduling), record the takeover, send the owner a short card. Then step (e): archive session_01JyJzMZdo2cwHjA4hcPLrcu once you have started work. Re-check each item below against git before starting it.

1. **20 Nov, 09:00 Barcelona (08:00 UTC): YPai #47 release,** one-shot trig_01TWYbtNXsPnDxP6vCuo4wZN; its prompt has the steps. The owner approved the GATEWAY_STREAM=1 set-env run in advance (ledger 2026-11-19T14:35Z) but must click Approve in GitHub between 09:00 and 10:00: send the link. Merge #47 (5da03a6) with a merge commit without `[skip netlify]`. Send no chat message yourself (a paid call); ask the owner to try one. After the merge write projects/ypai/releases/aux-cap.md and tell the YPai session (session_01JyJzMYdcL21t1LrX7eujSq) so it merges main into claude/gateway-retries.
2. **09:46 Barcelona check: the "Needs you" card** if anything waits (credentials 3a/3b; MyUni's Node line; UpvoteMe's magic-link test).
3. **MyUni, pisanuw/myuni PR #6** (draft, 706aa10), the owner's "2 yes": waits on the functions' Node version (nodemailer 10.6.0 needs Node 20+). The owner was asked to read "Now using node v..." in the Deploy Preview log (https://app.netlify.com/projects/myuniforever/deploys/6afead9c53d83b6aa6d2bfdc) or say "merge anyway". Then mark it ready, merge, check https://myuni.top and that GET /.netlify/functions/feedback answers 405.
4. **Tagging Doctor:** day 2 at 11:49 Barcelona (milestone 2, the app's first migration). The T2 scope defaults (Q2 to Q6, Q8, Q9) are taken at 12:50 Barcelona unless the owner answers (inbox/2026-11-19-tagging-doctor-spec-t2.md); a paid Render plan (Q5) stays T3. Q7 yes (gateway row, default caps): check it against release criterion 4 at milestone 2's release. Milestone 2 is the review-index trial (PIPELINE.md).
5. **13:23 Barcelona: footer redeploys** (trig_01Ke73kgrjfBaZf3WaSUzzJM): 20 Nov accessibility-lens and emoji-lingua; 21 Nov mult-streak-edge and accessibility-fleet-log. Append each express app's outcome to projects/platform/releases/express-advisories.md. These four are Netlify apps, so they do not exercise the deploy runner's wait-for-live (c32ad8c); its first real use is the next backend-hub deploy.
6. **20 Nov 20:10 Barcelona: Watchdog first-day check** (trig_01KsqUrJyRKkr6dN6yiQyhTd): H3 and H5.
7. **YPai #48** (7af6120): round 3, the last, after #47 merges and main is merged into claude/gateway-retries. Release 21 Nov, on the owner's yes of 06:55:32 UTC on 19 Nov.
8. **Workflow hand-off, the rest** (projects/workflow/pmanager-handoff.md): H7 (Monitor's tools), H10/H11 (credentials, now the inbox item), H12 to H16 and H18 (platform work: directive, Builder, fresh Reviewer; H17, the test account, is dropped), H19 to H24 (records). Ask the owner before changing any of the owner's routines.
9. **Render wait-live follow-ups** (R1 to R3): one small platform PR.

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

Times are Barcelona time (the owner's current zone), with Los Angeles or UTC time where the schedule uses it.
- **Relay routines** (move them at takeover):
  - PManager check every two hours at :46 of even UTC hours (01:46, 03:46 ... Barcelona; cards at the 09:46 and 19:46 checks);
  - handoff check 13:56 (04:56 LA);
  - session start 14:52 (05:52 LA);
  - footer redeploys 13:23, daily;
  - one-shots: YPai #47 release, 20 Nov 09:00 (08:00 UTC); Watchdog first-day check, 20 Nov 20:10 (19:10 UTC).
- **The YPai session's routines** (session_01JyJzMYdcL21t1LrX7eujSq): hourly report at :41; handoff check 18:56; session start 19:52.
- **Owner's routines:** ideas 10:51 (01:51 LA), build 11:49 (02:49 LA), TPT 06:37.
- **Workflow routines:** Monitor daily 08:13; Monitor weekly Mondays 07:37 (the first email is 23 Nov); Keeper Thursdays 08:43 (next 26 Nov); Marketer Mondays 10:23.
- **Workflow Actions (hintwise-workflow):** Watchdog 13:17 and 22:17 (12:17 and 21:17 UTC); Rules guard on each push to a rule file.
- **Platform:** app-notify 16:17; the LLM usage report 17:10 and 18:10 (often late).
- No background process runs in this container.

## 11. Open questions

Waiting on the owner:
1. **Credentials (T3, no default):** 3a and 3b on the 19 Nov 20:06 card (inbox/2026-11-19-session-credentials.md).
2. **MyUni's Node line:** read "Now using node v..." in the Deploy Preview build log, or say "merge anyway" (asked 19 Nov about 19:00 Barcelona).
3. **UpvoteMe's magic-link test:** the owner's own sign-in test after the 19 Nov 11:25 release.
4. **Today's GitHub click:** approve the GATEWAY_STREAM=1 run between 09:00 and 10:00 Barcelona.

Also open, no action now:
- Tagging Doctor's T2 scope questions: the defaults are taken on 20 Nov at 12:50 Barcelona.
- Own-repo analytics merges: the owner will do them later.
- digitalme's unused ANTHROPIC_API_KEY repository secret: the owner's to delete, and only if discover-and-draft.yml no longer needs it (default 9).
- The workflow hand-off's other owner questions: the approval gate (H12) and the rollback drill (H13).

## Notes for the next session

### Owner's standing instructions
- **Ask first, and wait, before:** writing production data, deploying to production unless asked, spending money, deleting the unrestorable, rotating secrets, rewriting shared history, publishing outside the session. Pushing to main and deleting merged branches are fine.
- **Questions:** numbered, with a recommendation, in message text. With a recommendation and no answer within 15 minutes in a live chat, take it and say how to undo it (never for the ask-first list). Workflow T2 items default after 24 hours.
- **Approvals typed in another session** (CHARTER.md, Communication, 19 Nov): a yes the owner typed in another session counts when PManager read it in that session's transcript, as a message the owner typed (not one a session relayed), and the ledger names where and when.
- **Times:** the reporting zone is Los Angeles by default. Until 6 January 2027 it is the zone the owner last named, Barcelona now. Label every time.
- **Reports** (owner, 18 Nov): no periodic status report (owner "1", 19 Nov). PManager's check runs every two hours (owner, 20 Nov). A check with nothing to report prints nothing, or exactly one line "HH:MM Nothing to report." (owner, 20 Nov).
  - PManager sends a "Needs you" card at about 09:00 and 18:00 in the reporting zone when something waits on the owner, and at once for an incident.
  - Monitor sends the daily digest, the weekly retrospective, and the weekly email.
- **Handovers:** the daily handover check hands over at 500,000 used tokens (owner's answer to Q23, 19 Nov, kept on 20 Nov: "No leave 500k in your place"), at 6 days, on request, or on failure. Compaction: the owner set `CLAUDE_CODE_AUTO_COMPACT_WINDOW=700000` and `CLAUDE_CODE_IDLE_COMPACT_MIN_TOKENS=400000` (20 Nov); a new session's window is 680,000 (700,000 less 20,000); its autocompact_state.threshold depends on the percentage the cloud sets, which differs between sessions (this session 80%, threshold 384,000 of 480,000; the previous one 92%, 441,600 of 480,000), so expect 544,000 to about 626,000. Read it at takeover and tell the owner the real figure.
- **Archive after a handover** (owner, 20 Nov): once the new session has taken over and started work, it archives the previous session with archive_session (takeover step (e)), unless that session is still working. Never archive any other session.
- **The HintWise workflow is adopted:** you are its PManager. Owner decisions go in hintwise-workflow `decisions/` verbatim.
- **Repo rules:** CHANGES.md is append-only (`YYYY-MM-DD [type] text`). Conventional Commits. No model names in repository files. Run lint and tests before committing.

### Relay parameters (session-relay skill)
| Parameter | Value |
|---|---|
| Repository | pisanuw/claude-built-apps; also pisan-labs/hintwise-workflow, pisanuw/digitalme, daily-project-ideas, pisanorg/yusuf, pisan-labs/chess-tournament-director, pisanuw/upvote, pisanuw/pastemd, pisanuw/understanding-debt, pisanuw/myuni, pisan-labs/photo2pgn, pisan-labs/visualizing-data-structures; read-only dashboards, chess-analyzer |
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
  - session_01JyJzMVhQhwQ7Ea3HMyJ3FN (Nov 14, depth 5);
  - session_01JyJzMXVbrUAhXw75BNyNCX ("PManager: Nov 18", depth 6 of limit 8). It took over on 18 Nov at 02:36 UTC and handed over on 18 Nov, by hand, at the owner's request; its routines were moved at 05:30 UTC.
  - session_01JyJzMXY6RAmKb5w3vkqBjo ("PManager: Nov 18", depth 0 of 8, a new lineage started by hand by the owner). Took over 18 Nov 05:30 UTC; handed over 19 Nov about 18:45 UTC at the owner's suggestion. Archived on 20 Nov at 03:00 UTC (get_session shows SESSION_STATUS_ARCHIVED).
- **Previous session: session_01JyJzMZdo2cwHjA4hcPLrcu ("PManager: Nov 19"),** lineage depth 1 of limit 8, parent session_01JyJzMXY6RAmKb5w3vkqBjo. Created 19 Nov 18:45:58 UTC by create_session; took over 19 Nov 18:47 UTC. Handed over on 20 Nov at about 04:20 UTC (05:20 Barcelona) at the owner's request, and starts the next session with create_session, so that session should read depth 2. Archive it under takeover step (e).
- **Current session:** to be written by the new session at takeover.
- **The relay's routines** (aimed at the previous session, session_01JyJzMZdo2cwHjA4hcPLrcu; the new session moves them):
  - trig_01FEYJzMcZfH5Z61dZTAAiBh: PManager check, every 2 hours, `46 */2 * * *` (was hourly until 20 Nov 04:08 UTC);
  - trig_01NK9e6hncKTF9CqeRKBYPyj: Plabs handoff check: hand over only when due, `CRON_TZ=America/Los_Angeles 56 4 * * *` (hands over at 500,000 used tokens);
  - trig_01W9QnQzfzpLzRZ72Jx2dK3Q: Plabs daily handoff: start the next session (create_session), `CRON_TZ=America/Los_Angeles 52 5 * * *` (its takeover prompt has step (e), archive, since 20 Nov);
  - trig_01Ke73kgrjfBaZf3WaSUzzJM: Footer redeploys, two apps a day, `CRON_TZ=Europe/Madrid 23 13 * * *`;
  - one-shot: trig_01TWYbtNXsPnDxP6vCuo4wZN, YPai #47 release day, 2026-11-20T08:00Z (09:00 Barcelona);
  - one-shot: trig_01KsqUrJyRKkr6dN6yiQyhTd, Watchdog first-day check (H3, H5), 2026-11-20T19:10Z (20:10 Barcelona).
- **Handover checks:**
  - 19 Nov, 12:56 UTC: no handover. Context was 101,271 of 500,000 (20%) after an auto-compaction; the session was 1 day 7 hours old. The owner set `CLAUDE_CODE_AUTO_COMPACT_WINDOW=500000` on the environment (seen 19 Nov; compaction point 441,600). Owner's answer to Q23, "1" (19 Nov, 13:03 UTC): the check hands over at 500,000 tokens, 50% of the 1M window, not at 50% of max_tokens (which now reads 500,000). Compaction keeps a session below that, so handovers come at 6 days, on request, or on failure. trig_01PwhDWfkjdf2pxLNMyp52a8 is updated; the YPai session updates its own check.
  - 19 Nov, about 18:45 UTC: handover at the owner's suggestion (ledger 18:26 UTC). Context was 400,172 of 500,000, with compaction at 441,600; the PR #1 edits would have crossed it.
  - 20 Nov, about 04:20 UTC: handover at the owner's request ("Do a handoff now"). get_session showed autocompact_state effective_window 480,000, threshold 384,000 (the old 500000 setting; this session's cloud percentage is 80), used about 340,000.
- **Leave alone:**
  - the YPai session's routines, moved at 18:53 UTC on 19 Nov to the new YPai session session_01JyJzMYdcL21t1LrX7eujSq ("YPai: Nov 19"; the one to tell after #47 merges): hourly report trig_01XRHaKRimeYQFDsdyzG8QRP (`41 * * * *`), handoff check trig_01CqD8KcEJGwvxNuhkspHd3j (`CRON_TZ=Europe/Madrid 56 18 * * *`), session start trig_01Tng1uFLw5e6RKT1uhE4gbW (`CRON_TZ=Europe/Madrid 52 19 * * *`);
  - the owner's routines: ideas trig_01K986yzFbf3noGkLA6RgZkn, build trig_01BAP9nsXTtxTdpMiwk5GdXE, TPT trig_013VN2RNYCwh2k3F2ZjgnK6U;
  - the workflow routines: Monitor daily trig_017ncnNvikFwwEUMzN8k3ix1, Monitor weekly trig_01NMJbSUXu1Pxnb74sQSbFHS, Keeper trig_011fPUzUbmBx8UMYhjtwZCBH, Marketer trig_01Pta3mTcpBNceabkLPScKbi;
  - the switched-off Chess TD one-shots and the SIGCSE reminder.
- **Dated task, 6 January 2027:** reports go back to Los Angeles time. Ask the owner for Los Angeles times for Monitor, Keeper and Marketer, and move them.
