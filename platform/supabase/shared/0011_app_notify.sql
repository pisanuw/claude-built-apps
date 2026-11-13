-- App-notify: a daily email to people who asked an app to tell them what is
-- new there (owner, 10-11 Nov 2026; docs/platform.md "App-notify"; contract
-- in platform/src/notify/README.md).
--
-- NOT APPLIED YET: waits for the owner's yes. Order: apply-shared (this
-- file), check-schema platform, deploy-function app-notify, deploy-function
-- email-optout (per-app opt-out and one-click unsubscribe), then a daily
-- schedule (pg_cron, later).
--
-- Same rules as 0003: idempotent (create if not exists, create or replace,
-- revoke/grant); RLS on with no policies; anon and authenticated have no
-- table access and cannot execute the functions; every function is security
-- invoker (the default) with search_path '' and schema-qualified names, so
-- it runs with the caller's own rights: the service role of the app-notify
-- edge function. Nothing here is security definer.
--
-- Registration is the Supabase admin's (the "Supabase admin" workflow's
-- `sql` command runs as postgres): the service role may read the registry
-- and set only seeded_at, so no app, and no holder of the service-role key,
-- can register an app, change a feed URL or point the opt-in query at
-- another table. Registering an app (example, StepWise):
--
--   insert into platform.notify_apps (slug, display_name, feed_url,
--     opt_in_schema, opt_in_table, opt_in_user_column, opt_in_flag_column)
--   values ('stepwise', 'StepWise', 'https://stepwise.hintwise.org/releases.json',
--     'app_stepwise', 'preferences', 'user_id', 'notify_new_pages');
--   -- the app's own migration: grant usage on schema app_stepwise to service_role;
--   --                          grant select on app_stepwise.preferences to service_role;
--   update platform.notify_apps set enabled = true where slug = 'stepwise';
--
-- First run after enabling seeds: every item already in the feed is
-- recorded as seen (seed = true) and nobody is emailed; only items first
-- seen on a later run are sent. To start an app over (say after it was off
-- for a while), set seeded_at to null: the next run seeds again.
--
-- Account deletion: notify_sends.user_id references auth.users on delete
-- cascade, and platform is a HintWise schema, so delete_hintwise_data (0004)
-- deletes a person's rows with the account.

-- ---------------------------------------------------------------------------
-- The registry: one row per app that sends notify email
-- ---------------------------------------------------------------------------

create table if not exists platform.notify_apps (
  slug text primary key,
  display_name text not null,
  feed_url text not null,
  opt_in_schema text not null,
  opt_in_table text not null,
  opt_in_user_column text not null,
  opt_in_flag_column text not null,
  enabled boolean not null default false,
  seeded_at timestamptz,
  created_at timestamptz not null default now(),
  -- The slug is the From address's local part and the opt-out scope's
  -- suffix (email_optouts_scope_check allows the same).
  constraint notify_apps_slug_check check (slug ~ '^[a-z0-9][a-z0-9-]{0,62}$'),
  -- The From display name: no quotes, angle brackets, commas, dots or
  -- control characters, so it needs no quoting in a header.
  constraint notify_apps_display_name_check check (display_name ~ '^[A-Za-z0-9][A-Za-z0-9 &+''-]{0,39}$'),
  -- https on the app's own host, a plain path, no query, port or user info.
  constraint notify_apps_feed_url_check check (feed_url ~ ('^https://' || slug || '\.hintwise\.org/[A-Za-z0-9._~/-]{0,200}$')),
  -- The opt-in rows live in the app's own schema, nowhere else; the names
  -- are plain lower-case identifiers (and quoted with format %I anyway).
  constraint notify_apps_opt_in_schema_check check (opt_in_schema = 'app_' || replace(slug, '-', '_')),
  constraint notify_apps_opt_in_table_check check (opt_in_table ~ '^[a-z_][a-z0-9_]{0,62}$'),
  constraint notify_apps_opt_in_user_check check (opt_in_user_column ~ '^[a-z_][a-z0-9_]{0,62}$'),
  constraint notify_apps_opt_in_flag_check check (opt_in_flag_column ~ '^[a-z_][a-z0-9_]{0,62}$')
);
comment on table platform.notify_apps is 'App-notify registry: which apps email their opted-in people about new feed items, the feed, and where the opt-in flag lives. Written by the Supabase admin only; the service role reads it and sets seeded_at.';
comment on column platform.notify_apps.feed_url is 'The app''s public releases feed, https://<slug>.hintwise.org/<path> (format: platform/src/notify/README.md).';
comment on column platform.notify_apps.opt_in_table is 'A table or view in opt_in_schema with one row per user: opt_in_user_column (uuid, auth.users.id) and opt_in_flag_column (boolean, true = send).';
comment on column platform.notify_apps.seeded_at is 'When the first run recorded the items already in the feed as seen (null: the next run seeds and sends nothing).';

-- ---------------------------------------------------------------------------
-- Feed items seen, per app
-- ---------------------------------------------------------------------------

create table if not exists platform.notify_items_seen (
  app text not null references platform.notify_apps(slug) on delete cascade,
  item_id text not null,
  seed boolean not null default false,
  first_seen_at timestamptz not null default now(),
  constraint notify_items_seen_pkey primary key (app, item_id),
  constraint notify_items_seen_item_check check (item_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$')
);
comment on table platform.notify_items_seen is 'Every feed item app-notify has seen, and when; seed = true for the items already there on the first run (never emailed).';

-- ---------------------------------------------------------------------------
-- Sends: one row per person, app and day (the daily cap), with the items
-- ---------------------------------------------------------------------------

create table if not exists platform.notify_sends (
  id bigint generated always as identity primary key,
  app text not null references platform.notify_apps(slug) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  item_ids text[] not null,
  status text not null default 'pending',
  resend_id text,
  error text,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  constraint notify_sends_once_a_day unique (app, user_id, day),
  constraint notify_sends_items_check check (cardinality(item_ids) between 1 and 20),
  constraint notify_sends_status_check check (status in ('pending', 'sent', 'failed')),
  constraint notify_sends_error_check check (error is null or length(error) <= 300),
  constraint notify_sends_resend_id_check check (resend_id is null or length(resend_id) <= 100)
);
comment on table platform.notify_sends is 'App-notify emails: at most one per person, app and day (UTC). Items of a pending or sent row count as sent (a crash between claim and send loses an item rather than sending it twice); a failed row''s items go again on a later day.';
create index if not exists notify_sends_user_idx on platform.notify_sends (app, user_id);

-- ---------------------------------------------------------------------------
-- notify_apps_enabled: the registry rows to run
-- ---------------------------------------------------------------------------

create or replace function platform.notify_apps_enabled()
returns table (slug text, display_name text, feed_url text, seeded boolean)
language sql
stable
set search_path = ''
as $$
  select a.slug, a.display_name, a.feed_url, a.seeded_at is not null
    from platform.notify_apps a
   where a.enabled
   order by a.slug;
$$;
comment on function platform.notify_apps_enabled() is 'App-notify: the enabled apps, their From name, feed and whether they are seeded.';

-- ---------------------------------------------------------------------------
-- notify_observe: record the feed's item ids; the first run seeds
-- ---------------------------------------------------------------------------

create or replace function platform.notify_observe(p_app text, p_item_ids text[])
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_seeded timestamptz;
  v_new int;
begin
  if cardinality(coalesce(p_item_ids, '{}'::text[])) > 500 then
    raise exception 'notify_observe: at most 500 items' using errcode = '22023';
  end if;
  select a.seeded_at into v_seeded from platform.notify_apps a where a.slug = p_app and a.enabled for update;
  if not found then
    raise exception 'notify_observe: no enabled app %', p_app using errcode = 'P0002';
  end if;
  insert into platform.notify_items_seen (app, item_id, seed)
  select p_app, i, v_seeded is null from unnest(coalesce(p_item_ids, '{}'::text[])) i
  on conflict (app, item_id) do nothing;
  get diagnostics v_new = row_count;
  if v_seeded is null then
    update platform.notify_apps set seeded_at = now() where slug = p_app;
    return jsonb_build_object('seeding', true, 'new', 0, 'seeded', v_new);
  end if;
  return jsonb_build_object('seeding', false, 'new', v_new, 'seeded', 0);
end;
$$;
comment on function platform.notify_observe(text, text[]) is 'App-notify: records the feed''s item ids as seen. On the app''s first run they are all seed items (never emailed) and the app is marked seeded. Returns { seeding, new, seeded }.';

-- ---------------------------------------------------------------------------
-- notify_opted_in: (user_id, email) of the people who opted in to an app
-- ---------------------------------------------------------------------------
-- Dynamic SQL over the registry's identifiers, which the check constraints
-- keep to plain names in the app's own schema, and which format('%I')
-- quotes regardless. Runs as the caller (service role): the app grants it
-- select on its opt-in table. Only confirmed, not deleted, not banned
-- accounts with an address. A flag column that is not boolean, or a user
-- column that is not a uuid, makes the query fail: nothing is sent.

create or replace function platform.notify_opted_in(p_app text)
returns table (user_id uuid, email text)
language plpgsql
stable
set search_path = ''
as $$
declare
  r platform.notify_apps%rowtype;
begin
  select * into r from platform.notify_apps a where a.slug = p_app and a.enabled;
  if not found then
    raise exception 'notify_opted_in: no enabled app %', p_app using errcode = 'P0002';
  end if;
  return query execute format(
    'select u.id, u.email::text from %I.%I t join auth.users u on u.id = t.%I '
    'where t.%I is true and u.email is not null and u.deleted_at is null '
    'and u.email_confirmed_at is not null and (u.banned_until is null or u.banned_until <= now())',
    r.opt_in_schema, r.opt_in_table, r.opt_in_user_column, r.opt_in_flag_column);
end;
$$;
comment on function platform.notify_opted_in(text) is 'App-notify: the opted-in people of an enabled app (its registry''s table and flag), with their confirmed address.';

-- ---------------------------------------------------------------------------
-- notify_due: who gets an email today, and which items
-- ---------------------------------------------------------------------------
-- Items: in the current feed (p_item_ids), first seen after the seed and
-- within p_window_days of p_day, and not in one of the person's pending or
-- sent rows. People: opted in, no row for this app on p_day yet.

create or replace function platform.notify_due(p_app text, p_item_ids text[], p_day date, p_window_days int default 14, p_limit int default 1000)
returns table (user_id uuid, email text, item_ids text[])
language sql
stable
set search_path = ''
as $$
  with eligible as (
    select s.item_id
      from platform.notify_items_seen s
     where s.app = p_app
       and not s.seed
       and s.item_id = any (coalesce(p_item_ids, '{}'::text[]))
       and s.first_seen_at >= (p_day - greatest(1, least(coalesce(p_window_days, 14), 60)))::timestamptz
  ),
  people as (
    select o.user_id, o.email
      from platform.notify_opted_in(p_app) o
     where not exists (select 1 from platform.notify_sends x where x.app = p_app and x.user_id = o.user_id and x.day = p_day)
  )
  select p.user_id, p.email, array_agg(e.item_id order by e.item_id)
    from people p
    cross join eligible e
   where not exists (
     select 1 from platform.notify_sends x
      where x.app = p_app and x.user_id = p.user_id and x.status <> 'failed' and e.item_id = any (x.item_ids))
   group by p.user_id, p.email
   order by p.user_id
   limit greatest(1, least(coalesce(p_limit, 1000), 5000));
$$;
comment on function platform.notify_due(text, text[], date, int, int) is 'App-notify: the opted-in people with no email from this app on p_day, and the feed items each has not been sent (first seen after the seed, within the window).';

-- ---------------------------------------------------------------------------
-- notify_claim / notify_finish: one email per person, app and day
-- ---------------------------------------------------------------------------

create or replace function platform.notify_claim(p_app text, p_user_id uuid, p_item_ids text[], p_day date)
returns bigint
language sql
set search_path = ''
as $$
  insert into platform.notify_sends (app, user_id, day, item_ids)
  values (p_app, p_user_id, p_day, p_item_ids)
  on conflict (app, user_id, day) do nothing
  returning id;
$$;
comment on function platform.notify_claim(text, uuid, text[], date) is 'App-notify: claims today''s one email for a person and app before it is sent; null when the day is already taken (another run, or already sent).';

create or replace function platform.notify_finish(p_id bigint, p_resend_id text, p_error text)
returns void
language sql
set search_path = ''
as $$
  update platform.notify_sends
     set status = case when p_error is null then 'sent' else 'failed' end,
         resend_id = left(p_resend_id, 100),
         error = left(p_error, 300),
         finished_at = now()
   where id = p_id and status = 'pending';
$$;
comment on function platform.notify_finish(bigint, text, text) is 'App-notify: marks a claimed email sent (with Resend''s id) or failed (with the error; its items go again on a later day).';

-- ---------------------------------------------------------------------------
-- Row level security and grants: service role only, registry read-only
-- ---------------------------------------------------------------------------

alter table platform.notify_apps enable row level security;        -- no policies: service role only
alter table platform.notify_items_seen enable row level security;  -- no policies: service role only
alter table platform.notify_sends enable row level security;       -- no policies: service role only

revoke all on table platform.notify_apps from public, anon, authenticated, service_role;
revoke all on table platform.notify_items_seen from public, anon, authenticated, service_role;
revoke all on table platform.notify_sends from public, anon, authenticated, service_role;
grant select on table platform.notify_apps to service_role;
grant update (seeded_at) on table platform.notify_apps to service_role;
grant select, insert on table platform.notify_items_seen to service_role;
grant select, insert, update on table platform.notify_sends to service_role;

revoke all on function platform.notify_apps_enabled() from public, anon, authenticated;
revoke all on function platform.notify_observe(text, text[]) from public, anon, authenticated;
revoke all on function platform.notify_opted_in(text) from public, anon, authenticated;
revoke all on function platform.notify_due(text, text[], date, int, int) from public, anon, authenticated;
revoke all on function platform.notify_claim(text, uuid, text[], date) from public, anon, authenticated;
revoke all on function platform.notify_finish(bigint, text, text) from public, anon, authenticated;

grant execute on function platform.notify_apps_enabled() to service_role;
grant execute on function platform.notify_observe(text, text[]) to service_role;
grant execute on function platform.notify_opted_in(text) to service_role;
grant execute on function platform.notify_due(text, text[], date, int, int) to service_role;
grant execute on function platform.notify_claim(text, uuid, text[], date) to service_role;
grant execute on function platform.notify_finish(bigint, text, text) to service_role;
