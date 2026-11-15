-- delivery-canary: Shopify connection and canary orders (milestone 4).
-- Applied by the Deploy workflow like 0001. Idempotent; never edited once
-- applied (add 0005_<name>.sql).
--
-- shop_connections: one per shop, the shop's own Dev Dashboard app
-- (myshopify domain, client ID, granted scopes, the shop's name in Shopify)
-- and its client secret sealed by the Netlify function (AES-256-GCM with
-- DELIVERY_CANARY_KEY, bound to the user, shop, domain and client ID). The
-- database never sees the secret itself. Column-level SELECT leaves the
-- sealed column out of every table read; the function reads it through
-- shop_connection_secret with the user's token. Rows are written only
-- through shop_connection_save, which checks the shop is the caller's; the
-- browser may delete its own row (disconnect).
--
-- shopify_calls: rate-limit log of calls the function makes to a shop's
-- Admin API for the user (60 an hour per user).
--
-- canary_orders: one per test order placed in the shop for its seed inbox:
-- the product variant, Shopify's order name, when it was placed and when
-- (and where) the download email arrived. Inserted by the function with the
-- user's token before it places the order; the insert trigger allows 5 a day
-- per user, because every canary is a real (free) order in the shop.

create table if not exists app_delivery_canary.shop_connections (
  shop_id uuid primary key references app_delivery_canary.shops(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  shop_domain text not null check (shop_domain ~ '^[a-z0-9][a-z0-9-]{0,59}\.myshopify\.com$'),
  client_id text not null check (client_id ~ '^[A-Za-z0-9_-]{16,128}$'),
  secret text not null check (char_length(secret) <= 800 and secret like 'v1.%'),
  scopes text not null default '' check (char_length(scopes) <= 500),
  shop_name text not null default '' check (char_length(shop_name) <= 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table app_delivery_canary.shop_connections is 'A shop''s own Shopify app: domain, client ID, scopes, and the client secret sealed by the function.';
create index if not exists shop_connections_user_idx on app_delivery_canary.shop_connections (user_id);

create table if not exists app_delivery_canary.shopify_calls (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind text not null check (kind in ('connect', 'products', 'orders', 'canary')),
  created_at timestamptz not null default now()
);
comment on table app_delivery_canary.shopify_calls is 'Rate-limit log for the Shopify routes of the api function.';
create index if not exists shopify_calls_user_created_idx on app_delivery_canary.shopify_calls (user_id, created_at);

create table if not exists app_delivery_canary.canary_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  shop_id uuid not null references app_delivery_canary.shops(id) on delete cascade,
  created_at timestamptz not null default now(),
  variant_id text not null check (variant_id ~ '^gid://shopify/ProductVariant/[0-9]{1,20}$'),
  variant_title text not null default '' check (char_length(variant_title) <= 300),
  status text not null default 'placing' check (status in ('placing', 'placed', 'failed', 'arrived', 'no-email')),
  order_id text check (order_id is null or order_id ~ '^gid://shopify/Order/[0-9]{1,20}$'),
  order_name text not null default '' check (char_length(order_name) <= 40),
  placed_at timestamptz,
  arrived_at timestamptz,
  transit_seconds integer check (transit_seconds is null or transit_seconds between 0 and 31536000),
  placement text check (placement is null or placement in ('inbox', 'promotions', 'spam', 'other', 'unknown')),
  seed_where text check (seed_where is null or seed_where in ('primary', 'promotions', 'social', 'updates', 'forums', 'archived', 'spam')),
  check_id uuid references app_delivery_canary.checks(id) on delete set null,
  error text not null default '' check (char_length(error) <= 500),
  updated_at timestamptz not null default now()
);
comment on table app_delivery_canary.canary_orders is 'A free test order placed in the shop for the seed inbox, and when and where its download email arrived.';
create index if not exists canary_orders_user_created_idx on app_delivery_canary.canary_orders (user_id, created_at);
create index if not exists canary_orders_shop_created_idx on app_delivery_canary.canary_orders (shop_id, created_at);

alter table app_delivery_canary.shop_connections enable row level security;
alter table app_delivery_canary.shopify_calls enable row level security;
alter table app_delivery_canary.canary_orders enable row level security;

drop policy if exists shop_connections_select_own on app_delivery_canary.shop_connections;
create policy shop_connections_select_own on app_delivery_canary.shop_connections for select to authenticated using (user_id = auth.uid());
drop policy if exists shop_connections_delete_own on app_delivery_canary.shop_connections;
create policy shop_connections_delete_own on app_delivery_canary.shop_connections for delete to authenticated using (user_id = auth.uid());

drop policy if exists shopify_calls_select_own on app_delivery_canary.shopify_calls;
create policy shopify_calls_select_own on app_delivery_canary.shopify_calls for select to authenticated using (user_id = auth.uid());
drop policy if exists shopify_calls_insert_own on app_delivery_canary.shopify_calls;
create policy shopify_calls_insert_own on app_delivery_canary.shopify_calls for insert to authenticated with check (user_id = auth.uid());

-- A canary may only point at one of the user's own shops (and own check).
drop policy if exists canary_orders_select_own on app_delivery_canary.canary_orders;
create policy canary_orders_select_own on app_delivery_canary.canary_orders for select to authenticated using (user_id = auth.uid());
drop policy if exists canary_orders_insert_own on app_delivery_canary.canary_orders;
create policy canary_orders_insert_own on app_delivery_canary.canary_orders for insert to authenticated with check (
  user_id = auth.uid()
  and exists (select 1 from app_delivery_canary.shops s where s.id = shop_id and s.user_id = auth.uid())
);
drop policy if exists canary_orders_update_own on app_delivery_canary.canary_orders;
create policy canary_orders_update_own on app_delivery_canary.canary_orders for update to authenticated using (user_id = auth.uid()) with check (
  user_id = auth.uid()
  and exists (select 1 from app_delivery_canary.shops s where s.id = shop_id and s.user_id = auth.uid())
  and (check_id is null or exists (select 1 from app_delivery_canary.checks c where c.id = check_id and c.user_id = auth.uid()))
);

-- Rate limit of Admin API calls: 60 an hour per user. Atomic per user, like
-- link_tests_limit; created_at fixed to now(); rows over a day old pruned.
create or replace function app_delivery_canary.shopify_calls_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('app_delivery_canary.shopify_calls:' || new.user_id::text, 0));
  new.created_at := now();
  delete from app_delivery_canary.shopify_calls where user_id = new.user_id and created_at < now() - interval '1 day';
  if (
    select count(*) from app_delivery_canary.shopify_calls
    where user_id = new.user_id and created_at > now() - interval '1 hour'
  ) >= 60 then
    raise sqlstate 'PT429' using message = 'You have made 60 Shopify requests in the last hour. Try again later.';
  end if;
  return new;
end
$$;

drop trigger if exists shopify_calls_limit on app_delivery_canary.shopify_calls;
create trigger shopify_calls_limit
  before insert on app_delivery_canary.shopify_calls
  for each row execute function app_delivery_canary.shopify_calls_limit();

-- Canary orders: 5 a day per user (each is a real order in the shop), at
-- most 500 kept per account (the oldest beyond that are removed), and the
-- row starts as 'placing' whatever the caller sent.
create or replace function app_delivery_canary.canary_orders_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('app_delivery_canary.canary_orders:' || new.user_id::text, 0));
  new.created_at := now();
  new.updated_at := now();
  new.status := 'placing';
  new.order_id := null;
  new.order_name := '';
  new.placed_at := null;
  new.arrived_at := null;
  new.transit_seconds := null;
  new.placement := null;
  new.seed_where := null;
  new.check_id := null;
  if (
    select count(*) from app_delivery_canary.canary_orders
    where user_id = new.user_id and created_at > now() - interval '1 day'
  ) >= 5 then
    raise sqlstate 'PT429' using message = 'You have placed 5 canary orders in the last day. Try again tomorrow.';
  end if;
  delete from app_delivery_canary.canary_orders where id in (
    select id from app_delivery_canary.canary_orders where user_id = new.user_id
    order by created_at desc offset 499
  );
  return new;
end
$$;

drop trigger if exists canary_orders_limit on app_delivery_canary.canary_orders;
create trigger canary_orders_limit
  before insert on app_delivery_canary.canary_orders
  for each row execute function app_delivery_canary.canary_orders_limit();

-- Updates keep the row's owner, shop, product and creation time (the
-- product's title may change: Shopify's own line item name replaces the one
-- the page sent).
create or replace function app_delivery_canary.canary_orders_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.id := old.id;
  new.user_id := old.user_id;
  new.shop_id := old.shop_id;
  new.created_at := old.created_at;
  new.variant_id := old.variant_id;
  new.updated_at := now();
  return new;
end
$$;

drop trigger if exists canary_orders_touch on app_delivery_canary.canary_orders;
create trigger canary_orders_touch
  before update on app_delivery_canary.canary_orders
  for each row execute function app_delivery_canary.canary_orders_touch();

-- Saves a shop's Shopify connection (the function calls it with the user's
-- own token once Shopify accepted the credentials). Runs as the owner (the
-- table has no insert or update grant), so it checks the caller and the
-- shop itself.
create or replace function app_delivery_canary.shop_connection_save(
  p_shop uuid,
  p_domain text,
  p_client_id text,
  p_secret text,
  p_scopes text,
  p_shop_name text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  if not exists (select 1 from app_delivery_canary.shops s where s.id = p_shop and s.user_id = v_user) then
    raise exception 'That shop is not yours.' using errcode = '42501';
  end if;
  insert into app_delivery_canary.shop_connections as t (shop_id, user_id, shop_domain, client_id, secret, scopes, shop_name)
  values (p_shop, v_user, lower(p_domain), p_client_id, p_secret, coalesce(p_scopes, ''), coalesce(p_shop_name, ''))
  on conflict (shop_id) do update set
    shop_domain = excluded.shop_domain,
    client_id = excluded.client_id,
    secret = excluded.secret,
    scopes = excluded.scopes,
    shop_name = excluded.shop_name,
    updated_at = now()
  where t.user_id = v_user;
  return found;
end
$$;

-- The connection of one of the caller's shops with its sealed secret, for
-- the function to open; no row when the shop is not connected.
create or replace function app_delivery_canary.shop_connection_secret(p_shop uuid)
returns table (shop_domain text, client_id text, secret text)
language sql
stable
security definer
set search_path = ''
as $$
  select t.shop_domain, t.client_id, t.secret from app_delivery_canary.shop_connections t
  where t.shop_id = p_shop and t.user_id = auth.uid();
$$;

-- Grants, written out in full.
revoke all on table app_delivery_canary.shop_connections from public, anon, authenticated;
grant select (shop_id, user_id, shop_domain, client_id, scopes, shop_name, created_at, updated_at)
  on app_delivery_canary.shop_connections to authenticated;
grant delete on app_delivery_canary.shop_connections to authenticated;
revoke all on table app_delivery_canary.shopify_calls from public, anon, authenticated;
grant select, insert on app_delivery_canary.shopify_calls to authenticated;
revoke all on table app_delivery_canary.canary_orders from public, anon, authenticated;
grant select, insert on app_delivery_canary.canary_orders to authenticated;
grant update (variant_title, status, order_id, order_name, placed_at, arrived_at, transit_seconds, placement, seed_where, check_id, error)
  on app_delivery_canary.canary_orders to authenticated;

revoke execute on function app_delivery_canary.shopify_calls_limit() from public, anon, authenticated;
revoke execute on function app_delivery_canary.canary_orders_limit() from public, anon, authenticated;
revoke execute on function app_delivery_canary.canary_orders_touch() from public, anon, authenticated;
revoke execute on function app_delivery_canary.shop_connection_save(uuid, text, text, text, text, text) from public, anon;
grant execute on function app_delivery_canary.shop_connection_save(uuid, text, text, text, text, text) to authenticated;
revoke execute on function app_delivery_canary.shop_connection_secret(uuid) from public, anon;
grant execute on function app_delivery_canary.shop_connection_secret(uuid) to authenticated;
