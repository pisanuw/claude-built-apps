-- Retire teacher-catalog-kit (owner, 11 Nov 2026: "take it down" after the
-- build was aborted on day 1). Run with the Supabase admin workflow: first
-- `unexpose-schema app_teacher_catalog_kit`, then `sql` with this file.
-- Drops only this app's schema (its tables, policies and trigger functions;
-- the foreign keys to auth.users go with them) and its rows in the migration
-- record, so nothing else in the shared project changes. Idempotent.
drop schema if exists app_teacher_catalog_kit cascade;
delete from platform.migrations where app = 'teacher-catalog-kit';
select
  (select count(*) from pg_namespace where nspname = 'app_teacher_catalog_kit') as schema_left,
  (select count(*) from platform.migrations where app = 'teacher-catalog-kit') as migrations_left;
