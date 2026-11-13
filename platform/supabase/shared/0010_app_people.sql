-- The admin list with names (owner, 13 Nov 2026: "Yes, do what photos
-- asked": add name and a games count to photo2pgn's list). Same rows as
-- platform.app_users_report (0009), plus the person's display name from
-- platform.profiles. A new function rather than a changed one, so the
-- credits-grant deployed before this file keeps working; 0009's stays.
-- App-specific counts (photo2pgn's saved games) come from an optional
-- app_<slug>.admin_user_counts() in the app's own schema, not from here.
-- Order: apply-shared (this file), then deploy-function credits-grant.
-- Idempotent: safe to re-run.

create or replace function platform.app_people(p_app text, p_limit integer)
returns table (
  user_id uuid,
  email text,
  name text,
  first_seen timestamptz,
  last_seen timestamptz,
  user_day numeric,
  app_user_day numeric,
  app_user_week numeric,
  app_user_day_calls bigint,
  app_user_week_calls bigint,
  readings_total bigint,
  credits integer
)
language sql
stable
security definer
set search_path = platform, pg_temp
as $$
  select r.user_id, r.email, pr.display_name, r.first_seen, r.last_seen,
         r.user_day, r.app_user_day, r.app_user_week,
         r.app_user_day_calls, r.app_user_week_calls, r.readings_total, r.credits
    from platform.app_users_report(p_app, p_limit) r
    left join platform.profiles pr on pr.id = r.user_id
   order by r.last_seen desc;
$$;
comment on function platform.app_people(text, integer) is 'credits-grant list for admins: app_users_report plus the display name from platform.profiles.';
revoke all on function platform.app_people(text, integer) from public;
grant execute on function platform.app_people(text, integer) to service_role;
