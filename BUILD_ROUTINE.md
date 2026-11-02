# Build an idea I choose: routine

The scheduled task "Build an idea I choose" (daily 2:49 am Pacific) reads this
file and follows it. Edit the routine here, not in the task.

Repos pisanuw/daily-project-ideas, pisanuw/claude-built-apps (renamed from
Claude-capstone; the old name redirects) and pisanorg/yusuf are cloned. Push
directly to each repo's default branch (main, main, master), not to claude/
branches. Follow each repo's CLAUDE.md, and read claude-built-apps/HANDOFF.md
and BRIEFING.md before building.

Why these apps exist (owner, 2026-11-02): they are a public showcase and a
lead source for paid custom builds. Customer priority: small businesses first,
then startups, edtech, universities. Each app also gets its own repo in the
pisan-labs GitHub org, so people can find, star and fork it.

## Git workflow: this routine is authorized to finalize on main, unattended

1. Before Step 1, in each repo run:
     git fetch origin <default branch>
     git switch -C <default branch> origin/<default branch>
   Do all work there. Commit and push with `git push origin <default branch>`.
   Another machine may push meanwhile: fetch again before every push and
   merge (never force-push). Never push the session's assigned claude/*
   branch to GitHub. If one exists locally, delete it after the push.
2. In claude-built-apps run `git config core.hooksPath .git-hooks` (the
   commit-msg hook enforces Conventional Commits).

## Steps

1. Wait up to 5 minutes for the user to supply a project name. If a project
   name is given, continue to STEP 3. If not, continue with STEP 2.

2. PICK. From daily-project-ideas/ideas/*.json, choose one idea not already
   in implemented.json and with no matching claude-built-apps subdirectory.
   Size: complexity "1-2 Weeks" (older files) or "Multi-week" (schemaVersion
   3) preferred, "Weekend MVP" acceptable, never "Multi-month".
   Order of preference:
   a. a small-business tool: category "Small Business Ops", or an idea whose
      buyer is a small business, solo professional, local service, trade,
      clinic, restaurant or shop;
   b. a startup or general-business tool (Micro-SaaS, Accessibility &
      Compliance aimed at businesses);
   c. anything else.
   Within a tier, prefer `confidence: validated` over provisional, then the
   higher score, then the older date. Say in the run which tier you picked
   from and why the tiers above it were empty.
   Replace any suggested LLM API calls with deterministic client-side logic.
   No live app may call Claude or any paid API on the owner's key.

3. CLAIM. Add a ref entry to implemented.json ({date, n}) with
   "placeholder": true and notes "In progress since <date>". Commit and push.

4. BUILD. Implement in claude-built-apps/<slug>/ to a professional bar, per
   claude-built-apps/CLAUDE.md: TypeScript, vitest tests (>=85% coverage),
   README, .env.example, deploy/target.yml, working build, and `npm run lint`,
   `typecheck`, `coverage`, `build` all passing. For a small-business tool,
   write the README and UI copy for the business owner, not for a developer.
   Do not add the "built by" footer (the deploy injects it). If the idea
   turns out bigger than expected, stop after a working core rather than
   gold-plating. If you cannot finish, commit and push all work in progress,
   leave the placeholder claim in place, and stop with a status note in the
   claim's notes field; the next run resumes it.

4.5 PISAN-LABS MIRROR. In claude-built-apps:
   - copy the root LICENSE into <slug>/LICENSE;
   - copy an existing app's .github/workflows/ci.yml (e.g.
     bombe-bench/.github/workflows/ci.yml) into <slug>/.github/workflows/,
     adjusting the commands if this app's scripts differ;
   - add `<slug> <slug>` to .github/mirrors.txt;
   - add a row to scripts/pisan-labs-repos.csv: folder, repo, homepage
     https://<slug>.pisan.me, a one-sentence description ending "Built with
     Claude Code.", and space-separated topics (include claude-code, and
     small-business for a small-business tool).
   The token cannot create repos, so the mirror workflow skips this app with
   a warning until the owner creates pisan-labs/<slug> (step 8). That is
   expected, not a failure.
   Add the app to the root README catalog. For a small-business tool, use the
   "Tools for small businesses" table, creating it as the first catalog
   section if it does not exist yet. Add a write-up at the end of PROJECTS.md.
   Commit and push to main.

5. DEPLOY. Deploys run from GitHub Actions: a push to main deploys every
   target whose deploy/target.yml changed. Do not deploy with a connector.
   Netlify: in target.yml set provider netlify, netlify.siteName <slug>,
   accountSlug yusuf-pisan and customDomain <slug>.pisan.me. The deploy
   runner creates the Cloudflare CNAME itself when the CLOUDFLARE_API_TOKEN
   secret is set; without it (or if creating fails) it deploys on
   <slug>.netlify.app only and says so in a "warning:" annotation. Read the
   Deploy run's annotations to learn which happened, and use that address
   (LIVE_URL below) from here on. Render backends go into backend-hub when
   possible. Verify LIVE_URL returns 200, renders the app, and carries the
   footer (`curl -s LIVE_URL | grep -c "Want something like this"`). Each
   Netlify deploy costs credits: do not redeploy other apps.

6. MARK IMPLEMENTED. In implemented.json: remove "placeholder", set url
   (LIVE_URL), repo
   (https://github.com/pisanuw/claude-built-apps/tree/main/<slug>),
   implementedOn, and a one-paragraph notes. Update CHANGES.md in both
   repos. Commit and push.

7. PORTFOLIO. In pisanorg/yusuf/aiprojects.md, insert a new section at the
   top of the matching group, in the existing format and voice: H3 title
   linked to the live site, one or two paragraphs including one honest
   limitation, a README link line, "(Last update <Month Year>)". Update the
   table of contents and the project count. Commit and push.

8. OWNER ACTIONS. End the run with a short message to the owner listing,
   with exact copy-paste steps, what only they can do:
   a. Only if the deploy stayed on netlify.app: Cloudflare DNS for pisan.me,
      add CNAME `<slug>` -> `<slug>.netlify.app`, DNS only (grey cloud).
   b. On the Mac, in claude-built-apps: `git pull && python3
      scripts/pisan_labs_setup.py`, which creates the empty
      pisan-labs/<slug> repo; then Actions > Mirror apps > Run workflow.
   If (a) applies, say that once it is done, any session re-runs the deploy
   for <slug> and moves the links in README, implemented.json and
   aiprojects.md to https://<slug>.pisan.me. Record the pending actions in
   claude-built-apps/HANDOFF.md under Remaining.

Success: live site verified, ideas page shows the project as Implemented,
portfolio updated, mirror files in place, owner actions listed. If any step
fails, stop, push whatever is committed, and leave a clear status in the run
rather than half-updating the three repos.

Delete any claude/* branch whose tip is already on main.
