# Handoff: get users, get noticed (PManager relay)

This is the rolling handoff for the PManager relay (the session-relay skill; this session was "Plabs" until 18 Nov). Each handover rewrites it; the last section holds the owner's standing instructions, the relay parameters and Scheduling.

- **Written:** 19 November 2026, about 19:40 Barcelona time (18:40 UTC).
- **By:** session_01JyJzMXY6RAmKb5w3vkqBjo ("PManager: Nov 18"). It hands over at the owner's suggestion: "Your context is over 50%, consider doing handoff and starting a new session to handle these tasks. Your call". Context was 400,172 of 500,000 tokens; compaction comes at 441,600 (ledger 2026-11-19T18:26Z).
- **This session starts the next one now,** with create_session and the session-start routine's takeover prompt, because that routine runs only at 05:52 Los Angeles time. The new session moves the routines; this session then starts no new work.

## 1. Goal

The owner's words, 2 November 2026: "Get people using these projects, advertise these projects to get customers that may want me to build similar projects for them." "One way to be noticed is for github repos to be noticed, forked and get stars."
- Customers, in order: small businesses, startups, edtech, universities. The owner's order is a strong preference, not absolute (the 18 Nov pick).
- Every app lives at `<app>.hintwise.org`.

The owner's words, 18 November 2026: "I want a more structured approach to my web app development ... help me structure it, choose what models should be used for each entity, define their boundaries and write their instructions."
- The result is the HintWise workflow in **pisan-labs/hintwise-workflow** (private), and this session is its **PManager**: roles/pmanager/ROLE.md.
- "Each new project should get its own folder in the workflow so all the agent/session documents that went into creating that project are inspectable."

## 2. Status

Done on 18 Nov (the detail is in hintwise-workflow `decisions/2026-11.md`, and in CHANGES.md here):
- [x] This session took over at 05:30 UTC. The HintWise workflow was adopted, with the `owner-approval` gate, the weekly email and the Monitor, Keeper and Marketer routines.
- [x] Next project, picked by the owner: Tagging Doctor (`projects/tagging-doctor/`), with a free Render service approved for its compile step.
- [x] LLM gateway streaming is live (PR #7, 4d6ce5c) and was checked end to end (gateway-check, PR #8, 04cce08).
- [x] YPai moved onto the platform: m1 (footer, analytics, privacy note) and m2 (sign-in, gateway client) are live. Its caps are set, and the 14:48 UTC model-reply incident was fixed by #41 and #42.
- [x] One sign-in look, as on UpvoteMe, is live on three apps (1380fbc). The Netlify-token and routine-repository incidents were resolved.
- [x] Delivery Canary was finished and catalogued (f427cc7); the Marketer's drafts were emailed to the owner.
- [x] Footer redeploys began, two apps a day (pluck-lab, net-units).

Done on 19 Nov (Barcelona time; UTC where a record uses it):
- [x] **YPai backups:** the offsite backup landed at 01:44 (00:44:41 UTC). The renewed token works; item 23 is closed.
- [x] **T2 defaults 5, 7, 8 and 9 taken** at the 07:15 deadline (ledger 06:17 UTC). The undo for each is in the ledger.
- [x] **YPai #45 is live** (each call priced by the model that served it). Merged at 08:21 (07:21:13 UTC) as c06215c, on the owner's "Accept all recommendations, do it" (typed in the YPai session at 06:55:32 UTC). GATEWAY_STREAM was not set: run 44475898087 waited for approval and was cancelled.
- [x] **YPai #47** (aux calls in the monthly cap; it also fixes bring-your-own-key chat, broken since 21 Jun): Reviewer round 3 APPROVE at 5da03a6, at 09:22. It is frozen; release 20 Nov.
- [x] **YPai #48** (gateway retries): round 1 CHANGES, round 2 EXPLAIN; the fixes are at 7af6120. Round 3, the last, comes after #47 merges.
- [x] **Keeper's weekly checks** (08:43): four security fixes (UpvoteMe, MyUni, express, PasteMD), each with Reviewer APPROVE, and a check-schema question.
- [x] **check-schema:** all seven app schemas passed (PManager, read-only; hintwise-workflow runs/2026-11-19T1050Z-pmanager-check-schema.md).
- [x] **Q22 default taken** (deadline 10:30): PasteMD's magic link moves to sign-in-link when PasteMD gets the new sign-in look.
- [x] **UpvoteMe's critical sign-in fix is live** (next-auth advisory; pisanuw/upvote #6, b488e55, 11:25), on the owner's "Upvote yes". The owner's magic-link test is still to do.
- [x] **PasteMD's security fix merged** (pisanuw/pastemd #4, 8ceb970, 11:26), on the owner's "Pastemd yes". Every function loads. The production deploy's finish cannot be seen from outside (lockfile-only change).
- [x] **Compact Instructions** went into CLAUDE.md (c7bcc8e, 11:46) by the 15-minute default. The owner set `CLAUDE_CODE_AUTO_COMPACT_WINDOW=500000` on the environment; compaction now comes at 441,600.
- [x] **Handover check, 13:56:** no handover. The owner answered Q23 with "1" (14:03): hand over at 500,000 used tokens.
- [x] **Footer redeploys 3 and 4:** elevator-algorithm-lab and cron-cartographer (run 44523578780). 4 of 60 are done.
- [x] **Owner's answers typed in the YPai session** (read in its transcript): "A / 1 ok" (14:09: its handoff branch, and the R47.3-3 fix after #48); "Stream only" (14:36: the sender stays as it is).
- [x] **The owner's yes to tomorrow's GATEWAY_STREAM=1 run** (15:35; ledger 14:35 UTC). Hourly reports stay off (owner "1", 15:39).
- [x] **Tagging Doctor day 1:**
  - the spec was approved in round 3; milestone 1 (the in-browser scan) got Reviewer APPROVE in round 3, and Manager accepted it with two change requests, now in milestone 2;
  - merged as cc9f135 at 15:48 under standing authorizations 2 and 3; Deploy run 44547696311; live at https://tagging-doctor.hintwise.org with the footer;
  - the owner approved the sign-in-link (44547822655) and delete-account (44547856165) redeploys; both succeeded at about 18:03 (17:02:57 and 17:03:27 UTC);
  - record: hintwise-workflow projects/tagging-doctor/releases/m1.md.
- [x] **The 18:46 card:** the owner's "1 yes, 2 yes, 3 yes from card" (ledger 17:56 UTC). 1 is Tagging Doctor's gateway row (Q7), 2 is MyUni PR #6, 3 is express PR #9.
- [x] **Express security updates (claude-built-apps PR #9):**
  - merged at 18:56 as 009a518, with `[skip render]`;
  - backend-hub deployed by run 44582576617; Render deploy dep-dbvjh47f3r2c73celit0 went live at 18:59 (17:59:10 UTC); health is ok;
  - backend-hub's address is https://backend-hub-wk2e.onrender.com;
  - the three Netlify apps follow in the footer slots (section 4, item 5). Record: projects/platform/releases/express-advisories.md.
- [x] **Workflow review, pisan-labs/hintwise-workflow PR #1:** received at 18:55. A fresh Reviewer's round 1 is in projects/workflow/review-pr1-r1.md. The owner answered PManager's three questions at 19:26 (ledger 18:26 UTC). F1 is done on main (CHARTER.md, Communication, 93947b1). The rest is section 4, item 1.
- [x] **The YPai session handed over:** pisanuw/digitalme PR #49 ("docs: the handoff of 19 November") merged at 19:05 (18:05:48 UTC). Its session-start routine starts "YPai: Nov 19" at 19:52 (18:52 UTC); not verified at the time of writing.
- [ ] **An unrecorded deploy:** manual Deploy run 44545724344 deployed lewis-alt-text at 15:37 (14:37 UTC; success at 14:39 UTC). No record names it; the owner was asked on the 18:46 card who ran it. The fact-check found the answer: the lewis-alt-text session (session_01JyJzMY5cjawi1RpmbD5RVP) started it at 14:37:14 UTC, after the owner typed "Yes deploy" there at 14:35:23 UTC (its transcript). Still to do: the ledger line.

Still open (section 4 has the next steps):
- [ ] **Own-repo analytics branches:** merge only on the owner's word ("2 will do later").
- [ ] **Sign-in look, own-repo apps:** udebt, photo2pgn, StepWise, then PasteMD (with the Q22 default). Not started.
- [ ] **Footer redeploys:** 56 apps left, two a day (hintwise-workflow projects/platform/footer-redeploys.md).
- [ ] **YPai follow-ups,** through PManager:
  - first after #47 merges, its own PR: Compact Instructions in digitalme's CLAUDE.md (ledger 2026-11-19T10:46Z; digitalme docs/handoff.md, "Next, in order" 3);
  - after #48, one follow-up PR: R47.3-3 first, linking a conversation started signed out to the account at sign-in, so deletion removes it, with a privacy-note check (owner, "1 ok"); then the other listed follow-ups of #45 and #47 (ledger 2026-11-18T21:22Z, 2026-11-19T08:10Z and 08:22Z).
  - The voice comparison (default 5) runs on halflife this week, as a draft PR not for merging.
- [ ] **Gateway follow-up (R48.1-10):** if credit_reserve commits but its answer is lost, index.ts:179-180 returns 500 without a refund, and a client retry takes a second credit. The streaming follow-ups are in projects/platform/releases/gateway-streaming.md.
- [ ] **Delivery Canary, the owner's actions:** Netlify analytics; pisan-labs/delivery-canary through the halflife job; a first real canary (delivery-canary/HANDOFF.md "Remaining").
- [ ] **Chess TD `analytics`:** main merged in, `pnpm check` green (18 Nov). Not merged into main.

## 3. Current state

- **Commits:**
  - claude-built-apps main 859ad1b, before this handoff commit; CI green on it (run 44583192822);
  - hintwise-workflow main 93947b1;
  - daily-project-ideas main bce54fc.
- **Live, and what changed today** (Barcelona time):
  - YPai: #45 live since 08:21; offsite backups resumed. #47 releases 20 Nov, #48 on 21 Nov.
  - UpvoteMe: the critical sign-in fix, live since 11:25.
  - PasteMD: the security fix merged at 11:26; its functions load, but the deploy's finish is not visible from outside.
  - Tagging Doctor: milestone 1 live at https://tagging-doctor.hintwise.org since 15:54 (merged 15:48; Deploy run success 14:53:50 UTC). sign-in-link and delete-account were redeployed with its origin at about 18:03 (delete-account checked at 18:47; sign-in-link not exercised).
  - backend-hub: the express updates, live since 18:59 at https://backend-hub-wk2e.onrender.com. The restart reset any mult-streak game in progress.
  - Footers: 4 of 60 apps redeployed (today elevator-algorithm-lab and cron-cartographer).
  - lewis-alt-text: redeployed at 15:37 by a manual run from its own session, on the owner's "Yes deploy" there; no record names it yet.
  - Supabase: check-schema passed on seven app schemas.
  - Environment: `CLAUDE_CODE_AUTO_COMPACT_WINDOW=500000`, set by the owner.
  - The YPai session: handed over (digitalme PR #49); "YPai: Nov 19" due at 19:52.
- **Open pull requests:**
  - pisan-labs/hintwise-workflow #1 (draft, d9772ef): the source for PR A and PR B; the owner merges.
  - pisanuw/myuni #6 (draft, 706aa10).
  - pisanuw/digitalme #47 (5da03a6, APPROVE, frozen) and #48 (7af6120, round 3 to come).
- **Clean:** every checkout, nothing uncommitted or unpushed apart from this file; no process running.
- **Branches not merged** (each pushed; merging deploys the app):
  - udebt `analytics`, upvote `analytics`, pastemd `analytics` and `csp-fix` (they conflict in netlify.toml and CHANGES.md), photo2pgn `analytics`;
  - chess-tournament-director `analytics` (main merged in; not re-checked on 19 Nov, the repository is not attached here);
  - myuni `analytics-masking`, and `fix/myuni-nodemailer` (PR #6);
  - claude-built-apps `analytics-code-analogy-forge`;
  - digitalme `claude/upbeat-hopper-78i32m` (#47) and `claude/gateway-retries` (#48);
  - hintwise-workflow `claude/gifted-cannon-883cr9` (PR #1).

## 4. Next step

**First:** the takeover prompt's steps (a) to (c). Move the relay's routines from session_01JyJzMXY6RAmKb5w3vkqBjo to yourself (list in Scheduling), record the takeover, and send the owner a short card. Do not message the previous session. pisanuw/digitalme is not in the takeover prompt's repository list: add_repo it (access push) before item 2. Then, in this order:

1. **Workflow review, pisan-labs/hintwise-workflow PR #1** (branch `claude/gifted-cannon-883cr9`, head d9772ef, draft).
   - The owner's answers to PManager, 19 Nov (18:26 UTC): "1 yes, a cepti g your recommendation / 2 yes, act on it / 3 you make the edits on a branch".
   - So PManager makes two new pull requests from main (93947b1 or later):
     - **PR A:** the four agreed commits (3a9b4dc, cbc2c61, 6932c82, c06e9c9), with edits E1 to E5 from projects/workflow/review-pr1-r1.md.
     - **PR B:** the other nine commits (c98b809 to d9772ef), with E6 to E9. The review's verdict also says "E10", which it never defines; say so in PR B's description.
   - Leave out of both:
     - `routines/hourly-check.md`. Later, as its own small PR, replace it with the real hourly prompt plus a daily-record line.
     - `inbox/2026-11-19-live-test-account.md`.
   - F1 (a yes typed in another session; not the review's finding F1, the Watchdog alarms) is already applied on main by the owner's instruction (CHARTER.md, Communication, 93947b1). PR B leaves F1 out; keep main's sentence where the branch's CHARTER.md edits overlap it.
   - A fresh Reviewer (top tier) checks each PR before the owner merges. Only the owner merges. PR #1 stays open as the source.
   - After each merge, do hand-off items H1 to H5 in projects/workflow/pmanager-handoff.md (on the branch). H1 includes the ledger lines for the review session's answers, "1a 2 agree 3 agree 4 yes".
2. **20 Nov, 09:00 Barcelona (08:00 UTC): YPai #47 release,** scheduled task trig_01TWYbtNXsPnDxP6vCuo4wZN. Its prompt has the steps.
   - The owner approved the GATEWAY_STREAM=1 set-env run in advance (ledger 2026-11-19T14:35Z). The owner must still click Approve in GitHub between 09:00 and 10:00 Barcelona: send the link.
   - Merge #47 (5da03a6) with a merge commit without `[skip netlify]`, at 10:00 Barcelona or as soon as the run has finished.
   - The sender stays as it is (owner, "Stream only"). Send no chat message yourself (a reply is a paid call); ask the owner to try one.
   - After the merge, write projects/ypai/releases/aux-cap.md and tell the new YPai session ("YPai: Nov 19" in list_sessions), so it merges main into claude/gateway-retries.
3. **MyUni, pisanuw/myuni PR #6** (draft, head 706aa10). The owner said yes (18:46 card, "2 yes").
   - It waits on check (b), the functions' Node version. nodemailer 10.6.0 needs Node 20 or newer, nothing in the repository pins it, and the Netlify token in the session env file answers 401. Checks (a) and (c) passed on the Deploy Preview (Keeper, 08:42 UTC).
   - The owner was asked to read the Deploy Preview build log (https://app.netlify.com/projects/myuniforever/deploys/6afead9c53d83b6aa6d2bfdc, the "Now using node v..." line), or to say "merge anyway".
   - Then mark it ready and merge. Check that https://myuni.top loads and that GET /.netlify/functions/feedback answers 405.
4. **Tagging Doctor:**
   - day 2 starts at 02:49 Los Angeles time (11:49 Barcelona): milestone 2, with the app's first migration;
   - the T2 scope defaults (Q2 to Q6, Q8, Q9) are taken at 2026-11-20T11:50 UTC (12:50 Barcelona) unless the owner answers (inbox/2026-11-19-tagging-doctor-spec-t2.md); a paid Render plan (Q5) stays T3;
   - Q7 yes (the gateway row, default caps): check it against release criterion 4 at milestone 2's release.
5. **20 Nov, 13:23 Barcelona: footer redeploys** (trig_01Ke73kgrjfBaZf3WaSUzzJM). The order changed for the express fix: 20 Nov accessibility-lens and emoji-lingua; 21 Nov mult-streak-edge and accessibility-fleet-log (projects/platform/footer-redeploys.md). Append the outcome for each express app (accessibility-lens, emoji-lingua, mult-streak-edge) to projects/platform/releases/express-advisories.md.
6. **YPai #48** (digitalme gateway retries, 7af6120): round 3, the last, after #47 merges and main is merged into claude/gateway-retries. Release 21 Nov, on the owner's yes of 06:55:32 UTC.
7. **Platform follow-up:** deploy.mjs's Render path health-checks about a second after triggering, against the old instance (run 44582576617). It should wait until the deploy is live. This is platform work: a directive, Builder, a fresh Reviewer, PManager's release.

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
  - PManager hourly check at :46;
  - handoff check 13:56 (04:56 LA);
  - session start 14:52 (05:52 LA);
  - footer redeploys 13:23, daily;
  - one-shot: YPai #47 release, 20 Nov 09:00 (08:00 UTC).
- **The YPai session's routines** (the new YPai session moves them): hourly report at :41; handoff check 18:56; session start 19:52.
- **Owner's routines:** ideas 10:51 (01:51 LA), build 11:49 (02:49 LA), TPT 06:37.
- **Workflow routines:** Monitor daily 08:13; Monitor weekly Mondays 07:37 (the first email is 23 Nov); Keeper Thursdays 08:43 (next 26 Nov); Marketer Mondays 10:23.
- **Platform:** app-notify 16:17; the LLM usage report 17:10 and 18:10 (often late).
- No background process runs in this container.

## 11. Open questions

Waiting on the owner:
1. **MyUni's Node line:** read "Now using node v..." in the Deploy Preview build log, or say "merge anyway" (18:46 card).
2. **UpvoteMe's magic-link test:** the owner's own sign-in test after the 11:25 release.
3. **Tomorrow's GitHub click:** approve the GATEWAY_STREAM=1 run between 09:00 and 10:00 Barcelona.
4. **PR A and PR B** (from workflow PR #1): the owner merges each once its Reviewer approves.
5. **Who deployed lewis-alt-text** at 15:37 Barcelona (14:37 UTC): manual Deploy run 44545724344, recorded nowhere (asked on the 18:46 card). Answered by that session's transcript (section 2): tell the owner no answer is needed.

Also open, no action now:
- Tagging Doctor's T2 scope questions: the defaults are taken on 20 Nov at 12:50 Barcelona.
- Own-repo analytics merges: the owner will do them later.
- digitalme's unused ANTHROPIC_API_KEY repository secret: the owner's to delete, and only if discover-and-draft.yml no longer needs it (default 9).
- The PR #1 hand-off's other questions for the owner (environments H11, the approval gate H12, the rollback drill H13, the test account): after the merges.

## Notes for the next session

### Owner's standing instructions
- **Ask first, and wait, before:** writing production data, deploying to production unless asked, spending money, deleting the unrestorable, rotating secrets, rewriting shared history, publishing outside the session. Pushing to main and deleting merged branches are fine.
- **Questions:** numbered, with a recommendation, in message text. With a recommendation and no answer within 15 minutes in a live chat, take it and say how to undo it (never for the ask-first list). Workflow T2 items default after 24 hours.
- **Approvals typed in another session** (CHARTER.md, Communication, 19 Nov): a yes the owner typed in another session counts when PManager read it in that session's transcript, as a message the owner typed (not one a session relayed), and the ledger names where and when.
- **Times:** the reporting zone is Los Angeles by default. Until 6 January 2027 it is the zone the owner last named, Barcelona now. Label every time.
- **Reports** (owner, 18 Nov): no hourly status report. Hourly reports stay off (owner "1", 19 Nov).
  - PManager sends a "Needs you" card at about 09:00 and 18:00 in the reporting zone when something waits on the owner, and at once for an incident.
  - Monitor sends the daily digest, the weekly retrospective, and the weekly email.
- **Handovers:** the daily handover check hands over at 500,000 used tokens, 50% of the 1M window (owner's answer to Q23, 19 Nov), at 6 days, on request, or on failure.
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
  - session_01JyJzMVhQhwQ7Ea3HMyJ3FN (Nov 14, depth 5);
  - session_01JyJzMXVbrUAhXw75BNyNCX ("PManager: Nov 18", depth 6 of limit 8). It took over on 18 Nov at 02:36 UTC and handed over on 18 Nov, by hand, at the owner's request; its routines were moved at 05:30 UTC.
- **Previous session: session_01JyJzMXY6RAmKb5w3vkqBjo ("PManager: Nov 18"),** lineage depth 0 of limit 8 (a new lineage, started by hand by the owner).
  - Created 18 Nov 05:28 UTC; took over 18 Nov 05:30 UTC (06:30 Barcelona time), for the handoff of 18 November (f8641db).
  - Handed over on 19 Nov at about 18:45 UTC (19:45 Barcelona time), at the owner's suggestion. It starts the next session with create_session, so that session should read depth 1 (check with get_session).
- **Current session: session_01JyJzMZdo2cwHjA4hcPLrcu ("PManager: Nov 19"),** lineage depth 1 of limit 8, parent session_01JyJzMXY6RAmKb5w3vkqBjo. Created 19 Nov 18:45:58 UTC by create_session; took over on 19 Nov at 18:47 UTC (19:47 Barcelona time) and moved the five routines below.
- **The relay's routines** (aimed at the current session since 19 Nov 18:47 UTC; the old ids trig_01D3w33bL8kxHA46VLTrnKNc, trig_01PwhDWfkjdf2pxLNMyp52a8, trig_01Ck5e8Yy3vvwQ1BSF6cJnE2, trig_01W7LHJXGx2ekKemn6hPJeBp and trig_0156DPbYvHFbU89bjsgiq2qV are deleted):
  - trig_01FEYJzMcZfH5Z61dZTAAiBh: PManager hourly check, `46 * * * *`;
  - trig_01NK9e6hncKTF9CqeRKBYPyj: Plabs handoff check: hand over only when due, `CRON_TZ=America/Los_Angeles 56 4 * * *` (hands over at 500,000 used tokens, the owner's Q23 answer);
  - trig_01W9QnQzfzpLzRZ72Jx2dK3Q: Plabs daily handoff: start the next session (create_session), `CRON_TZ=America/Los_Angeles 52 5 * * *`;
  - trig_01Ke73kgrjfBaZf3WaSUzzJM: Footer redeploys, two apps a day, `CRON_TZ=Europe/Madrid 23 13 * * *`;
  - one-shot: trig_01TWYbtNXsPnDxP6vCuo4wZN, YPai #47 release day, 2026-11-20T08:00Z (09:00 Barcelona).
- **Handover checks:**
  - 19 Nov, 12:56 UTC: no handover. Context was 101,271 of 500,000 (20%) after an auto-compaction; the session was 1 day 7 hours old. The owner set `CLAUDE_CODE_AUTO_COMPACT_WINDOW=500000` on the environment (seen 19 Nov; compaction point 441,600). Owner's answer to Q23, "1" (19 Nov, 13:03 UTC): the check hands over at 500,000 tokens, 50% of the 1M window, not at 50% of max_tokens (which now reads 500,000). Compaction keeps a session below that, so handovers come at 6 days, on request, or on failure. trig_01PwhDWfkjdf2pxLNMyp52a8 is updated; the YPai session updates its own check.
  - 19 Nov, about 18:45 UTC: handover at the owner's suggestion (ledger 18:26 UTC). Context was 400,172 of 500,000, with compaction at 441,600; the PR #1 edits would have crossed it.
- **Leave alone:**
  - the YPai session's routines, aimed at session_01JyJzMYC2h8cRGt8cGRNiLz; the new YPai session moves them: hourly report trig_017satGAS9LvJjDKRTknBi3q (`41 * * * *`), handoff check trig_01XUrHEVbtvC2MPBKNZqcXcs (`CRON_TZ=Europe/Madrid 56 18 * * *`), session start trig_01ECmpti2qx17B2xD4xk11FS (`CRON_TZ=Europe/Madrid 52 19 * * *`);
  - the owner's routines: ideas trig_01K986yzFbf3noGkLA6RgZkn, build trig_01BAP9nsXTtxTdpMiwk5GdXE, TPT trig_013VN2RNYCwh2k3F2ZjgnK6U;
  - the workflow routines: Monitor daily trig_017ncnNvikFwwEUMzN8k3ix1, Monitor weekly trig_01NMJbSUXu1Pxnb74sQSbFHS, Keeper trig_011fPUzUbmBx8UMYhjtwZCBH, Marketer trig_01Pta3mTcpBNceabkLPScKbi;
  - the switched-off Chess TD one-shots and the SIGCSE reminder.
- **Dated task, 6 January 2027:** reports go back to Los Angeles time. Ask the owner for Los Angeles times for Monitor, Keeper and Marketer, and move them.
