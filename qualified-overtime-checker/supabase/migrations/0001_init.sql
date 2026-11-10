-- qualified-overtime-checker: saved client files (milestone 2).
-- Applied by the Deploy workflow (deploy/target.yml has `supabase: true`)
-- through `node platform/supabase-admin.mjs migrate qualified-overtime-checker`,
-- then the schema is exposed with `expose-schema app_qualified_overtime_checker`.
-- Idempotent; once applied it must never change: add 0002_<name>.sql instead.
--
-- One row per employer file a signed-in user saves. `data` is the encoded
-- file (src/core/codec.ts): settings, employees, dated hours and pay rates,
-- the payroll's TT figures. Social Security numbers are dropped by the
-- importer before a file exists, so they never reach this table.

create schema if not exists app_qualified_overtime_checker;
comment on schema app_qualified_overtime_checker is 'Qualified Overtime Checker: saved client files per user; dropping the schema retires the app.';

create table if not exists app_qualified_overtime_checker.client_files (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null default '',
  tax_year integer not null,
  summary jsonb not null default '{}'::jsonb,
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table app_qualified_overtime_checker.client_files is 'One employer file (hours, rates, payroll TT figures) owned by user_id; no SSNs.';
create index if not exists client_files_user_updated_idx on app_qualified_overtime_checker.client_files (user_id, updated_at desc);

alter table app_qualified_overtime_checker.client_files enable row level security;

drop policy if exists client_files_select_own on app_qualified_overtime_checker.client_files;
create policy client_files_select_own on app_qualified_overtime_checker.client_files for select to authenticated using (user_id = auth.uid());
drop policy if exists client_files_insert_own on app_qualified_overtime_checker.client_files;
create policy client_files_insert_own on app_qualified_overtime_checker.client_files for insert to authenticated with check (user_id = auth.uid());
drop policy if exists client_files_update_own on app_qualified_overtime_checker.client_files;
create policy client_files_update_own on app_qualified_overtime_checker.client_files for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists client_files_delete_own on app_qualified_overtime_checker.client_files;
create policy client_files_delete_own on app_qualified_overtime_checker.client_files for delete to authenticated using (user_id = auth.uid());

-- Signed-in users only; anonymous visitors get no grants in app schemas.
grant usage on schema app_qualified_overtime_checker to authenticated;
grant all on all tables in schema app_qualified_overtime_checker to authenticated;
grant all on all sequences in schema app_qualified_overtime_checker to authenticated;
alter default privileges in schema app_qualified_overtime_checker grant all on tables to authenticated;
alter default privileges in schema app_qualified_overtime_checker grant all on sequences to authenticated;
