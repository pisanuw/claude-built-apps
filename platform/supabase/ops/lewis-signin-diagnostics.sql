-- Read-only diagnostics for lewis-alt-text sign-in reports (16 Nov 2026): gateway calls,
-- who-used counts, sign-in link requests and Auth activity in the last 48 hours.
-- Times, outcomes and counts only: no user ids, emails, IPs or contents.
-- Run: Supabase admin, command sql, arg platform/supabase/ops/lewis-signin-diagnostics.sql
select jsonb_build_object(
  'now_utc', to_char(now() at time zone 'UTC', 'YYYY-MM-DD HH24:MI'),
  'llm_usage_lewis_48h', (select coalesce(jsonb_agg(jsonb_build_object(
      'at', to_char(u.created_at at time zone 'UTC', 'MM-DD HH24:MI:SS'),
      'ok', u.ok, 'model', u.model, 'in', u.input_tokens, 'out', u.output_tokens,
      'cache_read', u.cache_read_tokens, 'cache_write', u.cache_write_tokens,
      'cost', u.cost_usd, 'error', left(u.error, 160)) order by u.created_at), '[]'::jsonb)
    from platform.llm_usage u
    where u.app = 'lewis-alt-text' and u.created_at >= now() - interval '48 hours'),
  'app_users_lewis', (select jsonb_build_object('n', count(*),
      'first', to_char(min(a.first_seen) at time zone 'UTC', 'MM-DD HH24:MI'),
      'last', to_char(max(a.last_seen) at time zone 'UTC', 'MM-DD HH24:MI'))
    from platform.app_users a where a.app = 'lewis-alt-text'),
  'sign_in_requests_lewis_48h', (select coalesce(jsonb_agg(jsonb_build_object(
      'at', to_char(r.created_at at time zone 'UTC', 'MM-DD HH24:MI:SS'),
      'outcome', r.outcome, 'detail', left(r.detail, 120)) order by r.created_at), '[]'::jsonb)
    from platform.sign_in_requests r
    where r.app = 'lewis-alt-text' and r.created_at >= now() - interval '48 hours'),
  'sign_in_requests_all_apps_24h', (select coalesce(jsonb_object_agg(k, n), '{}'::jsonb) from (
      select coalesce(r.app, '?') || ':' || r.outcome k, count(*) n
      from platform.sign_in_requests r
      where r.created_at >= now() - interval '24 hours' group by 1) t),
  'auth_actions_by_minute_24h', (select coalesce(jsonb_agg(jsonb_build_object('at', m, 'action', a, 'provider', p, 'n', n) order by m), '[]'::jsonb) from (
      select to_char(date_trunc('minute', e.created_at) at time zone 'UTC', 'MM-DD HH24:MI') m,
             coalesce(e.payload->>'action', '?') a,
             coalesce(e.payload->'traits'->>'provider', '') p,
             count(*) n
      from auth.audit_log_entries e
      where e.created_at >= now() - interval '24 hours'
      group by 1, 2, 3) t),
  'flow_states_24h', (select coalesce(jsonb_agg(jsonb_build_object(
      'at', to_char(f.created_at at time zone 'UTC', 'MM-DD HH24:MI:SS'),
      'provider', f.provider_type, 'method', f.authentication_method,
      'used', f.auth_code_issued_at is not null) order by f.created_at), '[]'::jsonb)
    from auth.flow_state f where f.created_at >= now() - interval '24 hours'),
  'refresh_tokens_revoked_24h', (select count(*) from auth.refresh_tokens r where r.revoked and r.updated_at >= now() - interval '24 hours')
)::text as diagnostics;
