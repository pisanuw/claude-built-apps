-- StepWise accounts, slice 3: lesson lists. A lesson list is an ordered set of examples saved in
-- the same account (from any pages), for teaching one class.
--
-- Everything StepWise keeps lives in the app_stepwise schema of the shared HintWise project;
-- this file touches nothing else. It needs 0001_saved_examples.sql and nothing from 0002. It is
-- idempotent: running it again changes nothing. Once it has been applied, never edit it (applied
-- files are checked by their sha256): later changes go in new files.
--
-- Who may do what:
--   - a signed-in reader (role authenticated) reads, adds, changes and deletes only their own
--     lists, and only the items of their own lists (row-level security); an item can hold only
--     an example from the same account;
--   - nobody else reads either table at all: anon has no grants on them;
--   - anyone, signed in or not, may read a shared list through
--     app_stepwise.shared_lesson_list(id): its title, notes and items in order (each item's page,
--     title, notes, example and note), whatever each example's own shared flag, and never who
--     owns it or any id.

create table if not exists app_stepwise.lesson_lists (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null default '',
  notes text not null default '',
  shared boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- The same limits as the site (src/account/lists.ts).
  constraint lesson_lists_title_check check (char_length(title) <= 200),
  constraint lesson_lists_notes_check check (char_length(notes) <= 2000)
);

comment on table app_stepwise.lesson_lists is
  'StepWise: lesson lists (ordered sets of saved examples). Rows go with their auth user (on delete cascade).';

create index if not exists lesson_lists_owner on app_stepwise.lesson_lists (owner);

create table if not exists app_stepwise.lesson_list_items (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references app_stepwise.lesson_lists (id) on delete cascade,
  -- Set by the insert trigger (the end of the list); changed only by reorder_lesson_list.
  position integer not null,
  -- Deleting the example takes it out of every list it is in.
  example_id uuid not null references app_stepwise.saved_examples (id) on delete cascade,
  -- A note for this step of the class, shown while the list plays.
  note text not null default '',
  created_at timestamptz not null default now(),
  constraint lesson_list_items_position_check check (position >= 0),
  constraint lesson_list_items_note_check check (char_length(note) <= 2000),
  -- Checked at the end of each statement, so one statement can renumber the whole list.
  constraint lesson_list_items_order unique (list_id, position) deferrable initially immediate
);

comment on table app_stepwise.lesson_list_items is
  'StepWise: the examples of a lesson list, in order. They go with their list and their example (on delete cascade).';

-- Deleting an example finds the items that hold it.
create index if not exists lesson_list_items_example on app_stepwise.lesson_list_items (example_id);

-- updated_at follows every change to a list; created_at never changes.
create or replace function app_stepwise.lesson_lists_touch()
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

drop trigger if exists lesson_lists_touch on app_stepwise.lesson_lists;
create trigger lesson_lists_touch
  before update on app_stepwise.lesson_lists
  for each row execute function app_stepwise.lesson_lists_touch();

-- At most 200 lists per account. Runs as the caller, so under row-level security it counts the
-- caller's own rows.
create or replace function app_stepwise.lesson_lists_cap()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select count(*) from app_stepwise.lesson_lists where owner = new.owner) >= 200 then
    raise exception 'lesson_lists_limit: an account holds at most 200 lesson lists'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists lesson_lists_cap on app_stepwise.lesson_lists;
create trigger lesson_lists_cap
  before insert on app_stepwise.lesson_lists
  for each row execute function app_stepwise.lesson_lists_cap();

-- A new item goes at the end of its list, and a list holds at most 100 items. The list's row is
-- locked first, so two additions at once cannot take the same place. Runs as the caller: another
-- account's list is invisible, so nothing is locked or counted, and the row-level check refuses
-- the item.
create or replace function app_stepwise.lesson_list_items_add()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform 1 from app_stepwise.lesson_lists where id = new.list_id for update;
  if (select count(*) from app_stepwise.lesson_list_items where list_id = new.list_id) >= 100 then
    raise exception 'lesson_list_items_limit: a lesson list holds at most 100 examples'
      using errcode = 'P0001';
  end if;
  new.position := coalesce(
    (select max(position) + 1 from app_stepwise.lesson_list_items where list_id = new.list_id),
    0
  );
  new.created_at := now();
  return new;
end;
$$;

drop trigger if exists lesson_list_items_add on app_stepwise.lesson_list_items;
create trigger lesson_list_items_add
  before insert on app_stepwise.lesson_list_items
  for each row execute function app_stepwise.lesson_list_items_add();

-- Adding or removing an item counts as a change to its list (lists are shown most recently
-- changed first). A list that is itself being deleted is already gone, so nothing is touched.
create or replace function app_stepwise.lesson_list_items_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  update app_stepwise.lesson_lists set updated_at = now()
    where id = case when tg_op = 'DELETE' then old.list_id else new.list_id end;
  return null;
end;
$$;

drop trigger if exists lesson_list_items_touch on app_stepwise.lesson_list_items;
create trigger lesson_list_items_touch
  after insert or delete on app_stepwise.lesson_list_items
  for each row execute function app_stepwise.lesson_list_items_touch();

-- Row-level security: owners do everything with their own lists and their lists' items, and
-- nobody sees anyone else's.
alter table app_stepwise.lesson_lists enable row level security;
alter table app_stepwise.lesson_list_items enable row level security;

drop policy if exists "owners read their lists" on app_stepwise.lesson_lists;
create policy "owners read their lists" on app_stepwise.lesson_lists
  for select to authenticated
  using (owner = (select auth.uid()));

drop policy if exists "owners add lists" on app_stepwise.lesson_lists;
create policy "owners add lists" on app_stepwise.lesson_lists
  for insert to authenticated
  with check (owner = (select auth.uid()));

drop policy if exists "owners change their lists" on app_stepwise.lesson_lists;
create policy "owners change their lists" on app_stepwise.lesson_lists
  for update to authenticated
  using (owner = (select auth.uid()))
  with check (owner = (select auth.uid()));

drop policy if exists "owners delete their lists" on app_stepwise.lesson_lists;
create policy "owners delete their lists" on app_stepwise.lesson_lists
  for delete to authenticated
  using (owner = (select auth.uid()));

drop policy if exists "owners read their list items" on app_stepwise.lesson_list_items;
create policy "owners read their list items" on app_stepwise.lesson_list_items
  for select to authenticated
  using (exists (
    select from app_stepwise.lesson_lists as l
    where l.id = list_id and l.owner = (select auth.uid())
  ));

-- Only into one's own list, and only one's own example: a shared list shows its examples to
-- anyone with its link, so it must never hold another account's.
drop policy if exists "owners add list items" on app_stepwise.lesson_list_items;
create policy "owners add list items" on app_stepwise.lesson_list_items
  for insert to authenticated
  with check (
    exists (
      select from app_stepwise.lesson_lists as l
      where l.id = list_id and l.owner = (select auth.uid())
    )
    and exists (
      select from app_stepwise.saved_examples as e
      where e.id = example_id and e.owner = (select auth.uid())
    )
  );

drop policy if exists "owners change their list items" on app_stepwise.lesson_list_items;
create policy "owners change their list items" on app_stepwise.lesson_list_items
  for update to authenticated
  using (exists (
    select from app_stepwise.lesson_lists as l
    where l.id = list_id and l.owner = (select auth.uid())
  ))
  with check (exists (
    select from app_stepwise.lesson_lists as l
    where l.id = list_id and l.owner = (select auth.uid())
  ));

drop policy if exists "owners delete their list items" on app_stepwise.lesson_list_items;
create policy "owners delete their list items" on app_stepwise.lesson_list_items
  for delete to authenticated
  using (exists (
    select from app_stepwise.lesson_lists as l
    where l.id = list_id and l.owner = (select auth.uid())
  ));

-- Put a list's items in this order: every item of the list, each once. One statement renumbers
-- them all (0, 1, 2, ...), so the order holds whatever it was before. Runs as the caller, so it
-- sees and changes only the caller's own lists.
create or replace function app_stepwise.reorder_lesson_list(p_list uuid, p_items uuid[])
returns void
language plpgsql
set search_path = ''
as $$
begin
  perform 1 from app_stepwise.lesson_lists where id = p_list for update;
  if not found then
    raise exception 'lesson_list_missing: no such lesson list' using errcode = 'P0001';
  end if;
  if p_items is null
     or cardinality(p_items) <> (select count(distinct x) from unnest(p_items) as x)
     or cardinality(p_items) <> (
       select count(*) from app_stepwise.lesson_list_items where list_id = p_list
     )
     or exists (
       select from unnest(p_items) as x
       where not exists (
         select from app_stepwise.lesson_list_items as i where i.id = x and i.list_id = p_list
       )
     ) then
    raise exception 'lesson_list_order: name every item of the list once' using errcode = 'P0001';
  end if;
  update app_stepwise.lesson_list_items as i
    set position = o.ord - 1
    from unnest(p_items) with ordinality as o (id, ord)
    where i.id = o.id and i.list_id = p_list;
  update app_stepwise.lesson_lists set updated_at = now() where id = p_list;
end;
$$;

-- A shared list's content, for anyone with its link. Runs as the tables' owner, so it reads past
-- row-level security; it returns only a shared list, and only these three columns. items is a
-- JSON array in the list's order: {viz, title, notes, example, note} for each item.
create or replace function app_stepwise.shared_lesson_list(p_id uuid)
returns table (title text, notes text, items jsonb)
language sql
stable
security definer
set search_path = ''
as $$
  select
    l.title,
    l.notes,
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'viz', e.viz,
            'title', e.title,
            'notes', e.notes,
            'example', e.example,
            'note', i.note
          )
          order by i.position
        )
        from app_stepwise.lesson_list_items as i
        join app_stepwise.saved_examples as e on e.id = i.example_id
        where i.list_id = l.id
      ),
      '[]'::jsonb
    )
  from app_stepwise.lesson_lists as l
  where l.id = p_id and l.shared;
$$;

-- Grants, written out in full. Revoked from authenticated too first, so default privileges the
-- schema may have cannot leave wider ones in place.
revoke all on table app_stepwise.lesson_lists from public, anon, authenticated;
revoke all on table app_stepwise.lesson_list_items from public, anon, authenticated;
grant select, insert, update, delete on table app_stepwise.lesson_lists to authenticated;
grant select, insert, delete on table app_stepwise.lesson_list_items to authenticated;
-- An item never moves to another list or holds another example: only its note and place change.
grant update (note, position) on table app_stepwise.lesson_list_items to authenticated;

revoke execute on function app_stepwise.shared_lesson_list(uuid) from public;
grant execute on function app_stepwise.shared_lesson_list(uuid) to anon, authenticated;

revoke execute on function app_stepwise.reorder_lesson_list(uuid, uuid[]) from public, anon;
grant execute on function app_stepwise.reorder_lesson_list(uuid, uuid[]) to authenticated;

-- The trigger functions are not for calling.
revoke execute on function app_stepwise.lesson_lists_touch() from public, anon, authenticated;
revoke execute on function app_stepwise.lesson_lists_cap() from public, anon, authenticated;
revoke execute on function app_stepwise.lesson_list_items_add() from public, anon, authenticated;
revoke execute on function app_stepwise.lesson_list_items_touch() from public, anon, authenticated;
