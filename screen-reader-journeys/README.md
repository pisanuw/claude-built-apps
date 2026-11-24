# Screen Reader Journeys: database migrations and the worker's deploy file

Screen Reader Journeys (https://screen-reader-journeys.hintwise.org) lives in
its own repository, pisan-labs/screen-reader-journeys. Its data sits in the
shared HintWise Supabase project, schema `app_screen_reader_journeys`, and its
migrations are applied from here with the Supabase admin workflow
(`migrate screen-reader-journeys`, then
`expose-schema app_screen_reader_journeys` and
`check-schema app_screen_reader_journeys`), so they are recorded in
`platform.migrations` like every other app's (the StepWise pattern,
`stepwise/README.md`).

Copy each migration here byte for byte from that repository (check its
sha256), never edit an applied file, and put later changes in a new
`000N_...sql` file.

- `0001_runs.sql`: from pisan-labs/screen-reader-journeys commit c2dc383
  (main), sha256
  9b55da7b0224fbf6768535ac2a828e23bc3dd9b0552663e6c878223498ef570b; owner's
  yes on 24 Nov 2026 ("SR release yes").
