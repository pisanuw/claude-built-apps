-- Self-service account deletion ("Delete my account", docs/platform.md).
--
-- Applied by `node platform/supabase-admin.mjs apply-shared` after
-- 0003_email_optout.sql, before the delete-account edge function is
-- deployed. Idempotent: create or replace, revoke/grant.
--
-- The Supabase project is shared: besides the HintWise schemas (platform and
-- every app_<slug>), other live apps keep data keyed on the same auth user
-- (wcv, public, 11 Nov 2026 inventory: platform/supabase/queries/
-- auth-user-references.sql). Deleting the auth user would cascade into their
-- tables. So deletion has two steps:
--
--   1. platform.delete_hintwise_data(uid) deletes the user's rows in
--      platform and every app_% schema: for each column there with a foreign
--      key to auth.users, rows with that user are deleted, or the column is
--      set to null where the key says "on delete set null" (llm_usage keeps
--      its cost rows without the user). It then reports whether any table
--      outside those schemas still refers to the user.
--   2. The delete-account function deletes the auth user (Auth admin API)
--      only when nothing else refers to it; otherwise the sign-in stays and
--      the person is told so.
--
-- platform.email_optouts is kept: it holds only a keyed hash, and a deleted
-- account's "Stop all email" must keep working.
--
-- Only the service role may run these. They are security definer (run as
-- their owner, the migration role) because the service role does not hold
-- table rights in every app schema (StepWise grants it single tables only);
-- execute is revoked from public, anon and authenticated. search_path is
-- pinned to '' and every object is schema-qualified; identifiers in dynamic
-- SQL go through format(%I), the user id is always a bound parameter.

create or replace function platform.account_references(p_uid uuid)
returns table (schema_name text, table_name text, column_name text, on_delete text, hintwise boolean)
language sql stable security definer set search_path = '' as $$
  select n.nspname::text, c.relname::text, a.attname::text,
         case con.confdeltype when 'c' then 'cascade' when 'n' then 'set null'
           when 'd' then 'set default' when 'r' then 'restrict' else 'no action' end,
         (n.nspname = 'platform' or n.nspname like 'app\_%')
    from pg_catalog.pg_constraint con
    join pg_catalog.pg_class c on c.oid = con.conrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    join pg_catalog.pg_attribute a on a.attrelid = c.oid and a.attnum = con.conkey[1]
   where con.contype = 'f' and con.confrelid = 'auth.users'::regclass
     and pg_catalog.array_length(con.conkey, 1) = 1
     and con.confkey = array[(select ua.attnum from pg_catalog.pg_attribute ua
                                where ua.attrelid = 'auth.users'::regclass and ua.attname = 'id')]
     and n.nspname <> 'auth'
$$;

comment on function platform.account_references(uuid) is 'Every single-column foreign key to auth.users outside auth, and whether it is in a HintWise schema (platform, app_%). The argument is unused; it keeps the signature next to delete_hintwise_data.';

-- Columns that hold a user id without a foreign key, in other apps. Checked
-- by delete_hintwise_data so the sign-in is kept for their users too.
-- Add a row here when the inventory finds a new one.
create table if not exists platform.account_soft_references (
  schema_name text not null,
  table_name text not null,
  column_name text not null,
  primary key (schema_name, table_name, column_name)
);
alter table platform.account_soft_references enable row level security;
insert into platform.account_soft_references values ('public', 'attempts', 'user_id')
  on conflict do nothing;

create or replace function platform.delete_hintwise_data(p_uid uuid)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  r record;
  n bigint;
  found boolean;
  deleted jsonb := '{}'::jsonb;
  others text[] := '{}';
begin
  if p_uid is null then
    raise exception 'delete_hintwise_data: no user' using errcode = '22004';
  end if;

  -- 1. HintWise rows. platform.profiles last, so app rows go first.
  for r in
    select * from platform.account_references(p_uid)
     where hintwise
     order by (schema_name = 'platform' and table_name = 'profiles'), schema_name, table_name, column_name
  loop
    if r.on_delete = 'set null' then
      execute format('update %I.%I set %I = null where %I = $1', r.schema_name, r.table_name, r.column_name, r.column_name) using p_uid;
    else
      execute format('delete from %I.%I where %I = $1', r.schema_name, r.table_name, r.column_name) using p_uid;
    end if;
    get diagnostics n = row_count;
    if n > 0 then
      deleted := deleted || jsonb_build_object(r.schema_name || '.' || r.table_name,
        coalesce((deleted ->> (r.schema_name || '.' || r.table_name))::bigint, 0) + n);
    end if;
  end loop;

  -- 2. Does anything outside HintWise still refer to the user?
  for r in select * from platform.account_references(p_uid) where not hintwise loop
    execute format('select exists (select 1 from %I.%I where %I = $1)', r.schema_name, r.table_name, r.column_name)
      into found using p_uid;
    if found and not (r.schema_name = any (others)) then others := others || r.schema_name; end if;
  end loop;
  for r in
    select s.* from platform.account_soft_references s
      join pg_catalog.pg_namespace ns on ns.nspname = s.schema_name
      join pg_catalog.pg_class c on c.relnamespace = ns.oid and c.relname = s.table_name
      join pg_catalog.pg_attribute a on a.attrelid = c.oid and a.attname = s.column_name and not a.attisdropped
  loop
    execute format('select exists (select 1 from %I.%I where %I::text = $1::text)', r.schema_name, r.table_name, r.column_name)
      into found using p_uid;
    if found and not (r.schema_name = any (others)) then others := others || r.schema_name; end if;
  end loop;

  return jsonb_build_object('deleted', deleted, 'other_schemas', to_jsonb(others));
end
$$;

comment on function platform.delete_hintwise_data(uuid) is 'Deletes (or nulls, for on delete set null) the user''s rows in platform and every app_% schema, then reports which other schemas still refer to the user (other_schemas). The delete-account function deletes the auth user only when other_schemas is empty. Service role only.';

revoke all on function platform.account_references(uuid) from public, anon, authenticated;
revoke all on function platform.delete_hintwise_data(uuid) from public, anon, authenticated;
revoke all on table platform.account_soft_references from public, anon, authenticated;
grant execute on function platform.account_references(uuid) to service_role;
grant execute on function platform.delete_hintwise_data(uuid) to service_role;
grant select on table platform.account_soft_references to service_role;
