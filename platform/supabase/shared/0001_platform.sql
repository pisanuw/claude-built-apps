-- HintWise shared platform schema (docs/platform.md, section 1).
--
-- Applied by `node platform/supabase-admin.mjs apply-shared`, which records
-- the file's sha256 in platform.migrations. Everything here is idempotent
-- (create if not exists, create or replace, drop policy if exists) so a
-- re-run is harmless. The project is shared with live apps: this file only
-- adds objects in its own schema; it never alters the auth schema.

create schema if not exists platform;
comment on schema platform is 'HintWise shared platform: profiles, LLM gateway apps and ledger, migration log (docs/platform.md).';

-- ---------------------------------------------------------------------------
-- profiles: one row per auth user, created by platform.ensure_profile()
-- ---------------------------------------------------------------------------

create table if not exists platform.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  created_at timestamptz default now()
);
comment on table platform.profiles is 'One row per auth user, written by platform.ensure_profile() after sign-in; a user reads and updates only their own row.';
comment on column platform.profiles.display_name is 'From the Google profile (full_name or name) or the part of the email before @; the user may change it.';

-- No trigger on auth.users: the project is shared with live apps and Supabase
-- does not let this role add triggers to its auth tables ("must be owner of
-- relation users", 9 Nov). An app calls platform.ensure_profile() after
-- sign-in instead (platform/templates/app/src/lib/auth.ts does).
create or replace function platform.ensure_profile()
returns platform.profiles
language plpgsql
security definer
set search_path = platform, pg_temp
as $$
declare
  uid uuid := auth.uid();
  u record;
  p platform.profiles;
begin
  if uid is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  select email, raw_user_meta_data into u from auth.users where id = uid;
  insert into platform.profiles (id, email, display_name)
  values (
    uid,
    u.email,
    coalesce(
      u.raw_user_meta_data ->> 'full_name',
      u.raw_user_meta_data ->> 'name',
      split_part(coalesce(u.email, ''), '@', 1)
    )
  )
  on conflict (id) do update set email = excluded.email
  returning * into p;
  return p;
end;
$$;
comment on function platform.ensure_profile() is 'Creates or refreshes the signed-in user''s platform.profiles row and returns it; apps call it after sign-in (security definer, search_path pinned).';
revoke all on function platform.ensure_profile() from public;

-- ---------------------------------------------------------------------------
-- llm_apps: one row per app that may use the owner's key through the gateway
-- ---------------------------------------------------------------------------

create table if not exists platform.llm_apps (
  slug text primary key,
  enabled boolean not null default true,
  default_model text not null default 'claude-opus-5-5',
  allowed_models text[] not null default '{claude-opus-5-5,claude-sonnet-5-5,claude-haiku-5-5}',
  cap_day_usd numeric not null default 2,
  cap_week_usd numeric not null default 10,
  cap_month_usd numeric not null default 20,
  cap_user_day_usd numeric not null default 0.25,
  max_tokens int not null default 4096,
  created_at timestamptz default now()
);
comment on table platform.llm_apps is 'Apps allowed to call the LLM gateway with the owner''s key, with their models and spending caps in USD; the owner edits caps with SQL.';
comment on column platform.llm_apps.cap_user_day_usd is 'Cap on one user''s spend per UTC day across all apps (the gateway sums the user''s llm_usage rows regardless of app).';

-- ---------------------------------------------------------------------------
-- llm_usage: the ledger, one row per gateway call (service role only)
-- ---------------------------------------------------------------------------

create table if not exists platform.llm_usage (
  id bigint generated always as identity primary key,
  app text not null references platform.llm_apps(slug),
  user_id uuid references auth.users(id) on delete set null,
  model text not null,
  input_tokens int,
  output_tokens int,
  cache_read_tokens int,
  cache_write_tokens int,
  cost_usd numeric(10,6) not null default 0,
  ok boolean not null default true,
  error text,
  created_at timestamptz not null default now()
);
comment on table platform.llm_usage is 'Ledger of gateway calls on the owner''s key: tokens, cost from the pricing table, ok or the upstream error; written only by the gateway (service role).';

create index if not exists llm_usage_app_created_idx on platform.llm_usage (app, created_at);
comment on index platform.llm_usage_app_created_idx is 'Speeds the per-app day/week/month sums in platform.llm_spend.';
create index if not exists llm_usage_user_created_idx on platform.llm_usage (user_id, created_at);
comment on index platform.llm_usage_user_created_idx is 'Speeds the per-user day sum in platform.llm_spend.';

-- ---------------------------------------------------------------------------
-- migrations: which SQL files have run, per app ("platform" for this folder)
-- ---------------------------------------------------------------------------

create table if not exists platform.migrations (
  app text not null,
  file text not null,
  sha256 text not null,
  applied_at timestamptz default now(),
  primary key (app, file)
);
comment on table platform.migrations is 'Migration log kept by platform/supabase-admin.mjs: app slug (or platform), file name and the sha256 of its content when applied.';

-- ---------------------------------------------------------------------------
-- llm_spend: sums for the gateway's cap check (UTC day, ISO week, month)
-- ---------------------------------------------------------------------------

create or replace function platform.llm_spend(p_app text, p_user uuid)
returns table (app_day numeric, app_week numeric, app_month numeric, user_day numeric)
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
    coalesce(sum(u.cost_usd) filter (where u.user_id = p_user and u.created_at >= b.d), 0)::numeric as user_day
  from b
  left join platform.llm_usage u
    on u.created_at >= least(b.w, b.m)
   and (u.app = p_app or u.user_id = p_user)
  group by b.d, b.w, b.m;
$$;
comment on function platform.llm_spend(text, uuid) is 'Spend in USD for the app over the current UTC day, ISO week and calendar month, and for the user over the UTC day (all apps); used by the gateway before each call.';
revoke all on function platform.llm_spend(text, uuid) from public;

-- ---------------------------------------------------------------------------
-- llm_usage_report: per-app summary for the daily email and the admin workflow
-- ---------------------------------------------------------------------------

create or replace function platform.llm_usage_report(p_days int default 1)
returns jsonb
language sql
stable
security definer
set search_path = platform, pg_temp
as $$
  with b as (
    select date_trunc('day', now(), 'UTC') as today,
           date_trunc('day', now(), 'UTC') - make_interval(days => greatest(coalesce(p_days, 1), 1)) as period_start,
           date_trunc('week', now(), 'UTC') as week_start,
           date_trunc('month', now(), 'UTC') as month_start,
           greatest(coalesce(p_days, 1), 1) as period_days
  ),
  per_app as (
    select a.slug, a.enabled, a.default_model, a.allowed_models,
           a.cap_day_usd, a.cap_week_usd, a.cap_month_usd, a.cap_user_day_usd, a.max_tokens,
           jsonb_build_object(
             'calls', count(u.id) filter (where u.created_at >= b.period_start and u.created_at < b.today),
             'users', count(distinct u.user_id) filter (where u.created_at >= b.period_start and u.created_at < b.today),
             'cost_usd', coalesce(sum(u.cost_usd) filter (where u.created_at >= b.period_start and u.created_at < b.today), 0),
             'errors', count(u.id) filter (where u.created_at >= b.period_start and u.created_at < b.today and not u.ok)
           ) as period,
           jsonb_build_object(
             'calls', count(u.id) filter (where u.created_at >= b.week_start),
             'users', count(distinct u.user_id) filter (where u.created_at >= b.week_start),
             'cost_usd', coalesce(sum(u.cost_usd) filter (where u.created_at >= b.week_start), 0),
             'errors', count(u.id) filter (where u.created_at >= b.week_start and not u.ok)
           ) as week,
           jsonb_build_object(
             'calls', count(u.id) filter (where u.created_at >= b.month_start),
             'users', count(distinct u.user_id) filter (where u.created_at >= b.month_start),
             'cost_usd', coalesce(sum(u.cost_usd) filter (where u.created_at >= b.month_start), 0),
             'errors', count(u.id) filter (where u.created_at >= b.month_start and not u.ok)
           ) as month
    from platform.llm_apps a
    cross join b
    left join platform.llm_usage u
      on u.app = a.slug
     and u.created_at >= least(b.period_start, b.week_start, b.month_start)
    group by a.slug, a.enabled, a.default_model, a.allowed_models,
             a.cap_day_usd, a.cap_week_usd, a.cap_month_usd, a.cap_user_day_usd, a.max_tokens,
             b.today, b.period_start, b.week_start, b.month_start
  )
  select jsonb_build_object(
    'generated_at', now(),
    'period_days', b.period_days,
    'period_start', b.period_start,
    'period_end', b.today,
    'week_start', b.week_start,
    'month_start', b.month_start,
    'apps', coalesce((
      select jsonb_agg(jsonb_build_object(
        'slug', p.slug,
        'enabled', p.enabled,
        'default_model', p.default_model,
        'allowed_models', to_jsonb(p.allowed_models),
        'max_tokens', p.max_tokens,
        'caps', jsonb_build_object(
          'day_usd', p.cap_day_usd, 'week_usd', p.cap_week_usd,
          'month_usd', p.cap_month_usd, 'user_day_usd', p.cap_user_day_usd),
        'period', p.period,
        'week', p.week,
        'month', p.month
      ) order by p.slug)
      from per_app p
    ), '[]'::jsonb)
  )
  from b;
$$;
comment on function platform.llm_usage_report(int) is 'Per-app calls, distinct users, cost and errors for the last p_days UTC days before today, the ISO week to date and the month to date, with the caps; feeds the daily usage email.';
revoke all on function platform.llm_usage_report(int) from public;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table platform.profiles enable row level security;
alter table platform.llm_apps enable row level security;
alter table platform.llm_usage enable row level security;    -- no policies: service role only
alter table platform.migrations enable row level security;   -- no policies: service role only

drop policy if exists profiles_select_own on platform.profiles;
create policy profiles_select_own on platform.profiles
  for select to authenticated using (id = auth.uid());
comment on policy profiles_select_own on platform.profiles is 'A signed-in user reads their own profile row.';

drop policy if exists profiles_update_own on platform.profiles;
create policy profiles_update_own on platform.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
comment on policy profiles_update_own on platform.profiles is 'A signed-in user updates their own profile row (display_name only, by the column grant).';

drop policy if exists llm_apps_select_authenticated on platform.llm_apps;
create policy llm_apps_select_authenticated on platform.llm_apps
  for select to authenticated using (true);
comment on policy llm_apps_select_authenticated on platform.llm_apps is 'Signed-in users may read which apps use the gateway and their caps (no secrets here).';

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

grant usage on schema platform to anon, authenticated, service_role;
grant select on platform.llm_apps to authenticated;
grant select on platform.profiles to authenticated;
grant update (display_name) on platform.profiles to authenticated;
grant all on all tables in schema platform to service_role;
grant all on all sequences in schema platform to service_role;
grant execute on function platform.ensure_profile() to authenticated;
grant execute on function platform.llm_spend(text, uuid) to service_role;
grant execute on function platform.llm_usage_report(int) to service_role;
