-- Read-only: is app-notify ready on the live project? (no names, no addresses)
-- Run: Supabase admin, command sql, arg platform/supabase/ops/notify-ready.sql
-- Only the last statement prints, so everything is one select.
select jsonb_build_object(
  'service_role_reads_auth_users', has_table_privilege('service_role', 'auth.users', 'select'),
  'service_role_uses_auth_schema', has_schema_privilege('service_role', 'auth', 'usage'),
  'notify_apps', to_regclass('platform.notify_apps') is not null,
  'notify_items_seen', to_regclass('platform.notify_items_seen') is not null,
  'notify_sends', to_regclass('platform.notify_sends') is not null,
  'registered_apps', (select count(*) from platform.notify_apps),
  'enabled_apps', (select count(*) from platform.notify_apps where enabled),
  'anon_reads_notify_apps', has_table_privilege('anon', 'platform.notify_apps', 'select'),
  'opted_in_is_definer', (select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'platform' and p.proname = 'notify_opted_in'),
  'authenticated_runs_opted_in', has_function_privilege('authenticated', 'platform.notify_opted_in(text)', 'execute')
)::text as notify_ready;
