-- Account deletion, second step (owner's choice, 11 Nov 2026): rows another
-- app creates automatically for every sign-in do not count as using that app.
--
-- The 11 Nov live test (account-deletion-test) found that a trigger on
-- auth.users, public.handle_new_user (another app on the shared project),
-- inserts a public.profiles row for every new sign-in, HintWise ones too. So
-- delete_hintwise_data reported "public" for everyone and the sign-in was
-- never deleted. Tables listed in platform.account_auto_references are left
-- out of that check; when the sign-in is deleted, their rows go with it by
-- their own on delete cascade. Every other table outside HintWise still
-- counts (wcv, public.attempts).
--
-- Applied by apply-shared after 0004. Idempotent. Same rules as 0004.

create table if not exists platform.account_auto_references (
  schema_name text not null,
  table_name text not null,
  why text not null,
  primary key (schema_name, table_name)
);
alter table platform.account_auto_references enable row level security;
insert into platform.account_auto_references values
  ('public', 'profiles', 'public.handle_new_user (trigger on_auth_user_created) inserts one row for every new sign-in')
  on conflict do nothing;
revoke all on table platform.account_auto_references from public, anon, authenticated;
grant select on table platform.account_auto_references to service_role;

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
  for r in
    select x.* from platform.account_references(p_uid) x
     where not x.hintwise
       and not exists (select 1 from platform.account_auto_references ar
                        where ar.schema_name = x.schema_name and ar.table_name = x.table_name)
  loop
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

comment on function platform.delete_hintwise_data(uuid) is 'Deletes (or nulls, for on delete set null) the user''s rows in platform and every app_% schema, then reports which other schemas still refer to the user (other_schemas), leaving out tables in account_auto_references. The delete-account function deletes the auth user only when other_schemas is empty. Service role only.';

revoke all on function platform.delete_hintwise_data(uuid) from public, anon, authenticated;
grant execute on function platform.delete_hintwise_data(uuid) to service_role;
