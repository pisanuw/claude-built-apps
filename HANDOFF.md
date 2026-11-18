# Handoff: get users, get noticed

This is the rolling handoff for the Plabs relay (session-relay skill). Each handover rewrites it. The last section holds the owner's standing instructions, the relay parameters and Scheduling.

Written 18 November 2026, 03:05 Barcelona time, by session_01JyJzMVhQhwQ7Ea3HMyJ3FN on the owner's "/handoff now". Context was 53% (531,832 of 1,000,000 tokens). It was fact-checked by a subagent against git, the Actions runs and the routines list. Reports to the owner use Barcelona time (Europe/Madrid). The relay's handoff and session-start routines use Europe/Berlin crons, the hourly report plain UTC, and the owner's routines Los Angeles time.

## 1. Goal

Owner's words (2026-11-02): "Get people using these projects, advertise these projects to get customers that may want me to build similar projects for them." "One way to be noticed is for github repos to be noticed, forked and get stars."
- The offer is paid custom builds, part-time: "I care more about connections and being useful than money." "Built by Claude" is the headline. Customers: small businesses, startups, edtech, universities. Every app lives at `<app>.hintwise.org`.
- Since 9 Nov the build routine builds one substantial project a week (BUILD_ROUTINE.md). This relay session runs the shared platform, the status reports and the owner's requests across repos.
- Latest request (17 Nov): "add analytics to the rest of the apps but do not deploy them, add it on a branch if necessary", then "merge do not deploy" and "3 ok": apps in this repo get analytics at their next deploy, with no batch redeploy.

## 2. Status

Done since the last handoff (14 Nov):
- [x] StepWise wave 10, the AI pathway and learning paths (its own session); app-notify sent its first real email on 15 Nov.
- [x] udebt live with anonymous gateway use (15 Nov). Lewis alt-text is live (15 Nov). A standalone setup guide (PDF and zip) was sent to the owner for Scott; it is not in any repo.
- [x] "Finish signing in" fix against mail scanners using up sign-in links. Deployed for lewis-alt-text, delivery-canary, qualified-overtime-checker and udebt (Netlify builds udebt's main; checked live 16 Nov). teacher-catalog-kit has it but is not deployed.
- [x] First-party analytics:
  - shared/0014 (events), 0015 (summary) and 0016 (own-repo apps) applied;
  - the app-events and app-events-report functions deployed;
  - pisan-analytics shows an "App events" section (pisanuw/dashboards, deployed by the "Deploy dashboards" workflow);
  - live and confirmed with real rows: MyUni (PR #5; check run 44080158002) and StepWise (check run 44121998338).
- [x] Analytics for every app merged to main (741b225), with no deploy:
  - scripts/site-analytics.mjs adds the script at deploy;
  - the deploy registers each app's origin (`analytics-register`);
  - ids and quoted text are masked, and a `data-mask` option covers short share codes.
- [x] StepWise deployed 17 Nov 18:19 UTC (main d83c070): credits aligned with each page's column; notes-only pushes skip CI.
- [x] Chess TD CI trim, PR #227 (45899b1): the full suite runs once per code version, and the scheduled Oracle is weekly (Sun 03:23 UTC).
- [x] Delivery Canary days 4 to 6 (build routine).
- [x] 18 Nov:
  - the LLM usage report treats a reused Resend key as already sent (6ba80f2);
  - the platform/node_modules link committed by mistake in d36dd1d is removed (0b04807).

In progress / remaining:
- [ ] Own-repo analytics branches await the owner's merge; merging deploys each app (section 4).
- [ ] Watch the first analytics rows for each newly deployed app on pisan-analytics.
- [ ] Delivery Canary day 7, the last build day: 18 Nov 11:49 Berlin (build routine).

## 3. Current state

- **claude-built-apps:** main 6ba80f2 before the handoff commits. CI on 6ba80f2 is green (run 44220531369; platform 533 tests).
- **Clean:** all twelve checkouts have no uncommitted or unpushed work, and no process is running. That is the 9 session repos plus daily-project-ideas, a second understanding-debt clone and srayermann/lewis-structures-alt-text.
- **Branches not merged** (each pushed; merging deploys the app):
  - udebt `analytics`, upvote `analytics`, pastemd `analytics` and `csp-fix`, photo2pgn `analytics`, chess-tournament-director `analytics`, myuni `analytics-masking`;
  - claude-built-apps `analytics-code-analogy-forge` (any change under that folder deploys it).
- **StepWise:** next 643ab0b, main d83c070.

## 4. Next step

First, tell the owner: a clone that pulled claude-built-apps between 17 Nov 16:21 UTC and 18 Nov 02:04 UTC had its platform/node_modules folder replaced by a dangling link. Fix: `rm platform/node_modules; (cd platform && npm ci)`. halflife may be one of them (unverified).

Then work through this list in order:
1. **Check the next LLM usage report run** (cron 16:10 and 17:10 UTC; GitHub has delayed these by up to 8 hours). Expect success, or the "Already sent for <day>" line.
2. **Merge the own-repo analytics branches only on the owner's word.** Two of them need preparing first:
   - Chess TD `analytics` was cut before #227: merge main into it first.
   - PasteMD `csp-fix` and `analytics` conflict in netlify.toml and CHANGES.md (the page heads merge cleanly): the second to merge needs those resolved.
3. **Watch the build routine:** Delivery Canary day 7.

## 5. Decisions and why

- **Mirrors:** the monorepo is the source of truth. pisan-labs repos are `git subtree split` mirrors (mirror.yml + .github/mirrors.txt).
- **Netlify credits:** a push to main deploys only targets whose target.yml changed, plus shortcut-sprint and code-analogy-forge source. Runner and footer changes deploy nothing until the next deploy. Docs-only commits carry `[skip netlify]`.
- **Addresses:** `<app>.hintwise.org` everywhere. target.yml keeps `customDomain: <app>.pisan.me`, and the runner swaps in APP_DOMAIN. Outside webhooks must use hintwise.org; they don't follow the 301.
- **Runtime:** Node 24 for CI, deploy and ops (owner yes, 14 Nov).
- **Public pages** are for customers: no scores, build times or test counts.
- **Email:** sign-in through sign-in-link only, never `signInWithOtp`. App mail is from `<slug>@hintwise.org`.
- **Gateway spending:** dollar caps per app (day, week, month), optional per-person caps, and credits after the free allowance (owner, 12–13 Nov).
- **Secrets:** the 9 Nov JWT exposure is accepted; **do not raise rotation again**. Never rotate EMAIL_OPTOUT_SECRET or SIGN_IN_HASH_KEY. Never replace DELIVERY_CANARY_KEY.
- **Analytics** (owner, 17 Nov: "my own endpoint"):
  - first-party and cookieless; the visitor id is a daily salted hash, and the IP is never stored;
  - nothing is sent under Global Privacy Control, Do Not Track or `navigator.webdriver`;
  - apps here get it at deploy (`analytics: false` opts out); own-repo apps copy hw-events.js byte for byte, pinned by a sha256 test;
  - app text must not promise "no tracking";
  - td.pisan.me is not registered (owner OK).
- **Sign-in links** wait for a "Finish signing in" click when nobody is signed in, because mail scanners (Safe Links) used up the single-use links.
- **CI minutes:** public repositories cost nothing on standard runners. Chess TD (private) spends most of the minutes (about 870 job-minutes per 100 runs), hence #227. MyUni is private too, but its runs take about 44 seconds.

## 6. Tried and rejected

- A second SQL copy of the gateway cap rules: rejected; check mode reuses `decide()`.
- Redeploying all apps on a runner edit: it ran Netlify out of credits on 2 Nov.
- A database trigger on auth.users: Supabase refuses it.
- Removing Chess TD's CI on main: rejected, because Render deploys main only after the checks pass. The check stays, but is fast when the same code already passed.
- Leaving paste, topic and join pages without analytics: replaced by `data-mask`.
- Sending a test beacon into production to prove the pipeline: not done; real visits proved it.

## 7. Constraints and gotchas

- **Commits:** Conventional Commits (`.git-hooks/commit-msg`; `git config core.hooksPath .git-hooks`). `git fetch` before work and before pushing; never force-push main.
- **Supabase admin workflow:**
  - one run at a time;
  - its logs are public: print counts and aggregates only;
  - `sql` takes a committed file.
- **Never print secrets or put them in workflow inputs.** Never ask the owner to paste a key.
- **Worktrees:** never commit a node_modules link. `.gitignore` now says `node_modules` without the slash, so it also covers links.
- **Playwright and analytics:** headless Chromium sets `navigator.webdriver`, so the script sends nothing. Tests override it, and must route or block auth.hintwise.org outright: pagehide beacons can slip past `page.route`.
- **The app-events endpoint answers 204 either way;** only a stored row proves the pipeline. It also drops headless user agents, so nothing from a test is stored.
- **CI concurrency:** a superseded run shows as cancelled, which is not a failure.
- **StepWise:** main moves only when Yusuf says "deploy" (fast-forward to a green `next`; 15 Netlify credits).
- **MyUni:** pytest is not installed in this container.

## 8. How to run and verify

- **App** (its folder): `npm ci && npm run lint && npm run typecheck && npm run coverage && npm run build`.
- **Platform** (platform/): `npm run lint && npm run typecheck && npx vitest run && npm run check-scripts`. 533 tests passed on 18 Nov.
- **Footer and analytics injector:** `node --test scripts/site-footer.test.mjs scripts/site-analytics.test.mjs`.
- **Analytics counts:** Supabase admin, `sql platform/supabase/ops/app-events-check.sql` (counts only).
- **Live footer:** `curl -s https://<app>.hintwise.org/ | grep -c data-site-footer` prints 1.

## 9. Key files

- docs/platform.md ("First-party analytics") and docs/new-app-guide.md: the platform and the per-app rules.
- platform/src/analytics/ (hw-events.js, events.ts, service.ts, report.ts): the analytics client and endpoints.
- scripts/site-analytics.mjs and scripts/site-footer.mjs: injected into every Netlify app at deploy.
- accessibility-lens/deploy/deploy.mjs: the deploy runner (never import it in a test; it runs main).
- platform/supabase-admin.mjs and .github/workflows/supabase-admin.yml: database admin.
- .github/workflows/deploy-dashboards.yml: deploys pisan-analytics.
- platform/supabase/shared/0001–0016 (schema) and platform/supabase/ops/ (read-only queries).
- platform/llm-usage-report.mjs: the daily usage email.
- CHANGES.md, BRIEFING.md, BUILD_ROUTINE.md.

## 10. Background jobs

All times Barcelona (Europe/Madrid):
- **Relay routines:** hourly status at :46; handoff check at 13:56; session start at 14:52. Ids in Scheduling below.
- **Owner's routines:** ideas (10:51), build (11:49) and TPT daily product builder (06:37), all daily.
- **Platform jobs:** pg_cron app-notify at 16:17; the LLM usage report at 17:10 and 18:10 (often hours late); halflife's pisan-labs sync at 04:13 (time zone not recorded).
- **Chess TD:** Oracle weekly, Sunday 04:23; FIDE test image daily (fide-test.yml).
- **Nothing else:** no subagent or background process is running at this handoff, apart from its fact-check.

## 11. Open questions

1. When should the own-repo analytics branches merge? Each merge deploys that app. No answer yet.
2. Which halflife jobs, if any, need platform/node_modules? I don't know.
3. Older offers with no answer: a weekly footer drift check; a redirect for fide-lookup.onrender.com; testing Google sign-in on MeetMe, Chess TD and Digital Yusuf; posting launch drafts 1–7.

## Notes for the next session

### Owner's standing instructions
- **Ask first, and wait, before:** writing production data, deploying to production unless asked, spending money, deleting the unrestorable, rotating secrets, rewriting shared history, publishing outside the session. Pushing to main and deleting merged branches are fine.
- **Questions:** numbered, with a recommendation, in message text. With a recommendation and no answer in 15 minutes, take it and say how to undo it (never for the ask-first list). Set a send_later check-in for 15 minutes.
- **Times:** Barcelona time (Europe/Madrid) in reports and chat (owner, 17 Nov, "until further notice").
- **Quiet hours:** when an hourly check finds nothing new, print nothing.
- **Repo rules:** CHANGES.md is append-only, `YYYY-MM-DD [type] text`. Conventional Commits. No model names in repo artifacts. Run lint and tests before committing.
- **Keys:** the owner's key only through the gateway; never in Netlify or in an app.

### Relay parameters (session-relay skill)
| Parameter | Value |
|---|---|
| Repository | pisanuw/claude-built-apps; also daily-project-ideas, pisanorg/yusuf, pisan-labs/chess-tournament-director, pisanuw/upvote, pisanuw/pastemd, pisanuw/understanding-debt, pisanuw/myuni, pisan-labs/photo2pgn, pisan-labs/visualizing-data-structures; read-only dashboards, chess-analyzer |
| Handoff document | HANDOFF.md (this file) |
| Routine time zone | Europe/Berlin |
| Report time zone | Europe/Madrid (Barcelona) |
| Handover check | 13:56 Europe/Berlin |
| Session start | 14:52 Europe/Berlin |
| Handoff marker | a commit on main titled `docs: the handoff of <D Month>`; no other commit may use that subject |
| Merge rule | push to main after `node --test scripts/site-footer.test.mjs` passes |

### Scheduling
- **Earlier sessions:** session_01JyJzMZ1aBTZCRkUXLJnRG4 (Nov 8, depth 2); session_01JyJzMXxeHu9P7By5BXRNJv (Nov 11, depth 3); session_01JyJzMWixW7SqcHTri4Umng (Nov 13, depth 4).
- **Previous session: session_01JyJzMVhQhwQ7Ea3HMyJ3FN ("Plabs: Nov 14")**, lineage depth 5 of limit 8.
  - Created 14 Nov 13:52 UTC; handed over 18 November 2026 on the owner's "/handoff now", at 53% context.
  - The next session is depth 6 of 8.
  - Its routines, all aimed at it, are to be re-aimed by the new session, which then deletes these:
    - trig_01LvzA4YK1HANnbjfntihccc: Plabs hourly status report, `46 * * * *`
    - trig_01DYgx6NLAWauCztLtCdzwBd: Plabs handoff check: hand over only when due, `CRON_TZ=Europe/Berlin 56 13 * * *`
    - trig_016QHHijGtC5VWcSzZUN4nuQ: Plabs daily handoff: start the next session (create_session), `CRON_TZ=Europe/Berlin 52 14 * * *`
- **Current session:** none has taken over yet. A session started by hand records itself here, and the 14:52 session-start routine then does nothing.
- **Not relay, leave alone:**
  - the owner's routines: trig_01K986yzFbf3noGkLA6RgZkn (ideas), trig_01BAP9nsXTtxTdpMiwk5GdXE (build), trig_013VN2RNYCwh2k3F2ZjgnK6U (TPT);
  - switched-off Chess TD one-shots: trig_019FyBvXSAJmnkRySX7Xcnhu, trig_01LEKF5t2KGMD4cYYugJm4cY, trig_01HWrJiGqnb64uMbfxLr2VLp, trig_01S3XupgMqeYd1SyUZE1fTyN;
  - the SIGCSE poster reminder trig_019diEeyHQKFaGeR69ba2soL, which is off (its session is gone).
