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
  template's grants. Applied 12 Nov 2026 on the owner's "yes 0002"
  (migrate run 43265085254, expose-schema 43266956563, check-schema
  43267054372 passed; anon gets 42501 permission denied).

- `0003_admin_counts.sql`: written here (13 Nov 2026, owner: add a games
  count to the admin list), sha256
  4af07300acb6a6fbdd48a55f4e707a7b1dbc9ae5e22d89ce172c492c61710abf, to be
  copied byte for byte into pisan-labs/photo2pgn. `app_photo2pgn.admin_user_counts()`
  (service role only) gives saved games per person to the credits-grant list.

The app's own caps are set by the owner, never in its migrations
(docs/new-app-guide.md, "Spending limits").

## The reader on halflife

`halflife/install-pgn-worker-agent.sh` installs a launchd agent that keeps
photo2pgn's CLI reader (`cli/pgn-worker.mjs` in pisan-labs/photo2pgn, cloned at
`~/bitbucket/pisanuw/photo2pgn` or `~/photo2pgn`, or set `REPO=`) running
on the owner's Mac: started at login, restarted after an error exit (every 5
minutes at most), logging to `~/Library/Logs/photo2pgn-worker.log`. It checks
the site and the token (`--list`) before installing. Run on halflife:

```bash
curl -fsSL https://raw.githubusercontent.com/pisanuw/claude-built-apps/main/photo2pgn/halflife/install-pgn-worker-agent.sh -o ~/install-pgn-worker-agent.sh
bash ~/install-pgn-worker-agent.sh            # or: bash ~/install-pgn-worker-agent.sh uninstall
```
