-- Who has used each app (owner, 13 Nov 2026: "photo2pgn admin should be able
-- to list all users that ever logged into photo2pgn along with how much free
-- and paid credits they have").
--
-- Sign-in is shared by every HintWise app, and sign_in_requests keeps only
-- keyed email hashes (Google sign-ins do not pass through it), so no table
-- said which app a person signed in to. From now on the gateway records it:
-- platform.app_seen on every check ({app, check: true}, which an app calls on
-- sign-in) and every call. This file also fills it in from what already
-- shows a person used an app: gateway calls and credits. An app can add its
-- own evidence with an ops file (ops/photo2pgn-app-users-backfill.sql).
--
-- platform.app_users_report feeds the credits-grant function's list for
-- admins: each person's email, first and last seen, the counts the free
-- allowance is computed from, readings ever, and paid credits.
--
-- Account deletion (shared/0004) deletes app_users rows with the account.
-- Order: apply-shared (this file), then deploy-gateway and deploy-function
-- credits-grant. Idempotent: safe to re-run.

create table if not exists platform.app_users (
  user_id uuid not null references auth.users(id) on delete cascade,
  app text not null references platform.llm_apps(slug),
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  primary key (user_id, app)
);
comment on table platform.app_users is 'Who has used each app: first and last time the gateway saw them (a check or a call), plus a backfill from earlier calls and credits. Written by the service role only.';
create index if not exists app_users_app_idx on platform.app_users (app, last_seen desc);
alter table platform.app_users enable row level security;
revoke all on table platform.app_users from public, anon, authenticated;
grant select, insert, update on table platform.app_users to service_role;

-- Backfill: earlier gateway calls, credit balances and ledger rows.
insert into platform.app_users (user_id, app, first_seen, last_seen)
select u.user_id, u.app, min(u.created_at), max(u.created_at)
  from platform.llm_usage u
  join auth.users au on au.id = u.user_id
 group by u.user_id, u.app
on conflict (user_id, app) do update
  set first_seen = least(platform.app_users.first_seen, excluded.first_seen),
      last_seen = greatest(platform.app_users.last_seen, excluded.last_seen);

insert into platform.app_users (user_id, app, first_seen, last_seen)
select c.user_id, c.app, c.updated_at, c.updated_at
  from platform.credits c
on conflict (user_id, app) do nothing;

insert into platform.app_users (user_id, app, first_seen, last_seen)
select l.user_id, l.app, min(l.created_at), max(l.created_at)
  from platform.credit_ledger l
 where l.user_id is not null
 group by l.user_id, l.app
on conflict (user_id, app) do update
  set first_seen = least(platform.app_users.first_seen, excluded.first_seen);

-- The gateway: note that this person used this app now.
create or replace function platform.app_seen(p_app text, p_user uuid)
returns void
language sql
volatile
security definer
set search_path = platform, pg_temp
as $$
  insert into platform.app_users (user_id, app) values (p_user, p_app)
  on conflict (user_id, app) do update set last_seen = now();
$$;
comment on function platform.app_seen(text, uuid) is 'Gateway: record that a person used an app (first_seen once, last_seen every time).';
revoke all on function platform.app_seen(text, uuid) from public;
grant execute on function platform.app_seen(text, uuid) to service_role;

-- credits-grant's list for admins: one row per person who used the app,
-- most recent first, with the person sums the free allowance is computed
-- from (same rules as llm_spend_and_calls: calls paid with a credit are left
-- out) and their paid credits.
create or replace function platform.app_users_report(p_app text, p_limit integer)
returns table (
  user_id uuid,
  email text,
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
  with b as (
    select date_trunc('day', now(), 'UTC') as d, date_trunc('week', now(), 'UTC') as w
  ),
  people as (
    select au.user_id, au.first_seen, au.last_seen
      from platform.app_users au
     where au.app = p_app
     order by au.last_seen desc
     limit greatest(1, least(coalesce(p_limit, 500), 2000))
  )
  select
    p.user_id,
    u.email::text,
    p.first_seen,
    p.last_seen,
    coalesce((select sum(x.cost_usd) from platform.llm_usage x, b
               where x.user_id = p.user_id and not x.paid_with_credit and x.created_at >= b.d), 0)::numeric,
    coalesce((select sum(x.cost_usd) from platform.llm_usage x, b
               where x.app = p_app and x.user_id = p.user_id and not x.paid_with_credit and x.created_at >= b.d), 0)::numeric,
    coalesce((select sum(x.cost_usd) from platform.llm_usage x, b
               where x.app = p_app and x.user_id = p.user_id and not x.paid_with_credit and x.created_at >= b.w), 0)::numeric,
    (select count(*) from platform.llm_usage x, b
      where x.app = p_app and x.user_id = p.user_id and x.ok and not x.paid_with_credit and x.created_at >= b.d),
    (select count(*) from platform.llm_usage x, b
      where x.app = p_app and x.user_id = p.user_id and x.ok and not x.paid_with_credit and x.created_at >= b.w),
    (select count(*) from platform.llm_usage x where x.app = p_app and x.user_id = p.user_id and x.ok),
    coalesce((select c.balance from platform.credits c where c.user_id = p.user_id and c.app = p_app), 0)
  from people p
  join auth.users u on u.id = p.user_id
  order by p.last_seen desc;
$$;
comment on function platform.app_users_report(text, integer) is 'credits-grant list for admins: people who used the app (most recent first, up to 2000), their email, first and last seen, the person sums behind the free allowance, readings ever and paid credits.';
revoke all on function platform.app_users_report(text, integer) from public;
grant execute on function platform.app_users_report(text, integer) to service_role;
