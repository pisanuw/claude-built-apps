-- delivery-canary: first migration. Schema app_delivery_canary, applied by
-- the Deploy workflow (deploy/target.yml has `supabase: true`) through
-- `node platform/supabase-admin.mjs migrate delivery-canary`, then exposed
-- with `expose-schema app_delivery_canary`. Idempotent; a migration that has
-- run never changes (add 0002_<name>.sql instead).
--
-- What is stored: the shop's name, its delivery app and the size and hash
-- of its canary file (never the file); one row per delivery-email check with
-- the derived report (sender, subject, authentication results, link host and
-- result, findings), never the raw email; and a log of link tests (host
-- only) for the per-user rate limit of /api/link-check.

create schema if not exists app_delivery_canary;
comment on schema app_delivery_canary is 'delivery-canary: per-user data; dropping the schema retires the app.';

-- Shops: one per store the user watches.
create table if not exists app_delivery_canary.shops (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  delivery_app text not null default 'unknown' check (char_length(delivery_app) <= 40),
  -- The right file, as the last good link test saw it: {fileName, contentType, size, sha256, host, setAt}.
  baseline jsonb check (baseline is null or pg_column_size(baseline) < 4096),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table app_delivery_canary.shops is 'A shop the user watches: name, delivery app, canary file baseline (size and hash only).';
create index if not exists shops_user_idx on app_delivery_canary.shops (user_id, created_at);

-- Checks: one per delivery email checked.
create table if not exists app_delivery_canary.checks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  shop_id uuid not null references app_delivery_canary.shops(id) on delete cascade,
  created_at timestamptz not null default now(),
  verdict text not null check (verdict in ('pass', 'warn', 'fail')),
  placement text not null check (placement in ('inbox', 'promotions', 'spam', 'other', 'unknown')),
  subject text not null default '' check (char_length(subject) <= 500),
  report jsonb not null check (pg_column_size(report) < 65536)
);
comment on table app_delivery_canary.checks is 'One delivery-email check: verdict, placement and the derived report (no raw email).';
create index if not exists checks_user_shop_created_idx on app_delivery_canary.checks (user_id, shop_id, created_at);

-- Link tests: written by /api/link-check with the caller's token, read back
-- to count the last hour. No update or delete policy, so a user cannot
-- clear their own count.
create table if not exists app_delivery_canary.link_tests (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  host text not null check (char_length(host) <= 253)
);
comment on table app_delivery_canary.link_tests is 'Rate-limit log for /api/link-check: who tested which host when.';
create index if not exists link_tests_user_created_idx on app_delivery_canary.link_tests (user_id, created_at);

alter table app_delivery_canary.shops enable row level security;
alter table app_delivery_canary.checks enable row level security;
alter table app_delivery_canary.link_tests enable row level security;

drop policy if exists shops_select_own on app_delivery_canary.shops;
create policy shops_select_own on app_delivery_canary.shops for select to authenticated using (user_id = auth.uid());
drop policy if exists shops_insert_own on app_delivery_canary.shops;
create policy shops_insert_own on app_delivery_canary.shops for insert to authenticated with check (user_id = auth.uid());
drop policy if exists shops_update_own on app_delivery_canary.shops;
create policy shops_update_own on app_delivery_canary.shops for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists shops_delete_own on app_delivery_canary.shops;
create policy shops_delete_own on app_delivery_canary.shops for delete to authenticated using (user_id = auth.uid());

-- A check may only point at one of the user's own shops.
drop policy if exists checks_select_own on app_delivery_canary.checks;
create policy checks_select_own on app_delivery_canary.checks for select to authenticated using (user_id = auth.uid());
drop policy if exists checks_insert_own on app_delivery_canary.checks;
create policy checks_insert_own on app_delivery_canary.checks for insert to authenticated with check (
  user_id = auth.uid()
  and exists (select 1 from app_delivery_canary.shops s where s.id = shop_id and s.user_id = auth.uid())
);
drop policy if exists checks_update_own on app_delivery_canary.checks;
create policy checks_update_own on app_delivery_canary.checks for update to authenticated using (user_id = auth.uid()) with check (
  user_id = auth.uid()
  and exists (select 1 from app_delivery_canary.shops s where s.id = shop_id and s.user_id = auth.uid())
);
drop policy if exists checks_delete_own on app_delivery_canary.checks;
create policy checks_delete_own on app_delivery_canary.checks for delete to authenticated using (user_id = auth.uid());

drop policy if exists link_tests_select_own on app_delivery_canary.link_tests;
create policy link_tests_select_own on app_delivery_canary.link_tests for select to authenticated using (user_id = auth.uid());
drop policy if exists link_tests_insert_own on app_delivery_canary.link_tests;
create policy link_tests_insert_own on app_delivery_canary.link_tests for insert to authenticated with check (user_id = auth.uid());

-- Storage caps: without them any signed-in account could fill the shared
-- database. An account keeps at most 20 shops and 2,000 checks; the count
-- leaves out the row being written, so an upsert at the limit still works.
create or replace function app_delivery_canary.shops_limit()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (
    select count(*) from app_delivery_canary.shops
    where user_id = new.user_id and id <> new.id
  ) >= 20 then
    raise exception 'An account keeps at most 20 shops. Delete one and try again.';
  end if;
  return new;
end
$$;

drop trigger if exists shops_limit on app_delivery_canary.shops;
create trigger shops_limit
  before insert on app_delivery_canary.shops
  for each row execute function app_delivery_canary.shops_limit();

create or replace function app_delivery_canary.checks_limit()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (
    select count(*) from app_delivery_canary.checks
    where user_id = new.user_id and id <> new.id
  ) >= 2000 then
    raise exception 'An account keeps at most 2,000 checks. Delete old ones and try again.';
  end if;
  return new;
end
$$;

drop trigger if exists checks_limit on app_delivery_canary.checks;
create trigger checks_limit
  before insert on app_delivery_canary.checks
  for each row execute function app_delivery_canary.checks_limit();

-- Signed-in users only; anonymous visitors get no grants in app schemas.
-- link_tests: select and insert only (the identity column needs no sequence grant).
grant usage on schema app_delivery_canary to authenticated;
grant select, insert, update, delete on app_delivery_canary.shops to authenticated;
grant select, insert, update, delete on app_delivery_canary.checks to authenticated;
grant select, insert on app_delivery_canary.link_tests to authenticated;
revoke execute on function app_delivery_canary.shops_limit() from public, anon, authenticated;
revoke execute on function app_delivery_canary.checks_limit() from public, anon, authenticated;
