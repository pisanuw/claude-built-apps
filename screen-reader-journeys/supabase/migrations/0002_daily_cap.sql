-- screen-reader-journeys, migration 0002: at most 10 runs a day per person, 40 in all.
--
-- With ALLOWED_TARGET_HOSTS="*", anyone signed in may point the worker at any public site. Besides
-- the 3 runs waiting or running (0001, limit_active_runs), a person may start at most 10 runs per
-- UTC day, and everyone together at most 40. They are counted in run_counts and run_totals, which
-- people can neither read nor change: counting rows of runs would not do, since people may delete
-- their own runs. An account is free, so the total, which no account deletion lowers, is the
-- bound on the one worker; the per-person count shares it out.
--
-- The error code is 53400, as for the 3-run limit, so the API answers 429 with the message.
-- Idempotent, like 0001: safe to apply again.

create table if not exists app_screen_reader_journeys.run_counts (
  user_id uuid not null references auth.users (id) on delete cascade,
  day     date not null,
  runs    integer not null check (runs >= 1),
  primary key (user_id, day)
);

-- Everyone's runs per UTC day. No person in it, so deleting an account does not lower it.
create table if not exists app_screen_reader_journeys.run_totals (
  day  date primary key,
  runs integer not null check (runs >= 1)
);
comment on table app_screen_reader_journeys.run_totals is 'Runs everyone started per UTC day, for the total daily limit. Written only by limit_daily_runs(); kept two days; nobody reads it through the API.';
alter table app_screen_reader_journeys.run_totals enable row level security;
drop policy if exists run_totals_none on app_screen_reader_journeys.run_totals;
create policy run_totals_none on app_screen_reader_journeys.run_totals
  for select to authenticated
  using (false);

comment on table app_screen_reader_journeys.run_counts is 'Runs each person started per UTC day, for the daily limit. Written only by limit_daily_runs(); kept two days; nobody reads it through the API.';

alter table app_screen_reader_journeys.run_counts enable row level security;

-- The limits, each in one place: to change one later, a migration replaces only its function.
-- (stable, not immutable: they are meant to be replaced.)
create or replace function app_screen_reader_journeys.daily_run_limit()
returns integer
language sql
stable
set search_path = ''
as $$ select 10 $$;

create or replace function app_screen_reader_journeys.daily_total_limit()
returns integer
language sql
stable
set search_path = ''
as $$ select 40 $$;

-- Nobody reads the counts through the API.
drop policy if exists run_counts_none on app_screen_reader_journeys.run_counts;
create policy run_counts_none on app_screen_reader_journeys.run_counts
  for select to authenticated
  using (false);

create or replace function app_screen_reader_journeys.limit_daily_runs()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  today date := (pg_catalog.now() at time zone 'utc')::date;
  most integer := app_screen_reader_journeys.daily_run_limit();
  total integer := app_screen_reader_journeys.daily_total_limit();
  started integer;
begin
  -- An insert for someone else fails the policy anyway (see limit_active_runs).
  if new.user_id is distinct from (select auth.uid()) then
    return new;
  end if;
  -- runs_limit_active fires first (triggers fire in name order) and holds this person's lock
  -- until the end of the transaction, so two inserts at once are counted one after the other.
  insert into app_screen_reader_journeys.run_counts as c (user_id, day, runs)
  values (new.user_id, today, 1)
  on conflict (user_id, day) do update set runs = c.runs + 1
  returning c.runs into started;
  if started > most then
    -- The insert fails, and with it this count (and limit_active_runs's retention delete).
    raise exception 'You have started % runs today (UTC). Try again tomorrow.', most
      using errcode = '53400';
  end if;
  -- Everyone's runs, one insert at a time across all people.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('srj.limit_daily_runs:total', 0));
  insert into app_screen_reader_journeys.run_totals as t (day, runs)
  values (today, 1)
  on conflict (day) do update set runs = t.runs + 1
  returning t.runs into started;
  if started > total then
    raise exception 'The service has run its % runs for today (UTC). Try again tomorrow.', total
      using errcode = '53400';
  end if;
  -- Only today and yesterday are kept, for everyone.
  delete from app_screen_reader_journeys.run_counts c where c.day < today - 1;
  delete from app_screen_reader_journeys.run_totals t where t.day < today - 1;
  return new;
end;
$$;

drop trigger if exists runs_limit_daily on app_screen_reader_journeys.runs;
create trigger runs_limit_daily
  before insert on app_screen_reader_journeys.runs
  for each row execute function app_screen_reader_journeys.limit_daily_runs();

revoke all on table app_screen_reader_journeys.run_counts, app_screen_reader_journeys.run_totals from public, anon, authenticated;
revoke execute on function app_screen_reader_journeys.limit_daily_runs() from public, anon, authenticated;
revoke execute on function app_screen_reader_journeys.daily_run_limit() from public, anon, authenticated;
revoke execute on function app_screen_reader_journeys.daily_total_limit() from public, anon, authenticated;
