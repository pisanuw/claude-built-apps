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
