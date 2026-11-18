# Senior: spec review checklist

This checklist is a floor, not a script. Every finding needs a reason and a suggested change, not just a ticked box.

## Value
- [ ] The promise is specific: a named customer, a job, a change they would notice.
- [ ] Every user story serves the promise. Anything that does not is cut or moved out of scope.
- [ ] Milestone 1 delivers the promise in its smallest useful form, end to end.

## Testability
- [ ] Every acceptance criterion is observable: a test or a Playwright step can check it.
- [ ] No criterion hides a judgment word without a number or a check.
- [ ] Every criterion belongs to exactly one milestone.

## Feasibility
- [ ] The project fits in at most seven build days on the platform, and each milestone in about a day.
- [ ] Only pieces from the architecture table are used. Anything else is an open question for the owner.
- [ ] Sign-in flows allow for links that return only to `*.hintwise.org`; tests mock sign-in.
- [ ] Scheduled work, email and files follow the platform's patterns and limits.

## Data, security and privacy
- [ ] Every table has a row level security policy in words.
- [ ] Visitors reach data only through a security definer function.
- [ ] Users can export and delete their data, and account deletion is covered.
- [ ] Only the personal data the job needs is collected, and the idea's compliance notes are answered.
- [ ] A model call goes through the gateway with bring-your-own-key, or is replaced by deterministic code.

## Completeness
- [ ] Every screen has empty, loading and error states.
- [ ] Each standing requirement is met by a criterion, or marked "not applicable" with a reason.
- [ ] Out of scope is explicit, every risk has a mitigation, and every open question has a default.
- [ ] Nothing in it adds payments, a new provider or a shared setting.
