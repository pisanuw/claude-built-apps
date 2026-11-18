# Pipeline

How a project moves from role to role, what each hand-off leaves behind, and the limits on loops.

## Stages

| Stage | Who | Leaves behind | Moves on when |
|---|---|---|---|
| picked | Picker, then the owner (T2) | `pipeline/shortlist-<date>.md`, an inbox item, the project card | The owner chose, or the deadline passed |
| spec | Junior | `<slug>/docs/SPEC.md`, `<slug>/docs/PLAN.md` | The draft is complete |
| spec review | Senior | `<slug>/docs/reviews/spec-r<N>.md` | APPROVE; after round 3, escalation |
| build m<N> | Builder | Commits on `build/<slug>`, a pull request, `docs/DECISIONS.md`, `HANDOFF.md` | The gates pass |
| code review m<N> | Reviewer | `docs/reviews/code-m<N>-r<K>.md`, also posted as the PR review | APPROVE; after round 3, escalation |
| acceptance m<N> | Manager | `docs/reviews/acceptance-m<N>.md`, change requests in SPEC.md | ACCEPT, or ACCEPT WITH CHANGE REQUESTS |
| release m<N> | PManager | The merge, the deploy run, the live check in the card | The live site answers and shows the milestone |
| polish | Builder; Reviewer (security review of the whole app); Manager (launch review) | As above | No launch blocker is open |
| launch | PManager | Catalog row, PROJECTS.md write-up, mirror files, implemented.json, Studio entry and image, portfolio entry | The app is live and listed everywhere |
| market | Marketer | `marketing/<slug>/` | The owner has the drafts |

Rules that apply across stages:
- A milestone with no user-visible change skips acceptance.
- A milestone can be released before the next one starts. Builder then continues on the same branch, after merging main into it.
- Directives in the project card come before stage work.

## Loops

- A **round** is one draft (or one set of fixes) followed by one verdict.
- **Limits.**
  - Spec: up to 3 rounds.
  - Code: up to 3 rounds per milestone.
  - Acceptance: one verdict per milestone. Failing acceptance criteria go back to Builder as fixes; needs the spec missed go to Junior as change requests.
- **Fresh reviewers.** Each review round uses a fresh subagent. It reads the files and the earlier rounds, never the author's reasoning.
- **Escalation after the last round.** The conductor files an inbox item with both positions and both recommendations:
  - a code dispute goes to PManager (T1, or T2 if PManager wants the owner);
  - a spec dispute goes through PManager to the owner (T2).

  Work continues on everything the dispute does not touch.

## Change requests

1. Manager files each change request as CR-<n> in SPEC.md's "Change requests" section.
2. A launch blocker, or a request within the project's budget (one build day, Q 8), goes ahead. The conductor has Junior turn it into acceptance criteria and a milestone in PLAN.md.
3. A request estimated above half a day gets one Senior round.
4. A request beyond the budget is a T2 item for the owner. Until it is answered, it waits under "next version".

## Release criteria

PManager checks these before merging:
1. Reviewer's APPROVE is on the pull request's last commit.
2. Manager's ACCEPT, or ACCEPT WITH CHANGE REQUESTS, covers a user-visible milestone.
3. CI is green.
4. Migrations, if any, touch only `app_<slug_>`, and every new table has row level security. The Deploy workflow's check-schema step enforces this again.
5. No open T3 item touches the release.
6. This app has had no other production deploy today.

After the deploy, the live check goes into the card: status 200, the app renders, the footer is there.

## Launch

PManager does this after the launch review passes. The conductor prepares the files on the project branch.
1. The steps in claude-built-apps BUILD_ROUTINE.md, Step 5:
   - the mirror files;
   - the catalog row and the PROJECTS.md write-up;
   - implemented.json and the Studio entry and image;
   - the portfolio entry, drafted by Marketer in the owner's voice.
2. Start the Marketer routine with the slug.
3. Move the card to `market`.

## Formats

### Project card: `projects/<slug>.md`

```markdown
# <App name> (`<slug>`)

- Stage: build m3 (Builder). Day 4 of 7. Started 2026-11-19.
- Idea: daily-project-ideas `ideas/2026-11-17.json` #1. Picked by the owner on 2026-11-18 (decisions/2026-11.md).
- Links: spec, plan, decisions, open pull request, live site.

## Directives
Newest first, dated. The owner's words verbatim.

## Log
Append-only, one line per stage change or run, UTC:
2026-11-19T11:31Z spec r1: Junior draft done (38 min).
```

### Inbox item: `inbox/<id>.md`

```markdown
---
id: 2026-11-19-<slug>-<short-name>
from: <role>
project: <slug or "all">
tier: T2 | T3
raised: 2026-11-19T11:10Z
deadline: 2026-11-20T11:10Z    # T2 only
---
Question: one sentence.
Options: 1. ... 2. ...
Recommendation: <option>, because ...
If no answer: T2, the recommendation stands at the deadline. T3, it waits; meanwhile <what continues>.
Evidence: links.
```

PManager moves an answered item into the ledger and deletes the file.

### Decision ledger: `decisions/YYYY-MM.md`

One line per decision, append-only, written by PManager:

```
2026-11-19T17:04Z | <inbox id> | T2 | Next project | owner: "2" | done: card updated
2026-11-20T11:10Z | <inbox id> | T2 | Next project | DEFAULT: option 1 at the deadline | done: card updated
```

### Run record: `runs/YYYY/MM/<UTC time>-<role>-<slug>.json`

One file per run or subagent call, so parallel writers never conflict:

```json
{"start": "2026-11-19T10:52Z", "end": "2026-11-19T11:31Z", "role": "junior", "project": "<slug>",
 "stage": "spec", "round": 1, "vehicle": "subagent", "session": "session_...", "tier": "fast",
 "effort": "high", "tokens": null, "outcome": "draft", "notes": ""}
```

- `outcome` is one of: done, draft, approve, revise, changes, explain, accept, reject, escalated, failed.
- Unknown numbers are `null`, never guessed.

## Where project files live

**Project files** live in the app's folder: claude-built-apps `<slug>/`, or the app's own repository.
- `docs/SPEC.md`, `docs/PLAN.md` (from claude-built-apps `docs/templates/PLAN.md`) and `docs/DECISIONS.md`;
- `docs/reviews/`;
- `HANDOFF.md`.

**Process files** live in this repository: cards, the inbox, the ledger, runs, reports and marketing drafts.
