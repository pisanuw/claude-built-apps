-- Read-only, small enough for a public Actions log: events per app and name in
-- the last 2 hours (counts only), and whether platform.app_events_summary
-- (shared/0015) runs, as the sizes of what it returns.
-- Run: Supabase admin, command sql, arg platform/supabase/ops/app-events-check.sql
select jsonb_build_object(
  'last_2h', (select coalesce(jsonb_object_agg(k, n), '{}'::jsonb) from (
      select app || ':' || name k, count(*) n from platform.app_events
      where at >= now() - interval '2 hours' group by 1) t),
  'summary', (select jsonb_build_object(
      'days', s->'days', 'apps', s->'apps',
      'daily_rows', jsonb_array_length(s->'daily'),
      'top_apps', (select count(*) from jsonb_object_keys(s->'top')),
      'people_apps', (select count(*) from jsonb_object_keys(s->'people')),
      'model_apps', (select count(*) from jsonb_object_keys(s->'model')))
    from (select platform.app_events_summary(7) s) x)
)::text as check;
