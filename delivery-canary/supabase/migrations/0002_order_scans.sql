-- delivery-canary: order scans (milestone 2). Applied by the Deploy workflow
-- like 0001. Idempotent; never edited once applied (add 0003_<name>.sql).
--
-- One row per Shopify orders export the shop scanned. The browser reads the
-- file and keeps only order numbers, dates, statuses and product names, so
-- customer emails, names, phones and addresses never reach this table. The
-- summary holds the counts and the late orders (at most 500).
-- unique (shop_id, file_sha256): scanning the same file again updates its row.

create table if not exists app_delivery_canary.order_scans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  shop_id uuid not null references app_delivery_canary.shops(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  file_sha256 text not null check (file_sha256 ~ '^[0-9a-f]{64}$'),
  file_name text not null default '' check (char_length(file_name) <= 200),
  grace_minutes integer not null check (grace_minutes between 5 and 10080),
  orders_total integer not null check (orders_total between 0 and 100000),
  flagged integer not null check (flagged between 0 and 100000),
  summary jsonb not null check (pg_column_size(summary) < 262144),
  constraint order_scans_shop_file_key unique (shop_id, file_sha256)
);
comment on table app_delivery_canary.order_scans is 'One scan of a Shopify orders export: counts and late orders (order numbers, dates, product names), no customer data.';
create index if not exists order_scans_user_shop_updated_idx on app_delivery_canary.order_scans (user_id, shop_id, updated_at);

alter table app_delivery_canary.order_scans enable row level security;

-- Own rows only, and a scan may only point at one of the user's own shops.
drop policy if exists order_scans_select_own on app_delivery_canary.order_scans;
create policy order_scans_select_own on app_delivery_canary.order_scans for select to authenticated using (user_id = auth.uid());
drop policy if exists order_scans_insert_own on app_delivery_canary.order_scans;
create policy order_scans_insert_own on app_delivery_canary.order_scans for insert to authenticated with check (
  user_id = auth.uid()
  and exists (select 1 from app_delivery_canary.shops s where s.id = shop_id and s.user_id = auth.uid())
);
drop policy if exists order_scans_update_own on app_delivery_canary.order_scans;
create policy order_scans_update_own on app_delivery_canary.order_scans for update to authenticated using (user_id = auth.uid()) with check (
  user_id = auth.uid()
  and exists (select 1 from app_delivery_canary.shops s where s.id = shop_id and s.user_id = auth.uid())
);
drop policy if exists order_scans_delete_own on app_delivery_canary.order_scans;
create policy order_scans_delete_own on app_delivery_canary.order_scans for delete to authenticated using (user_id = auth.uid());

-- Storage cap: at most 200 scans per account (the count leaves out the row
-- being written, so an upsert at the limit still works).
create or replace function app_delivery_canary.order_scans_limit()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('app_delivery_canary.order_scans:' || new.user_id::text, 0));
  if (
    select count(*) from app_delivery_canary.order_scans
    where user_id = new.user_id and id <> new.id
  ) >= 200 then
    raise exception 'An account keeps at most 200 order scans. Delete old ones and try again.';
  end if;
  return new;
end
$$;

drop trigger if exists order_scans_limit on app_delivery_canary.order_scans;
create trigger order_scans_limit
  before insert on app_delivery_canary.order_scans
  for each row execute function app_delivery_canary.order_scans_limit();

grant select, insert, update, delete on app_delivery_canary.order_scans to authenticated;
revoke execute on function app_delivery_canary.order_scans_limit() from public, anon, authenticated;
