# RankedVote: database migrations only

RankedVote (https://ranked-voting.hintwise.org) lives in its own repository,
pisanuw/ranked-voting. Its data sits in the shared HintWise Supabase project,
schema `app_ranked_voting`, and its migrations are applied from here with the
Supabase admin workflow (`migrate ranked-voting`, then
`expose-schema app_ranked_voting` and `check-schema app_ranked_voting`), so
they are recorded in `platform.migrations` like every other app's (the
StepWise pattern, `stepwise/README.md`).

Copy each migration here byte for byte from that repository (check its
sha256), never edit an applied file, and put later changes in a new
`000N_...sql` file.

- `0001_app_ranked_voting.sql`: from pisanuw/ranked-voting branch
  `fix/rankedvote-shared-supabase` at b505374 (draft pull request, under
  review), sha256
  ae7184e624ea2267a6158f58f94b78bf86832ccd6226bfe17e58815bb0529ecb. Not
  applied. Creates the schema with six tables (contests, contest_options,
  allowed_voters, votes, vote_rankings, vote_comments), row level security on
  each, and seven functions; anon may execute only `get_contest`,
  `submit_vote` and `contest_ballots` (voting by code, anonymous ballots,
  results after voting) and has no table access. No service-role key; no
  `public` table. RankedVote's own project was deleted on 27 Nov 2026 (owner,
  "rv deleted"), so the schema starts empty. If review changes the file in
  that repository, copy it here again and update the sha256 before anything
  is applied.

Email sign-in and "Delete my account" for the app need `ranked-voting` in
`EXTERNAL_APP_LABELS` (`platform/src/signin/validate.ts`), then
`deploy-function sign-in-link` and `deploy-function delete-account`.
