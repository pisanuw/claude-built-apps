# Handoff: get users, get noticed

Rolling handoff for the Plabs relay (session-relay skill). Rewritten at each handover; the last section has the owner's standing instructions, the relay parameters and Scheduling.

## 1. Goal

Owner's words (2026-11-02): "Get people using these projects, advertise these projects to get customers that may want me to build similar projects for them." "One way to be noticed is for github repos to be noticed, forked and get stars." Paid custom builds are the offer, part-time; "I care more about connections and being useful than money." "Built by Claude" is the headline. Customer priority: small businesses, startups, edtech, universities. Domain: hintwise.org (apps moved from pisan.me, owner, 2026-11-08; plan in docs/hintwise-migration.md).

## 2. What is live (6 November)

- claude-built-apps: 59 apps with a deploy/target.yml, each at `<folder>.hintwise.org` (old `<folder>.pisan.me` addresses 301 there); README (visitor-facing, DEVELOPING.md for developers) with "My biggest project" (Digital Student Assistant) and a "Start here" grid incl. StepWise; 57 pisan-labs mirrors (.github/mirrors.txt; backend-hub and tetromino-arcade are not mirrored), synced daily by halflife (scripts/halflife/, launchd 04:13).
- studio.hintwise.org: customer-facing idea pages grouped by audience, "Built and live" showcase of 8 apps (6 demo GIFs, 2 screenshots) (web/showcase.json), owner notes at /notes/ (password).
- pisanorg.github.io/yusuf/aiprojects.html: 99 projects, StepWise newest; Digital Student Assistant featured in the hire box (demo account demo@hintwise.org, no code needed).
- Routines (owner's, not relay): ideas routine trig_01K986yzFbf3noGkLA6RgZkn daily 01:51 Pacific (10:51 CET), reads ROUTINE.md on main (copy made 6 Nov so agents can fire it; the old http_api routine is deleted); build routine trig_01BAP9nsXTtxTdpMiwk5GdXE daily 02:49 Pacific (11:49 CET), reads BUILD_ROUTINE.md on main.
- Heads at handoff: claude-built-apps main 411fd03, daily-project-ideas main cefd94e, yusuf master 1f5ca00.

## 3. Landed 2 to 5 November (this session, session_01JyJzMUtBZwWUSbZ6bDDS2Q)

- Ideas site rewritten for customers (public/notes split, audience sections, plain-language copy, publicNotes for all built apps); "Built and live" showcase (cefd94e, 5 Nov).
- Ideas routine reworked for more and better ideas: spend pass, new sources A15 (no-code communities), A16 (Xero ideas board), B11 (freelancer.com API), B12 (Shopify app review pages, Atlassian); watchlist re-research; keep reviewing to 10; per-run provisional cap. Results: 4 Nov 4 ideas (3 with willingnessToPay 3 or 4), 5 Nov 2 ideas after 6 reviews (rule fixed afterwards, 6a0d49a).
- Build routine (BUILD_ROUTINE.md): small-business pick order, customDomain from the first deploy, publicNotes, direct analytics link, no invented first-person facts, deletes only its own branches.
- Deploy runner creates the Cloudflare CNAME (cloudflare-dns.mjs); "Check Cloudflare token" and "Attach custom domain" (attach-domain.yml, no deploy) workflows; chess-tournament-director.pisan.me attached, its netlify.app 301 merged (pisan-labs/chess-tournament-director#35).
- Apps built by the build routine in this period: Consent Leak Watch, ACR Draft, Student Journey Check, Dossier Comment Reflector, Misrepresentation Preflight, Accessibility Fleet Log, Popup Check.
- README and aiprojects: visitor-facing, test counts removed, StepWise and Digital Student Assistant featured.

## 4. Branches not merged

- `claude/intelligent-ptolemy-533qe5` in claude-built-apps, daily-project-ideas and yusuf: this session's working branch, level with main (nothing unmerged).

## 5. Next, in order

1. Report on the 6 Nov 10:51 CET ideas run (dated task trig_011quEkqoF96yu4PSnnWmevH fires at 11:15 CET into the relay session): ideas, reviews (did it reach 10 before settling for fewer than 3?), whether A16 or the watchlist produced an idea; small ROUTINE.md/sources.json fixes with [skip netlify].
2. Poincaré Paint (https://poincare-paint.hintwise.org): add "save as PNG" and "save as JPG" and deploy it. The owner asked for this on 6 Nov and confirmed it goes to the new session; the deploy is approved. First reconcile the pisan-labs/poincare-paint mirror, which rejected pushes on 4 Nov (non-fast-forward: someone committed to the mirror directly): port any change from it into poincare-paint/ here before the mirror run overwrites it.
3. Owner offered: a launch draft for Digital Student Assistant (SIGCSE list and LinkedIn, arXiv paper, demo account) in docs/launch-drafts.md.

## 6. Waiting on the owner

- Post launch drafts 1 to 7 in docs/launch-drafts.md, one at a time, days apart.
- Remaining for us-duty-price-sheet (built 8 Nov): pisan-labs/us-duty-price-sheet is created and mirrored by the halflife job (04:13), or by hand with `git pull && python3 scripts/pisan_labs_setup.py && gh workflow run mirror.yml --repo pisanuw/claude-built-apps --ref main`; turn on Netlify analytics at https://app.netlify.com/projects/us-duty-price-sheet/analytics-and-metrics/analytics. DNS and certificate are done.
- pisan-labs/donation-receipts (built 7 Nov) is created and mirrored by the halflife job (04:13), or by hand with `git pull && python3 scripts/pisan_labs_setup.py && gh workflow run mirror.yml --repo pisanuw/claude-built-apps --ref main`.

## 7. Dated tasks

| When (CET) | What | Routine |
|---|---|---|
| 6 Nov 11:15 | Report on the 6 Nov ideas run | trig_011quEkqoF96yu4PSnnWmevH (one-shot) |

## 8. Decisions and why

- Monorepo stays the source of truth; pisan-labs repos are `git subtree split` mirrors (mirror.yml + .github/mirrors.txt). One place for CI, deploy and footer; separate repos for discovery.
- Each mirrored app folder carries its own LICENSE and `.github/workflows/ci.yml` (inert in the monorepo, active in the mirror).
- tetromino-arcade not mirrored or promoted: Tetris trademark/trade-dress risk.
- Subdomains are named after the package folder, not the Netlify site name.
- Netlify deploys cost credits. A push deploys only targets whose target.yml changed (plus shortcut-sprint and code-analogy-forge source changes; docs, GIFs, LICENSE and app CI files excluded). Runner/footer changes need a manual Deploy run naming apps or `all`.
- accessibility-lens runs rule-based only; no Claude on the owner's key for visitor scans.
- game-palette-inspector suggests a fix only if it adds no confusion under any of 8 vision types; the Red/green trap preset therefore shows "no safe fix" (owner told; strict rule kept).
- Ideas site keeps the name "Daily Project Ideas" (search terms), tagline does the pitch.
- Footer links to pisanorg.github.io/yusuf/aiprojects.html (owner's choice), URL not renamed.
- Footer line breaks are part of the text (owner, 2026-11-07): four lines plus "Yusuf Pisan", "free :-)" never split, "Email builder@hintwise.org." kept together on phones (fd55877 and the next commit; the address was builder@pisan.me until 2026-11-08). Not deployed on purpose (owner): each app picks it up on its next deploy for another reason; no `all` run.
- Small business first for new ideas and builds (owner, 2026-11-02). The ideas floor moved from one EdTech idea to one small-business idea.
- The build routine lives in BUILD_ROUTINE.md, read by the task, so it is versioned and editable from any session (the task itself can only be edited by the owner).
- Every site's primary address is <app>.hintwise.org (owner, 2026-11-08; it was <app>.pisan.me from 2026-11-02). target.yml keeps `customDomain: <app>.pisan.me` and the runner swaps in APP_DOMAIN from scripts/domains.mjs, so no target.yml changes (each would be a paid deploy); old pisan.me names 301 to hintwise.org through a Cloudflare redirect rule. New apps set customDomain from the start; the runner uses it only once DNS answers (creating the CNAME with the Cloudflare token), because a custom domain without a record 301s the working netlify.app address to a dead one.
- pisan-labs: CI is checked only when the owner messages; a repo is attached to a session only when it gets an issue or PR.
- Public pages are written for customers (owner, 2026-11-02): no scores, evidence, competitors, build time, tech stack or test counts on the ideas site, README or aiprojects; the owner's notes are at studio.hintwise.org/notes/ behind NOTES_PASSWORD.
- Ideas routine (owner, 2026-11-04): a first run ships 3 to 5 ideas, provisional capped per run (4 first, 3 extra), a day holds up to 10; gate numbers unchanged.
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
- Netlify branch deploys for daily-project-ideas: unknown whether enabled (each would cost a build).

## 11. How to run and verify

- Per app (from its folder): `npm ci && npm run lint && npm run typecheck && npm run coverage && npm run build` (game-palette-inspector, pathfinding-playground: `npm test`; emoji-lingua has no lint).
- Footer tests: `node --test scripts/site-footer.test.mjs`
- Deploy named apps: Actions > Deploy > Run workflow, targets `app-a app-b` (or `gh api -X POST repos/pisanuw/claude-built-apps/actions/workflows/deploy.yml/dispatches -f ref=main -f 'inputs[targets]=app-a app-b'`).
- Mirror everything: Actions > Mirror apps > Run workflow.
- Live check: `curl -s https://<app>.hintwise.org/ | grep -c "Want something like this"`; old host `curl -sI https://<site>.netlify.app/` should 301.
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
- daily-project-ideas: web/, build.js, ROUTINE.md (lens table), implemented.json
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
| Repository | pisanuw/claude-built-apps (also daily-project-ideas, pisanorg/yusuf, pisan-labs/chess-tournament-director; read-only dashboards, chess-analyzer) |
| Handoff document | HANDOFF.md (this file) |
| Routine time zone | Europe/Berlin |
| Report time zone | Europe/Berlin |
| Handover check | 13:56 Europe/Berlin |
| Session start | 14:52 Europe/Berlin |
| Handoff marker | a commit on main titled `docs: the handoff of <D Month>` (this project pushes docs to main, no PR); no other commit may use that subject |
| Merge rule | push to main after `node --test scripts/site-footer.test.mjs` passes |

### Scheduling
- Previous session: session_01JyJzMUtBZwWUSbZ6bDDS2Q ("Plabs", created 2026-11-02), lineage depth 0 of limit 8. It handed over on 6 November at 74% context. The owner asked for the handover at once, so the previous session started the new one by hand at about 09:00 CET with create_session, not at 14:52; the 14:52 start routine on 6 November must therefore do nothing. The new session records its id below as the current session.
- Current session: session_01JyJzMYaEBiQ8ixgKSDb4Lu ("Plabs: Nov 6", created 2026-11-06 by create_session from the previous session), took over on 6 November 2026 at about 08:56 CET; lineage depth 1 of limit 8. This takeover is for the 6 November handoff, so the 14:52 start routine on 6 November does nothing.
- Relay routines (aimed at the current session since the 6 November takeover; the previous session's copies are deleted):
  - trig_01GdgQq1wKWYX3VUnV5jHppy: Plabs hourly status report, `46 * * * *`
  - trig_01Te7E4X5YHgH4rXo9RyuW2Q: Plabs handoff check, `CRON_TZ=Europe/Berlin 56 13 * * *`
  - trig_01Rbhw1b9k8mJoG4esixj6Aa: Plabs session start, `CRON_TZ=Europe/Berlin 52 14 * * *`
  - trig_011quEkqoF96yu4PSnnWmevH: one-shot, report on the 6 Nov ideas run, 2026-11-06 10:15 UTC
