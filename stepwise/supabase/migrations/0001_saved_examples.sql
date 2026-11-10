-- StepWise accounts, slice 1: examples saved in an account.
--
-- Everything StepWise keeps lives in the app_stepwise schema of the shared HintWise project;
-- this file touches nothing else. It is idempotent: running it again changes nothing. Once it
-- has been applied, never edit it (applied files are checked by their sha256): later changes go
-- in 0002_... files.
--
-- Who may do what:
--   - a signed-in reader (role authenticated) reads, adds, changes and deletes only their own
--     rows (row-level security);
--   - nobody else reads the table at all: anon has no grants on it;
--   - anyone, signed in or not, may read a shared example's content (viz, title, notes,
--     example) through app_stepwise.shared_example(id), and nothing more.

create schema if not exists app_stepwise;

create table if not exists app_stepwise.saved_examples (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default auth.uid() references auth.users (id) on delete cascade,
  viz text not null,
  title text not null default '',
  notes text not null default '',
  example jsonb not null,
  shared boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- A page id as in src/viz/catalog.ts.
  constraint saved_examples_viz_check check (viz ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
  -- The same limits as the site (validateExample, the Save field).
  constraint saved_examples_title_check check (char_length(title) <= 200),
  constraint saved_examples_notes_check check (char_length(notes) <= 2000),
  constraint saved_examples_example_check check (
    jsonb_typeof(example) = 'object' and octet_length(example::text) <= 262144
  )
);

comment on table app_stepwise.saved_examples is
  'StepWise: examples saved in an account. Rows go with their auth user (on delete cascade).';

-- Listing a reader's examples for one page.
create index if not exists saved_examples_owner_viz on app_stepwise.saved_examples (owner, viz);

-- updated_at follows every change; created_at never changes.
create or replace function app_stepwise.saved_examples_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  new.created_at := old.created_at;
  return new;
end;
$$;

drop trigger if exists saved_examples_touch on app_stepwise.saved_examples;
create trigger saved_examples_touch
  before update on app_stepwise.saved_examples
  for each row execute function app_stepwise.saved_examples_touch();

-- At most 1000 examples per account (the site says so when one is refused). Runs as the caller,
-- so under row-level security it counts the caller's own rows.
create or replace function app_stepwise.saved_examples_cap()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select count(*) from app_stepwise.saved_examples where owner = new.owner) >= 1000 then
    raise exception 'saved_examples_limit: an account holds at most 1000 examples'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists saved_examples_cap on app_stepwise.saved_examples;
create trigger saved_examples_cap
  before insert on app_stepwise.saved_examples
  for each row execute function app_stepwise.saved_examples_cap();

-- Row-level security: owners do everything with their own rows, and nobody sees anyone else's.
alter table app_stepwise.saved_examples enable row level security;

drop policy if exists "owners read their examples" on app_stepwise.saved_examples;
create policy "owners read their examples" on app_stepwise.saved_examples
  for select to authenticated
  using (owner = (select auth.uid()));

drop policy if exists "owners add examples" on app_stepwise.saved_examples;
create policy "owners add examples" on app_stepwise.saved_examples
  for insert to authenticated
  with check (owner = (select auth.uid()));

drop policy if exists "owners change their examples" on app_stepwise.saved_examples;
create policy "owners change their examples" on app_stepwise.saved_examples
  for update to authenticated
  using (owner = (select auth.uid()))
  with check (owner = (select auth.uid()));

drop policy if exists "owners delete their examples" on app_stepwise.saved_examples;
create policy "owners delete their examples" on app_stepwise.saved_examples
  for delete to authenticated
  using (owner = (select auth.uid()));

-- A shared example's content, for anyone with its link. Runs as the table's owner, so it reads
-- past row-level security; it returns only shared rows and only these four columns.
create or replace function app_stepwise.shared_example(p_id uuid)
returns table (viz text, title text, notes text, example jsonb)
language sql
stable
security definer
set search_path = ''
as $$
  select e.viz, e.title, e.notes, e.example
  from app_stepwise.saved_examples as e
  where e.id = p_id and e.shared;
$$;

-- Grants, written out in full.
grant usage on schema app_stepwise to anon, authenticated;
revoke all on table app_stepwise.saved_examples from public, anon;
grant select, insert, update, delete on table app_stepwise.saved_examples to authenticated;

revoke execute on function app_stepwise.shared_example(uuid) from public;
grant execute on function app_stepwise.shared_example(uuid) to anon, authenticated;

-- The trigger functions are not for calling.
revoke execute on function app_stepwise.saved_examples_touch() from public, anon, authenticated;
revoke execute on function app_stepwise.saved_examples_cap() from public, anon, authenticated;
