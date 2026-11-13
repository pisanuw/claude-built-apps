-- Credits for the HintWise key (owner, 13 Nov 2026: "1 yes"; designed with
-- the photo2pgn session). One credit is one successful gateway call in one
-- app. A person's credits are spent only once their free allowance (the
-- per-person caps) is used up; the app-wide caps stay the ceiling and are
-- never skipped. Payment comes later (slice 2); for now an admin grants
-- credits with the credits-grant function.
--
--   platform.admins         who may grant credits; written only by the
--                           Supabase admin workflow ("admin add"), never by apps
--   platform.credits        one balance per person per app; a person reads
--                           their own rows (RLS)
--   platform.credit_ledger  every change: grant, purchase, spend, refund; a
--                           person reads their own rows; kept, without the
--                           person, when the account is deleted
--   llm_usage.paid_with_credit
--                           a call paid with a credit counts for the app caps
--                           but not for the person's own caps
--
-- Account deletion (shared/0004) finds these foreign keys by itself: credits
-- and admins rows are deleted, ledger user_id and actor are set to null.
-- Order: apply-shared (this file), then deploy-gateway and
-- deploy-function credits-grant. Idempotent: safe to re-run.

alter table platform.llm_usage add column if not exists paid_with_credit boolean not null default false;
comment on column platform.llm_usage.paid_with_credit is 'True when the call was paid with one of the person''s credits (platform.credits): counted for the app caps, not for the person''s.';

create table if not exists platform.admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  added_at timestamptz not null default now()
);
comment on table platform.admins is 'HintWise admins: may grant credits (credits-grant). Written only by the Supabase admin workflow (admin add/remove) with the service role.';
alter table platform.admins enable row level security;
revoke all on table platform.admins from public, anon, authenticated;
grant select, insert, delete on table platform.admins to service_role;

create table if not exists platform.credits (
  user_id uuid not null references auth.users(id) on delete cascade,
  app text not null references platform.llm_apps(slug),
  balance integer not null default 0 check (balance >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, app)
);
comment on table platform.credits is 'Credits per person per app: one credit is one successful gateway call once the free allowance is used up. Changed only by the credit_* functions (service role).';
alter table platform.credits enable row level security;
drop policy if exists credits_select_own on platform.credits;
create policy credits_select_own on platform.credits for select to authenticated using (user_id = auth.uid());
revoke all on table platform.credits from public, anon, authenticated;
grant select on table platform.credits to authenticated;
grant select on table platform.credits to service_role;

create table if not exists platform.credit_ledger (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete set null,
  app text not null references platform.llm_apps(slug),
  kind text not null check (kind in ('grant', 'purchase', 'spend', 'refund')),
  credits integer not null,
  balance_after integer not null,
  note text,
  actor uuid references auth.users(id) on delete set null,
  ref text,
  created_at timestamptz not null default now()
);
comment on table platform.credit_ledger is 'Every credit change, signed (credits) with the balance after it. kind purchase rows keep their ref (the payment id) unique; rows stay, without the person, when the account is deleted.';
create unique index if not exists credit_ledger_purchase_ref_idx on platform.credit_ledger (ref) where kind = 'purchase';
create index if not exists credit_ledger_user_idx on platform.credit_ledger (user_id, created_at);
alter table platform.credit_ledger enable row level security;
drop policy if exists credit_ledger_select_own on platform.credit_ledger;
create policy credit_ledger_select_own on platform.credit_ledger for select to authenticated using (user_id = auth.uid());
revoke all on table platform.credit_ledger from public, anon, authenticated;
grant select on table platform.credit_ledger to authenticated;
grant select on table platform.credit_ledger to service_role;

-- The person's own sums leave out calls paid with a credit (same signature
-- and columns as in 0007, so create or replace keeps the gateway working).
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
    coalesce(sum(u.cost_usd) filter (where u.user_id = p_user and not u.paid_with_credit and u.created_at >= b.d), 0)::numeric as user_day,
    coalesce(sum(u.cost_usd) filter (where u.app = p_app and u.user_id = p_user and not u.paid_with_credit and u.created_at >= b.d), 0)::numeric as app_user_day,
    coalesce(sum(u.cost_usd) filter (where u.app = p_app and u.user_id = p_user and not u.paid_with_credit and u.created_at >= b.w), 0)::numeric as app_user_week,
    count(*) filter (where u.app = p_app and u.user_id = p_user and u.ok and not u.paid_with_credit and u.created_at >= b.d) as app_user_day_calls,
    count(*) filter (where u.app = p_app and u.user_id = p_user and u.ok and not u.paid_with_credit and u.created_at >= b.w) as app_user_week_calls
  from b
  left join platform.llm_usage u
    on u.created_at >= least(b.w, b.m)
   and (u.app = p_app or u.user_id = p_user)
  group by b.d, b.w, b.m;
$$;
comment on function platform.llm_spend_and_calls(text, uuid) is 'Spend in USD for the app (UTC day, ISO week, month), for the user across all apps (UTC day), and for the user in this app (UTC day, ISO week), plus the user''s successful calls in this app (UTC day, ISO week); the user''s figures leave out calls paid with a credit. Used by the gateway before each call and by its check mode.';
revoke all on function platform.llm_spend_and_calls(text, uuid) from public;
grant execute on function platform.llm_spend_and_calls(text, uuid) to service_role;

-- Take one credit before a call (atomic: two calls at once cannot spend the
-- same credit). Returns the balance after, or null when there is none.
create or replace function platform.credit_reserve(p_app text, p_user uuid)
returns integer
language plpgsql
volatile
security definer
set search_path = platform, pg_temp
as $$
declare
  b integer;
begin
  update platform.credits
     set balance = balance - 1, updated_at = now()
   where user_id = p_user and app = p_app and balance > 0
  returning balance into b;
  if b is null then
    return null;
  end if;
  insert into platform.credit_ledger (user_id, app, kind, credits, balance_after, note)
  values (p_user, p_app, 'spend', -1, b, 'gateway call');
  return b;
end;
$$;
comment on function platform.credit_reserve(text, uuid) is 'Gateway: take one credit before a call paid with a credit; returns the balance after, or null when the person has none.';
revoke all on function platform.credit_reserve(text, uuid) from public;
grant execute on function platform.credit_reserve(text, uuid) to service_role;

-- Give the credit back when the call failed.
create or replace function platform.credit_refund(p_app text, p_user uuid, p_note text)
returns integer
language plpgsql
volatile
security definer
set search_path = platform, pg_temp
as $$
declare
  b integer;
begin
  insert into platform.credits as c (user_id, app, balance)
  values (p_user, p_app, 1)
  on conflict (user_id, app) do update set balance = c.balance + 1, updated_at = now()
  returning balance into b;
  insert into platform.credit_ledger (user_id, app, kind, credits, balance_after, note)
  values (p_user, p_app, 'refund', 1, b, left(p_note, 200));
  return b;
end;
$$;
comment on function platform.credit_refund(text, uuid, text) is 'Gateway: give back the credit of a call that failed; returns the balance after.';
revoke all on function platform.credit_refund(text, uuid, text) from public;
grant execute on function platform.credit_refund(text, uuid, text) to service_role;

-- An admin's grant (credits-grant): add or remove credits for the account
-- with this email. Refuses an unknown email (P0002) and a balance below 0
-- (P0001 'below zero'); credits 0 only reads the balance.
create or replace function platform.credit_grant(p_app text, p_email text, p_credits integer, p_note text, p_actor uuid)
returns table (user_id uuid, email text, balance integer)
language plpgsql
volatile
security definer
set search_path = platform, pg_temp
as $$
#variable_conflict use_column
declare
  uid uuid;
  mail text;
  b integer;
begin
  select u.id, u.email::text into uid, mail
    from auth.users u
   where lower(u.email) = lower(trim(p_email))
   limit 1;
  if uid is null then
    raise exception 'no account with that email' using errcode = 'P0002';
  end if;
  if not exists (select 1 from platform.llm_apps a where a.slug = p_app) then
    raise exception 'no such app' using errcode = 'P0002';
  end if;
  if p_credits = 0 then
    select c.balance into b from platform.credits c where c.user_id = uid and c.app = p_app;
    return query select uid, mail, coalesce(b, 0);
    return;
  end if;
  select c.balance into b from platform.credits c where c.user_id = uid and c.app = p_app for update;
  if coalesce(b, 0) + p_credits < 0 then
    raise exception 'below zero' using errcode = 'P0001';
  end if;
  -- The check (balance >= 0) applies to an insert's own row before any
  -- conflict, so an existing balance is updated, never upserted.
  if b is null then
    insert into platform.credits (user_id, app, balance) values (uid, p_app, p_credits);
    b := p_credits;
  else
    update platform.credits c set balance = c.balance + p_credits, updated_at = now()
     where c.user_id = uid and c.app = p_app
    returning c.balance into b;
  end if;
  insert into platform.credit_ledger (user_id, app, kind, credits, balance_after, note, actor)
  values (uid, p_app, 'grant', p_credits, b, left(p_note, 200), p_actor);
  return query select uid, mail, b;
end;
$$;
comment on function platform.credit_grant(text, text, integer, text, uuid) is 'credits-grant: add (or with a negative number remove) credits for the account with this email, logged with the admin as actor; refuses an unknown email and a balance below 0.';
revoke all on function platform.credit_grant(text, text, integer, text, uuid) from public;
grant execute on function platform.credit_grant(text, text, integer, text, uuid) to service_role;

-- The Supabase admin workflow's "admin add|remove|list" (service role).
-- The email never leaves the database: the answer is the count and the
-- action taken.
create or replace function platform.admin_set(p_action text, p_email text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = platform, pg_temp
as $$
declare
  uid uuid;
  n integer;
begin
  if p_action = 'list' then
    return jsonb_build_object('ok', true, 'admins', (select count(*) from platform.admins));
  end if;
  if p_action not in ('add', 'remove') then
    raise exception 'action must be add, remove or list' using errcode = '22023';
  end if;
  select u.id into uid from auth.users u where lower(u.email) = lower(trim(p_email)) limit 1;
  if uid is null then
    return jsonb_build_object('ok', false, 'error', 'no account with that email: sign in to a HintWise app first');
  end if;
  if p_action = 'add' then
    insert into platform.admins (user_id) values (uid) on conflict do nothing;
  else
    delete from platform.admins a where a.user_id = uid;
  end if;
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'action', p_action, 'changed', n, 'admins', (select count(*) from platform.admins));
end;
$$;
comment on function platform.admin_set(text, text) is 'Supabase admin workflow: add, remove or count HintWise admins; answers without the email.';
revoke all on function platform.admin_set(text, text) from public;
grant execute on function platform.admin_set(text, text) to service_role;
