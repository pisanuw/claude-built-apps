---
name: session-relay
description: Run a long-lived Claude Code cloud session as a relay. A status check every two hours sends a report when something is new, else the line "HH:MM Nothing to report." A daily check hands over to a fresh session only when it is worth it (context half full, the session six days old, the owner asks, or it is failing), so a session lasts 1 to 7 days. Scheduled routines do both, the new session moves the routines to itself and archives the old one, and the session lineage limit is respected. Use this whenever the user wants a session that keeps working for days, asks for hourly or periodic status reports, says "set up the handoff routines", "hand over to a new session", "take over as the new session", "move the routines", or "report only when there is news", or when a routine fires asking for a status check, a handoff check or the start of the next session, even if the skill is not named. For a one-off handoff file with no recurring routines, the plain handoff skill is enough.
---

# Session relay

A cloud session that works for days fills its context, gets compacted, and eventually degrades. A fresh one starts sharp but knows nothing. The relay keeps the work moving across sessions without the owner having to babysit:

- **Status check.** Every two hours, the session looks for anything new. It sends the owner a short report when there is something, and the single line "HH:MM Nothing to report." when there is not.
- **Handover check.** Once a day, the session decides whether handing over is worth it. If so, it rewrites the project's rolling handoff document and merges it.
- **Session start.** Shortly after, a routine starts the next session with `create_session`, if and only if today's handoff was written.
- **Takeover.** The new session moves every routine to itself, archives the previous session, reports that it took over, and continues the work.

Handing over every day throws away a session that has barely used its context. Never handing over lets one session rot. So hand over when it is worth it, anywhere from 1 to 7 days.

The tools are the remote-session MCP tools: `get_session`, `list_triggers`, `create_trigger`, `update_trigger`, `delete_trigger`, `create_session`, `send_later`, `archive_session`. Load them with ToolSearch if they are deferred. `SendUserFile` delivers reports and cards; `SendUserMessage` delivers the one-line "Nothing to report." A routine arrives as a new turn, or as a notice that notifications are pending: then call `ReadNotifications` until none remain. Call routines "scheduled tasks" when talking to the user, and a fact-checker "a subagent" (the Agent tool), never a session made with `create_session`.

**"Today" is the date in the routine time zone** (`TZ=<routine tz> date '+%-d %B'`), never bare `date`, which is UTC. With a 15:56 Pacific check and a 16:52 start, UTC has already rolled over to tomorrow at the start: a session reading bare `date` looks for tomorrow's handoff PR, finds none, and silently skips the handover.

## The parameters (record them once, in the handoff document)

Ask the owner for these once, at setup, in one message with a proposed value for each, then keep working; with no answer in 15 minutes, use the proposals and say so. Write them into the handoff document's Scheduling section. Every later session reads them there instead of asking again.

| Parameter | Example | Used for |
|---|---|---|
| Repository | `owner/repo` | `create_session`'s `source_url`, PRs |
| Handoff document | `docs/handoff.md`, else `HANDOFF.md` | the rolling handoff |
| Routine time zone | `America/Los_Angeles` | the routines' `CRON_TZ` and "today"; where the owner lives, so the check, the start and any start-by-hand card land in their working day; keep routines out of 06:00 to 09:00 Pacific, when scheduled runs are often delayed |
| Report time zone | `Europe/Berlin` | every time written in a report |
| Handover check time | 15:56 | the daily decision, an hour before the start |
| Session start time | 16:52 | `create_session` |
| Handoff PR title | `docs: the handoff of <D Month>` | the marker the start routine looks for |
| Merge rule | the project's own (CI green, review) | merging the handoff |

Put each routine's minute off `:00` and `:30` (schedulers run late at the top of the hour). Leave the check about an hour before the start, so the handoff PR has time to go green and merge.

## Setup (the first session)

1. **Create the three routines first**, aimed at this session (`create_trigger` with the default target, `initiation: human_request`), so the handoff document can name their ids. The prompts are in [references/routines.md](references/routines.md): copy them, fill in the parameters, and keep each self-contained, since a routine fires into a context that may have been compacted.
   - the status check every two hours (cron `46 */2 * * *`, or another minute off the hour);
   - the handover check (`CRON_TZ=<routine tz> 56 15 * * *`);
   - the session start (`CRON_TZ=<routine tz> 52 16 * * *`).
2. **Make each dated task a one-shot routine** (`run_once_at`) aimed at this session. Tasks more than about two weeks out can live in the handoff document's dated table alone; the session of the day before reads them there.
3. **Find or create the handoff document.**
   - If the project has one, it is the rolling handoff: each handover rewrites it, never adds a dated copy.
   - If not, create it in the `handoff` skill's format, but merge it the project's way (a PR where the project uses PRs) instead of that skill's direct commit.
   - Add a last section, "Notes for the next session", with three parts: the owner's standing instructions, the parameters above, and Scheduling. Scheduling holds this session's id, its lineage, and each routine's id and purpose. Add a dated-tasks table too.
   - Title the setup PR anything but the handoff title (for example `docs: add the session handoff`). The handoff title would make today's start routine create a session.
4. **Send the first status report** (below), so the owner sees the format.

## The status check (every two hours)

When it fires, if you took over from a previous session that is not yet archived, try the takeover's archive step again first (step 3 below). Then decide whether anything changed since the last check:

- a PR opened, merged, closed or red;
- a deploy;
- a failed or late scheduled job;
- a production health problem;
- a decision or owner action newly due or newly answered, or a decision's default taken;
- a dated task done.

**Nothing changed: send exactly one line, `HH:MM Nothing to report.`** Read the time from `date` just before sending, in the report time zone (`TZ=<report tz> date '+%H:%M'`), so it reads like `12:35 Nothing to report.` Send it with `SendUserMessage` and nothing else: no file, no caption, no time zone, no context figure, no list of what you checked, and no other text in the turn. Then go back to the work in hand. The line is a heartbeat: it tells the owner the relay is alive and the check ran, at a glance, without anything to read. Anything added to it turns it back into a report they have to scan, so changes belong in a full report, never tacked onto this line.

**Something changed:** rewrite the report file in the scratchpad and send it with `SendUserFile` (`status: proactive`). The caption is one line naming what is new and anything waiting for the owner. The format is in [references/report.md](references/report.md). The rules that matter:

- **Stamp the time only from `date`**, converted to the report time zone, never from a time you plan to send at.
- **"Waiting for you" writes every open decision out in full, every time:** the question, its options and the recommendation. The owner may not be able to reach old reports, so never point at an earlier card.
- **List an owner action only once it can be done now.** One that waits on a merge or a date stays off the list until it is due. When it is due, give the exact copy-paste command and what a working run prints.
- **Never list deleting merged branches.** Turn on the repository's "Automatically delete head branches" setting at setup (the owner does this in Settings → General), and say "Nothing open" when nothing is.
- **Say what is not verified.**

## The handover check

When it fires, decide whether to hand over today. Read `get_session` with no id:

- `ccr.external_metadata.context_usage`: `used_tokens` of `max_tokens` (if absent, decide on age and health alone);
- `ccr.created_at`;
- the top-level `lineage`: `depth` and `limit`.

**Hand over if any of these holds:**
1. `used_tokens` is 50% or more of `max_tokens`;
2. the session is 6 days old or older, so none runs past a week;
3. the owner asked;
4. the session is failing in a way a fresh one would fix (repeated tool errors, real loss of context after a compaction).

**Otherwise do not hand over.** Write no handoff and open no PR. Say in the next full report, only if something else is new, that the session continues, with its context figure; a "Nothing to report." line stays bare.

Read the figure at the check rather than remembering it. A compaction can take a session from 58% to 10%, and the old number would hand over a healthy session. A compaction alone is not "failing": the summary usually carries enough. Hand over for it only when the work actually suffers.

**If handing over:**

0. **Check the lineage now, not at the start.** If `depth + 1` is more than `limit`, `create_session` will refuse. Still write and merge the handoff, since the owner's new session reads it, but send the owner a card now asking them to start the next session by hand: claude.ai/code, the repository, and the takeover prompt pasted as its first message. Keep working until a new session takes over. Write no further handoff PR on later days while the card waits; repeat the ask in each report instead.
1. **Push every branch** well before the start time. Leave a PR that cannot merge in time open, and name it.
2. **Rewrite the handoff document**, gathering facts from the repository, not memory:
   - what is live;
   - what merged since the last handoff, with times in the routine time zone;
   - branches still unmerged (never merged ones to delete);
   - next, in order;
   - waiting on the owner;
   - dated tasks;
   - notes.

   In Scheduling, write your own session id as the previous session, the lineage depth and limit, and each routine's current id.
3. **Have a subagent fact-check it** against git, the PR list and the workflow runs, and fix what it finds. A self-written summary drifts: one check found seven errors in a short update (wrong dates, a dangling reference, a claim contradicted by the remote).
4. **Open the PR under exactly the handoff title** and merge it by the project's rule. That title is the marker the session start looks for, so never give any other PR that title. A PR that only updates the handoff document on a non-handover day needs a different title.
5. **Do not start the next session and do not delete any routine.** The start routine starts it, and the new session moves the routines.

## The session start

When it fires:

0. **If no PR with the handoff title and today's date (in the routine time zone) was opened since yesterday's start, do nothing** and send nothing. Today is not a handover day.
1. **Make sure today's handoff is on main.** If it is only an open PR, merge it on green first.
2. **At the lineage limit, stop here:** the handover check already sent the start-by-hand card.
3. **Call `create_session`** with:
   - `source_url` of the repository;
   - title `<Project>: <Mon D>`;
   - the default environment and model, unless the owner chose others;
   - the takeover prompt from [references/routines.md](references/routines.md), verbatim, with today's date and your own session id filled in.
4. **Tell the owner the new session's id** in a one-line card (`SendUserFile`), since plain chat text may not reach them. Then stop starting new work: finish nothing half-way that the handoff did not name, push anything unpushed, and answer only what is addressed to you. The new session archives this one as soon as it has moved the routines, so expect to be cut off. Do not send the new session a message. It knows the previous id from the handoff, and a cross-session message asks the owner for permission each time.

## The takeover (the new session)

1. **Read the project's instructions** (CLAUDE.md or equivalent), then the handoff document on main. If main's is not today's, read it from the open handoff PR's branch.
2. **Move every routine aimed at the previous session to yourself.** Run `list_triggers`, paging until `has_more` is false. For each routine whose `persistent_session_id` is the previous session, create the same routine (same name, prompt and schedule, `initiation: human_schedule`) aimed at yourself, then delete the old one.
   - A paused routine stays paused: switch the copy off too (`update_trigger`, `enabled: false`).
   - For a one-shot routine due within ten minutes, delete the old one first, so it cannot fire twice.
   - If `delete_trigger` refuses, switch the old one off instead and say so.
   - Leave every other routine alone, the owner's own included. If one looks like a relay routine aimed at some other, older session, leave it but name it in your takeover report: it could start a second session on a handover day.
   - Note the new ids for the next handoff.
3. **Archive the previous session, and only after step 2 is done.** Run `list_triggers` again and confirm no routine still has the previous session's id as its `persistent_session_id`. An archived session refuses new messages, so a routine still aimed at it would fail to fire and the owner would hear nothing; that is why the archive waits for the move.
   - Call `get_session` with the previous session's id. If its `status_bucket` is `"working"`, it is still finishing a turn (often a last push): leave it and try again at your next status check, since archiving mid-turn can cut that off.
   - Otherwise call `archive_session` on the previous session's id (load it with ToolSearch if deferred). Archiving is reversible (claude.ai/code/sessions, the Archived tab, Unarchive), so it needs no separate yes from the owner. Record the time in the handoff's Scheduling section and mention it in the next full report; on its own it does not call for one.
   - Archive only the previous session: never one the owner started for other work, never an older session, and never delete one.
   - If `archive_session` is not available or refuses, do not improvise (no raw API call, no browser). Put one owner action in the takeover report instead: archive `<previous id>` from its ⋯ menu in the claude.ai/code sidebar. The old session's own watch (below) still keeps two sessions from working at once.
4. **If the owner started you by hand** (the lineage limit), read your own `lineage` and record it in the handoff's Scheduling section.
5. **Send the status report now**, saying you took over, with your session id and whether the previous session was archived. This is the one full report sent even when nothing else is new.
6. **Work the handoff's "next, in order"** under its standing instructions.

**The old session watches for its own replacement.** Once the new session archives it, it can take no new turns, which settles the matter. Until then (or when archiving was not possible), before starting each new piece of work, a session that has handed over, or is waiting for a hand-started successor, runs `list_triggers`. If its routines are gone, a new session has taken over: it stops starting work. That is how two sessions avoid working the repository at once when the owner starts one by hand and forgets to say so. A session waiting for a hand-started successor pushes each piece of work as soon as it is done, because the successor archives it on arrival and anything left only in its container may be lost.

## Decisions and questions while the relay runs

The owner is often away, so a question must never stall the work.

- **Send each decision as a short card.** One Markdown file, sent with `SendUserFile` (`status: proactive`), holding the question, numbered options, a recommendation and what happens with no answer. Then keep working on something else.
- **Set a check-in for 15 minutes later** (`send_later`).
- **With no answer by then, take the recommendation.** Put it in the next status report's "What's new", with how to undo it, and keep a one-line undo under "Defaults taken" in each report until the owner acknowledges it.
- **The default never covers** writing production data, spending money, deploying unless the owner asked for deploys, deleting what cannot be restored, rotating secrets, rewriting shared history or publishing outside the session. Those wait for an explicit yes.
- **A question without a recommendation is not guessed.** Work on other parts and list it as open.
- **If a review changes your recommendation after you sent it, send a revised card** saying it replaces the earlier one and why. Do not quietly build the old recommendation.

## Pitfalls seen in practice

- **A wrong PR title starts a session.** A docs PR on a non-handover day titled like a handoff makes the start routine create a session nobody wanted.
- **Routines fire into the session they are aimed at.** If the takeover skips step 2, the status check keeps firing into a session that has stopped working, or that is archived and refuses the message, and the owner hears nothing. That is why the archive comes after the move, never before. Read the ids from `list_triggers`, never from memory.
- **A routine's prompt can be changed only from the session it fires into.** `update_trigger` refuses a new prompt from any other session (name, schedule and on/off may still change). So when the skill changes, a running relay's own session must update its routines, or the takeover copies the old prompts forward unchanged. Never delete and recreate a routine to get around this.
- **The heartbeat line grows.** "Nothing to report." gains a time zone, a context figure or a "checked PRs, CI, deploys" tail. Each addition makes it something to read. The line is the time and those three words; anything worth saying is a change, and a change gets a full report.
- **Don't poll.** Routines and notifications wake the session; a `sleep` loop wastes the turn and is often blocked.
- **Times drift.** Stamp from `date` and convert, and write routine times in the routine time zone and report times in the report time zone. The handoff document says which is which.
- **Merged branches leak back onto the owner's list.** A branch merged before the auto-delete setting was turned on stays on the remote. Don't list it as an owner action; the session usually cannot delete it either.
- **The new session repeats the old one's last hour.** The handoff's "next, in order" should start with what is actually next, not with what the previous session already finished after the document was written. Re-check against git before starting.
