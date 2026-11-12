# photo2pgn: database migrations only

photo2pgn (https://photo2pgn.hintwise.org) lives in its own repository,
pisan-labs/photo2pgn. It stores nothing per user in Supabase; its only
migration registers it with the LLM gateway. Migrations are applied from here
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

The app's own caps are set by the owner, never in its migrations
(docs/new-app-guide.md, "Spending limits").
