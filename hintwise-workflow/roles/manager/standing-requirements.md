# Standing requirements

Every spec meets each of these with acceptance criteria, or says why it does not apply. Manager proposes additions when the same change request recurs, and the owner merges them. The first three are the owner's examples of 18 November 2026; their numbers are proposals (Q 8).

| # | Requirement | Check | Source |
|---|---|---|---|
| 1 | Pages load fast | Lighthouse mobile performance at least 90 on the main pages, and largest contentful paint under 2.5 seconds | Owner, 18 Nov 2026 (the numbers are proposed) |
| 2 | Users can keep or delete their history | A signed-in user can export their data and delete it; account deletion removes it (docs/platform.md, "Account deletion") | Owner, 18 Nov 2026 |
| 3 | Bring your own key | Every model call offers the user's own key; the owner's key only through the gateway and its caps | Owner; docs/platform.md section 3 |
| 4 | Accessible | No serious issue in an accessibility-lens scan of the live page; the main flow works by keyboard and with a screen reader | BUILD_ROUTINE.md, polish |
| 5 | Works on a phone | The main flow works at 375 px width | BUILD_ROUTINE.md, polish |
| 6 | Honest states | Every screen has empty, loading and error states in plain words | BUILD_ROUTINE.md, polish |
| 7 | Google sign-in button | Matches Google's branding rules as listed in BUILD_ROUTINE.md | Owner, 10 Nov 2026 |
| 8 | Free | No payments and no pricing; a price in the idea is market research | Owner, 10 Nov 2026 |
| 9 | Email is polite | Recurring mail is opt-in with an unsubscribe link, capped per user and per day, sent from `<slug>@hintwise.org` | BUILD_ROUTINE.md, architecture table |
| 10 | No third-party tracking | Only the platform's first-party analytics, with ids and codes masked | 17 Nov 2026 analytics rollout |
| 11 | Readable for its customer | The README is written for the business owner, not a developer | BUILD_ROUTINE.md, polish |
| 12 | The footer comes from the deploy | The app adds no "built by" footer and does not make `body` a row flexbox | claude-built-apps CLAUDE.md |
