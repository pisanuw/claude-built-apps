-- teacher-catalog-kit: first migration. Schema app_teacher_catalog_kit.
-- Applied by the Deploy workflow (deploy/target.yml `supabase: true`)
-- through `node platform/supabase-admin.mjs migrate teacher-catalog-kit`,
-- then exposed with `expose-schema app_teacher_catalog_kit`. Idempotent. A
-- migration that has run must never change (the migrate command refuses a
-- changed file): add 0002_<name>.sql instead.
--
-- Storage caps from the start (Qualified Overtime Checker needed them after
-- its security review): an account keeps at most 2,000 resources, titles and
-- notes are bounded, and a resource's other-store listings are a small array.

create schema if not exists app_teacher_catalog_kit;
comment on schema app_teacher_catalog_kit is 'Teacher Catalog Kit: a teacher-author''s resource catalog and seller settings per user; dropping the schema retires the app.';

-- One teaching resource. user_id comes from auth.uid(), never from the
-- browser. tpt_price_cents is the marketplace price (null: not listed there);
-- listings holds the other stores it is sold on:
-- [{"store": "payhip", "priceCents": 400, "url": "https://..."}].
create table if not exists app_teacher_catalog_kit.resources (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null,
  product_type text not null,
  tpt_price_cents integer,
  tpt_id text,
  listings jsonb not null default '[]'::jsonb,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint resources_title_len check (char_length(title) between 1 and 300),
  constraint resources_type_len check (char_length(product_type) between 1 and 40),
  constraint resources_price_range check (tpt_price_cents is null or tpt_price_cents between 0 and 10000000),
  constraint resources_tpt_id_len check (tpt_id is null or char_length(tpt_id) between 1 and 64),
  constraint resources_listings_shape check (jsonb_typeof(listings) = 'array' and jsonb_array_length(listings) <= 20),
  constraint resources_listings_size check (pg_column_size(listings) < 16384),
  constraint resources_notes_len check (char_length(notes) <= 2000)
);
comment on table app_teacher_catalog_kit.resources is 'One teaching resource owned by user_id: type, marketplace price and other-store listings.';
create index if not exists resources_user_created_idx on app_teacher_catalog_kit.resources (user_id, created_at);
-- Re-importing the marketplace's CSV matches rows by product id (milestone 2).
create unique index if not exists resources_user_tpt_id_key on app_teacher_catalog_kit.resources (user_id, tpt_id) where tpt_id is not null;

-- One row per user: the seller tier they are on or weighing, and opt-ins.
create table if not exists app_teacher_catalog_kit.seller_settings (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  tier text not null default 'undecided',
  updated_at timestamptz not null default now(),
  constraint seller_settings_tier check (tier in ('undecided', 'exclusive', 'basic'))
);
comment on table app_teacher_catalog_kit.seller_settings is 'Per-user seller tier (undecided, exclusive or basic).';

-- updated_at follows every update.
create or replace function app_teacher_catalog_kit.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end
$$;

drop trigger if exists resources_touch on app_teacher_catalog_kit.resources;
create trigger resources_touch before update on app_teacher_catalog_kit.resources
  for each row execute function app_teacher_catalog_kit.touch_updated_at();
drop trigger if exists seller_settings_touch on app_teacher_catalog_kit.seller_settings;
create trigger seller_settings_touch before update on app_teacher_catalog_kit.seller_settings
  for each row execute function app_teacher_catalog_kit.touch_updated_at();

-- At most 2,000 resources per account. The count leaves out the row being
-- written, so an upsert of an existing resource still works at the limit.
create or replace function app_teacher_catalog_kit.resources_limit()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (
    select count(*) from app_teacher_catalog_kit.resources
    where user_id = new.user_id and id <> new.id
  ) >= 2000 then
    raise exception 'An account keeps at most 2,000 resources. Delete some and try again.';
  end if;
  return new;
end
$$;

drop trigger if exists resources_limit on app_teacher_catalog_kit.resources;
create trigger resources_limit before insert on app_teacher_catalog_kit.resources
  for each row execute function app_teacher_catalog_kit.resources_limit();

alter table app_teacher_catalog_kit.resources enable row level security;
alter table app_teacher_catalog_kit.seller_settings enable row level security;

drop policy if exists resources_select_own on app_teacher_catalog_kit.resources;
create policy resources_select_own on app_teacher_catalog_kit.resources for select to authenticated using (user_id = auth.uid());
drop policy if exists resources_insert_own on app_teacher_catalog_kit.resources;
create policy resources_insert_own on app_teacher_catalog_kit.resources for insert to authenticated with check (user_id = auth.uid());
drop policy if exists resources_update_own on app_teacher_catalog_kit.resources;
create policy resources_update_own on app_teacher_catalog_kit.resources for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists resources_delete_own on app_teacher_catalog_kit.resources;
create policy resources_delete_own on app_teacher_catalog_kit.resources for delete to authenticated using (user_id = auth.uid());

drop policy if exists seller_settings_select_own on app_teacher_catalog_kit.seller_settings;
create policy seller_settings_select_own on app_teacher_catalog_kit.seller_settings for select to authenticated using (user_id = auth.uid());
drop policy if exists seller_settings_insert_own on app_teacher_catalog_kit.seller_settings;
create policy seller_settings_insert_own on app_teacher_catalog_kit.seller_settings for insert to authenticated with check (user_id = auth.uid());
drop policy if exists seller_settings_update_own on app_teacher_catalog_kit.seller_settings;
create policy seller_settings_update_own on app_teacher_catalog_kit.seller_settings for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists seller_settings_delete_own on app_teacher_catalog_kit.seller_settings;
create policy seller_settings_delete_own on app_teacher_catalog_kit.seller_settings for delete to authenticated using (user_id = auth.uid());

-- Signed-in users only; anonymous visitors get no grants in app schemas.
grant usage on schema app_teacher_catalog_kit to authenticated;
grant select, insert, update, delete on all tables in schema app_teacher_catalog_kit to authenticated;
alter default privileges in schema app_teacher_catalog_kit grant select, insert, update, delete on tables to authenticated;
