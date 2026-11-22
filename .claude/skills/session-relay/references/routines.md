# The relay's routine prompts

Copy each prompt into `create_trigger`'s `prompt`. Replace every `<...>` with the project's value, the ones recorded in the handoff document's Scheduling section, except the ones that say "today's date", which stay as words for the routine to fill when it runs. "Today" is always the date in <ROUTINE_TZ> (`TZ=<ROUTINE_TZ> date '+%-d %B'`), never bare `date`, which is UTC and has rolled over by an evening start. Keep the prompts self-contained. A routine fires into a context that may have been compacted, so it must say what to do without relying on memory, and it should name the session-relay skill for the details.

## 1. Status check, every two hours

- name: `<Project> status report (every 2 hours)`
- cron: `46 */2 * * *` (any minute off `:00` and `:30`; UTC is fine for a line that runs every two hours)

```
Status check every two hours (the session-relay skill): a full report when something is new, one line when not. If you took over from a previous session that is not yet archived (the handoff's Scheduling section), first call get_session on its id and, unless its status_bucket is "working", archive it with archive_session and record the time there. Then decide whether anything changed since the last check: a PR opened, merged, closed or red; a deploy; a failed or late scheduled job; a production health problem; a decision or owner action newly due or newly answered; a dated task done. If nothing changed, run TZ=<REPORT_TZ> date '+%H:%M' just before sending and send exactly '<that time> Nothing to report.' (for example '12:35 Nothing to report.') with SendUserMessage: no file, no caption, no time zone, nothing added, and no other text in this turn. Then go back to the work in hand. If something changed, rewrite the scratchpad's status-report.md: the update time from `date` in <REPORT_TZ>, used for every time in the report; "What's new" (the changes since the last report, first); "Waiting for you" (every decision or owner action the owner can act on now, written out in full with when it was sent and the recommendation, each action with its exact copy-paste command and a check that it worked; an action that waits on a merge or a date is not listed until it is due; never list deleting merged branches; say "Nothing open" when so); "In flight" (each open PR, its CI state, each branch ready for a PR); "Next up"; and "Implemented, by day" (each day's merged PRs and other finished work under its date, newest day first, in <REPORT_TZ>). Then send it with SendUserFile (status proactive, a one-line caption naming what is new and anything waiting for the owner). Keep it short and accurate: say what is not verified. Then go back to the work in hand. At the next handover, the new session moves this routine to itself.
```

## 2. Handover check

- name: `<Project> handoff check: hand over only when due`
- cron: `CRON_TZ=<ROUTINE_TZ> 56 15 * * *`

```
Handover check (the session-relay skill): hand over only when it is worth it, anywhere from 1 to 7 days. Call get_session with no id and read ccr.external_metadata.context_usage (used_tokens of max_tokens), ccr.created_at and the top-level lineage (depth, limit). Hand over today if any holds: (1) used_tokens is 50% or more of max_tokens; (2) the session is 6 days old or older; (3) the owner asked for a handoff; (4) the session is failing in a way a fresh one would fix (repeated tool errors, real loss of context after a compaction). Otherwise do NOT hand over: write no handoff, open no PR, and leave the session-start routine nothing to do; record in the next full status report (only if something else is new; a 'Nothing to report.' line stays bare) that the session continues, with the context figure. If handing over and depth + 1 is more than limit, create_session will refuse: still write and merge the handoff, and now send the owner a card (SendUserFile, status proactive) asking them to start the next session by hand at https://claude.ai/code with the repository <REPO> and the takeover prompt from the session-start routine pasted as its first message; open no further handoff PR on later days while it waits. If handing over: by <START_TIME minus 10 minutes> <ROUTINE_TZ> push every branch, and leave a PR that cannot merge in time open and name it. Rewrite <HANDOFF_DOC> from the repository's facts (what is live, what merged since the last handoff, branches still unmerged, next in order, waiting on the owner, dated tasks, notes); never list merged branches to delete. In its Scheduling section write your own session id (get_session with no id) as the previous session, the lineage depth and limit, and each routine's current id. Have a subagent (the Agent tool) fact-check it against git, the PR list and the workflow runs, fix what it finds, open it as a PR titled '<HANDOFF_PR_TITLE with today's date>', and merge it by <MERGE_RULE>. Never give any other PR that title. Do not start the next session and do not delete any routine: the session-start routine starts it, and the new session moves them.
```

## 3. Session start

- name: `<Project> daily handoff: start the next session (create_session)`
- cron: `CRON_TZ=<ROUTINE_TZ> 52 16 * * *`

```
Session start (the session-relay skill), only on a day the handover check decided to hand over. Steps:
0. Today is the date in <ROUTINE_TZ> (TZ=<ROUTINE_TZ> date '+%-d %B'), never bare date (UTC). If no PR titled '<HANDOFF_PR_TITLE with today's date>' was opened in <REPO> since yesterday's start, today is not a handover day: do nothing, send nothing, and keep working as the current session.
1. Check that today's handoff is on main (<HANDOFF_DOC> written today, from that PR); if it is only an open PR, merge it on green first.
2. Call get_session with no id and read the top-level lineage (depth, limit). If depth + 1 is more than limit, the handover check has already asked the owner to start the next session by hand: stop here and keep working until a new session takes over (your routines disappear from list_triggers).
3. Call create_session with source_url https://github.com/<REPO>, title '<Project>: <Mon D>' (today's date), the default environment and model, and this prompt, verbatim, with today's date and your own session id filled in:
---
<THE TAKEOVER PROMPT BELOW, filled in>
---
4. Tell the owner the new session's id in a one-line card (SendUserFile, status proactive). Then stop starting new work and push anything unpushed: the new session archives this one as soon as it has moved the routines. Do not message the new session. If create_session fails, say exactly what failed and keep working as the current session until the owner says otherwise.
```

## The takeover prompt (the new session's first message)

```
You are the new <Project> cloud session for <REPO>, started by the session relay: the previous session made you with create_session, so the repository is checked out in your container. If it is not, call add_repo (owner <OWNER>, repo <NAME>, access push), clone it as the result says, and call register_repo_root. Read <INSTRUCTIONS_FILE, e.g. CLAUDE.md>, then <HANDOFF_DOC> on main. If main's handoff is not today's, read the open PR '<HANDOFF_PR_TITLE with today's date>' from its branch. The previous session is <PREVIOUS_SESSION_ID> (its Scheduling section names it too). Then:
(a) Run list_triggers, paging until has_more is false. For every routine whose persistent_session_id is the previous session, create the same routine (same name, prompt, schedule) aimed at yourself, then delete the old one: a paused one stays paused (update_trigger enabled false on the copy); a one-shot due within ten minutes is deleted first; if a delete is refused, switch the old one off and say so. Leave every other routine alone, the owner's own included, but name in your report any relay-looking routine aimed at another session.
(b) Only after (a): run list_triggers again and confirm no routine is still aimed at the previous session (an archived session refuses messages, so a routine left on it would fail). Then call get_session with id <PREVIOUS_SESSION_ID>: if its status_bucket is "working", leave it and try again at your next status check; otherwise call archive_session on <PREVIOUS_SESSION_ID> and no other session, and record the time in the handoff's Scheduling section. Archiving is reversible, so it needs no yes. Never delete a session. If archive_session is not available or refuses, do not improvise: list it in your report as an owner action (archive <PREVIOUS_SESSION_ID> from its ⋯ menu in the claude.ai/code sidebar).
(c) Send the owner the status report now, saying you took over, with your session id and whether the previous session was archived. Do not message the previous session; it already knows your id.
(d) If the owner started you by hand, read your own lineage (get_session) and record it in the handoff's Scheduling section.
(e) Work the handoff's "next, in order" under its standing instructions (the session-relay skill has the relay's rules).
```

## A dated task

- name: `<Project>: <what>`
- `run_once_at`: `<YYYY-MM-DDTHH:MM:SS>[<ROUTINE_TZ>]`

The prompt says what to do and why, what "done" looks like, and what to send the owner, with the exact command for any owner action. Every routine aimed at the session moves at each handover, so a dated task survives as long as its row is in the handoff's dated table too.

## Moving a routine (the takeover's step a)

`create_trigger` with the old routine's `name`, `prompt` and `cron_expression` or `run_once_at`, and no `persistent_session_id`, so it fires into the caller. Then `delete_trigger` the old id. Copy the prompt from `list_triggers`' `derived_state.prompt`, exactly. Do not move a routine that is not the previous session's, even one that looks related. Archive the previous session (the takeover's step b) only once every one of its routines has moved.
