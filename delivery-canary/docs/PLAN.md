# Delivery Canary: build plan

Written on day 1 (2026-11-12). The idea has no `buildPlan` (it predates
2026-11-10), so this plan follows the same rules: 5 to 7 milestones, each
about a day, milestone 1 a deployable vertical slice, the last ones polish
and finish. A milestone that grows gets split here; one that proves
unnecessary is struck through with the reason.

## Goal

Tell a digital-product shop owner, before their customers do, when the
download email stops arriving, lands in Promotions or Spam, or links to a
broken or wrong file. Customer: solo creators and small studios selling
patterns, ebooks, presets, templates and printables from their own Shopify
shop with a delivery app (Shopify Digital Products, Sky Pilot, Filemonk,
BIG Digital Downloads, SendOwl). Idea: daily-project-ideas
`ideas/2026-11-08.json` #3, "Delivery Canary for Digital Shops".

Picked on 2026-11-12 from tier a (category Small Business Ops, the buyer is
the shop owner). No eligible idea is validated, so the higher score won: 19,
ahead of Pay-Run Cover Check and Deposits Register (18). Name: folder and
subdomain `delivery-canary`, with no marketplace trademark in the domain.

## Shape

The idea predates the `shape` field, so the marks are judged here against
the rubric in daily-project-ideas ROUTINE.md:

- **stateful**: the shop keeps a history of every check (placement, arrival
  time, link result) and a baseline of the right file, and comes back to it
  each week.
- **connected**: reads the shop's own Shopify orders (CSV export first, the
  Admin API with the shop's own app credentials later) and the shop's own
  seed Gmail mailbox.
- **unattended**: a scheduled canary order and mailbox check, a digest email
  and an instant alert when a check fails.
- **engine**: a MIME and header parser (SPF, DKIM, DMARC and alignment,
  transit time from the Received chain), per-delivery-app link extraction, a
  link follower with SSRF guard that hashes the file and compares it with
  the baseline, and the unfulfilled-order rules.
- shared: no (one role, the shop owner).

Four marks, so substantial.

Platform needs, from the architecture table in BUILD_ROUTINE.md:

| Need | Piece | From milestone |
|---|---|---|
| Sign-in | Supabase Auth (Google and email link) through the template's `src/lib/auth.ts` panel | 1 |
| Database | Schema `app_delivery_canary`, RLS own rows: `shops`, `checks`, `link_tests` (rate-limit log) | 1 |
| Server function | Netlify Function `api` at `/api/*`: `/api/link-check` follows a download link with an SSRF guard and returns status, type, size and SHA-256 (a browser cannot read another site's file). Acts with the signed-in user's token. | 1 |
| Shop credentials at rest | The seed mailbox app password and the Shopify app credentials, encrypted (AES-GCM) in the function with a key only Netlify holds (open question 1) | 3 |
| Scheduled work | Netlify Scheduled Function (first use with this runner; verify) for the weekly canary and digest | 5 |
| App email | Resend from the function only, sender `Delivery Canary <delivery-canary@hintwise.org>`, opt-in, unsubscribe link, per-user and per-day caps | 5 |
| LLM | None: header rules, link tests and order rules are deterministic. | none |
| Files | None: the app never keeps the shop's files, only their size and hash. | none |
| Render backend | None: every server step fits a short function call. | none |

## Milestones

| # | Milestone | Delivers (what a user can do) | Acceptance (testable) |
|---|---|---|---|
| 1 | Delivery email check | Drop in a delivery email (.eml, or pasted "Show original" source) and say where it landed; see which delivery app sent it, SPF/DKIM/DMARC and alignment, transit time, every download link found, and a link test (status, file type, size, SHA-256) compared with the shop's saved baseline file. Findings in plain words with a fix for each. Signed in, each check is saved to the shop's history. A sample email works without signing in. | The sample email gives a known verdict; a DKIM fail, an unaligned signature, a Spam placement and a 404 link each produce their finding; a signed-in check is saved and listed; the function refuses private addresses and anonymous callers; deployed. |
| 2 | Unfulfilled digital order scan | Upload Shopify's Orders CSV export and see paid orders whose items need no shipping and are still unfulfilled after a grace period, ready to resend from the delivery app; customer emails and addresses are dropped at import. Saved scans. | A sample export with three late digital orders, one shipped order and one refunded order flags exactly the three; no email or address reaches the database; re-uploading the same file adds no duplicate scan rows. |
| 3 | Seed mailbox connection | Connect a seed Gmail account with a Google app password (kept encrypted); "Check my seed inbox now" finds the newest delivery email from the shop and reads its Gmail placement (Inbox, Promotions, Spam) and arrival time, then runs the milestone 1 check on it. | Against a recorded IMAP session, Inbox, Promotions and Spam placements are read correctly; the stored password is never returned to the browser; a wrong password gives a plain-words error. |
| 4 | Shopify connection and canary order | Connect the shop with its own app credentials (read_orders, write_draft_orders), pick the canary product, and place a free, tagged canary order to the seed address; the app then waits for the email and records time to arrive. The unfulfilled scan can read orders through the API instead of a CSV. | Against a recorded Admin API session, a 100%-off draft order is created with the canary tag and the seed email, completed, and the check records its arrival; scopes beyond the two are refused. |
| 5 | Schedule and alerts | Weekly (or daily) canary per shop run unattended; a digest email and an instant alert when a check fails or lands in Spam; placement trend over time. | A simulated week runs exactly one canary per shop; a failing check sends exactly one alert; the per-day cap holds; the unsubscribe link stops mail. |
| 6 | Polish | README for the shop owner, phone layout, keyboard and screen-reader pass, Google button against the branding rules, empty and error states, Playwright walkthrough, security review, demo GIF | Walkthrough green from the sample email to the saved check; accessibility-lens scan of the live page has no serious issue |
| 7 | Finish | Catalog row, PROJECTS.md write-up, mirror files, implemented.json, portfolio | Live check and the finish checklist in BUILD_ROUTINE.md |

If the feature milestones finish early, polish and finish split into two days
as written; if one grows, it is split here first.

## Out of scope

- Placement in Outlook, Yahoo or other mailbox providers (one Gmail seed is a
  proxy; the report says so).
- Bandwidth forecasting and licence-key stock (no API exposes them).
- WooCommerce and Etsy (Etsy delivers files itself).
- Automatic resending of failed deliveries.
- Payments: the app is free (owner, 10 November 2026).

## Risks

- A draft order completed through the API may not trigger some delivery apps
  (a 2021 report says Shopify's old app ignored one): milestone 4 says so on
  the page, records "no email arrived" as its own outcome, and keeps the
  manual route (the shop places a 100%-off order and the app checks the
  mailbox) working from milestone 3.
- Delivery email formats change: link extraction falls back to every link
  with download words or a file extension, and a parse failure is reported as
  "could not find the download link", never as a pass.
- Each canary download uses the shop's bandwidth and download limits: one
  small canary product, weekly by default, one download per check.
- The link test fetches arbitrary URLs from a server: SSRF guard on every
  hop (public addresses, web ports only), sign-in required, 30 tests an hour
  per user, 25 MB and 8 seconds per test.
- Shopify's custom-app route has changed (since 2026 new apps are made in
  the Dev Dashboard): milestone 4 checks the current steps before building
  (open question 2).
