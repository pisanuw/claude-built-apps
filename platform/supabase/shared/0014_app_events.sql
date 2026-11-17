-- First-party, cookieless analytics for HintWise apps (owner, 17 Nov 2026:
-- "my own endpoint", starting with myuni.top and StepWise).
--
-- Browsers send events to the app-events function (supabase/functions/
-- app-events), which validates them (src/analytics/events.ts) and calls
-- app_events_record below with the request's IP and user agent. The visitor
-- id is a hash of today's random salt, the app, the IP and the user agent:
-- the same person counts once per app per day, and nobody, us included, can
-- link days together or recover the IP, because each salt is deleted once its
-- day is over and never leaves the database. No cookie, no localStorage, no
-- IP stored.
--
-- analytics_apps: which apps may send, from which origins (https only).
-- app_events: one row per event; path is a pathname only (never the query or
-- the hash, which can carry sign-in tokens).
-- Service role only: RLS on, no policies, no grants to anon or authenticated.
-- Idempotent: safe to re-run.

create table if not exists platform.analytics_apps (
  slug text primary key check (slug ~ '^[a-z0-9][a-z0-9-]{0,39}$'),
  origins text[] not null check (cardinality(origins) between 1 and 10),
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);
comment on table platform.analytics_apps is 'Apps that may send first-party analytics events (app-events function), and the exact https origins they send from. Service role only.';

create table if not exists platform.app_events (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  app text not null references platform.analytics_apps(slug) on delete cascade,
  name text not null check (name ~ '^[a-z][a-z0-9_]{0,39}$'),
  path text check (char_length(path) <= 200),
  visitor text not null check (visitor ~ '^[0-9a-f]{16}$'),
  referrer text check (char_length(referrer) <= 100),
  device text check (device in ('mobile', 'tablet', 'desktop')),
  value double precision,
  props jsonb
);
comment on table platform.app_events is 'First-party analytics events: pageview, engaged (value = seconds visible), error, outbound, and app-defined names. visitor rotates daily (salted hash, salt deleted after its day). Service role only.';
create index if not exists app_events_app_at_idx on platform.app_events (app, at desc);
create index if not exists app_events_at_idx on platform.app_events (at);

create table if not exists platform.app_events_salt (
  day date primary key,
  salt text not null
);
comment on table platform.app_events_salt is 'Today''s random salt for app_events.visitor; older salts are deleted by app_events_record. Never read outside the database.';

alter table platform.analytics_apps enable row level security;
alter table platform.app_events enable row level security;
alter table platform.app_events_salt enable row level security;
revoke all on platform.analytics_apps, platform.app_events, platform.app_events_salt from public, anon, authenticated;
grant select on platform.analytics_apps to service_role;
grant select, delete on platform.app_events to service_role;

-- Records up to 20 validated events for one request. Returns the number
-- stored, -1 when the app is unknown or switched off, -2 when the origin is
-- not one of the app's. The function, not the caller, owns the salt.
create or replace function platform.app_events_record(
  p_app text, p_origin text, p_ip text, p_ua text, p_device text, p_events jsonb
) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_origins text[];
  v_today date := (now() at time zone 'utc')::date;
  v_salt text;
  v_visitor text;
  v_count integer;
begin
  select a.origins into v_origins from platform.analytics_apps a where a.slug = p_app and a.enabled;
  if v_origins is null then return -1; end if;
  if p_origin is null or not (p_origin = any (v_origins)) then return -2; end if;

  insert into platform.app_events_salt (day, salt)
  values (v_today, encode(sha256(convert_to(gen_random_uuid()::text || gen_random_uuid()::text || clock_timestamp()::text, 'UTF8')), 'hex'))
  on conflict (day) do nothing;
  select s.salt into v_salt from platform.app_events_salt s where s.day = v_today;
  delete from platform.app_events_salt s where s.day < v_today;

  v_visitor := left(encode(sha256(convert_to(v_salt || '|' || p_app || '|' || coalesce(p_ip, '') || '|' || coalesce(p_ua, ''), 'UTF8')), 'hex'), 16);

  insert into platform.app_events (app, name, path, visitor, referrer, device, value, props)
  select p_app, e.n, left(e.p, 200), v_visitor, left(e.r, 100),
         case when p_device in ('mobile', 'tablet', 'desktop') then p_device end,
         e.v, e.x
  from jsonb_to_recordset(case when jsonb_typeof(p_events) = 'array' then p_events else '[]'::jsonb end)
       as e(n text, p text, r text, v double precision, x jsonb)
  where e.n ~ '^[a-z][a-z0-9_]{0,39}$'
  limit 20;
  get diagnostics v_count = row_count;
  return v_count;
end
$$;
comment on function platform.app_events_record(text, text, text, text, text, jsonb) is 'app-events function only (service role): checks app and origin, owns the daily salt, stores up to 20 events. -1 unknown app, -2 refused origin.';

-- Deletes events older than p_keep_days (default 400). For a scheduled job.
create or replace function platform.app_events_prune(p_keep_days integer default 400)
returns integer
language plpgsql security definer set search_path = '' as $$
declare v_count integer;
begin
  delete from platform.app_events e where e.at < now() - make_interval(days => greatest(p_keep_days, 30));
  get diagnostics v_count = row_count;
  return v_count;
end
$$;

revoke execute on function platform.app_events_record(text, text, text, text, text, jsonb) from public, anon, authenticated;
revoke execute on function platform.app_events_prune(integer) from public, anon, authenticated;
grant execute on function platform.app_events_record(text, text, text, text, text, jsonb) to service_role;
grant execute on function platform.app_events_prune(integer) to service_role;

-- The first two apps (owner, 17 Nov 2026).
insert into platform.analytics_apps (slug, origins) values
  ('myuni', array['https://myuni.top', 'https://www.myuni.top']),
  ('stepwise', array['https://stepwise.hintwise.org'])
on conflict (slug) do nothing;
