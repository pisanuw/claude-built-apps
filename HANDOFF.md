# Handoff: get users, get noticed

## 1. Goal

Owner's words (2026-11-02): "Get people using these projects, advertise these projects to get customers that may want me to build similar projects for them." "One way to be noticed is for github repos to be noticed, forked and get stars." Paid custom builds are the offer, part-time; "I care more about connections and being useful than money." "Built by Claude" is the headline: "While Claude can build them, not everybody can guide Claude to build them." Customer priority: small businesses, startups, edtech, universities. Domain: pisan.me.

## 2. Status

Done
- [x] Repo renamed Claude-capstone -> pisanuw/claude-built-apps; README rewritten as pitch + catalog by audience; long write-ups in PROJECTS.md
- [x] pisan.me DNS moved from cPanel to Cloudflare (all records DNS-only); Google MX kept
- [x] All 51 Netlify apps live at `<folder>.pisan.me` (mult-streak-edge -> mult-streak.pisan.me); `.netlify.app` 301s there
- [x] Shared footer (scripts/site-footer.mjs) uses the owner's final wording; all sites redeployed once and checked live
- [x] daily-project-ideas framed as "ideas I could build for you"; canonical daily-project-ideas.pisan.me; Friday lens = small business
- [x] aiprojects page (pisanorg/yusuf): "Want one built?" box, phone menu fix, pisan.me links, 4 dead Render projects marked (offline)
- [x] pisan-labs org: 50 mirror repos created by the owner with scripts/pisan_labs_setup.py; mirror.yml pushed code to all 50
- [x] Demo GIFs for 47 apps (none for emoji-lingua, mult-streak-edge, tetromino-arcade)
- [x] 7 live bugs fixed with regression tests and deployed (cron-cartographer, game-palette-inspector, emoji-lingua, summit-navigator, code-analogy-forge, cipher-ladder, pull-the-pin)
- [x] accessibility-lens and emoji-lingua: Anthropic key removed from Netlify (envRemove); no live app calls Claude on the owner's key

Remaining
- [ ] Check pisan-labs mirror CI results (this session could not read those repos' Actions; owner was asked to glance)
- [ ] Owner posts the launch drafts in docs/launch-drafts.md (Show HN: Bombe Bench; SIGCSE email: Cache Miss Theater)
- [ ] Optional small bugs listed under Constraints

## 3. Current state

- claude-built-apps: branch `claude/beautiful-shannon-9m7sw7` = `main` at 6d2f973 (before this handoff commit). Clean tree.
- daily-project-ideas: `main` 3673627, clean. pisanorg/yusuf: `master` ab97a18, clean.
- Last full deploy run 41416184263: 52/52 jobs success. Mirror run: success.
- Handoff written 2026-11-02 about 10:30 CET.

## 4. Next step

Ask the owner whether the pisan-labs repos' Actions tabs show green CI; fix any red one in the monorepo app folder (its `.github/workflows/ci.yml`), never in the mirror.

## 5. Decisions and why

- Monorepo stays the source of truth; pisan-labs repos are `git subtree split` mirrors (mirror.yml + .github/mirrors.txt). One place for CI, deploy and footer; separate repos for discovery.
- Each mirrored app folder carries its own LICENSE and `.github/workflows/ci.yml` (inert in the monorepo, active in the mirror).
- tetromino-arcade not mirrored or promoted: Tetris trademark/trade-dress risk.
- Subdomains are named after the package folder, not the Netlify site name.
- Netlify deploys cost credits. A push deploys only targets whose target.yml changed (plus shortcut-sprint, code-analogy-forge, type-witness source changes; docs, GIFs, LICENSE and app CI files excluded). Runner/footer changes need a manual Deploy run naming apps or `all`.
- accessibility-lens runs rule-based only; no Claude on the owner's key for visitor scans.
- game-palette-inspector suggests a fix only if it adds no confusion under any of 8 vision types; the Red/green trap preset therefore shows "no safe fix" (owner told; strict rule kept).
- Ideas site keeps the name "Daily Project Ideas" (search terms), tagline does the pitch.
- Footer links to pisanorg.github.io/yusuf/aiprojects.html (owner's choice), URL not renamed.

## 6. Tried and rejected

- GIF of emoji-lingua via a mocked API: rejected, it would show output live visitors never get.
- Proxied (orange-cloud) Cloudflare records: Netlify cannot issue certificates through the proxy.
- Redeploying all apps on every deploy.mjs edit: ran Netlify out of credits on 2026-11-02; owner bought more.
- `_redirects` rule written before the SPA fallback: the fallback step rewrote the file and erased it.

## 7. Constraints and gotchas

- User preferences: ask before spending money (Netlify deploys, paid APIs), publishing outside the session, deleting what cannot be restored. Push to main is fine. Number questions. CHANGES.md is append-only, `YYYY-MM-DD [type] text`.
- Conventional Commits enforced by `.git-hooks/commit-msg` (run `git config core.hooksPath .git-hooks`); merge commits need a conventional message too.
- Another machine pushes to these branches: `git fetch` before work and before pushing; merge, never force-push.
- This session's git proxy reset `origin` to the old Claude-capstone URL several times; `git remote set-url origin https://github.com/pisanuw/claude-built-apps` if pushes warn "repository moved".
- Repo settings (description/topics/homepage) cannot be written from a cloud session; use scripts/pisan_labs_setup.py locally or the GitHub UI.
- Secrets (names only): NETLIFY_AUTH_TOKEN, RENDER_API_KEY, MIRROR_TOKEN (fine-grained, pisan-labs, all repos, Contents+Workflows), ANTHROPIC_API_KEY, RESEND_API, ADMIN_EMAIL, COOKIE_SECRET. No Cloudflare token exists yet; DNS records are already in place for every app.
- Time zone: owner is travelling in Germany (CET) as of 2026-11-02; default is America/Los_Angeles. Report times in the zone they are in.
- emoji-lingua now uses its dictionary engine only (key removed 2026-11-02). mult-streak-edge page load runs its idle-email sweep; do not load it in automated runs.
- Known small issues not fixed: cron-cartographer refuses "last day of the month" (RRULE parser lacks BYMONTHDAY=-1); summit-navigator now/next bar shows the conference weekday for viewers far east of ET; pull-the-pin Instructor tab and analyzer rows still use clear+append re-render.
- Netlify branch deploys for daily-project-ideas: unknown whether enabled (each would cost a build).

## 8. How to run and verify

- Per app (from its folder): `npm ci && npm run lint && npm run typecheck && npm run coverage && npm run build` (game-palette-inspector, pathfinding-playground: `npm test`; emoji-lingua has no lint).
- Footer tests: `node --test scripts/site-footer.test.mjs`
- Deploy named apps: Actions > Deploy > Run workflow, targets `app-a app-b` (or `gh api -X POST repos/pisanuw/claude-built-apps/actions/workflows/deploy.yml/dispatches -f ref=main -f 'inputs[targets]=app-a app-b'`).
- Mirror everything: Actions > Mirror apps > Run workflow.
- Live check: `curl -s https://<app>.pisan.me/ | grep -c "Want something like this"`; old host `curl -sI https://<site>.netlify.app/` should 301.
- Ideas site: `node build.js && node scripts/smoke_pages.js` in daily-project-ideas.

## 9. Key files

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

## 10. Background jobs

None running from this session. Recurring jobs owned elsewhere: daily-project-ideas routine (daily 5am Pacific, Remote Trigger) and its notify-implemented email (9:10am Pacific, GitHub Actions). Each ideas commit to main triggers a Netlify build.

## 11. Open questions

1. Are the 50 pisan-labs CI runs green? I don't know.
2. Which apps to promote next after Bombe Bench and Cache Miss Theater, and whether to steer new builds toward small-business tools (the catalog has none yet).
