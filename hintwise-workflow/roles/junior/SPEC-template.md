# <App name>: spec

- Idea: daily-project-ideas `ideas/<date>.json` #<n>.
- Customer: <who>.
- Status: draft r<N>, or approved in round <N> on <date>.

## 1. Promise

One sentence: who it is for, the job, and what changes for them.

## 2. Users and their jobs

Each kind of user, what they are trying to get done, and how they do it today.

## 3. User stories and acceptance criteria

### US-1 <title>

As a <user>, I want <capability> so that <outcome>.

- AC-1: Given <state>, when <action>, then <observable result>.
- AC-2: ...

Every acceptance criterion can be checked by a test or a Playwright step. Avoid unmeasured words such as "fast", "easy" or "intuitive": give a number or a check instead.

## 4. Screens and flows

For each screen:
- its purpose, what it shows, and what the user can do;
- its empty, loading and error states.

Then the main flow, step by step.

## 5. Data

| Table | Columns | Who reads | Who writes | Row level security, in words |
|---|---|---|---|---|

What visitors who are not signed in may see, and how (for example, a security definer function). How a user exports and deletes their data.

## 6. Platform pieces

| Need | Piece (from the architecture table) | Why |
|---|---|---|

Anything outside the table goes in section 10 as a question for the owner.

## 7. Standing requirements

| Requirement (roles/manager/standing-requirements.md) | Met by | Or not applicable, because |
|---|---|---|

## 8. Out of scope

What is deliberately left out, and why.

## 9. Risks

Each risk with its mitigation.

## 10. Open questions

Each question with a recommended default, and the tier: T2 for the owner's choice, T3 for something that needs the owner's yes.

## Change requests

Filled in later, by Manager:
- CR-<n> (<date>): the need; why it was not visible earlier; the priority; the estimate; the decision.
