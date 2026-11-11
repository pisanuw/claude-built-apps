# Teacher Catalog Kit: handoff (ABORTED after day 1 and taken down, 2026-11-11)

> **Aborted by the owner on 2026-11-11 and taken down: do not develop this
> further.** The build routine must not resume or re-pick it (the
> implemented.json placeholder was removed; the repo HANDOFF.md section 14
> lists it under aborted builds). Removed on 2026-11-11 at the owner's
> request: the Netlify site and teacher-catalog-kit.hintwise.org, schema
> app_teacher_catalog_kit and its migration records, `deploy/target.yml`, the
> CI job and the sign-in host. The code stays here only as a record; the
> sections below describe it as it was.

Rewritten at the end of every build day by the build routine
(BUILD_ROUTINE.md). It is the only state the next day's session has, and the
document the owner pastes into any other session to continue the work.

## Resume prompt

> Continue building `teacher-catalog-kit` in pisanuw/claude-built-apps (branch
> main; run `git config core.hooksPath .git-hooks`). Read
> `teacher-catalog-kit/HANDOFF.md`, `teacher-catalog-kit/docs/PLAN.md`,
> `docs/platform.md` and the repo CLAUDE.md, then work the next milestone as
> BUILD_ROUTINE.md Step 3 describes: implement with tests, review, push to
> main, update this handoff.

## Goal and customer

Idea: daily-project-ideas `ideas/2026-11-10.json` idea 1, "Off-TPT Catalog
Kit for Teacher-Authors" (folder, subdomain and name avoid the marketplace's
trademark, as donation-receipts did with Xero). Buyer: a teacher-author who
sells their own resources, paying from store income. Promise: one catalog that
tells you which of your products you may sell where, and at what price, under
your Teachers Pay Teachers seller tier. Shape marks: stateful, connected,
unattended, engine.

## What is live

- https://teacher-catalog-kit.hintwise.org (first deploy 2026-11-11 15:28 UTC,
  commit cc76e70; migration 0001 applied, check-schema passed): pick a tier
  (or both), add a resource with its type, TPT price and other stores, see
  the Exclusive and Basic verdicts live, edit and delete; the catalog stays
  in the browser, or in the account after Google or email-link sign-in, with
  a "copy this browser's catalog to my account" button.
- Not live yet: milestones 2 to 7.

## Milestones (docs/PLAN.md)

| # | Milestone | Status | Day | Notes |
|---|---|---|---|---|
| 1 | One resource, one verdict | done | 1 | tier picker, resource form with live verdict, list with both tiers, browser or account storage, copy browser catalog to account |
| 2 | Catalog import (TPT Product Statistics CSV) | next | | headers unconfirmed: map by name with aliases and let the seller confirm (QOC's importer pattern); dedupe by `tpt_id` (unique index exists) |
| 3 | Where-is-it-sold matrix and price parity | | | |
| 4 | Listing packs and Shopify CSV | | | Shopify's current header list is in "Decisions" |
| 5 | Rule watch and decision reminders | | | needs open question 1 |
| 6 | Sales roll-up | | | |
| 7 | Polish and finish | | | |

## How to run and verify

```bash
cd teacher-catalog-kit && npm ci && npm run lint && npm run typecheck && npm run coverage && npm run build
npm run dev          # http://localhost:5173 (browser storage only without .env)
PW_CHROMIUM=/opt/pw-browsers/chromium npm run e2e   # Playwright walkthrough (cloud sessions need PW_CHROMIUM)
```

Tests: 117 vitest (coverage 99.8% statements, 97.2% branches), 1 Playwright walkthrough. Live
check: `curl -s https://teacher-catalog-kit.hintwise.org/ | grep -c "Teacher Catalog Kit"`
and `| grep -c "Want something like this"` (the footer).

## Platform use

- Supabase schema `app_teacher_catalog_kit`: tables `resources` (one row per
  resource; other-store listings as a jsonb array of at most 20; caps: 2,000
  resources per account, title 300, notes 2,000 chars) and `seller_settings`
  (one row per user: tier). RLS own rows on both, grants to `authenticated`
  only. Migration `supabase/migrations/0001_init.sql`, applied by the Deploy
  workflow (`supabase: true`).
- Sign-in: Google and email link through the template's panel
  (`src/lib/auth.ts`, sign-in-link function; the app is in
  `platform/src/signin/app-hosts.ts` since day 1).
- LLM: none (deterministic rules).
- Email, scheduled jobs: none yet (milestone 5).
- Env names (values never here): VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY
  (public, in target.yml).

## Decisions and why

- 2026-11-11: picked from tier a (Small Business Ops). The same tier's
  delivery-canary-for-digital-shops (2026-11-08, also 19, older) was passed
  over: it needs a Shopify app and the Gmail API, two new providers that need
  the owner's yes, so it cannot be built unattended.
- 2026-11-11: the rules (src/core/rules.ts) follow TPT's seller blog post of
  1 October 2026 (fetched): Exclusive may sell off TPT clip art and fonts,
  physical products, courses/PD, Boom Cards, Kindle books; not digital
  education resources, licences to them, or memberships that include them.
  Free off-TPT is allowed; charging on TPT for something free elsewhere is not
  (both tiers). The help-center articles refused automated fetching (403), so
  Basic's wording ("TPT buyers are not being charged a higher price") comes
  from a search snippet: a lower price elsewhere is a conflict, a higher one a
  note. Boom Cards and Kindle are allowed only on Boom Learning and Amazon KDP;
  elsewhere the app says "check".
- 2026-11-11: own website under Exclusive: a conflict, with the blog's way out
  (a Buy button that goes to the TPT store, or free).
- 2026-11-11: signed-out sellers keep the catalog in localStorage, so the
  checker works without an account (the idea's lead magnet); after sign-in the
  page offers to copy the browser catalog to the account and then clears it.
- 2026-11-11: Shopify product CSV (milestone 4), from help.shopify.com: new
  headers start "Title, URL handle, Description, Vendor, Product category,
  Type, Tags, Published on online store, Status, SKU, ..., Price, ...,
  Inventory tracker, ..., Requires shipping, ..."; only Title is required for
  new products; digital = `Requires shipping` false and `Inventory tracker`
  blank. TES and Payhip have no bulk import (listing packs are the right
  output).
- 2026-11-11: TPT dates: Exclusive sign-up by 31 December 2026 11:59 pm ET;
  ex-Premium accounts become Basic on 1 January 2027; Exclusive 77.5% payout,
  $59.95 a year (seller blog).

## Tried and rejected

- Fetching help.teacherspayteachers.com: 403 to WebFetch, and a browser
  user-agent workaround was refused as bot-check circumvention.

## Open questions for the owner

1. Milestone 5 (the weekly rule watch and the two reminder emails) needs code
   that emails opted-in sellers when nobody is signed in, and apps never hold
   the service-role key. Recommendation: build it on the platform's planned
   app-notify sender (HANDOFF.md section 5 item 3), with this app publishing
   its notices as a feed; that also needs the postal address in the email
   footer (section 6 item 3). Default taken on day 5 if unanswered: build the
   watch and the in-app notices, and leave the email send behind app-notify,
   listed under Remaining.
2. Could someone with a TPT seller account export one Product Statistics CSV
   and one Sales Details CSV (any small store) and drop the header rows into
   the repo or chat? Recommendation: yes, if it is easy; the column names are
   not published anywhere. Default: the importer guesses columns from aliases
   and asks the seller to confirm the mapping.

## Remaining and known issues

- Milestones 2 to 7.
- The rule text from the two TPT help articles is unconfirmed word for word
  (see Decisions); re-check in a normal browser before the polish day.

## Key files

- `src/core/rules.ts`: the rule table, sources, dates and the check.
- `src/core/types.ts`: the data model and `normalizeResource` (every stored row is re-checked).
- `src/store/catalog.ts`: MemoryCatalog, LocalCatalog (localStorage), SupabaseCatalog.
- `src/ui/app.ts`: the page; `src/main.ts` wires sign-in and stores.
- `supabase/migrations/0001_init.sql`: schema, RLS, caps.

## Log

- Day 1 (2026-11-11): picked and claimed the idea, plan, scaffold, milestone 1 built, reviewed (10 code findings fixed, no security findings), deployed and checked live; sign-in-link redeployed with the new host.
- 2026-11-11: aborted by the owner after day 1; no further development.
- 2026-11-11: taken down at the owner's request (site, DNS, schema, CI job, deploy target, sign-in host).
