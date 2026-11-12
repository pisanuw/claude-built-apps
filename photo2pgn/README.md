# photo2pgn: database migrations only

photo2pgn (https://photo2pgn.hintwise.org) lives in its own repository,
pisan-labs/photo2pgn. Its first migration registers it with the LLM gateway;
the second keeps signed-in visitors' saved games ("My games"; no photos). Migrations are applied from here
with the Supabase admin workflow (`migrate photo2pgn`), so they are recorded in
`platform.migrations` like every other app's (the StepWise pattern,
`stepwise/README.md`).

Copy each migration here byte for byte from that repository (check its
sha256), never edit an applied file, and put later changes in a new
`000N_...sql` file.

- `0001_init.sql`: from pisan-labs/photo2pgn commit ecb94a5 (branch
  claude/chess-pgn-converter-app-rdsh9n), sha256
  1832745baede240370edaa68bda49eb3b38ea7e13cc892e57e81b7eeed1bb3fc. Only
  `insert into platform.llm_apps (slug) values ('photo2pgn') on conflict do
  nothing`: the row already exists with the owner's caps
  (`platform/supabase/ops/photo2pgn-llm-caps.sql`, 12 Nov), so applying it
  changes nothing but the migration record. Applied 12 Nov 2026 on the
  owner's yes (Supabase admin run 43257164982).

- `0002_games.sql`: from pisan-labs/photo2pgn main at fae34d9a, sha256
  eed2943bfacdf8f5103d651b3eab8cd96a7726de648428a065c53931563f14e9. Creates
  schema `app_photo2pgn` with one table, `games` (own-row RLS for
  `authenticated`, nothing for `anon`, rows deleted with the account), the
  template's grants. **Not applied yet:** waits for the owner's yes, then
  `migrate photo2pgn`, `expose-schema app_photo2pgn` and
  `check-schema app_photo2pgn`. Until then the app keeps games on the device.

The app's own caps are set by the owner, never in its migrations
(docs/new-app-guide.md, "Spending limits").
