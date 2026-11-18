# Build day (the conductor)

This routine runs one day of one project. It decides nothing about the product. It:
- reads the project card;
- runs the stage that is due, by calling roles as subagents;
- keeps the loop limits;
- writes the records.

Until the owner switches over, claude-built-apps BUILD_ROUTINE.md remains the build routine (Q 1).

## Setup

1. Clone the repositories named in the routine prompt, and fetch each default branch.
2. Rename the session "Build: <slug> day <N>".
3. Read CHARTER.md, PIPELINE.md and the project card.

## Calling a role

- Use the Agent tool:
  - subagent type general-purpose;
  - `model` from the tier map in the routine prompt;
  - `effort` from the role's card;
  - in the foreground.
- The prompt says: "You are the <Role> of the HintWise workflow. Read CHARTER.md and roles/<role>/ROLE.md and follow them. Project: <slug>. Task: <the stage's task>. Files: <paths>."
- Give the subagent paths to files, never your own conclusions.
- Use a fresh subagent for every review round: Senior, Reviewer and Manager. Within one day, continue Junior and Builder across rounds with SendMessage, so they keep their context.
- After each call, write a run record (PIPELINE.md, Formats). Take the duration and the tokens from what the call reports; where it reports none, write `null`.

## The day

1. **Directives.** First, carry out anything in the card's Directives that is not done.
2. **The stage.**
   - **No project:**
     1. If no decided pick exists, run Picker.
     2. Claim the idea in implemented.json, as BUILD_ROUTINE.md Step 2 does.
     3. Create the card.
     4. Move to `spec`.
   - **spec:**
     1. Run Junior, then a fresh Senior.
     2. Repeat until Senior says APPROVE, or round 3 ends.
     3. After round 3, file a T2 inbox item and go on with the parts no blocker touches.
   - **build m<N>:**
     1. Run Builder, then a fresh Reviewer.
     2. Repeat until Reviewer says APPROVE, or round 3 ends. After round 3, file an inbox item for PManager.
     3. If the milestone changes what a user sees, run Manager's acceptance.
     4. Mark the pull request "ready for release", and file a release item for PManager.
   - **polish:**
     1. Builder's polish tasks (BUILD_ROUTINE.md Step 3.5).
     2. Reviewer, with the security review of the whole app.
     3. Manager's launch review.
     4. A release item.
   - **launch:** prepare the launch files on the branch, and file a launch item for PManager.
3. **Keep going.** A day's work is several hours of agent time. Continue while the next stage does not wait on PManager or the owner.
4. **End of day.**
   1. Update the card: the stage, and the day's log lines.
   2. Update HANDOFF.md, and the implemented.json placeholder note.
   3. Commit and push:
      - the records, to this repository's main;
      - the work, to the project branch.
   4. End with a summary of three lines at most. Monitor's digest carries it to the owner.

## Failure

If a step fails:
1. Push whatever is committed.
2. Write the failure under "Blocked" in HANDOFF.md, with the command and its output.
3. Write a run record with outcome `failed`.
4. Stop. Never leave the card claiming a stage that did not happen.
