-- Totals for the pisan-analytics dashboard (pisanuw/dashboards): first-party
-- analytics (0014) and, for every app, the platform's own records: people
-- who signed in (app_users) and model calls on the owner's key (llm_usage).
-- Aggregates only: no visitor ids, user ids, IPs or event rows leave the
-- database. Read through the app-events-report function, which checks a
-- shared secret (APP_EVENTS_REPORT_SECRET).
-- Service role only. Idempotent: safe to re-run.

create or replace function platform.app_events_summary(p_days integer default 30)
returns jsonb
language sql stable security definer set search_path = '' as $$
  with span as (
    select least(greatest(coalesce(p_days, 30), 1), 400) as days,
           (now() at time zone 'utc')::date - least(greatest(coalesce(p_days, 30), 1), 400) + 1 as since
  ),
  e as (
    select ev.* from platform.app_events ev, span
    where ev.at >= (span.since::timestamp at time zone 'utc')
  ),
  daily as (
    select app, (at at time zone 'utc')::date as day,
           count(*) filter (where name = 'pageview') as pageviews,
           count(distinct visitor) as visitors,
           percentile_cont(0.5) within group (order by value) filter (where name = 'engaged') as engaged_median,
           count(*) filter (where name = 'error') as errors,
           count(*) filter (where name = 'pageview' and device = 'mobile') as mobile_pageviews
    from e group by 1, 2
  ),
  totals as (
    select app,
           count(*) filter (where name = 'pageview') as pageviews,
           count(distinct (visitor, (at at time zone 'utc')::date)) as visitor_days,
           percentile_cont(0.5) within group (order by value) filter (where name = 'engaged') as engaged_median
    from e group by 1
  ),
  ranked as (
    select app, kind, label, n, row_number() over (partition by app, kind order by n desc, label) as r
    from (
      select app, 'event' as kind, name as label, count(*) as n from e where name not in ('pageview', 'engaged') group by 1, 3
      union all
      select app, 'path', path, count(*) from e where name = 'pageview' and path is not null group by 1, 3
      union all
      select app, 'referrer', referrer, count(*) from e where name = 'pageview' and referrer is not null group by 1, 3
      union all
      select app, 'outbound', props->>'host', count(*) from e where name = 'outbound' and props ? 'host' group by 1, 3
      union all
      select app, 'prop', name || ' ' || kv.key || '=' || kv.value, count(*)
      from e, jsonb_each_text(coalesce(e.props, '{}'::jsonb)) as kv
      where e.name not in ('pageview', 'engaged', 'outbound', 'error') group by 1, 3
    ) x
  ),
  people as (
    select au.app,
           count(*) as total,
           count(*) filter (where au.last_seen >= (span.since::timestamp at time zone 'utc')) as active,
           count(*) filter (where au.first_seen >= (span.since::timestamp at time zone 'utc')) as new
    from platform.app_users au, span group by au.app
  ),
  model as (
    select u.app,
           count(*) as calls,
           count(*) filter (where u.ok) as ok_calls,
           round(sum(u.cost_usd), 4) as cost_usd,
           round(sum(coalesce(u.cache_read_tokens, 0))::numeric / nullif(sum(coalesce(u.cache_read_tokens, 0) + coalesce(u.cache_write_tokens, 0) + coalesce(u.input_tokens, 0)), 0), 3) as cache_share
    from platform.llm_usage u, span
    where u.created_at >= (span.since::timestamp at time zone 'utc')
    group by u.app
  )
  select jsonb_build_object(
    'generated_at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'days', (select days from span),
    'since', (select since from span),
    'apps', (select coalesce(jsonb_agg(a.slug order by a.slug), '[]'::jsonb) from platform.analytics_apps a where a.enabled),
    'daily', (select coalesce(jsonb_agg(jsonb_build_object(
        'app', d.app, 'day', d.day, 'pageviews', d.pageviews, 'visitors', d.visitors,
        'engaged_median', round(d.engaged_median::numeric, 1), 'errors', d.errors, 'mobile_pageviews', d.mobile_pageviews)
        order by d.app, d.day), '[]'::jsonb) from daily d),
    'totals', (select coalesce(jsonb_object_agg(t.app, jsonb_build_object(
        'pageviews', t.pageviews, 'visitor_days', t.visitor_days, 'engaged_median', round(t.engaged_median::numeric, 1))), '{}'::jsonb) from totals t),
    'top', (select coalesce(jsonb_object_agg(k.app, k.lists), '{}'::jsonb) from (
        select r.app, jsonb_object_agg(r.kind, r.items) as lists from (
          select app, kind, jsonb_agg(jsonb_build_array(label, n) order by n desc, label) as items
          from ranked where r <= 20 group by app, kind) r
        group by r.app) k),
    'people', (select coalesce(jsonb_object_agg(p.app, jsonb_build_object('total', p.total, 'active', p.active, 'new', p.new)), '{}'::jsonb) from people p),
    'model', (select coalesce(jsonb_object_agg(m.app, jsonb_build_object('calls', m.calls, 'ok_calls', m.ok_calls, 'cost_usd', m.cost_usd, 'cache_share', m.cache_share)), '{}'::jsonb) from model m)
  )
$$;
comment on function platform.app_events_summary(integer) is 'Totals for pisan-analytics over the last p_days (1-400, UTC days): first-party analytics per app and day, top events/paths/referrers/outbound/props, signed-in people and model calls per app. Aggregates only. app-events-report function (service role) only.';

revoke execute on function platform.app_events_summary(integer) from public, anon, authenticated;
grant execute on function platform.app_events_summary(integer) to service_role;
