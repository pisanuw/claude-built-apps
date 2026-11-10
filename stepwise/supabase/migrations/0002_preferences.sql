-- StepWise accounts, slice 2: preferences and progress that follow the account, the opt-in for
-- email about new pages, and "Delete my StepWise data".
--
-- Everything here is in the app_stepwise schema of the shared HintWise project; this file touches
-- nothing else. It is idempotent: running it again changes nothing. Once it has been applied,
-- never edit it (applied files are checked by their sha256): later changes go in new files.
--
-- Who may do what:
--   - a signed-in reader (role authenticated) reads, adds, changes and deletes only their own
--     row (row-level security);
--   - anon has no grants on the table at all;
--   - the platform's daily new-pages email (service_role, which bypasses row-level security)
--     reads every row and may change notify_new_pages only (its unsubscribe link);
--   - app_stepwise.delete_my_data() deletes the caller's own rows from every app_stepwise table
--     that has an owner column (saved examples, preferences, and lesson lists once they exist).

create schema if not exists app_stepwise;

create table if not exists app_stepwise.preferences (
  owner uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  -- theme, speed, detail, codeView and tab, each as {"value": ..., "at": "<ISO time>"}, so that
  -- when two copies meet, the later setting wins key by key (src/account/sync-merge.ts).
  prefs jsonb not null default '{}'::jsonb,
  -- The reader's progress, the versioned object of src/progress/progress.ts (merged both ways).
  progress jsonb not null default '{}'::jsonb,
  -- The id of the newest release the reader has seen (src/releases.ts).
  last_release text,
  notify_new_pages boolean not null default false,
  updated_at timestamptz not null default now(),
  constraint preferences_prefs_check check (
    jsonb_typeof(prefs) = 'object' and octet_length(prefs::text) <= 4096
  ),
  constraint preferences_progress_check check (
    jsonb_typeof(progress) = 'object' and octet_length(progress::text) <= 524288
  ),
  constraint preferences_last_release_check check (
    last_release is null or last_release ~ '^[a-z0-9][a-z0-9-]{0,63}$'
  )
);

comment on table app_stepwise.preferences is
  'StepWise: one row per account (settings, progress, last release seen, new-pages email opt-in). Goes with its auth user (on delete cascade).';

-- updated_at changes on every write, and only ever moves forward: the site writes a row back
-- only if updated_at is still what it read (compare and swap), so two tabs or two devices never
-- overwrite each other's changes unseen.
create or replace function app_stepwise.preferences_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.updated_at := now();
  else
    new.updated_at := greatest(now(), old.updated_at + interval '1 microsecond');
  end if;
  return new;
end;
$$;

drop trigger if exists preferences_touch on app_stepwise.preferences;
create trigger preferences_touch
  before insert or update on app_stepwise.preferences
  for each row execute function app_stepwise.preferences_touch();

-- Row-level security: owners do everything with their own row, and nobody sees anyone else's.
alter table app_stepwise.preferences enable row level security;

drop policy if exists "owners read their preferences" on app_stepwise.preferences;
create policy "owners read their preferences" on app_stepwise.preferences
  for select to authenticated
  using (owner = (select auth.uid()));

drop policy if exists "owners add their preferences" on app_stepwise.preferences;
create policy "owners add their preferences" on app_stepwise.preferences
  for insert to authenticated
  with check (owner = (select auth.uid()));

drop policy if exists "owners change their preferences" on app_stepwise.preferences;
create policy "owners change their preferences" on app_stepwise.preferences
  for update to authenticated
  using (owner = (select auth.uid()))
  with check (owner = (select auth.uid()));

drop policy if exists "owners delete their preferences" on app_stepwise.preferences;
create policy "owners delete their preferences" on app_stepwise.preferences
  for delete to authenticated
  using (owner = (select auth.uid()));

-- "Delete my StepWise data": the caller's rows in every table of this schema that has an owner
-- column, so tables added later (lesson lists) are covered without changing this function. It
-- runs as the caller (security invoker), so row-level security and the caller's grants still
-- hold: it can only ever delete the caller's own rows. A table whose rows another table still
-- refers to is tried again after the others. Returns the number of rows deleted per table.
create or replace function app_stepwise.delete_my_data()
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  todo text[];
  later text[];
  t text;
  n bigint;
  counts jsonb := '{}'::jsonb;
begin
  if me is null then
    raise exception 'delete_my_data: not signed in' using errcode = '42501';
  end if;
  select coalesce(array_agg(c.relname::text order by c.relname), '{}') into todo
  from pg_catalog.pg_class as c
  join pg_catalog.pg_namespace as s on s.oid = c.relnamespace
  join pg_catalog.pg_attribute as a on a.attrelid = c.oid
  where s.nspname = 'app_stepwise'
    and c.relkind in ('r', 'p')
    and not c.relispartition
    and a.attname = 'owner'
    and not a.attisdropped
    and a.atttypid = 'pg_catalog.uuid'::pg_catalog.regtype;
  while pg_catalog.cardinality(todo) > 0 loop
    later := '{}';
    foreach t in array todo loop
      begin
        execute pg_catalog.format('delete from app_stepwise.%I where owner = $1', t) using me;
        get diagnostics n = row_count;
        counts := counts || pg_catalog.jsonb_build_object(t, n);
      exception when foreign_key_violation then
        later := pg_catalog.array_append(later, t);
      end;
    end loop;
    if pg_catalog.cardinality(later) = pg_catalog.cardinality(todo) then
      raise exception 'delete_my_data: rows in % are still referred to', later
        using errcode = '23503';
    end if;
    todo := later;
  end loop;
  return counts;
end;
$$;

-- Grants, written out in full.
grant usage on schema app_stepwise to anon, authenticated, service_role;
revoke all on table app_stepwise.preferences from public, anon, authenticated, service_role;
grant select, insert, update, delete on table app_stepwise.preferences to authenticated;
-- The platform's new-pages email: read the rows, and turn the opt-in off from its unsubscribe
-- link. Nothing else.
grant select on table app_stepwise.preferences to service_role;
grant update (notify_new_pages) on table app_stepwise.preferences to service_role;

revoke execute on function app_stepwise.delete_my_data() from public, anon, service_role;
grant execute on function app_stepwise.delete_my_data() to authenticated;

-- The trigger function is not for calling.
revoke execute on function app_stepwise.preferences_touch() from public, anon, authenticated, service_role;
