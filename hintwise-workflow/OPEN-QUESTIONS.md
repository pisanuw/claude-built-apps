# Open questions

Asked on 18 November 2026. Each question has a recommendation. Questions marked "needs a yes" wait for the owner's answer. For the rest, the recommendation is taken after 15 minutes without an answer, and the undo is stated.

| # | Question | Recommendation | Status |
|---|---|---|---|
| 1 | Tomorrow (19 Nov, 11:49) the build routine starts a new project. Run it (a) the old way, (b) with a pilot of the Junior and Senior spec loop on day 1, or (c) skip a week? | (b): only day 1's planning changes, both subagents use the session's model, and the undo is reverting one commit | open |
| 2 | Where should `hintwise-workflow` live, and how visible? Sessions here cannot create repositories. | Private, `pisanuw/hintwise-workflow`. The owner creates it empty; this folder moves there with its history. | open (needs the owner) |
| 3 | Builder stops pushing to main: one branch per project, one pull request per milestone, and PManager merges and deploys at most once per app per day. | Yes. Day 1's slice then goes live at PManager's next release, not inside the build run. | open |
| 4 | Tiers instead of model names in the repository; the tier map in the routine prompts; the role-to-tier table in README.md. | Yes, with top = the most capable model, strong = the default model, fast = the cheaper model. Reviewer on top is the costliest choice; confirm it. | open |
| 5 | Two channels to the owner: PManager's "Needs you" card (about 09:00 and 18:00 Barcelona, at once only for an incident or a blocker), and Monitor's daily digest and weekly retrospective. They replace the hourly status report. | Yes | open |
| 6 | The deadline for T2 decisions (the next project, a change request beyond the budget, a spec dispute). | 24 hours, instead of 15 minutes. T3 never defaults. The 15-minute rule stays for questions in a live chat. | open |
| 7 | A GitHub approval gate (the owner as required reviewer on a GitHub environment) for the Supabase admin, domain and DNS, and Retire site workflows? | Yes for those three. App deploys stay under PManager's standing authorization. | open (needs the owner to set up) |
| 8 | Manager's budget for change requests, the standing requirements, and the portfolio targets. | Up to one build day per project without asking. Review `roles/manager/standing-requirements.md` and `roles/picker/portfolio.md`. | open |
| 9 | More roles: a Keeper for the live apps (dependency alerts, health, feedback)? Security and QA as roles? | Add Keeper in phase 3. Security stays in Reviewer and PManager's gate; QA stays in Manager. | open |
| 10 | Work in progress: one project at a time, or spec the next while building the current? | One now; overlap after two projects run cleanly | open |
| 11 | Finder's procedure: keep ROUTINE.md in daily-project-ideas, or move it here? | Keep it there for now (949 lines, tied to that repository's data and scripts); the role card here points to it | open |
