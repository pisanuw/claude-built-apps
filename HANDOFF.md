# Handoff: get users, get noticed

Rolling handoff for the Plabs relay (session-relay skill). Rewritten at each handover; the last section has the owner's standing instructions, the relay parameters and Scheduling.

## 1. Goal

Owner's words (2026-11-02): "Get people using these projects, advertise these projects to get customers that may want me to build similar projects for them." "One way to be noticed is for github repos to be noticed, forked and get stars." Paid custom builds are the offer, part-time; "I care more about connections and being useful than money." "Built by Claude" is the headline. Customer priority: small businesses, startups, edtech, universities. Domain: hintwise.org (apps moved from pisan.me, owner, 2026-11-08; plan in docs/hintwise-migration.md).

## 2. What is live (8 November)

- **HintWise move done (8 Nov).** Every app is at `<app>.hintwise.org`: Cloudflare CNAME, DNS only, straight to its Netlify site or Render service; Netlify primary domain is the hintwise name, no pisan.me alias. Each old `<app>.pisan.me` record still points at the same host but is proxied, and one Single Redirect rule on the pisan.me zone (ref `hintwise_moved_apps`, `wildcard_replace`, explicit host list) 301s it with path and query. `daily-project-ideas.pisan.me` -> `studio.hintwise.org` (own rule). `hintwise.org` and `www.hintwise.org` -> `studio.hintwise.org` (rule `hintwise_apex_to_studio`, first in that zone; two older owner rules below it, to digital-student-assistant.com, are unused). Not redirected on purpose: `td.pisan.me` (Chess TD API), `ypdsa.pisan.me` (not moved; it 301s to digital-student-assistant.com itself), the personal site (pisan.me, www, g, yusuf, zoom) and email names. Plan, decisions and owner answers: docs/hintwise-migration.md.
- claude-built-apps: 62 deploy targets (*/deploy/target.yml), all deployed on 8 Nov with the HintWise footer (Deploy `all`, 63 jobs green); each `.netlify.app` 301s to its hintwise.org address. Newest app: US Duty Price Sheet (8 Nov, us-duty-price-sheet.hintwise.org). 60 pisan-labs mirrors (.github/mirrors.txt), pushed on each main push for changed apps and daily by halflife (04:13); Mirror apps fails every run on poincare-paint (pisan-labs/poincare-paint stuck at 8870751, one commit behind the split; failing since 4 Nov, still after the 6 Nov reset; cause not seen: logs need auth), the other mirrors still push; repo homepages still say pisan.me until the owner re-runs scripts/pisan_labs_setup.py (CSV already updated).
- Footer (scripts/site-footer.mjs, owner-approved 8 Nov): six lines plus "Yusuf Pisan, Chief Education Officer, HintWise"; builder@hintwise.org; academic page https://pisanorg.github.io/yusuf/; More apps -> studio.hintwise.org.
- studio.hintwise.org (pisanuw/daily-project-ideas, Netlify site renamed `hintwise`): HintWise Studio redesign live since 8 Nov (375895c, pushed 13:17 CET): home (hero, 6 featured apps, audiences, how it works, about), /apps/ (65 apps, filters, search), /apps/<slug>/ pages, Next up (the daily ideas), /notes/ behind NOTES_PASSWORD. Data in studio.json + implemented.json; built by build.js + build-studio.js.
- Chess TD on Render: chesstd.hintwise.org (web) and td.hintwise.org (API); chess-td-server PUBLIC_URL=https://td.hintwise.org, WEB_ORIGINS both web origins, SMTP_FROM td@hintwise.org; chesstd.pisan.me 301s; td.pisan.me still serves. The web app picks its API from its own host (pisan-labs/chess-tournament-director 12ea11f).
- Email: Resend sends from hintwise.org (verified 8 Nov; Test email workflow delivered). Senders: mult-streak@hintwise.org (backend-hub, mult-streak-edge), td@hintwise.org (Chess TD), daily-project-ideas FROM_EMAIL secret (owner set). builder@hintwise.org forwards via Cloudflare Email Routing. Digital Yusuf (pisanuw/digitalme) still sends as ypai@pisan.me and receives on reply.pisan.me (Resend inbound): not moved.
- Google sign-in: all 9 hosts use the new HintWise Google Cloud client (secrets HINTWISE_AUTH_GOOGLE_ID/SECRET; Google env workflow): Netlify meetme-2, chess-analyzer-app, paste-md, upvoteme, myuniforever, chatwithdigitalme, stockreptile; Render chess-td-server, dsa-instructor, chatwithdigitalme. URIs: docs/google-oauth.md. Owner confirmed Digital Student Assistant works; MeetMe APP_URL fixed to meetme.hintwise.org and Digital Yusuf CORS fixed (pisanuw/digitalme f93102b) after owner reports.
- pisanorg.github.io/yusuf/aiprojects.html: all app links on hintwise.org, hire box -> studio.hintwise.org, contact builder@hintwise.org, Digital Yusuf -> ypai.hintwise.org (master b977d5d).
- Routines (owner's, not relay): ideas trig_01K986yzFbf3noGkLA6RgZkn 01:51 Pacific (10:51 CET; 8 Nov run shipped 4 ideas); build trig_01BAP9nsXTtxTdpMiwk5GdXE 02:49 Pacific (11:49 CET; 8 Nov built US Duty Price Sheet).
- Heads at handoff: claude-built-apps main 34e8ef5 (before this handoff commit), daily-project-ideas main 375895c, yusuf master b977d5d, chess-tournament-director main 92ea9c5, digitalme main f93102b.

## 3. Landed 6 to 8 November (this session, session_01JyJzMYaEBiQ8ixgKSDb4Lu)

- 6 Nov: Poincare Paint PNG/JPG export (78699e5); launch draft 7, Digital Student Assistant (f6abd70); pisan-labs/poincare-paint mirror reset (owner's yes); Chess TD renamed to chesstd (later moved to Render); Chess TD GIF on the ideas showcase; ideas routine duplicated so agents can fire it.
- 7 Nov: deploy runner finds Netlify sites by custom domain (c1141a6); footer line breaks (fd55877, 93045e8); flaky popup-check test fixed (18bae94).
- 8 Nov, HintWise move: plan (docs/hintwise-migration.md); Phase 1 by five agents (deploy tooling, app code, footer, docs, yusuf, Chess TD); tools: Migrate domains (hosts/switch, parallel batches), Redirect rule, Set CNAME (optional proxy), Remove Netlify domain, Render domain, List DNS, List hosts, Google env, Env pisan.me, Test email workflows; fixes found on the way: Netlify certificate needs POST /ssl/renew (7f70a3a), Cloudflare free plan needs wildcard_replace (62c72bd), apex rule moved first (20f176d), site lookup by domain for popup-check-629 (53f89a5); all 64 Netlify hosts moved and switched; Deploy all; Google client switch; studio redesign merged.

## 4. Branches not merged

- claude-built-apps `hintwise-apps`: shows 9 commits ahead, but all were cherry-picked into main (different SHAs, `git cherry` shows none missing); main fast-forwarded to `hintwise` (7c1eaff records it). Nothing unmerged. `hintwise`, `hintwise-docs`, `hintwise-infra` are 0 ahead of main (6, 47, 47 behind).
- daily-project-ideas `studio-redesign`, yusuf `hintwise`: level with main/master; chess-tournament-director `hintwise`: 0 ahead, 1 behind main.
- Older branches not from this session (claude-built-apps `claude/fix-mobile-overflow`, `claude/magical-cray-*`, `claude/wonderful-tesla-lgdegm`; daily-project-ideas and yusuf `claude/*`; digitalme `bot/draft-*`): not reviewed here.

## 5. Next, in order

1. Google sign-in follow-up: the owner is testing MeetMe, Chess TD and Digital Yusuf. If MeetMe still says redirect_uri_mismatch, the URIs are not saved on the client whose ID starts 985338662899- (docs/google-oauth.md has the list). StockReptile and MyUni/Upvote/PasteMD/chess-analyzer rebuilt with the new client; not tested.
2. Hosts also had a `GOOGLE_SECRET` var (on Netlify sites and three Render services) that the first listing did not show; Google env set it to the new secret. Find out where it came from (likely an owner-added shared variable) and tell the owner.
3. Studio wording the owner has not confirmed (listed in CHANGES of daily-project-ideas and the 8 Nov chat): hero line, how-it-works step 3, About paraphrase, Digital Student Assistant third-person blurb, blurbs for Summit Navigator, Tetromino Arcade, MyChessMaster, Chess TD; audiences of Summit Navigator and Chess TD.
4. Offer (owner decides): move Digital Yusuf email from ypai@pisan.me / reply.pisan.me to hintwise.org (new Resend inbound domain + DNS + app env); remove the two unused older redirect rules on the hintwise.org zone.
5. Mirror apps: find why the poincare-paint push fails (owner can read the run log) and tell the owner.

## 6. Waiting on the owner

- Test Google sign-in on MeetMe (https://meetme.hintwise.org/login), Chess TD (https://chesstd.hintwise.org) and Digital Yusuf (https://ypai.hintwise.org).
- Re-run `python3 scripts/pisan_labs_setup.py` locally so pisan-labs repo homepages show hintwise.org.
- Post launch drafts 1 to 7 in docs/launch-drafts.md, one at a time, days apart.
- us-duty-price-sheet (built 8 Nov): pisan-labs mirror exists and matches main (e50db89); Netlify analytics at https://app.netlify.com/projects/us-duty-price-sheet/analytics-and-metrics/analytics.

## 7. Dated tasks

None.

## 8. Decisions and why

- Monorepo stays the source of truth; pisan-labs repos are `git subtree split` mirrors (mirror.yml + .github/mirrors.txt). One place for CI, deploy and footer; separate repos for discovery.
- Each mirrored app folder carries its own LICENSE and `.github/workflows/ci.yml` (inert in the monorepo, active in the mirror).
- tetromino-arcade not mirrored or promoted: Tetris trademark/trade-dress risk.
- Subdomains are named after the package folder, not the Netlify site name.
- Netlify deploys cost credits. A push deploys only targets whose target.yml changed (plus shortcut-sprint and code-analogy-forge source changes; docs, GIFs, LICENSE and app CI files excluded). Runner/footer changes need a manual Deploy run naming apps or `all`.
- accessibility-lens runs rule-based only; no Claude on the owner's key for visitor scans.
- game-palette-inspector suggests a fix only if it adds no confusion under any of 8 vision types; the Red/green trap preset therefore shows "no safe fix" (owner told; strict rule kept).
- The ideas site became HintWise Studio at studio.hintwise.org (owner, 8 Nov); the daily ideas stay public as "Next up". Featured apps: StepWise, Poincare Paint, Digital Student Assistant, Bombe Bench, Cache Miss Theater, Health Page Tracker Watch. All apps listed.
- Footer text and line breaks are the owner's (8 Nov): six lines, then the name line; "Email builder@hintwise.org." and "interesting ones may be done for free :-)" never wrap apart on phones. Deployed to all apps with the 8 Nov Deploy all (owner: do the whole move including redeploying all Netlify sites).
- Small business first for new ideas and builds (owner, 2026-11-02). The ideas floor moved from one EdTech idea to one small-business idea.
- The build routine lives in BUILD_ROUTINE.md, read by the task, so it is versioned and editable from any session (the task itself can only be edited by the owner).
- Every site's primary address is <app>.hintwise.org (owner, 2026-11-08; it was <app>.pisan.me from 2026-11-02). target.yml keeps `customDomain: <app>.pisan.me` and the runner swaps in APP_DOMAIN from scripts/domains.mjs, so no target.yml changes (each would be a paid deploy); old pisan.me names 301 to hintwise.org through a Cloudflare redirect rule. New apps set customDomain from the start; the runner uses it only once DNS answers (creating the CNAME with the Cloudflare token), because a custom domain without a record 301s the working netlify.app address to a dead one.
- pisan-labs: CI is checked only when the owner messages; a repo is attached to a session only when it gets an issue or PR.
- Public pages are written for customers (owner, 2026-11-02): no scores, evidence, competitors, build time, tech stack or test counts on the ideas site, README or aiprojects; the owner's notes are at studio.hintwise.org/notes/ behind NOTES_PASSWORD.
- Ideas routine (owner, 2026-11-04): a first run ships 3 to 5 ideas, provisional capped per run (4 first, 3 extra), a day holds up to 10; gate numbers unchanged.
- Resend sends everything from hintwise.org (owner, 8 Nov); Google sign-in uses the HintWise Google Cloud project's client for every app (owner, 8 Nov).
- A deploy needs no yes when the owner asked for the change; any other Netlify deploy or site build waits for a yes. Pushes that change only docs or routine files in daily-project-ideas carry [skip netlify].

## 9. Tried and rejected

- GIF of emoji-lingua via a mocked API: rejected, it would show output live visitors never get.
- Proxied (orange-cloud) Cloudflare records: Netlify cannot issue certificates through the proxy. (Exception by design: a moved `<x>.pisan.me` record is proxied so the redirect rule can answer it; Netlify no longer serves that name.)
- Redeploying all apps on every deploy.mjs edit: ran Netlify out of credits on 2026-11-02; owner bought more.
- `_redirects` rule written before the SPA fallback: the fallback step rewrote the file and erased it.

## 10. Constraints and gotchas

- User preferences: ask before spending money (Netlify deploys, paid APIs), publishing outside the session, deleting what cannot be restored. Push to main is fine. Number questions. CHANGES.md is append-only, `YYYY-MM-DD [type] text`.
- Conventional Commits enforced by `.git-hooks/commit-msg` (run `git config core.hooksPath .git-hooks`); merge commits need a conventional message too.
- Another machine pushes to these branches: `git fetch` before work and before pushing; merge, never force-push.
- This session's git proxy reset `origin` to the old Claude-capstone URL several times; `git remote set-url origin https://github.com/pisanuw/claude-built-apps` if pushes warn "repository moved".
- Repo settings (description/topics/homepage) cannot be written from a cloud session; use scripts/pisan_labs_setup.py locally or the GitHub UI.
- Secrets (names only): NETLIFY_AUTH_TOKEN, RENDER_API_KEY, MIRROR_TOKEN (fine-grained, pisan-labs, all repos, Contents+Workflows), CLOUDFLARE_API_TOKEN, CLOUDFLARE_ZONE_ID, ANTHROPIC_API_KEY, RESEND_API, ADMIN_EMAIL, COOKIE_SECRET.
- Time zone: owner is travelling in Germany (CET) as of 2026-11-02; default is America/Los_Angeles. Report times in the zone they are in.
- emoji-lingua now uses its dictionary engine only (key removed 2026-11-02). mult-streak-edge page load runs its idle-email sweep; do not load it in automated runs.
- Known small issues not fixed: cron-cartographer refuses "last day of the month" (RRULE parser lacks BYMONTHDAY=-1); summit-navigator now/next bar shows the conference weekday for viewers far east of ET; pull-the-pin Instructor tab and analyzer rows still use clear+append re-render.
- Netlify branch deploys for daily-project-ideas: unknown whether enabled (each would cost a build); branch commits there carry [skip netlify].
- Netlify: a newly added domain gets its certificate only after POST /sites/{id}/ssl/renew (POST /ssl answers 422 once a site has a certificate), 5 to 15 minutes later. Cloudflare free plan: Single Redirects allow wildcard_replace but not regex_replace. Cloudflare redirect rules only run on proxied records. Netlify env PATCH cannot set the `all` context; PUT the whole variable.
- Sandbox curl to a freshly issued Netlify certificate can fail for a while when GitHub runners already see it: verify from a workflow run.

## 11. How to run and verify

- Per app (from its folder): `npm ci && npm run lint && npm run typecheck && npm run coverage && npm run build` (game-palette-inspector, pathfinding-playground: `npm test`; emoji-lingua has no lint).
- Footer tests: `node --test scripts/site-footer.test.mjs`
- Deploy named apps: Actions > Deploy > Run workflow, targets `app-a app-b` (or `gh api -X POST repos/pisanuw/claude-built-apps/actions/workflows/deploy.yml/dispatches -f ref=main -f 'inputs[targets]=app-a app-b'`).
- Mirror everything: Actions > Mirror apps > Run workflow.
- Live check: `curl -s https://<app>.hintwise.org/ | grep -c "Chief Education Officer"`; old hosts `curl -sI https://<app>.pisan.me/x?q=1` and `https://<site>.netlify.app/` should 301 to the hintwise.org address.
- Ideas site: `node build.js && node scripts/smoke_pages.js` in daily-project-ideas.

## 12. Key files

- README.md, PROJECTS.md: public pitch and catalog
- scripts/site-footer.mjs: footer text for every app
- accessibility-lens/deploy/deploy.mjs: deploy runner (customDomain, envRemove, netlify.app redirect)
- */deploy/target.yml: per-app deploy config
- .github/workflows/deploy.yml, mirror.yml, .github/mirrors.txt: deploy and mirror rules
- scripts/pisan-labs-repos.csv + scripts/pisan_labs_setup.py: pisan-labs About boxes
- docs/launch-drafts.md: Show HN and SIGCSE drafts, unposted
- CHANGES.md, BRIEFING.md: project journal and scope
- daily-project-ideas: web/, build.js, build-studio.js, studio.json, ROUTINE.md (lens table), implemented.json
- docs/hintwise-migration.md, docs/google-oauth.md; accessibility-lens/deploy/{migrate-domains,redirect-rule,set-cname,render-domain,google-env,env-pisan,list-dns,list-hosts}.mjs; scripts/domains.mjs (APP_DOMAIN, HOST_RENAMES)
- pisanorg/yusuf: aiprojects.md, assets/css/style.scss

## 13. Background jobs

Relay routines (Scheduling below) plus the owner's ideas and build routines (section 2). The notify-implemented email runs 9:10am Pacific (GitHub Actions). Each ideas commit to main triggers a Netlify build unless it carries [skip netlify].

## Notes for the next session

### Owner's standing instructions
- Ask before spending money (Netlify deploys and builds the owner did not ask for, paid APIs), publishing outside the session, deleting the unrestorable. Push to main is fine. Number questions; recommend rather than survey.
- Public pages are for customers (section 8). Never invent facts about the owner in his voice.
- Hourly check with nothing new: say nothing at all, not even a one-line "nothing new" in chat (owner, 2026-11-08).
- Report times in Europe/Berlin (owner travelling in Germany; home zone America/Los_Angeles).
- CHANGES.md append-only, `YYYY-MM-DD [type] text`; Conventional Commits in claude-built-apps.

### Relay parameters (session-relay skill)
| Parameter | Value |
|---|---|
| Repository | pisanuw/claude-built-apps (also daily-project-ideas, pisanorg/yusuf, pisan-labs/chess-tournament-director, pisanuw/digitalme; read-only dashboards, chess-analyzer) |
| Handoff document | HANDOFF.md (this file) |
| Routine time zone | Europe/Berlin |
| Report time zone | Europe/Berlin |
| Handover check | 13:56 Europe/Berlin |
| Session start | 14:52 Europe/Berlin |
| Handoff marker | a commit on main titled `docs: the handoff of <D Month>` (this project pushes docs to main, no PR); no other commit may use that subject |
| Merge rule | push to main after `node --test scripts/site-footer.test.mjs` passes |

### Scheduling
- Previous session: session_01JyJzMYaEBiQ8ixgKSDb4Lu ("Plabs: Nov 6", created 2026-11-06 by create_session from session_01JyJzMUtBZwWUSbZ6bDDS2Q), lineage depth 1 of limit 8. Handed over on 8 November 2026 at 59% context (586,845 of 1,000,000 tokens). The 14:52 Europe/Berlin start routine creates the next session (depth 2 of 8).
- Current session: the new session records its id here on takeover.
- Relay routines (aimed at the previous session until the new session moves them):
  - trig_01GdgQq1wKWYX3VUnV5jHppy: Plabs hourly status report, `46 * * * *`
  - trig_01Te7E4X5YHgH4rXo9RyuW2Q: Plabs handoff check, `CRON_TZ=Europe/Berlin 56 13 * * *`
  - trig_01Rbhw1b9k8mJoG4esixj6Aa: Plabs session start, `CRON_TZ=Europe/Berlin 52 14 * * *`
- Not relay, leave alone: the owner's ideas (trig_01K986yzFbf3noGkLA6RgZkn) and build (trig_01BAP9nsXTtxTdpMiwk5GdXE) routines; the Chess TD, Chess Analyzer, DSA and StepWise relays (other sessions); TPT daily product builder; SIGCSE poster reminder.
