-- heard-as-check: first migration (rename to 0001_init.sql). Schema app_heard_as_check, where
-- heard-as-check has dashes replaced by underscores (donation-receipts ->
-- app_donation_receipts). Applied by the Deploy workflow when
-- deploy/target.yml has `supabase: true`, through
-- `node platform/supabase-admin.mjs migrate <slug>`, then the schema is
-- exposed with `expose-schema app_heard_as_check`. Write it idempotently; a migration
-- that has run must never change (the migrate command refuses a changed
-- file): add 0002_<name>.sql instead.

create schema if not exists app_heard_as_check;
comment on schema app_heard_as_check is 'heard-as-check: per-user data; dropping the schema retires the app.';

-- One example table. Every table carries user_id with the auth.uid() default
-- so the browser never sends it, and row level security keeps rows per user.
create table if not exists app_heard_as_check.notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null,
  body text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table app_heard_as_check.notes is 'Example table: one note per row, owned by user_id.';
create index if not exists notes_user_created_idx on app_heard_as_check.notes (user_id, created_at);

alter table app_heard_as_check.notes enable row level security;

drop policy if exists notes_select_own on app_heard_as_check.notes;
create policy notes_select_own on app_heard_as_check.notes for select to authenticated using (user_id = auth.uid());
drop policy if exists notes_insert_own on app_heard_as_check.notes;
create policy notes_insert_own on app_heard_as_check.notes for insert to authenticated with check (user_id = auth.uid());
drop policy if exists notes_update_own on app_heard_as_check.notes;
create policy notes_update_own on app_heard_as_check.notes for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists notes_delete_own on app_heard_as_check.notes;
create policy notes_delete_own on app_heard_as_check.notes for delete to authenticated using (user_id = auth.uid());

-- Signed-in users only; anonymous visitors get no grants in app schemas.
grant usage on schema app_heard_as_check to authenticated;
grant all on all tables in schema app_heard_as_check to authenticated;
grant all on all sequences in schema app_heard_as_check to authenticated;
alter default privileges in schema app_heard_as_check grant all on tables to authenticated;
alter default privileges in schema app_heard_as_check grant all on sequences to authenticated;

-- Optional: register the app for the LLM gateway (the owner's key behind the
-- default caps: $2/day, $10/week, $20/month per app, $0.25/day per user).
-- insert into platform.llm_apps (slug) values ('heard-as-check') on conflict do nothing;
