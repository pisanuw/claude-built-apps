# Qualified Overtime Checker: handoff (day 1 of 7, 2026-11-10)

Rewritten at the end of every build day by the build routine
(BUILD_ROUTINE.md). It is the only state the next day's session has, and the
document the owner pastes into any other session to continue the work.

## Resume prompt

> Continue building `qualified-overtime-checker` in pisanuw/claude-built-apps
> (branch main; run `git config core.hooksPath .git-hooks`). Read
> `qualified-overtime-checker/HANDOFF.md`, `qualified-overtime-checker/docs/PLAN.md`,
> `docs/platform.md` and the repo CLAUDE.md, then work the next milestone as
> BUILD_ROUTINE.md Step 3 describes: implement with tests, review, push to
> main, update this handoff.

## Goal and customer

Idea: daily-project-ideas `ideas/2026-11-07.json` idea 2, "Qualified Overtime
Checker for W-2 Box 12 TT". Buyer: the bookkeeper, per client file, or the
owner of a small employer with hourly staff. Promise: "it checks the new
overtime number on my staff's W-2s and tells me which ones are wrong and by
how much." Shape marks: stateful, connected, engine, shared.

## What is live

- Day 1 in progress: milestone 1 being built; nothing deployed yet.

## Milestones (docs/PLAN.md)

| # | Milestone | Status | Day | Notes |
|---|---|---|---|---|
| 1 | One employer, checked | in progress | 1 | |
| 2 | Saved client files | next | | |
| 3 | The hard cases | | | |
| 4 | Real exports | | | |
| 5 | Worksheet and W-2c list | | | |
| 6 | Polish | | | |
| 7 | Finish | | | |

## Log

- Day 1 (2026-11-10): picked, claimed, planned; scaffold from platform/templates/app.
