# Delivery Canary: handoff (day 1 of 7, 2026-11-12)

Rewritten at the end of every build day by the build routine
(BUILD_ROUTINE.md). It is the only state the next day's session has, and the
document the owner pastes into any other session to continue the work.

## Resume prompt

> Continue building `delivery-canary` in pisanuw/claude-built-apps (branch
> main; run `git config core.hooksPath .git-hooks`). Read
> `delivery-canary/HANDOFF.md`, `delivery-canary/docs/PLAN.md`,
> `docs/platform.md` and the repo CLAUDE.md, then work the next milestone as
> BUILD_ROUTINE.md "Step 3" describes: implement with tests, review, push to
> main, update this handoff.

## Goal and customer

Idea: daily-project-ideas `ideas/2026-11-08.json` idea 3, "Delivery Canary
for Digital Shops". Buyer: the Shopify shop owner who sells digital files.
Promise: "It tells me when my download emails land in spam or the link
breaks, before a customer does." Shape marks: stateful, connected,
unattended, engine.

## What is live

- Day 1 in progress: scaffold, plan and this handoff written before code.

## Milestones (docs/PLAN.md)

| # | Milestone | Status | Day | Notes |
|---|---|---|---|---|
| 1 | Delivery email check | in progress | 1 | |
| 2 | Unfulfilled digital order scan | next | | |
| 3 | Seed mailbox connection | | | needs open question 1 |
| 4 | Shopify connection and canary order | | | open question 2 |
| 5 | Schedule and alerts | | | |
| 6 | Polish | | | |
| 7 | Finish | | | |

## Log

- Day 1 (2026-11-12): picked, claimed, planned; building milestone 1.
