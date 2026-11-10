# StepWise: database migrations only

StepWise (https://stepwise.hintwise.org) lives in its own repository,
pisan-labs/visualizing-data-structures. Its data sits in the shared HintWise
Supabase project, schema `app_stepwise`, and its migrations are applied from
here with the Supabase admin workflow (`migrate stepwise`, then
`expose-schema app_stepwise` and `check-schema app_stepwise`), so they are
recorded in `platform.migrations` like every other app's.

Copy each migration here byte for byte from that repository (check its
sha256), never edit an applied file, and put later changes in a new
`000N_...sql` file.

- `0001_saved_examples.sql`: from visualizing-data-structures commit 4dc76e7
  (branch next), sha256
  5deb9b0088c55481a53d4bf685cbd2484486dc3c28f3d37e39595d955672bebd; owner's
  yes on 10 Nov 2026.
- `0002_preferences.sql`: from visualizing-data-structures (branch next),
  sha256 73cf806781250dde4519d72da4b5ad6ab9438cca90d73c224762ffa2e6e39131;
  owner's yes on 10 Nov 2026. It grants service_role select on
  `preferences` and update of `notify_new_pages` only, for the platform's
  opt-in app emails.
- `0003_lesson_lists.sql`: from visualizing-data-structures commit 081c8ed
  (branch next), sha256
  5c88485f0ba1456f7fe94b28b4e418868fab63db23aab07cf15c6b28429ef844; owner's
  yes on 10 Nov 2026.
