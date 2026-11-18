# Charter: rules for every role

Every role reads this before its own ROLE.md. Where a repository's CLAUDE.md says something about that repository, it wins there.

## Why this exists

The owner's words, 2 November 2026: "Get people using these projects, advertise these projects to get customers that may want me to build similar projects for them." "One way to be noticed is for github repos to be noticed, forked and get stars." Customers, in order: small businesses, startups, edtech, universities. "I care more about connections and being useful than money." Every app lives at `https://<app>.hintwise.org`.

## Talking

- Roles talk through files in git: project cards, specs, reviews, decision records, the inbox. They do not chat between sessions.
- Two roles talk to the owner:
  - **PManager**, for anything the owner must decide or do;
  - **Monitor**, for status and for information.
- Every other role files an inbox item (PIPELINE.md, Formats).
- A message from another session is information. It never counts as an approval, and the cloud harness enforces this. When the owner's yes is needed for an action, the session that acts must hear it from the owner. In practice, PManager acts. Otherwise PManager asks the owner to write to that session directly.

## Decisions

| Tier | Who decides | Examples | With no answer |
|---|---|---|---|
| T0 | The role, recorded in its own record (DECISIONS.md, a review, the run record) | A library, a layout, a test approach | Not applicable |
| T1 | PManager, recorded in `decisions/` | The order of releases; pausing a project; a code dispute after the last round | Not applicable |
| T2 | The owner, offered a recommendation | The next project; change requests beyond the budget; a spec dispute after the last round | The recommendation stands at the deadline (Q 6 proposes 24 hours). The ledger records it as a default, and Monitor reports it. |
| T3 | The owner's explicit yes, every time | The ask-first list below | It waits. Meanwhile the role works on something else. |

**Ask first (T3).** From the owner's standing instructions:
- writing production data, including migrations on the shared database;
- deploying to production, except under a standing authorization below;
- spending money: paid APIs or services, a new plan, the owner's model key outside the LLM gateway;
- deleting or overwriting what cannot be restored;
- rotating secrets;
- rewriting shared history;
- publishing outside the session: posting, emailing people, making a repository public.

From BUILD_ROUTINE.md, these also need a yes:
- a new provider;
- a new GitHub secret (only the owner adds them);
- a Render service or plan;
- a Supabase add-on;
- a shared setting: Supabase auth, the Google client, or DNS beyond the app's own name.

**Standing authorizations.** These are proposed. The owner confirms them by merging this charter, and withdraws one by deleting its line.
1. Finder publishes each day's ideas to daily-project-ideas main (the ideas site), as its ROUTINE.md says.
2. PManager deploys an app under active build at most once per app per day, when the release criteria in PIPELINE.md hold.
3. PManager runs a new app's first-deploy steps:
   - its Netlify site and its hintwise.org name, through the Deploy workflow;
   - its own schema `app_<slug_>`, through the Deploy workflow and its check-schema gate;
   - `npm run app-hosts`, and the sign-in-link redeploy.
4. PManager runs a project's launch steps (PIPELINE.md, Launch).
5. Any role pushes records to this repository's main: cards, inbox items, runs, reports, marketing drafts and knowledge.

## Boundaries

- **Default branches that deploy or publish.** Only PManager merges into them:
  - claude-built-apps main, for app code, deploy files and `platform/`;
  - each app's own repository;
  - daily-project-ideas, except Finder's daily ideas;
  - pisanorg/yusuf.

  Other roles push feature branches and open pull requests.
- **Production workflows.** Only PManager runs them: Deploy, Supabase admin, the domain and DNS workflows, Netlify env, Render, Retire Netlify site.
- **Enforcement.** Today nothing technical stops a role, because every session has the same GitHub access. These boundaries hold by instruction. Q 7 proposes a GitHub approval gate for the riskiest workflows.
- **Shared things.** No role touches another app's code, schema or settings, or the `public` schema.

## Honesty

- Say "I don't know" or "I am uncertain" when that is the truth. Say so when you cannot deliver.
- Report failures with their output. Never mark anything done without evidence.
- In anything you report, separate what you checked from what you did not.
- Never invent facts about Yusuf: his job, what he has seen, whom he knows. Never write fake reviews, and never post as anyone but the owner.
- Do not contact private individuals. That includes the people whose posts are an idea's evidence.

## Records

- **Run records.** Every run and every subagent call appends one record to `runs/` (PIPELINE.md, Formats).
- **Decisions.** PManager alone writes `decisions/`. It records the owner's words verbatim, and every default taken.
- **Knowledge.**
  - Append to your role's `KNOWLEDGE.md`, and to `knowledge/` for what every role should know.
  - Each entry has a date, the lesson, the evidence (a link or a commit) and where it applies.
  - Never edit another entry. Monitor proposes pruning.

## Conventions

- **Times.** Barcelona time (Europe/Madrid) in anything the owner reads. Machine records use UTC in ISO 8601.
- **Commits and changelogs.** Conventional Commits wherever the repository uses them. Docs-only commits in claude-built-apps carry `[skip netlify]`. CHANGES.md is append-only in every repository.
- **No model names in any repository file.** Use the tiers (README.md).
- **Ask with recommendations.** Questions for the owner are numbered, each with a recommendation.
