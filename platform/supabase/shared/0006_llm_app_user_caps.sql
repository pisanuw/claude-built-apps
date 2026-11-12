-- Per-app limits for one user (owner, 12 Nov 2026: "its own limits inside
-- the HintWise gateway"; "the project might have stricter limits").
--
-- platform.llm_apps already holds each app's own day, week and month caps.
-- cap_user_day_usd counts a user's spend across every app. This adds two
-- optional caps that count only the user's spend in this app, per UTC day
-- and per ISO week. Null means no such cap (every existing app keeps its
-- behaviour). An app gets stricter limits by setting lower numbers, for
-- example:
--
--   update platform.llm_apps
--      set cap_day_usd = 1, cap_week_usd = 5, cap_month_usd = 10,
--          cap_app_user_day_usd = 0.10, cap_app_user_week_usd = 0.40
--    where slug = 'photo2pgn';
--
-- The gateway reads the sums from platform.llm_spend_app_user. The older
-- platform.llm_spend stays, so a gateway deployed before this file keeps
-- working. Order: apply-shared (this file), then deploy-gateway.
-- Idempotent: safe to re-run.

alter table platform.llm_apps add column if not exists cap_app_user_day_usd numeric;
alter table platform.llm_apps add column if not exists cap_app_user_week_usd numeric;
comment on column platform.llm_apps.cap_app_user_day_usd is 'Optional cap on one user''s spend in this app per UTC day (null: none). Checked besides cap_user_day_usd, which counts all apps.';
comment on column platform.llm_apps.cap_app_user_week_usd is 'Optional cap on one user''s spend in this app per ISO week, Monday 00:00 UTC (null: none).';

create or replace function platform.llm_spend_app_user(p_app text, p_user uuid)
returns table (
  app_day numeric,
  app_week numeric,
  app_month numeric,
  user_day numeric,
  app_user_day numeric,
  app_user_week numeric
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
    coalesce(sum(u.cost_usd) filter (where u.app = p_app and u.user_id = p_user and u.created_at >= b.w), 0)::numeric as app_user_week
  from b
  left join platform.llm_usage u
    on u.created_at >= least(b.w, b.m)
   and (u.app = p_app or u.user_id = p_user)
  group by b.d, b.w, b.m;
$$;
comment on function platform.llm_spend_app_user(text, uuid) is 'Spend in USD for the app (UTC day, ISO week, month), for the user across all apps (UTC day), and for the user in this app (UTC day, ISO week); used by the gateway before each call.';

revoke all on function platform.llm_spend_app_user(text, uuid) from public;
grant execute on function platform.llm_spend_app_user(text, uuid) to service_role;
