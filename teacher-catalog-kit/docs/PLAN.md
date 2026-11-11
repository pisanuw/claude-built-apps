# Teacher Catalog Kit: build plan

Written on day 1 (2026-11-11) from the idea's `buildPlan`, then kept current:
a milestone that grows gets split here, a milestone that proves unnecessary is
struck through with the reason.

## Goal

One catalog that tells a teacher-author which of their resources they may sell
on which stores, and at what price, under their marketplace seller tier
(Exclusive or Basic), and helps them move or cross-list the ones they keep
outside. Customer: teacher-authors with roughly 50 to 500 resources who sell,
or are deciding whether to sell, on Payhip, Etsy, Shopify, TES or their own
site as well as Teachers Pay Teachers. Idea: daily-project-ideas
`ideas/2026-11-10.json` #1, "Off-TPT Catalog Kit for Teacher-Authors".

Name: the folder, subdomain and product name avoid the marketplace's
trademark (as donation-receipts did with Xero). The app names Teachers Pay
Teachers only to say what it works with, and says it is not affiliated.

## Shape

Marks (from the idea):

- **stateful**: the seller keeps a saved master catalog (every resource, its
  type, its marketplace price and every other store it is listed on) and
  returns to it each time they list something new.
- **connected**: imports the marketplace's own Product Statistics and Sales
  Details CSV downloads; exports a Shopify product CSV and listing packs for
  Payhip and TES.
- **unattended**: a weekly job checks the updated date of the marketplace's
  two seller-rule help articles and emails opted-in sellers when either
  changes, plus reminders before the 31 December 2026 Exclusive decision and
  the 1 January 2027 Basic conversion.
- **engine**: applies the rules per resource and per store: the Exclusive
  table of product types allowed off the marketplace and the Basic rule to
  keep prices consistent across platforms.

Platform needs, from the architecture table in BUILD_ROUTINE.md:

| Need | Piece | Milestone |
|---|---|---|
| Sign-in | Supabase Auth (Google and email link) through `src/lib/auth.ts`'s panel | 1 |
| Database | Schema `app_teacher_catalog_kit`, RLS own rows: `resources` (one row per resource, its other-store listings as a bounded jsonb array) and `seller_settings` (tier, reminder opt-in) | 1 |
| Browser-only use | Without sign-in the catalog lives in localStorage on this device, so the checker works as a free lead magnet with no account | 1 |
| Scheduled work + app email | Weekly rule watch and two dated reminders, sent from `teacher-catalog-kit@hintwise.org` with an unsubscribe link and per-user caps (Resend from server code only) | 5 |
| LLM | None: the rules are a table and an equality check; listing text is the seller's own. Deterministic code does the job. | none |
| Files | None: the app never stores the seller's resource files, only their names in the listing-pack checklist | none |
| Render backend | None: no long-running server | none |

## Milestones

Each is about one build day. Milestone 1 is deployable on day 1.

| # | Milestone | Delivers (what a user can do) | Acceptance (testable) |
|---|---|---|---|
| 1 | One resource, one verdict | Pick a tier (Exclusive, Basic, or undecided to see both), add a resource with its product type, marketplace price and the other stores it is on with their prices, and see whether it breaks the Exclusive or Basic rules. Saved in the browser, or in the account after sign-in. | A signed-in user saves a resource; a digital worksheet listed on Payhip under Exclusive is flagged, a clip-art set is not; a Basic listing at a different price is flagged; deployed. |
| 2 | Catalog import | Upload the marketplace's Product Statistics CSV and get a saved catalog of every resource with its price; edit types in bulk. | A 300-row sample CSV imports with no lost rows; rows survive sign-out and sign-in; a second upload of the same file creates no duplicates. |
| 3 | Where-is-it-sold matrix and price parity | A matrix of resources by store with conflicts and price mismatches, filters, and a decision summary (what Exclusive would make you remove, what Basic would make you reprice). | Seeded data with three mismatched prices and two Exclusive conflicts shows exactly those five flags. |
| 4 | Listing packs and Shopify CSV | Download a Shopify product CSV (digital, no shipping) and step-by-step Payhip and TES listing packs (title, description, tags, price, file checklist) for selected resources. | The Shopify CSV has Shopify's documented header and one row per product; packs contain every selected resource. |
| 5 | Rule watch and decision reminders | Opt in to a weekly check of the marketplace's two rule articles and an email when either changes; reminders before 31 December and 1 January. | A seeded change in an article's updated date produces exactly one email per opted-in user; each reminder fires once on its date; unsubscribe works. |
| 6 | Sales roll-up | Upload marketplace Sales Details, Payhip and Etsy order CSVs and see revenue per resource per store. | Totals for a sample month match a hand-worked spreadsheet to the cent. |
| 7 | Polish and finish | README for the seller, phone layout, keyboard and screen-reader pass, empty and error states, Playwright walkthrough, then the finish checklist | Walkthrough green from adding a resource to the CSV export; accessibility-lens scan has no serious issue; Step 5 of BUILD_ROUTINE.md done |

If the feature milestones finish early, polish and finish split into two days
as BUILD_ROUTINE.md describes.

## Out of scope

- Etsy API publishing (commercial API access reported locked in 2026).
- Scraping marketplace listings or pages other than the two public rule
  articles' updated dates.
- Sales-tax advice (the app may say which store collects tax, nothing more).
- Payments: the app is free (owner, 10 November 2026).
- Storing the seller's resource files.

## Risks

- The marketplace changes its rules again: the rule table lives in one file
  (`src/core/rules.ts`) with the date it was checked and the source URLs; the
  rule watch (milestone 5) tells sellers and the maintainer when to re-check.
- The CSV headers of the Product Statistics and Sales Details downloads are
  not published: the importer maps columns by name with aliases and lets the
  seller confirm the mapping, as Qualified Overtime Checker does.
- Milestone 5 needs server code that can email opted-in users with no one
  signed in. Apps never get the service-role key, so the job must go through
  a narrow security definer function or the platform's planned app-notify
  sender (HANDOFF.md section 5). Decided on day 5 with the owner (open
  question in HANDOFF.md).
- Email to users needs a postal address in the footer before the first
  recurring send (CAN-SPAM; HANDOFF.md section 6 item 3).
- The decision window closes on 31 December 2026: milestones 1 to 4 ship
  first; the rest serves Basic sellers after 1 January.
