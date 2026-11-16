-- delivery-canary: scheduled canaries and email alerts (milestone 5).
-- Applied by the Deploy workflow like 0001. Idempotent; never edited once
-- applied (add 0006_<name>.sql).
--
-- canary_schedules: one per shop. Daily or weekly, at an hour (UTC), the
-- scheduled Netlify function `canary-run` places the shop's canary, looks
-- for its email in the seed inbox and mails an alert when it fails or lands
-- in Spam, and a weekly digest when asked. The browser reads its own row
-- (every column but `tag`) and may delete it; it is written only through
-- canary_schedule_save, which the api function calls with the user's token.
--
-- The scheduled run has no user token and the app never gets the
-- service-role key. It proves itself with the job token: an HMAC of
-- DELIVERY_CANARY_KEY that only the Netlify function can compute. When a
-- schedule is saved, the function stores tag = HMAC(job token, shop id);
-- the job_* functions below (anon may execute them) only ever touch
-- schedules whose tag matches the token they are given. A caller without
-- the key cannot make a matching tag for any shop: a signed-in user who
-- writes a tag of their own through canary_schedule_save reaches only their
-- own shop with it, and every kept secret the job_* functions return is
-- sealed with the key (AES-256-GCM, bound to user and shop).
--
-- email_sends: one row per alert or digest email, reserved before it is
-- sent: it holds the caps (4 a day per user, 300 a day for the app) and
-- the dedupe key (one alert per canary or problem a day, one digest a week
-- per shop). No address is stored; the job reads the account's address
-- from auth.users when it reserves a send.
--
-- job_runs: the scheduled run's heartbeat, keyed by the hash of the job
-- token, so /api/health can say when the schedule last ran.

create extension if not exists pgcrypto with schema extensions;

-- Canaries placed by the schedule are marked, so the job only touches its own.
alter table app_delivery_canary.canary_orders add column if not exists source text not null default 'page';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'canary_orders_source_check' and conrelid = 'app_delivery_canary.canary_orders'::regclass) then
    alter table app_delivery_canary.canary_orders add constraint canary_orders_source_check check (source in ('page', 'schedule'));
  end if;
end
$$;

-- Whatever the caller sent, a row is 'page' unless job_canary_start inserted it.
create or replace function app_delivery_canary.canary_orders_source()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    new.source := old.source;
  else
    -- Only job_canary_start (running as the function owner) sets the flag; a page insert runs as authenticated.
    new.source := case when coalesce(current_setting('app_delivery_canary.job', true), '') = 'on' and current_user not in ('authenticated', 'anon') then 'schedule' else 'page' end;
  end if;
  return new;
end
$$;

drop trigger if exists canary_orders_source on app_delivery_canary.canary_orders;
create trigger canary_orders_source
  before insert or update on app_delivery_canary.canary_orders
  for each row execute function app_delivery_canary.canary_orders_source();

create table if not exists app_delivery_canary.canary_schedules (
  shop_id uuid primary key references app_delivery_canary.shops(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  enabled boolean not null default false,
  cadence text not null default 'weekly' check (cadence in ('daily', 'weekly')),
  -- 0 is Sunday; weekday and hour are UTC (the page converts from local time).
  weekday smallint not null default 1 check (weekday between 0 and 6),
  hour smallint not null default 9 check (hour between 0 and 23),
  variant_id text check (variant_id is null or variant_id ~ '^gid://shopify/ProductVariant/[0-9]{1,20}$'),
  variant_title text not null default '' check (char_length(variant_title) <= 300),
  alerts boolean not null default true,
  digest boolean not null default false,
  tag text not null default '' check (tag ~ '^([0-9a-f]{64})?$'),
  next_run_at timestamptz,
  last_run_at timestamptz,
  last_outcome text not null default '' check (char_length(last_outcome) <= 300),
  digest_from timestamptz,
  last_digest_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table app_delivery_canary.canary_schedules is 'A shop''s scheduled canary (daily or weekly, UTC hour) and its email choices; tag proves the job token.';
create index if not exists canary_schedules_due_idx on app_delivery_canary.canary_schedules (next_run_at) where enabled;
create index if not exists canary_schedules_user_idx on app_delivery_canary.canary_schedules (user_id);

create table if not exists app_delivery_canary.email_sends (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  shop_id uuid references app_delivery_canary.shops(id) on delete cascade,
  kind text not null check (kind in ('alert', 'digest')),
  dedupe text not null check (char_length(dedupe) between 1 and 120),
  status text not null default 'reserved' check (status in ('reserved', 'sent', 'failed')),
  provider_id text not null default '' check (char_length(provider_id) <= 100),
  error text not null default '' check (char_length(error) <= 300),
  created_at timestamptz not null default now(),
  unique (shop_id, kind, dedupe)
);
comment on table app_delivery_canary.email_sends is 'Alert and digest emails: caps and dedupe (no address stored).';
create index if not exists email_sends_user_created_idx on app_delivery_canary.email_sends (user_id, created_at);
create index if not exists email_sends_created_idx on app_delivery_canary.email_sends (created_at);

create table if not exists app_delivery_canary.job_runs (
  token_hash text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
  last_run_at timestamptz not null default now(),
  runs bigint not null default 0,
  summary jsonb not null default '{}'::jsonb check (pg_column_size(summary) < 4096)
);
comment on table app_delivery_canary.job_runs is 'Heartbeat of the scheduled canary-run function, keyed by the hash of its token.';

alter table app_delivery_canary.canary_schedules enable row level security;
alter table app_delivery_canary.email_sends enable row level security;
alter table app_delivery_canary.job_runs enable row level security;

drop policy if exists canary_schedules_select_own on app_delivery_canary.canary_schedules;
create policy canary_schedules_select_own on app_delivery_canary.canary_schedules for select to authenticated using (user_id = auth.uid());
drop policy if exists canary_schedules_delete_own on app_delivery_canary.canary_schedules;
create policy canary_schedules_delete_own on app_delivery_canary.canary_schedules for delete to authenticated using (user_id = auth.uid());
drop policy if exists email_sends_select_own on app_delivery_canary.email_sends;
create policy email_sends_select_own on app_delivery_canary.email_sends for select to authenticated using (user_id = auth.uid());
-- job_runs: no policy for anon or authenticated; only the definer functions touch it.
drop policy if exists job_runs_none on app_delivery_canary.job_runs;
create policy job_runs_none on app_delivery_canary.job_runs for select to authenticated using (false);

-- A schedule cannot run without the shop's Shopify connection: disconnecting
-- (however it happens) removes the schedule too, so no "cannot run" alerts follow.
create or replace function app_delivery_canary.shop_connections_drop_schedule()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from app_delivery_canary.canary_schedules where shop_id = old.shop_id and user_id = old.user_id;
  return old;
end
$$;

drop trigger if exists shop_connections_drop_schedule on app_delivery_canary.shop_connections;
create trigger shop_connections_drop_schedule
  after delete on app_delivery_canary.shop_connections
  for each row execute function app_delivery_canary.shop_connections_drop_schedule();

-- job_config: the SHA-256 of the real job token, once a later migration
-- stores it (the live function shows it at /api/health as jobTokenSha256;
-- it is not secret). From then on job_token_ok refuses every other token,
-- so a token a user made up for their own schedule's tag stops working.
create table if not exists app_delivery_canary.job_config (
  id boolean primary key default true check (id),
  token_sha256 text not null check (token_sha256 ~ '^[0-9a-f]{64}$')
);
comment on table app_delivery_canary.job_config is 'The SHA-256 of the scheduled job''s token (not secret); job_token_ok checks it.';
alter table app_delivery_canary.job_config enable row level security;
drop policy if exists job_config_none on app_delivery_canary.job_config;
create policy job_config_none on app_delivery_canary.job_config for select to authenticated using (false);
revoke all on table app_delivery_canary.job_config from public, anon, authenticated;

-- The next run after p_after: the hour (UTC) on the next day, or on the next
-- p_weekday for weekly. The page has the same rule (src/core/schedule.ts).
create or replace function app_delivery_canary.canary_next_slot(p_cadence text, p_weekday integer, p_hour integer, p_after timestamptz)
returns timestamptz
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_day timestamp := date_trunc('day', p_after at time zone 'UTC');
  v_at timestamptz;
begin
  v_at := (v_day + make_interval(hours => p_hour)) at time zone 'UTC';
  if p_cadence = 'daily' then
    if v_at <= p_after then
      v_at := v_at + interval '1 day';
    end if;
    return v_at;
  end if;
  v_at := v_at + make_interval(days => ((p_weekday - extract(dow from v_day)::integer + 7) % 7));
  if v_at <= p_after then
    v_at := v_at + interval '7 days';
  end if;
  return v_at;
end
$$;

-- The tag a schedule must carry for a job token (hex HMAC-SHA256 of the shop id).
create or replace function app_delivery_canary.job_tag(p_token text, p_shop uuid)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(extensions.hmac(p_shop::text, p_token, 'sha256'), 'hex');
$$;

create or replace function app_delivery_canary.job_token_ok(p_token text)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    raise exception 'Bad job token.' using errcode = '42501';
  end if;
  if exists (select 1 from app_delivery_canary.job_config c where c.token_sha256 <> encode(extensions.digest(p_token, 'sha256'), 'hex')) then
    raise exception 'Bad job token.' using errcode = '42501';
  end if;
end
$$;

-- Saves a shop's schedule (the api function calls it with the user's own
-- token and the tag it computed). Checks the caller owns the shop.
create or replace function app_delivery_canary.canary_schedule_save(
  p_shop uuid,
  p_enabled boolean,
  p_cadence text,
  p_weekday integer,
  p_hour integer,
  p_variant_id text,
  p_variant_title text,
  p_alerts boolean,
  p_digest boolean,
  p_tag text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_old app_delivery_canary.canary_schedules;
  v_row app_delivery_canary.canary_schedules;
begin
  if v_user is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  if not exists (select 1 from app_delivery_canary.shops s where s.id = p_shop and s.user_id = v_user) then
    raise exception 'That shop is not yours.' using errcode = '42501';
  end if;
  if p_enabled and p_variant_id is null then
    raise exception 'Pick the canary product first.' using errcode = '22023';
  end if;
  select * into v_old from app_delivery_canary.canary_schedules t where t.shop_id = p_shop;
  insert into app_delivery_canary.canary_schedules as t (
    shop_id, user_id, enabled, cadence, weekday, hour, variant_id, variant_title, alerts, digest, tag, next_run_at, digest_from
  ) values (
    p_shop, v_user, coalesce(p_enabled, false), p_cadence, p_weekday, p_hour, p_variant_id, coalesce(p_variant_title, ''),
    coalesce(p_alerts, false), coalesce(p_digest, false), coalesce(p_tag, ''),
    case when p_enabled then app_delivery_canary.canary_next_slot(p_cadence, p_weekday, p_hour, now()) end,
    case when p_digest then now() end
  )
  on conflict (shop_id) do update set
    enabled = excluded.enabled,
    cadence = excluded.cadence,
    weekday = excluded.weekday,
    hour = excluded.hour,
    variant_id = excluded.variant_id,
    variant_title = excluded.variant_title,
    alerts = excluded.alerts,
    digest = excluded.digest,
    tag = excluded.tag,
    -- An unchanged time keeps its next run (saving twice never skips or adds one).
    next_run_at = case
      when not excluded.enabled then null
      when t.enabled and t.next_run_at is not null and t.cadence = excluded.cadence and t.weekday = excluded.weekday and t.hour = excluded.hour then t.next_run_at
      else excluded.next_run_at
    end,
    digest_from = case when excluded.digest and not t.digest then now() when excluded.digest then t.digest_from else null end,
    updated_at = now()
  where t.user_id = v_user
  returning * into v_row;
  if v_row.shop_id is null then
    raise exception 'That shop is not yours.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'shop_id', v_row.shop_id, 'enabled', v_row.enabled, 'cadence', v_row.cadence, 'weekday', v_row.weekday, 'hour', v_row.hour,
    'variant_id', v_row.variant_id, 'variant_title', v_row.variant_title, 'alerts', v_row.alerts, 'digest', v_row.digest,
    'next_run_at', v_row.next_run_at, 'last_run_at', v_row.last_run_at, 'last_outcome', v_row.last_outcome,
    'last_digest_at', v_row.last_digest_at, 'updated_at', v_row.updated_at
  );
end
$$;

-- Claims the next due schedule for the job: moves its next run on (from now,
-- so a missed run is never made up in a burst) and returns what the job
-- needs, kept secrets still sealed. Null when nothing is due.
create or replace function app_delivery_canary.job_claim(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s app_delivery_canary.canary_schedules;
  v_out jsonb;
begin
  perform app_delivery_canary.job_token_ok(p_token);
  select * into s from app_delivery_canary.canary_schedules x
  where x.enabled and x.next_run_at <= now() and x.tag = app_delivery_canary.job_tag(p_token, x.shop_id)
  order by x.next_run_at
  limit 1
  for update skip locked;
  if not found then
    return null;
  end if;
  update app_delivery_canary.canary_schedules set
    next_run_at = app_delivery_canary.canary_next_slot(s.cadence, s.weekday, s.hour, now()),
    last_run_at = now(),
    updated_at = now()
  where shop_id = s.shop_id;
  select jsonb_build_object(
    'shopId', s.shop_id,
    'userId', s.user_id,
    'shopName', sh.name,
    'baseline', sh.baseline,
    'variantId', s.variant_id,
    'variantTitle', s.variant_title,
    'alerts', s.alerts,
    'connection', (
      select jsonb_build_object('domain', c.shop_domain, 'clientId', c.client_id, 'secret', c.secret, 'canaryEmail', c.canary_email)
      from app_delivery_canary.shop_connections c where c.shop_id = s.shop_id and c.user_id = s.user_id
    ),
    'seed', (
      select jsonb_build_object('address', i.address, 'sender', i.sender, 'subject', i.subject_hint, 'secret', i.secret)
      from app_delivery_canary.seed_inboxes i where i.shop_id = s.shop_id and i.user_id = s.user_id
    )
  ) into v_out
  from app_delivery_canary.shops sh where sh.id = s.shop_id;
  return v_out;
end
$$;

-- Records a scheduled canary ('placing') for the schedule's owner, with the
-- same limits as the page's canaries (5 a day per user, one unresolved per
-- shop) and one Shopify call counted. {id} or {error: limited | busy | not-scheduled}.
create or replace function app_delivery_canary.job_canary_start(p_token text, p_shop uuid, p_variant_id text, p_variant_title text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
  v_id uuid;
begin
  perform app_delivery_canary.job_token_ok(p_token);
  select s.user_id into v_user from app_delivery_canary.canary_schedules s
  where s.shop_id = p_shop and s.enabled and s.tag = app_delivery_canary.job_tag(p_token, s.shop_id);
  if v_user is null then
    return jsonb_build_object('error', 'not-scheduled');
  end if;
  perform set_config('app_delivery_canary.job', 'on', true);
  begin
    insert into app_delivery_canary.shopify_calls (user_id, kind) values (v_user, 'canary');
    insert into app_delivery_canary.canary_orders (user_id, shop_id, variant_id, variant_title)
    values (v_user, p_shop, p_variant_id, left(coalesce(p_variant_title, ''), 300))
    returning id into v_id;
  exception
    when sqlstate 'PT429' then
      perform set_config('app_delivery_canary.job', '', true);
      return jsonb_build_object('error', 'limited', 'message', sqlerrm);
    when sqlstate 'PT409' then
      perform set_config('app_delivery_canary.job', '', true);
      -- Another canary of this shop is still unresolved: this slot tries again shortly instead of waiting a whole period.
      update app_delivery_canary.canary_schedules set next_run_at = least(next_run_at, now() + interval '15 minutes') where shop_id = p_shop;
      return jsonb_build_object('error', 'busy', 'message', sqlerrm);
  end;
  perform set_config('app_delivery_canary.job', '', true);
  return jsonb_build_object('id', v_id);
end
$$;

-- Updates a scheduled canary (only those) and, with p_check, saves the
-- delivery-email check of its email to the owner's history and links it.
-- Returns the new check's id, or null.
create or replace function app_delivery_canary.job_canary_update(p_token text, p_canary uuid, p_patch jsonb, p_check jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  r app_delivery_canary.canary_orders;
  v_check uuid;
begin
  perform app_delivery_canary.job_token_ok(p_token);
  select o.* into r from app_delivery_canary.canary_orders o
  join app_delivery_canary.canary_schedules s on s.shop_id = o.shop_id and s.user_id = o.user_id
  where o.id = p_canary and o.source = 'schedule' and s.tag = app_delivery_canary.job_tag(p_token, s.shop_id)
  for update of o;
  if r.id is null then
    return null;
  end if;
  if p_check is not null and jsonb_typeof(p_check) = 'object' then
    insert into app_delivery_canary.checks (user_id, shop_id, verdict, placement, subject, report)
    values (r.user_id, r.shop_id, p_check->>'verdict', p_check->>'placement', left(coalesce(p_check->>'subject', ''), 500), p_check->'report')
    returning id into v_check;
  end if;
  update app_delivery_canary.canary_orders set
    status = coalesce(p_patch->>'status', status),
    order_id = case when p_patch ? 'order_id' then p_patch->>'order_id' else order_id end,
    order_name = case when p_patch ? 'order_name' then left(coalesce(p_patch->>'order_name', ''), 40) else order_name end,
    variant_title = case when p_patch ? 'variant_title' then left(coalesce(p_patch->>'variant_title', ''), 300) else variant_title end,
    placed_at = case when p_patch ? 'placed_at' then (p_patch->>'placed_at')::timestamptz else placed_at end,
    arrived_at = case when p_patch ? 'arrived_at' then (p_patch->>'arrived_at')::timestamptz else arrived_at end,
    transit_seconds = case when p_patch ? 'transit_seconds' then (p_patch->>'transit_seconds')::integer else transit_seconds end,
    placement = case when p_patch ? 'placement' then p_patch->>'placement' else placement end,
    seed_where = case when p_patch ? 'seed_where' then p_patch->>'seed_where' else seed_where end,
    error = case when p_patch ? 'error' then left(coalesce(p_patch->>'error', ''), 500) else error end,
    check_id = coalesce(v_check, check_id)
  where id = r.id;
  return v_check;
end
$$;

-- Scheduled canaries placed in the last day whose email has not been found
-- yet, oldest first, with the seed inbox to look in (password still sealed).
create or replace function app_delivery_canary.job_waiting(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app_delivery_canary.job_token_ok(p_token);
  return (
    select coalesce(jsonb_agg(q order by q."placedAt"), '[]'::jsonb) from (
      select o.id as "canaryId", o.shop_id as "shopId", o.user_id as "userId", o.placed_at as "placedAt", o.order_name as "orderName",
        o.variant_title as "variantTitle", sh.name as "shopName", sh.baseline as baseline, s.alerts as alerts,
        case when i.shop_id is null then null else jsonb_build_object('address', i.address, 'sender', i.sender, 'subject', i.subject_hint, 'secret', i.secret) end as seed
      from app_delivery_canary.canary_orders o
      join app_delivery_canary.canary_schedules s on s.shop_id = o.shop_id and s.user_id = o.user_id
      join app_delivery_canary.shops sh on sh.id = o.shop_id
      left join app_delivery_canary.seed_inboxes i on i.shop_id = o.shop_id and i.user_id = o.user_id
      where o.source = 'schedule' and o.status = 'placed' and o.placed_at > now() - interval '1 day'
        and s.tag = app_delivery_canary.job_tag(p_token, s.shop_id)
      order by o.placed_at
      limit 10
    ) q
  );
end
$$;

-- Sets the schedule's last outcome line (shown on the page).
create or replace function app_delivery_canary.job_outcome(p_token text, p_shop uuid, p_text text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app_delivery_canary.job_token_ok(p_token);
  update app_delivery_canary.canary_schedules s set last_outcome = left(coalesce(p_text, ''), 300), updated_at = now()
  where s.shop_id = p_shop and s.tag = app_delivery_canary.job_tag(p_token, s.shop_id);
  return found;
end
$$;

-- Reserves one email before it is sent: the owner must still want that kind
-- for this shop, at most 4 a day per user and 300 a day for the app, and
-- one per dedupe key ever. {sendId, email, shopName} or {skip: reason}.
create or replace function app_delivery_canary.job_mail_reserve(p_token text, p_shop uuid, p_kind text, p_dedupe text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s app_delivery_canary.canary_schedules;
  v_email text;
  v_name text;
  v_id uuid;
begin
  perform app_delivery_canary.job_token_ok(p_token);
  if p_kind not in ('alert', 'digest') then
    raise exception 'Bad kind.' using errcode = '22023';
  end if;
  select * into s from app_delivery_canary.canary_schedules x
  where x.shop_id = p_shop and x.tag = app_delivery_canary.job_tag(p_token, x.shop_id)
  for update;
  if s.shop_id is null then
    return jsonb_build_object('skip', 'not-scheduled');
  end if;
  if p_kind = 'digest' then
    -- A digest that cannot go out now waits a week, not one more run.
    update app_delivery_canary.canary_schedules set last_digest_at = now() where shop_id = s.shop_id;
  end if;
  if (p_kind = 'alert' and not s.alerts) or (p_kind = 'digest' and not s.digest) then
    return jsonb_build_object('skip', 'off');
  end if;
  select u.email into v_email from auth.users u
  where u.id = s.user_id and u.email_confirmed_at is not null and not coalesce(u.is_anonymous, false);
  if v_email is null or v_email = '' then
    return jsonb_build_object('skip', 'no-address');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('app_delivery_canary.email_sends', 0));
  delete from app_delivery_canary.email_sends where created_at < now() - interval '90 days';
  if (select count(*) from app_delivery_canary.email_sends e where e.user_id = s.user_id and e.created_at > now() - interval '1 day' and e.status <> 'failed') >= 4 then
    return jsonb_build_object('skip', 'user-cap');
  end if;
  if (select count(*) from app_delivery_canary.email_sends e where e.created_at > now() - interval '1 day' and e.status <> 'failed') >= 300 then
    return jsonb_build_object('skip', 'app-cap');
  end if;
  insert into app_delivery_canary.email_sends (user_id, shop_id, kind, dedupe)
  values (s.user_id, s.shop_id, p_kind, left(p_dedupe, 120))
  on conflict (shop_id, kind, dedupe) do nothing
  returning id into v_id;
  if v_id is null then
    return jsonb_build_object('skip', 'duplicate');
  end if;
  select sh.name into v_name from app_delivery_canary.shops sh where sh.id = s.shop_id;
  return jsonb_build_object('sendId', v_id, 'email', v_email, 'shopName', v_name);
end
$$;

create or replace function app_delivery_canary.job_mail_done(p_token text, p_send uuid, p_ok boolean, p_detail text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app_delivery_canary.job_token_ok(p_token);
  update app_delivery_canary.email_sends e set
    status = case when p_ok then 'sent' else 'failed' end,
    provider_id = case when p_ok then left(coalesce(p_detail, ''), 100) else '' end,
    error = case when p_ok then '' else left(coalesce(p_detail, ''), 300) end
  from app_delivery_canary.canary_schedules s
  where e.id = p_send and e.status = 'reserved' and s.shop_id = e.shop_id and s.tag = app_delivery_canary.job_tag(p_token, s.shop_id);
  return found;
end
$$;

-- Shops whose weekly digest is due (a week after it was turned on, then
-- weekly), with the last 7 days of canaries and checks to sum up.
create or replace function app_delivery_canary.job_digest_due(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app_delivery_canary.job_token_ok(p_token);
  return (
    select coalesce(jsonb_agg(q), '[]'::jsonb) from (
      select s.shop_id as "shopId", sh.name as "shopName",
        (select coalesce(jsonb_agg(jsonb_build_object('created_at', o.created_at, 'status', o.status, 'placement', o.placement,
            'transit_seconds', o.transit_seconds, 'order_name', o.order_name, 'source', o.source) order by o.created_at), '[]'::jsonb)
          from app_delivery_canary.canary_orders o where o.shop_id = s.shop_id and o.created_at > now() - interval '7 days') as canaries,
        (select coalesce(jsonb_agg(jsonb_build_object('created_at', c.created_at, 'verdict', c.verdict, 'placement', c.placement) order by c.created_at), '[]'::jsonb)
          from (select c2.created_at, c2.verdict, c2.placement from app_delivery_canary.checks c2
                where c2.shop_id = s.shop_id and c2.created_at > now() - interval '7 days' order by c2.created_at desc limit 200) c) as checks
      from app_delivery_canary.canary_schedules s
      join app_delivery_canary.shops sh on sh.id = s.shop_id
      where s.digest and s.enabled and greatest(s.last_digest_at, s.digest_from) <= now() - interval '7 days'
        and s.tag = app_delivery_canary.job_tag(p_token, s.shop_id)
      limit 5
    ) q
  );
end
$$;

-- The unsubscribe link (checked by the function with the key) turns off
-- both kinds of email for the shop; the schedule itself keeps running.
create or replace function app_delivery_canary.job_unsubscribe(p_token text, p_shop uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app_delivery_canary.job_token_ok(p_token);
  update app_delivery_canary.canary_schedules s set alerts = false, digest = false, digest_from = null, updated_at = now()
  where s.shop_id = p_shop and s.tag = app_delivery_canary.job_tag(p_token, s.shop_id);
  return found;
end
$$;

-- Heartbeat: rows older than two days are forgotten, and at most 20 token
-- hashes are kept (the most recently seen).
create or replace function app_delivery_canary.job_heartbeat(p_token text, p_summary jsonb)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash text;
begin
  perform app_delivery_canary.job_token_ok(p_token);
  v_hash := encode(extensions.digest(p_token, 'sha256'), 'hex');
  perform pg_advisory_xact_lock(hashtextextended('app_delivery_canary.job_runs', 0));
  delete from app_delivery_canary.job_runs where last_run_at < now() - interval '2 days';
  update app_delivery_canary.job_runs set last_run_at = now(), runs = runs + 1, summary = coalesce(p_summary, '{}'::jsonb) where token_hash = v_hash;
  if found then
    return true;
  end if;
  insert into app_delivery_canary.job_runs (token_hash, runs, summary) values (v_hash, 1, coalesce(p_summary, '{}'::jsonb));
  -- Junk tokens cannot lock the real job out: the stalest rows beyond 20 go, and the real job refreshes its row every run.
  delete from app_delivery_canary.job_runs where token_hash in (
    select r.token_hash from app_delivery_canary.job_runs r order by r.last_run_at desc offset 20
  );
  return true;
end
$$;

create or replace function app_delivery_canary.job_last_run(p_token text)
returns timestamptz
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app_delivery_canary.job_token_ok(p_token);
  return (select r.last_run_at from app_delivery_canary.job_runs r where r.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex'));
end
$$;

-- Grants, written out in full.
grant usage on schema app_delivery_canary to anon;
revoke all on table app_delivery_canary.canary_schedules from public, anon, authenticated;
grant select (shop_id, user_id, enabled, cadence, weekday, hour, variant_id, variant_title, alerts, digest, next_run_at, last_run_at, last_outcome, digest_from, last_digest_at, created_at, updated_at)
  on app_delivery_canary.canary_schedules to authenticated;
grant delete on app_delivery_canary.canary_schedules to authenticated;
revoke all on table app_delivery_canary.email_sends from public, anon, authenticated;
grant select (id, shop_id, user_id, kind, status, created_at) on app_delivery_canary.email_sends to authenticated;
revoke all on table app_delivery_canary.job_runs from public, anon, authenticated;

revoke execute on function app_delivery_canary.canary_orders_source() from public, anon, authenticated;
revoke execute on function app_delivery_canary.shop_connections_drop_schedule() from public, anon, authenticated;
revoke execute on function app_delivery_canary.canary_next_slot(text, integer, integer, timestamptz) from public, anon, authenticated;
revoke execute on function app_delivery_canary.job_tag(text, uuid) from public, anon, authenticated;
revoke execute on function app_delivery_canary.job_token_ok(text) from public, anon, authenticated;
revoke execute on function app_delivery_canary.canary_schedule_save(uuid, boolean, text, integer, integer, text, text, boolean, boolean, text) from public, anon;
grant execute on function app_delivery_canary.canary_schedule_save(uuid, boolean, text, integer, integer, text, text, boolean, boolean, text) to authenticated;

revoke execute on function app_delivery_canary.job_claim(text) from public, authenticated;
revoke execute on function app_delivery_canary.job_canary_start(text, uuid, text, text) from public, authenticated;
revoke execute on function app_delivery_canary.job_canary_update(text, uuid, jsonb, jsonb) from public, authenticated;
revoke execute on function app_delivery_canary.job_waiting(text) from public, authenticated;
revoke execute on function app_delivery_canary.job_outcome(text, uuid, text) from public, authenticated;
revoke execute on function app_delivery_canary.job_mail_reserve(text, uuid, text, text) from public, authenticated;
revoke execute on function app_delivery_canary.job_mail_done(text, uuid, boolean, text) from public, authenticated;
revoke execute on function app_delivery_canary.job_digest_due(text) from public, authenticated;
revoke execute on function app_delivery_canary.job_unsubscribe(text, uuid) from public, authenticated;
revoke execute on function app_delivery_canary.job_heartbeat(text, jsonb) from public, authenticated;
revoke execute on function app_delivery_canary.job_last_run(text) from public, authenticated;
grant execute on function app_delivery_canary.job_claim(text) to anon;
grant execute on function app_delivery_canary.job_canary_start(text, uuid, text, text) to anon;
grant execute on function app_delivery_canary.job_canary_update(text, uuid, jsonb, jsonb) to anon;
grant execute on function app_delivery_canary.job_waiting(text) to anon;
grant execute on function app_delivery_canary.job_outcome(text, uuid, text) to anon;
grant execute on function app_delivery_canary.job_mail_reserve(text, uuid, text, text) to anon;
grant execute on function app_delivery_canary.job_mail_done(text, uuid, boolean, text) to anon;
grant execute on function app_delivery_canary.job_digest_due(text) to anon;
grant execute on function app_delivery_canary.job_unsubscribe(text, uuid) to anon;
grant execute on function app_delivery_canary.job_heartbeat(text, jsonb) to anon;
grant execute on function app_delivery_canary.job_last_run(text) to anon;
