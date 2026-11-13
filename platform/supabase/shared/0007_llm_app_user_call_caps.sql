-- Per-app limits for one user counted in calls, not dollars (owner, 13 Nov
-- 2026: "2 yes 3/9", count photo2pgn's free allowance in readings). One
-- successful gateway call is one reading; failed calls (ok = false) do not
-- count. The app-wide caps stay in dollars and remain the ceiling on the
-- owner's key.
--
-- Two optional columns on platform.llm_apps, null meaning no such cap (every
-- existing app keeps its behaviour):
--   cap_app_user_day_calls   calls by one user in this app per UTC day
--   cap_app_user_week_calls  calls by one user in this app per ISO week
--
-- The gateway reads the sums and counts from platform.llm_spend_and_calls.
-- platform.llm_spend_app_user (0006) stays, so a gateway deployed before this
-- file keeps working. Order: apply-shared (this file), then deploy-gateway.
-- Idempotent: safe to re-run.

alter table platform.llm_apps add column if not exists cap_app_user_day_calls integer;
alter table platform.llm_apps add column if not exists cap_app_user_week_calls integer;
comment on column platform.llm_apps.cap_app_user_day_calls is 'Optional cap on one user''s successful calls in this app per UTC day (null: none).';
comment on column platform.llm_apps.cap_app_user_week_calls is 'Optional cap on one user''s successful calls in this app per ISO week, Monday 00:00 UTC (null: none).';

create or replace function platform.llm_spend_and_calls(p_app text, p_user uuid)
returns table (
  app_day numeric,
  app_week numeric,
  app_month numeric,
  user_day numeric,
  app_user_day numeric,
  app_user_week numeric,
  app_user_day_calls bigint,
  app_user_week_calls bigint
)
language sql
stable
security definer
set search_path = platform, pg_temp
as $$
  with b as (
    select date_trunc('day', now(), 'UTC') as d,
           date_trunc('week', now(), 'UTC') as w,
           date_trunc('month', now(), 'UTC') as m
  )
  select
    coalesce(sum(u.cost_usd) filter (where u.app = p_app and u.created_at >= b.d), 0)::numeric as app_day,
    coalesce(sum(u.cost_usd) filter (where u.app = p_app and u.created_at >= b.w), 0)::numeric as app_week,
    coalesce(sum(u.cost_usd) filter (where u.app = p_app and u.created_at >= b.m), 0)::numeric as app_month,
    coalesce(sum(u.cost_usd) filter (where u.user_id = p_user and u.created_at >= b.d), 0)::numeric as user_day,
    coalesce(sum(u.cost_usd) filter (where u.app = p_app and u.user_id = p_user and u.created_at >= b.d), 0)::numeric as app_user_day,
    coalesce(sum(u.cost_usd) filter (where u.app = p_app and u.user_id = p_user and u.created_at >= b.w), 0)::numeric as app_user_week,
    count(*) filter (where u.app = p_app and u.user_id = p_user and u.ok and u.created_at >= b.d) as app_user_day_calls,
    count(*) filter (where u.app = p_app and u.user_id = p_user and u.ok and u.created_at >= b.w) as app_user_week_calls
  from b
  left join platform.llm_usage u
    on u.created_at >= least(b.w, b.m)
   and (u.app = p_app or u.user_id = p_user)
  group by b.d, b.w, b.m;
$$;
comment on function platform.llm_spend_and_calls(text, uuid) is 'Spend in USD for the app (UTC day, ISO week, month), for the user across all apps (UTC day), and for the user in this app (UTC day, ISO week), plus the user''s successful calls in this app (UTC day, ISO week); used by the gateway before each call and by its check mode.';

revoke all on function platform.llm_spend_and_calls(text, uuid) from public;
grant execute on function platform.llm_spend_and_calls(text, uuid) to service_role;
