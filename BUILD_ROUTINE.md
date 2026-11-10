# Build a substantial idea: the weekly routine

The scheduled task "Build an idea I choose" (daily 2:49 am Pacific, 11:49 CET)
reads this file and follows it. Edit the routine here, not in the task.

Since 9 November 2026 (owner's decision) the routine builds **one substantial
project per week** instead of one small app per day. A project takes up to
seven build days. Each day is a fresh session; the only state it inherits is
the project's own `<slug>/HANDOFF.md`, which this routine rewrites at the end
of every day and which the owner can paste into any other session to continue
the work. Apps use the shared platform in `docs/platform.md` (Supabase for
sign-in and data, the LLM gateway, backend-hub) instead of being single-page
tools.

Repos pisanuw/daily-project-ideas, pisanuw/claude-built-apps and pisanorg/yusuf
are cloned. Push directly to each repo's default branch (main, main, master),
not to claude/ branches. Follow each repo's CLAUDE.md, and read
claude-built-apps/HANDOFF.md section 14 and BRIEFING.md before building.

Why these apps exist (owner, 2026-11-02): they are a public showcase and a
lead source for paid custom builds. Customer priority: small businesses first,
then startups, edtech, universities. Each app also gets its own repo in the
pisan-labs GitHub org, so people can find, star and fork it.

## The usual architecture (owner, 10 November 2026)

The owner has paid accounts on Netlify, Render, Supabase and Resend, and
Google sign-in goes through Supabase. Build on this stack by default and plan
the features the customer actually needs (sign-in, saved data, file uploads,
email, scheduled checks) instead of cutting them to stay on a free tier. Add
no other provider without the owner's yes.

| Need | Use |
|---|---|
| The app | Vite + TypeScript from `platform/templates/app/`, on Netlify at `https://<slug>.hintwise.org`, deployed by the Deploy workflow from `deploy/target.yml` (Step 4). |
| Server-side code (a secret, a webhook, a signed URL, sending email) | Netlify Functions in the same site: `netlify/functions/`, served at `/api/*` (the deploy runner bundles them; `netlify.functionsDir` in target.yml). A secret reaches them by name through target.yml `envPassthrough`, filled from a GitHub repo secret (`RESEND_API` is one already). A function that touches the database acts with the signed-in user's token, so row level security applies; apps never get the service-role key. |
| Sign-in | Supabase Auth at `https://auth.hintwise.org`: Google through Supabase, and magic link (docs/platform.md section 2). Never add a Google OAuth client, a redirect URI or an auth setting for one app. Sign-in only returns to `https://*.hintwise.org/**`, so it cannot finish on localhost or a deploy preview: tests and the Playwright walkthrough mock it. |
| Data | Supabase Postgres in the app's own schema `app_<slug_>`, row level security on every table, migrations in `<slug>/supabase/migrations/` (Step 4). The project is shared with live apps: never touch `public` or another app's schema. |
| Files | Supabase Storage: one private bucket per app named `<slug>`, created with its `storage.objects` policies in the app's migration; downloads through signed URLs. |
| Sign-in email | Nothing to build: Supabase sends magic links through Resend (sign-in@hintwise.org). |
| App email (notifications, reports, reminders) | Resend, from a Netlify Function only (the key never reaches the browser), sender `<slug>@hintwise.org` (hintwise.org is already the sending domain for sign-in mail and the usage report). Recurring mail is opt-in and carries an unsubscribe link; cap sends per user and per day in code. |
| Model calls | The LLM gateway, with bring-your-own-key always offered (docs/platform.md section 3). |
| Scheduled work | Netlify Scheduled Functions for light jobs (not yet used with this deploy runner: verify on first use); Render for heavy or long-running jobs. |
| A long-running server (websockets, queues, heavy compute, a Python library) | Render: a path prefix in `backend-hub` first. backend-hub runs on Render's free instance (sleeps when idle, 512 MB). |
| DNS | Cloudflare (hintwise.org); the deploy runner creates the app's record. |

Ask the owner first, as a numbered open question with a recommendation (Step
4), before anything that adds a bill or changes what other apps share: a new
Render service or plan, a Supabase add-on, a new provider, a new GitHub secret
(only the owner adds them: give the exact name and what uses it), or a shared
setting (Supabase auth, the Google client, DNS beyond the app's own name).
Netlify charges credits for each production deploy, so the once-a-day deploy
rule in Step 3 stays.

## Git workflow: this routine is authorized to finalize on main, unattended

1. Before anything else, in each repo run:
     git fetch origin <default branch>
     git switch -C <default branch> origin/<default branch>
   Do all work there. Commit and push with `git push origin <default branch>`.
   Another machine may push meanwhile: fetch again before every push and
   merge (never force-push). Never push the session's assigned claude/*
   branch to GitHub. If one exists locally, delete it after the push.
2. In claude-built-apps run `git config core.hooksPath .git-hooks` (the
   commit-msg hook enforces Conventional Commits; scope is the app slug).
3. Push at least at the end of the day, and after every milestone that
   passes the quality gates. Work that is not pushed does not exist tomorrow.

## Step 0: Which day is it?

Read `daily-project-ideas/implemented.json`. An entry with `"placeholder":
true` is the build in progress (there is at most one); its `notes` field says
"In progress since <date>, day <N> of 7" and its `slug` names the folder.

- A build in progress: today is **day N+1**. Go to Step 1, then Step 3.
- No build in progress: today is **day 1** of a new project. Go to Step 1,
  then Step 2.

Days are counted in runs, not calendar days: a run that was skipped does not
advance the count.

## Step 1: Owner input (wait up to 5 minutes)

Wait up to 5 minutes for a message from the owner. Accept:
- a project name or idea reference (date and n), on day 1: build that idea;
- `skip`: do nothing today, say so, and stop;
- `finish <slug>`: treat today as day 7 for that build;
- `stop <slug>`: mark it implemented as it stands (Step 5) and stop;
- `continue <slug>`: reopen a finished project for more days (set its
  placeholder again with "day 1 of 7 (continued)").
With no message, continue.

**Same-day continue.** If the owner replies `continue` (or "continue with
day N") to a run's end-of-day message while the session is still open, run
the next day in the same session: today's Step 4 is already done, so the
placeholder says "day N of 7"; do Step 3 for day N+1 and then Step 4 again.
Each such day counts as a day, and tomorrow's run reads the placeholder as
usual. The owner sends that reply to the build session itself, not to
another session, so two sessions never work on one project at once.

## Step 2: Day 1: pick, plan, vertical slice

**PICK.** From daily-project-ideas/ideas/*.json of the last 21 days, choose
one idea not in implemented.json and with no matching claude-built-apps
folder, with `complexity` "Multi-week" (never "Weekend MVP", never
"Multi-month"). Since 2026-11-10 ideas carry `shape` (five marks), `substantial`
and `buildPlan`; take only `substantial: true`. For older ideas without
`shape`, judge them yourself against the rubric in daily-project-ideas
ROUTINE.md (stateful, connected, unattended, engine, shared; two or more
marks) and write the marks into PLAN.md. Order of preference:
a. a small-business tool: category "Small Business Ops", or an idea whose
   buyer is a small business, solo professional, local service, trade,
   clinic, restaurant or shop;
b. a startup or general-business tool (Micro-SaaS, Accessibility &
   Compliance aimed at businesses);
c. anything else.
Within a tier, prefer `confidence: validated` over provisional, then the
higher score, then the older date. Say in the run which tier you picked from
and why the tiers above it were empty. If nothing qualifies, say so, stop, and
record it in HANDOFF.md section 14 of this repo; do not build a Weekend MVP.

**CLAIM.** Add a ref entry to implemented.json ({date, n}) with
"placeholder": true, "slug": "<slug>" and notes "In progress since <date>, day
1 of 7". Commit and push.

**PLAN.** Create `<slug>/docs/PLAN.md` from `docs/templates/PLAN.md`: the
idea's `buildPlan` (or one you write to the same rules: 5 to 7 milestones,
each about a day, milestone 1 a deployable vertical slice, the last ones
polish and finish), the shape marks, and the platform needs decided against
the architecture table above and `docs/platform.md`: Supabase when the customer returns to saved data or signs
in (schema `app_<slug_>`, migrations in `supabase/migrations/`), the LLM
gateway when a model genuinely adds value (bring-your-own-key always offered;
the owner's key only through the gateway and its caps; deterministic code
wherever it does the job), backend-hub when a server is unavoidable. No live
app may call Claude or any paid API on the owner's key except through the
gateway. An app that uses no platform piece must say in PLAN.md why the shape
marks still hold. Apps are free unless the owner says otherwise (owner, 10
November 2026): a price in the idea is market research, not a requirement, so
build no payments and do not ask about pricing.

**SCAFFOLD.** Create `<slug>/` from `platform/templates/app/` if it exists,
otherwise from the newest app's package.json, vite, vitest (85% thresholds),
eslint and tsconfig files. Write `<slug>/HANDOFF.md` from
`docs/templates/PROJECT_HANDOFF.md` straight away, before any code, so a
crashed day still leaves a usable handoff. README: a stub for the business
owner (what it does, for whom), finished on the polish day.

**VERTICAL SLICE.** Build milestone 1 end to end: UI, core logic, tests,
`deploy/target.yml` (Step 4 has the deploy rules), push, verify the live site.
The public Supabase URL and anon key are in `platform/supabase.json`.

Then do the end-of-day work in Step 4.

## Step 3: Days 2 to 7: one milestone a day

Read `<slug>/HANDOFF.md` and `<slug>/docs/PLAN.md`. Check the live site still
answers (`curl -sI https://<slug>.hintwise.org/` is 200). Then:

1. Take the next milestone from PLAN.md. If it is bigger than a day, split it
   in PLAN.md first and say so in HANDOFF.md; never leave a milestone half
   done without a line saying exactly what is left.
2. Implement it with tests. Work until the milestone's acceptance criteria
   hold; a day's work is several hours of agent time, and "a working core" is
   not a stopping point. Use subagents for independent pieces (tests, docs,
   a second component) when that saves wall-clock time.
3. Before pushing, have a reviewer subagent run the code-review skill (level
   high) on the day's diff and fix what it finds. When the milestone touches
   sign-in, a migration or row level security, a server function, file
   storage or email, also run the security-review skill on the day's diff
   (not only on the polish day) and fix what it finds. Then `npm run lint`,
   `typecheck`, `coverage` (85%) and `build` must pass.
4. Push to main. Deploy by touching `deploy/target.yml` **once per day at
   most**, and only when the live app changed (each Netlify deploy costs
   credits). Verify the live site after the deploy.
5. Day 6, or the first day after the feature milestones are done, is polish:
   README written for the business owner (not a developer), phone layout,
   keyboard and screen-reader pass (run https://accessibility-lens.hintwise.org
   on the live page and fix serious issues), empty and error states, a
   Playwright walkthrough of the main flow (`npm run e2e`, against `vite
   preview` with the in-memory repository), the security-review skill on the
   app, a demo GIF or screenshot for the catalog, and the draft `publicNotes`.
6. Day 7, or the day after polish when everything is done, is finish: Step 5.
   A project that is not done on day 7 still finishes: what is live is
   marked implemented with an honest limitation in `publicNotes`, and
   HANDOFF.md "Remaining" lists the rest for `continue <slug>` or any
   session.

Then the end-of-day work in Step 4.

## Step 4: End of every day

1. Rewrite `<slug>/HANDOFF.md` from the template: day number, what is live,
   the milestone table, how to run and verify, platform use, decisions, tried
   and rejected, open questions for the owner (numbered, each with a
   recommendation and the default you will take), remaining, key files, and a
   one-line log entry for the day. The resume prompt at the top must work
   when pasted into a fresh session.
2. Update the implemented.json placeholder notes to "In progress since
   <date>, day <N> of 7, <one line of status>".
3. Append a CHANGES.md line in claude-built-apps (`YYYY-MM-DD [code] <slug>
   day N: ...`).
4. Commit and push both repos. Delete only the claude/* branches this run
   created (locally and on GitHub) once their tip is on main.
5. End the run with a short message to the owner: what is live, what the
   next day does, the open questions (numbered, with recommendations), and
   any owner action with exact copy-paste steps.

Deploy rules (unchanged from the daily routine): deploys run from GitHub
Actions when a `deploy/target.yml` changes on main; never deploy with a
connector. Netlify: provider netlify, netlify.siteName <slug>, accountSlug
yusuf-pisan, customDomain <slug>.pisan.me (the runner swaps in APP_DOMAIN and
serves https://<slug>.hintwise.org, creates the Cloudflare CNAME and 301s the
netlify.app name). If the Deploy run's annotations warn that the domain was
skipped, report it, use https://<slug>.netlify.app as LIVE_URL for now, and
list the DNS step under owner actions. Verify LIVE_URL returns 200, renders
the app and carries the footer (`curl -s LIVE_URL | grep -c "Want something
like this"`). Apps with a Supabase schema set `supabase: true` in target.yml
so the Deploy workflow applies `supabase/migrations/*.sql` and exposes the
schema (first used on 10 November by qualified-overtime-checker); read that
step's log; it ends with `check-schema`, which fails the deploy if a table
has row level security off, the anon role can reach a table, a security
definer function has no fixed search_path, or a signed-in stranger can see
any real row (share rows with visitors through a security definer function,
as StepWise does). The expose step waits until the Data API serves the schema and
sends the list again if it does not; if its log ends with a warning, dispatch
the "Supabase admin" workflow with `expose-schema app_<slug_> --reapply`
(`sql` with `platform/supabase/ops/reload-postgrest.sql` is the fallback).
Do not add the "built by" footer
(the deploy injects it). Do not redeploy other apps.

## Step 5: Finish (day 7, or earlier when PLAN.md is done)

1. PISAN-LABS MIRROR. In claude-built-apps: copy the root LICENSE into
   `<slug>/LICENSE`; copy an existing app's `.github/workflows/ci.yml` (for
   example bombe-bench's) into `<slug>/.github/workflows/`, adjusting the
   commands if this app's scripts differ; add `<slug> <slug>` to
   `.github/mirrors.txt`; add a row to `scripts/pisan-labs-repos.csv`:
   folder, repo, homepage https://<slug>.hintwise.org, a one-sentence
   description ending "Built with Claude Code.", and space-separated topics
   (include claude-code, and small-business for a small-business tool). The
   token cannot create repos, so the mirror workflow skips this app with a
   warning until the daily halflife job creates pisan-labs/<slug>; that is
   expected.
2. CATALOG. Add the app to the root README catalog (for a small-business
   tool, the "Tools for small businesses" table) and a write-up at the end of
   PROJECTS.md. Commit and push.
3. MARK IMPLEMENTED. In implemented.json: remove "placeholder", set url
   (LIVE_URL), repo
   (https://github.com/pisanuw/claude-built-apps/tree/main/<slug>),
   implementedOn, a one-paragraph `notes` (technical, for the owner's
   password-protected notes view) and a `publicNotes` for visitors: two to
   four plain sentences on what it does and who it is for, then one honest
   limitation. publicNotes never mentions how long the build took, the tech
   stack, test counts or coverage. Update CHANGES.md in both repos. Commit and
   push.
4. PORTFOLIO. In pisanorg/yusuf/aiprojects.md, insert a new section at the
   top of the matching group, in the existing format and voice: H3 title
   linked to the live site, one or two paragraphs including one honest
   limitation, a README link line, "(Last update <Month Year>)". Never invent
   facts about Yusuf (his job, what he has seen, who he knows); write about
   the problem and the app. No test counts, coverage or build time. Update
   the table of contents and the project count. Commit and push.
5. OWNER ACTIONS. End the run with a short message listing, with exact
   copy-paste steps, what only the owner can do:
   a. Only if the deploy stayed on netlify.app: Cloudflare DNS for
      hintwise.org, add CNAME `<slug>` -> `<slug>.netlify.app`, DNS only.
   b. Nothing for the pisan-labs repo if the daily halflife job
      (scripts/halflife/, 04:13) is installed: it creates pisan-labs/<slug>
      and mirrors it. Manual fallback: in claude-built-apps on the Mac,
      `git pull && python3 scripts/pisan_labs_setup.py && gh workflow run
      mirror.yml --repo pisanuw/claude-built-apps --ref main`.
   c. Turn on Netlify web analytics for the new site:
      https://app.netlify.com/projects/<slug>/analytics-and-metrics/analytics
   d. If the app uses the gateway: confirm the `platform.llm_apps` row and its
      caps (defaults $2/day, $10/week, $20/month, $0.25 per user per day).
   Record pending actions in `<slug>/HANDOFF.md` under Remaining and in this
   repo's HANDOFF.md under Remaining.
6. The project's HANDOFF.md stays in place with the resume prompt, so
   `continue <slug>` or any session can pick it up.

Success for a run: everything pushed, the live site verified when it changed,
`<slug>/HANDOFF.md` current, CHANGES.md updated, the owner message sent. If
any step fails, stop, push whatever is committed, write the failure under
"Blocked" in `<slug>/HANDOFF.md`, and leave a clear status in the run rather
than half-updating the three repos.

Delete only the claude/* branches this run created (locally and on GitHub),
once their tip is on main. Leave every other claude/* branch alone: other
sessions may be working on them.
