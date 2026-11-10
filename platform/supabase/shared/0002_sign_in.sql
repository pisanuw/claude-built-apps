-- Sign-in links and abuse limits (docs/platform.md, "Sign-in links and
-- abuse limits"; contract in platform/src/signin/README.md).
--
-- Applied by `node platform/supabase-admin.mjs apply-shared` after
-- 0001_platform.sql. Idempotent: create if not exists, create or replace,
-- revoke/grant. Only the service role (the sign-in-link and auth-email-hook
-- edge functions) touches these tables: RLS is on with no policies, and anon
-- and authenticated have no table access and cannot execute the functions.
--
-- The functions are security invoker (the default): they run with the
-- service role's own rights, so they need no security definer, and a role
-- without table access gets nothing from them even if it could call them.
-- Each one pins search_path to '' and names every object with its schema.
--
-- Windows used here, mirrored in platform/src/signin (a test checks they
-- agree): a key's ladder restarts after 24 hours with no request for it; a
-- 'pending' row counts as a link being sent for 5 minutes; challenge counts
-- look back 24 hours, the per-IP allowance and the alerts 1 hour; rows are
-- kept 30 days.

-- ---------------------------------------------------------------------------
-- sign_in_requests: one row per request to sign-in-link (and per refused
-- direct magic link from auth-email-hook). Keys are HMAC-SHA256 hashes
-- (function secret SIGN_IN_HASH_KEY); no address, IP or browser id is stored.
-- ---------------------------------------------------------------------------

create table if not exists platform.sign_in_requests (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  app text,
  outcome text not null,
  detail text,
  email_hash text,
  ip_hash text,
  browser_hash text,
  constraint sign_in_requests_outcome_check
    check (outcome in ('pending', 'sent', 'wait', 'challenge', 'challenge_failed', 'refused', 'error', 'invalid'))
);
comment on table platform.sign_in_requests is 'Sign-in link requests: hashed keys (email, IP, browser), app, outcome and detail; written by the sign-in-link and auth-email-hook functions (service role), kept 30 days.';
comment on column platform.sign_in_requests.outcome is 'pending while sign-in-link decides and sends; then sent, wait, challenge, challenge_failed, refused (auth-email-hook), error or invalid.';
comment on column platform.sign_in_requests.email_hash is 'HMAC-SHA256 of ''email:<address>'' under SIGN_IN_HASH_KEY, hex.';
comment on column platform.sign_in_requests.ip_hash is 'HMAC-SHA256 of ''ip:<client ip>'' (or ''ip:unknown'') under SIGN_IN_HASH_KEY, hex.';
comment on column platform.sign_in_requests.browser_hash is 'HMAC-SHA256 of ''browser:<browserId>'' (localStorage hintwise.browserId) under SIGN_IN_HASH_KEY, hex.';

create index if not exists sign_in_requests_email_idx on platform.sign_in_requests (email_hash, created_at);
create index if not exists sign_in_requests_browser_idx on platform.sign_in_requests (browser_hash, created_at);
create index if not exists sign_in_requests_ip_idx on platform.sign_in_requests (ip_hash, created_at);
create index if not exists sign_in_requests_email_sent_idx on platform.sign_in_requests (email_hash, created_at)
  where outcome in ('sent', 'pending');
create index if not exists sign_in_requests_browser_sent_idx on platform.sign_in_requests (browser_hash, created_at)
  where outcome in ('sent', 'pending');
create index if not exists sign_in_requests_sent_idx on platform.sign_in_requests (created_at) where outcome = 'sent';
create index if not exists sign_in_requests_created_idx on platform.sign_in_requests (created_at);
comment on index platform.sign_in_requests_email_sent_idx is 'Counts the links of one address''s ladder (sign_in_key_stats).';
comment on index platform.sign_in_requests_sent_idx is 'Counts links sent project-wide in the last hour (volume alert).';

-- ---------------------------------------------------------------------------
-- sign_in_alerts: when each alert kind last went to the owner (one an hour)
-- ---------------------------------------------------------------------------

create table if not exists platform.sign_in_alerts (
  kind text primary key,
  last_sent_at timestamptz,
  sent_count int not null default 0,
  constraint sign_in_alerts_kind_check
    check (kind in ('many-addresses', 'address-repeated', 'challenge-failures', 'bypass', 'volume'))
);
comment on table platform.sign_in_alerts is 'Last time each sign-in alert kind was emailed to the owner; sign_in_claim_alert lets at most one per kind through an hour.';

-- ---------------------------------------------------------------------------
-- sign_in_episode_start: where a key's current ladder began
-- ---------------------------------------------------------------------------

-- The earliest request of the key's current run of activity: walking back
-- from its latest request, each step jumps to the earliest request in the
-- 24 hours before; it stops at a 24-hour gap. Null when the key had no
-- request in the last 24 hours (a quiet day resets the ladder). Every two
-- steps move back more than 24 hours, so with 30 days kept the walk is a few
-- dozen index probes however many rows a key has.
create or replace function platform.sign_in_episode_start(p_column text, p_hash text)
returns timestamptz
language plpgsql
stable
set search_path = ''
as $$
declare
  t timestamptz;
  e timestamptz;
  steps int := 0;
begin
  if p_hash is null then
    return null;
  end if;
  if p_column not in ('email_hash', 'browser_hash', 'ip_hash') then
    raise exception 'sign_in_episode_start: unknown column %', p_column;
  end if;
  execute format('select max(created_at) from platform.sign_in_requests where %I = $1', p_column)
    into t using p_hash;
  if t is null or now() - t >= interval '24 hours' then
    return null;
  end if;
  loop
    execute format('select min(created_at) from platform.sign_in_requests where %I = $1 and created_at > $2 and created_at < $3', p_column)
      into e using p_hash, t - interval '24 hours', t;
    exit when e is null;
    t := e;
    steps := steps + 1;
    exit when steps >= 200;
  end loop;
  return t;
end;
$$;
comment on function platform.sign_in_episode_start(text, text) is 'Start of a key''s current ladder: its earliest request with no 24-hour gap since; null after a quiet day.';

-- ---------------------------------------------------------------------------
-- sign_in_key_stats: one key's ladder and 24-hour count
-- ---------------------------------------------------------------------------

create or replace function platform.sign_in_key_stats(p_column text, p_hash text)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_start timestamptz;
  v_sent int := 0;
  v_last timestamptz;
  v_day int := 0;
begin
  if p_hash is null then
    return jsonb_build_object('sent', 0, 'last_sent_at', null, 'requests_24h', 0, 'episode_start', null);
  end if;
  v_start := platform.sign_in_episode_start(p_column, p_hash);
  if v_start is not null then
    -- A 'pending' row younger than 5 minutes is a link being sent right now.
    execute format($q$select count(*)::int, max(created_at) from platform.sign_in_requests
      where %I = $1 and created_at >= $2 and outcome in ('sent', 'pending')
        and (outcome = 'sent' or created_at > now() - interval '5 minutes')$q$, p_column)
      into v_sent, v_last using p_hash, v_start;
  end if;
  -- Only "10 or more" matters, so the count stops at 1000.
  execute format($q$select count(*)::int from (select 1 from platform.sign_in_requests
      where %I = $1 and created_at > now() - interval '24 hours' limit 1000) s$q$, p_column)
    into v_day using p_hash;
  return jsonb_build_object('sent', v_sent, 'last_sent_at', v_last, 'requests_24h', v_day, 'episode_start', v_start);
end;
$$;
comment on function platform.sign_in_key_stats(text, text) is 'For one hashed key: links sent since its ladder began, the last one''s time, and its requests in 24 hours.';

-- ---------------------------------------------------------------------------
-- sign_in_begin: the counts the decision needs, and a 'pending' row
-- ---------------------------------------------------------------------------

-- Takes a transaction lock per address and per browser first, so a burst of
-- parallel requests is decided one at a time: the second sees the first's
-- 'pending' row as a link being sent and waits. Returns
-- { id, email: stats, browser: stats, ip: { requests_1h, requests_24h } },
-- counts excluding the new row.
create or replace function platform.sign_in_begin(p_email_hash text, p_ip_hash text, p_browser_hash text, p_app text)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_id bigint;
  v_email jsonb;
  v_browser jsonb;
  v_ip_hour int := 0;
  v_ip_day int := 0;
begin
  if p_email_hash is not null then
    perform pg_advisory_xact_lock(7301, hashtext(p_email_hash));
  end if;
  if p_browser_hash is not null then
    perform pg_advisory_xact_lock(7302, hashtext(p_browser_hash));
  end if;
  v_email := platform.sign_in_key_stats('email_hash', p_email_hash);
  v_browser := platform.sign_in_key_stats('browser_hash', p_browser_hash);
  if p_ip_hash is not null then
    select count(*)::int into v_ip_hour from (
      select 1 from platform.sign_in_requests
      where ip_hash = p_ip_hash and created_at > now() - interval '1 hour' limit 1000) s;
    select count(*)::int into v_ip_day from (
      select 1 from platform.sign_in_requests
      where ip_hash = p_ip_hash and created_at > now() - interval '24 hours' limit 5000) s;
  end if;
  insert into platform.sign_in_requests (app, outcome, email_hash, ip_hash, browser_hash)
  values (left(p_app, 64), 'pending', p_email_hash, p_ip_hash, p_browser_hash)
  returning id into v_id;
  return jsonb_build_object(
    'id', v_id,
    'email', v_email,
    'browser', v_browser,
    'ip', jsonb_build_object('requests_1h', v_ip_hour, 'requests_24h', v_ip_day));
end;
$$;
comment on function platform.sign_in_begin(text, text, text, text) is 'sign-in-link, step 1: per-address and per-browser lock, the ladder and challenge counts, and a new pending request row (its id).';

-- ---------------------------------------------------------------------------
-- sign_in_prune: a bounded delete of rows older than 30 days
-- ---------------------------------------------------------------------------

create or replace function platform.sign_in_prune()
returns int
language sql
set search_path = ''
as $$
  with gone as (
    delete from platform.sign_in_requests
    where id in (
      select id from platform.sign_in_requests
      where created_at < now() - interval '30 days'
      order by created_at
      limit 200)
    returning 1
  )
  select count(*)::int from gone;
$$;
comment on function platform.sign_in_prune() is 'Deletes up to 200 sign-in requests older than 30 days; called on every logged request.';

-- ---------------------------------------------------------------------------
-- sign_in_alert_counts: what the alert rules look at, for one request's keys
-- ---------------------------------------------------------------------------

create or replace function platform.sign_in_alert_counts(p_email_hash text, p_ip_hash text, p_browser_hash text)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'ip_addresses_1h', (select count(distinct s.email_hash)::int from (
        select r.email_hash from platform.sign_in_requests r
        where p_ip_hash is not null and r.ip_hash = p_ip_hash
          and r.created_at > now() - interval '1 hour' and r.email_hash is not null
        limit 2000) s),
    'browser_addresses_1h', (select count(distinct s.email_hash)::int from (
        select r.email_hash from platform.sign_in_requests r
        where p_browser_hash is not null and r.browser_hash = p_browser_hash
          and r.created_at > now() - interval '1 hour' and r.email_hash is not null
        limit 2000) s),
    'email_requests_1h', (select count(*)::int from (
        select 1 from platform.sign_in_requests r
        where p_email_hash is not null and r.email_hash = p_email_hash
          and r.created_at > now() - interval '1 hour'
        limit 1000) s),
    'ip_challenge_failures_1h', (select count(*)::int from (
        select 1 from platform.sign_in_requests r
        where p_ip_hash is not null and r.ip_hash = p_ip_hash and r.outcome = 'challenge_failed'
          and r.created_at > now() - interval '1 hour'
        limit 1000) s),
    'sent_1h', (select count(*)::int from (
        select 1 from platform.sign_in_requests r
        where r.outcome = 'sent' and r.created_at > now() - interval '1 hour'
        limit 10000) s),
    'alerts', (select coalesce(jsonb_object_agg(a.kind, a.last_sent_at), '{}'::jsonb) from platform.sign_in_alerts a)
  );
$$;
comment on function platform.sign_in_alert_counts(text, text, text) is 'Last-hour counts for the sign-in alert rules (addresses per IP and per browser, requests per address, failed challenges per IP, links sent overall) and when each alert last went.';

-- ---------------------------------------------------------------------------
-- sign_in_finish: the outcome of a pending request, then the alert counts
-- ---------------------------------------------------------------------------

create or replace function platform.sign_in_finish(p_id bigint, p_outcome text, p_detail text)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  r platform.sign_in_requests;
begin
  if p_outcome is null or p_outcome = 'pending' then
    raise exception 'sign_in_finish: give a final outcome, not %', coalesce(p_outcome, 'null');
  end if;
  update platform.sign_in_requests
     set outcome = p_outcome, detail = left(p_detail, 500)
   where id = p_id and outcome = 'pending'
  returning * into r;
  if not found then
    raise exception 'sign_in_finish: request % is not pending', p_id;
  end if;
  perform platform.sign_in_prune();
  return platform.sign_in_alert_counts(r.email_hash, r.ip_hash, r.browser_hash);
end;
$$;
comment on function platform.sign_in_finish(bigint, text, text) is 'sign-in-link, step 2: records the outcome of a pending request, prunes old rows, returns the alert counts.';

-- ---------------------------------------------------------------------------
-- sign_in_log: one finished row (invalid requests, the hook's refusals)
-- ---------------------------------------------------------------------------

create or replace function platform.sign_in_log(p_email_hash text, p_ip_hash text, p_browser_hash text, p_app text, p_outcome text, p_detail text)
returns bigint
language plpgsql
set search_path = ''
as $$
declare
  v_id bigint;
begin
  if p_outcome is null or p_outcome = 'pending' then
    raise exception 'sign_in_log: give a final outcome, not %', coalesce(p_outcome, 'null');
  end if;
  insert into platform.sign_in_requests (app, outcome, detail, email_hash, ip_hash, browser_hash)
  values (left(p_app, 64), p_outcome, left(p_detail, 500), p_email_hash, p_ip_hash, p_browser_hash)
  returning id into v_id;
  perform platform.sign_in_prune();
  return v_id;
end;
$$;
comment on function platform.sign_in_log(text, text, text, text, text, text) is 'Records a sign-in request that needed no decision (invalid, or refused by auth-email-hook); returns its id.';

-- ---------------------------------------------------------------------------
-- sign_in_claim_alert: at most one alert per kind an hour
-- ---------------------------------------------------------------------------

create or replace function platform.sign_in_claim_alert(p_kind text)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_last timestamptz;
begin
  insert into platform.sign_in_alerts (kind) values (p_kind) on conflict (kind) do nothing;
  select last_sent_at into v_last from platform.sign_in_alerts where kind = p_kind for update;
  if v_last is not null and v_last > now() - interval '1 hour' then
    return false;
  end if;
  update platform.sign_in_alerts set last_sent_at = now(), sent_count = sent_count + 1 where kind = p_kind;
  return true;
end;
$$;
comment on function platform.sign_in_claim_alert(text) is 'True (and the time recorded) when this alert kind has not gone out in the last hour; false otherwise.';

-- ---------------------------------------------------------------------------
-- Row level security and grants: service role only
-- ---------------------------------------------------------------------------

alter table platform.sign_in_requests enable row level security;   -- no policies: service role only
alter table platform.sign_in_alerts enable row level security;     -- no policies: service role only

revoke all on table platform.sign_in_requests from public, anon, authenticated;
revoke all on table platform.sign_in_alerts from public, anon, authenticated;
grant select, insert, update, delete on table platform.sign_in_requests to service_role;
grant select, insert, update, delete on table platform.sign_in_alerts to service_role;

revoke all on function platform.sign_in_episode_start(text, text) from public, anon, authenticated;
revoke all on function platform.sign_in_key_stats(text, text) from public, anon, authenticated;
revoke all on function platform.sign_in_begin(text, text, text, text) from public, anon, authenticated;
revoke all on function platform.sign_in_prune() from public, anon, authenticated;
revoke all on function platform.sign_in_alert_counts(text, text, text) from public, anon, authenticated;
revoke all on function platform.sign_in_finish(bigint, text, text) from public, anon, authenticated;
revoke all on function platform.sign_in_log(text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function platform.sign_in_claim_alert(text) from public, anon, authenticated;

grant execute on function platform.sign_in_episode_start(text, text) to service_role;
grant execute on function platform.sign_in_key_stats(text, text) to service_role;
grant execute on function platform.sign_in_begin(text, text, text, text) to service_role;
grant execute on function platform.sign_in_prune() to service_role;
grant execute on function platform.sign_in_alert_counts(text, text, text) to service_role;
grant execute on function platform.sign_in_finish(bigint, text, text) to service_role;
grant execute on function platform.sign_in_log(text, text, text, text, text, text) to service_role;
grant execute on function platform.sign_in_claim_alert(text) to service_role;
