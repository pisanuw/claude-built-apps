-- Read-only report of first-party analytics (shared/0014_app_events.sql) for the last 14 days:
-- per app and day, page views, visitors (daily ids, so a person counts once a day), median
-- seconds visible per page view, and the top events, paths and referrers over the period.
-- Run: Supabase admin, command sql, arg platform/supabase/ops/app-events-report.sql
with e as (
  select * from platform.app_events where at >= now() - interval '14 days'
)
select jsonb_build_object(
  'apps', (select coalesce(jsonb_agg(jsonb_build_object('slug', a.slug, 'origins', a.origins, 'enabled', a.enabled)), '[]'::jsonb) from platform.analytics_apps a),
  'by_day', (select coalesce(jsonb_agg(d order by d->>'app', d->>'day' desc), '[]'::jsonb) from (
      select jsonb_build_object(
        'app', app,
        'day', to_char(date_trunc('day', at at time zone 'UTC'), 'MM-DD'),
        'pageviews', count(*) filter (where name = 'pageview'),
        'visitors', count(distinct visitor),
        'median_engaged_s', percentile_cont(0.5) within group (order by value) filter (where name = 'engaged'),
        'mobile_share', round(avg(case when device = 'mobile' then 1.0 else 0 end) filter (where name = 'pageview'), 2),
        'errors', count(*) filter (where name = 'error')) d
      from e group by app, date_trunc('day', at at time zone 'UTC')) t),
  'top_events', (select coalesce(jsonb_object_agg(k, n), '{}'::jsonb) from (
      select app || ':' || name k, count(*) n from e where name not in ('pageview', 'engaged') group by 1 order by 2 desc limit 30) t),
  'top_paths', (select coalesce(jsonb_object_agg(k, n), '{}'::jsonb) from (
      select app || ':' || path k, count(*) n from e where name = 'pageview' group by 1 order by 2 desc limit 30) t),
  'top_referrers', (select coalesce(jsonb_object_agg(k, n), '{}'::jsonb) from (
      select app || ':' || referrer k, count(*) n from e where name = 'pageview' and referrer is not null group by 1 order by 2 desc limit 20) t),
  'search_select_kinds', (select coalesce(jsonb_object_agg(k, n), '{}'::jsonb) from (
      select coalesce(props->>'kind', '?') || ' rank ' || coalesce(props->>'rank', '?') k, count(*) n
      from e where app = 'myuni' and name = 'search_select' group by 1 order by 2 desc limit 20) t)
)::text as report;
