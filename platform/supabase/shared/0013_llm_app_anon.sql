-- Anonymous gateway use, per app (owner, 15 Nov 2026, "1a" to the UDebt
-- session's option A): an app's own server code may call llm-gateway for
-- visitors who are not signed in, all of them counted as one stand-in user.
-- The app's server sends `x-hintwise-app-key: <secret>` (never a browser: the
-- header is not in the CORS allow list). The gateway compares the secret's
-- sha256 with key_sha256 here and then acts as user_id, so every cap applies
-- to that one user: the per-person caps become the visitors' shared allowance,
-- inside the app's own caps.
-- A row exists only for an app the owner switched on (admin command
-- `anon-setup <slug> --key-sha256=<hex>`; `anon-off <slug>` removes it).
-- Service role only: RLS on, no policies, no grants.
-- Idempotent: safe to re-run.

create table if not exists platform.llm_app_anon (
  slug text primary key references platform.llm_apps(slug) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  key_sha256 text not null check (key_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now()
);
comment on table platform.llm_app_anon is 'Apps whose server may call the LLM gateway for visitors who are not signed in, all counted as one stand-in user (user_id); key_sha256 is the sha256 of the app''s secret (x-hintwise-app-key). Service role only.';

alter table platform.llm_app_anon enable row level security;
revoke all on platform.llm_app_anon from public, anon, authenticated;
