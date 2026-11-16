-- Read-only: the sessions of lewis-alt-text's signed-in users in the last 48 hours (16 Nov 2026),
-- to tell a person's browser from a mail scanner. Email domain and browser string only:
-- no user ids, full addresses or IPs.
-- Run: Supabase admin, command sql, arg platform/supabase/ops/lewis-signin-sessions.sql
select jsonb_build_object(
  'users', (select coalesce(jsonb_agg(jsonb_build_object(
      'domain', split_part(u.email, '@', 2),
      'created', to_char(u.created_at at time zone 'UTC', 'MM-DD HH24:MI:SS'),
      'last_sign_in', to_char(u.last_sign_in_at at time zone 'UTC', 'MM-DD HH24:MI:SS'),
      'providers', u.raw_app_meta_data->'providers',
      'sessions_48h', (select coalesce(jsonb_agg(jsonb_build_object(
          'created', to_char(s.created_at at time zone 'UTC', 'MM-DD HH24:MI:SS'),
          'updated', to_char(s.updated_at at time zone 'UTC', 'MM-DD HH24:MI:SS'),
          'refreshed', to_char(s.refreshed_at at time zone 'UTC', 'MM-DD HH24:MI:SS'),
          'agent', left(s.user_agent, 140),
          'tokens', (select count(*) from auth.refresh_tokens r where r.session_id = s.id),
          'revoked', (select count(*) from auth.refresh_tokens r where r.session_id = s.id and r.revoked)
        ) order by s.created_at), '[]'::jsonb)
        from auth.sessions s where s.user_id = u.id and s.created_at >= now() - interval '48 hours')
    ) order by u.created_at), '[]'::jsonb)
    from auth.users u
    where u.id in (select a.user_id from platform.app_users a where a.app = 'lewis-alt-text')),
  'sessions_all_48h', (select count(*) from auth.sessions s where s.created_at >= now() - interval '48 hours')
)::text as diagnostics;
