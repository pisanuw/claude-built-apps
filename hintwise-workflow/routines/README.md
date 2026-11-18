# Routines

Each routine's prompt is a short bootstrap that clones the repositories and points at a file in this repository. Changing what a routine does is then a commit, not an edit to the routine. The prompt also holds the tier map, which is the only place model names appear.

| Routine | Schedule (Barcelona time) | Runs | Status |
|---|---|---|---|
| Daily Product Ideas (Finder) | daily 10:51 | daily-project-ideas ROUTINE.md | Exists; unchanged |
| Build day (the conductor) | daily 11:49 | routines/build-day.md | Proposed. Today "Build an idea I choose" runs claude-built-apps BUILD_ROUTINE.md |
| Marketer | at a launch (PManager starts it), and Mondays 10:23 | roles/marketer/ROLE.md | Proposed |
| Monitor, daily | daily 08:13 | roles/monitor/ROLE.md, daily part | Proposed |
| Monitor, weekly | Mondays 07:37 | roles/monitor/ROLE.md, weekly part | Proposed |
| PManager | relay session, hourly check | roles/pmanager/ROLE.md and the session-relay skill | Exists as the Plabs session |

## Bootstrap prompt

```
Setup: for each of <repositories>: if it is not cloned, call add_repo (access push),
clone it as the result says, and call register_repo_root; then run
`git fetch origin <default branch>` and `git switch -C <default branch> origin/<default branch>`.
Tier map for subagents (the Agent tool's model): top=<model>, strong=<model>, fast=<model>, light=<model>.
Then read hintwise-workflow/<file> and follow it exactly. <Mode, for example "daily part" or "weekly part".>
```

A routine's own session runs on the model set for the routine in its settings. Set it to the tier its role card names.
