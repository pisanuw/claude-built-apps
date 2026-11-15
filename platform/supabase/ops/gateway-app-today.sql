-- Read-only diagnostics for one app's gateway calls today and Auth activity since 16:00 UTC
-- (udebt, 15 Nov 2026). Times, statuses and counts only: no user ids, emails, IPs or contents.
-- Run: Supabase admin, command sql, arg platform/supabase/ops/gateway-app-today.sql
select jsonb_build_object(
  'llm_usage_udebt_today', (select coalesce(jsonb_agg(jsonb_build_object(
      'at', to_char(u.created_at at time zone 'UTC', 'HH24:MI:SS'),
      'ok', u.ok, 'model', u.model, 'in', u.input_tokens, 'out', u.output_tokens,
      'cost', u.cost_usd, 'error', left(u.error, 160)) order by u.created_at), '[]'::jsonb)
    from platform.llm_usage u
    where u.app = 'udebt' and u.created_at >= date_trunc('day', now() at time zone 'UTC') at time zone 'UTC'),
  'auth_actions_since_1600_utc', (select coalesce(jsonb_object_agg(a, n), '{}'::jsonb) from (
      select coalesce(e.payload->>'action', '?') a, count(*) n
      from auth.audit_log_entries e
      where e.created_at >= '2026-11-15 16:00:00+00'
      group by 1) t),
  'auth_actions_by_minute', (select coalesce(jsonb_agg(jsonb_build_object('at', m, 'action', a, 'n', n) order by m), '[]'::jsonb) from (
      select to_char(date_trunc('minute', e.created_at) at time zone 'UTC', 'HH24:MI') m,
             coalesce(e.payload->>'action', '?') a, count(*) n
      from auth.audit_log_entries e
      where e.created_at >= '2026-11-15 16:00:00+00'
      group by 1, 2) t),
  'sessions_touched_since_1600', (select count(*) from auth.sessions s where s.updated_at >= '2026-11-15 16:00:00+00'),
  'refresh_tokens_revoked_since_1600', (select count(*) from auth.refresh_tokens r where r.revoked and r.updated_at >= '2026-11-15 16:00:00+00')
)::text as diagnostics;
