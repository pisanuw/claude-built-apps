-- RankedVote, migration 0001: contests, ballots and comments in the app's own schema on the
-- shared HintWise Supabase project (claude-built-apps docs/platform.md, section 1).
--
-- RankedVote (https://ranked-voting.hintwise.org, pisanuw/ranked-voting) had a Supabase project
-- of its own, deleted on 27 Nov 2026 (owner, "rv deleted"), so this schema starts empty. Its old
-- public.profiles table is gone for good: voters' addresses are read from auth.users, by the
-- contest_voters and submit_vote functions only, and never copied.
--
-- Who may do what:
--   a contest's admin   (signed in) creates a contest with its options and voter list
--                       (create_contest_with_relations, which runs as the caller); reads, edits
--                       and deletes their own contests; adds, edits and removes options while the
--                       contest is a draft; edits its voter list; sees who voted and when
--                       (contest_voters), never how; downloads the comments without voter
--                       identity (contest_feedback); always sees the results (contest_ballots).
--   a voter             reads one open or closed contest by its voting code (get_contest);
--                       submits one ballot (submit_vote), which checks the contest is open, the
--                       submission gate, the end date, the voter list, the ranking and the
--                       required comments; reads their own vote row; sees the results after
--                       voting when the admin shows them to voters (contest_ballots). Signed in,
--                       lists the contests they voted in or are on the voter list of
--                       (my_voter_contests).
--   anonymous visitors  only get_contest, submit_vote and contest_ballots; submit_vote refuses
--                       them when the contest has a voter list. No table access.
-- Nobody reads a ballot next to the voter's identity, the admin included: rankings and
-- comments leave the database only through contest_ballots and contest_feedback, without vote
-- ids and in random order.
--
-- Account deletion (docs/platform.md, "Account deletion"): an admin's contests go with the
-- account, and everything under them by cascade. A voter's ballots stay in the count without
-- them (votes.voter_id is set to null), so a closed contest's result does not change.
--
-- No service-role key anywhere: the browser and the Netlify functions call these with the
-- public anon key and, when signed in, the person's own token. Every function pins
-- search_path to '' and names every object with its schema. Idempotent: a second run changes
-- nothing.

create schema if not exists app_ranked_voting;

comment on schema app_ranked_voting is 'RankedVote (ranked-voting.hintwise.org): ranked-choice contests, ballots and comments; dropping the schema retires the app.';

-- Contests ---------------------------------------------------------------------------------

create table if not exists app_ranked_voting.contests (
  id                        uuid primary key default gen_random_uuid(),
  -- The admin: the person who created the contest.
  admin_id                  uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title                     text not null check (char_length(btrim(title)) between 1 and 200),
  description               text check (char_length(description) <= 5000),
  -- The code in the voting and results addresses (/vote/<code>, /results/<code>): 32 hex
  -- characters, 122 random bits. The contest id never appears in a public address.
  vote_token                text not null unique default replace(gen_random_uuid()::text, '-', ''),
  max_winners               integer not null default 1 check (max_winners between 1 and 99),
  results_visible_to_voters boolean not null default true,
  randomize_options         boolean not null default true,
  -- False: voters can rank and comment but not submit yet (the submission gate).
  submissions_open          boolean not null default false,
  -- True: every option needs a comment before a ballot is accepted.
  comments_required         boolean not null default false,
  end_date                  timestamptz,
  status                    text not null default 'draft' check (status in ('draft', 'open', 'closed')),
  created_at                timestamptz not null default now()
);

comment on table app_ranked_voting.contests is 'One row per contest, owned by admin_id. Voters reach a contest only by its vote_token, through get_contest.';

create index if not exists contests_admin_id_idx on app_ranked_voting.contests (admin_id, created_at desc);

create table if not exists app_ranked_voting.contest_options (
  id          uuid primary key default gen_random_uuid(),
  contest_id  uuid not null references app_ranked_voting.contests (id) on delete cascade,
  title       text not null check (char_length(btrim(title)) between 1 and 300),
  description text check (char_length(description) <= 2000),
  order_index integer not null default 0 check (order_index >= 0),
  created_at  timestamptz not null default now()
);

comment on table app_ranked_voting.contest_options is 'The candidates or options of a contest.';

create index if not exists contest_options_contest_id_idx on app_ranked_voting.contest_options (contest_id, order_index);

-- The voter list. A contest without rows here is open to anyone with its voting address.
create table if not exists app_ranked_voting.allowed_voters (
  id         uuid primary key default gen_random_uuid(),
  contest_id uuid not null references app_ranked_voting.contests (id) on delete cascade,
  -- A full address (alice@uw.edu) or a domain rule (@uw.edu) that allows every address on
  -- that domain; lower case.
  email      text not null check (
    email = lower(email) and char_length(email) between 3 and 254 and email ~ '^[^@\s]*@[^@\s]+\.[^@\s]+$'
  ),
  created_at timestamptz not null default now(),
  unique (contest_id, email)
);

comment on table app_ranked_voting.allowed_voters is 'A contest''s voter list: full addresses or @domain rules. Empty: anyone with the voting address may vote.';

-- Ballots ----------------------------------------------------------------------------------

create table if not exists app_ranked_voting.votes (
  id          uuid primary key default gen_random_uuid(),
  contest_id  uuid not null references app_ranked_voting.contests (id) on delete cascade,
  -- The signed-in voter. Set to null when they delete their account: the ballot stays in the
  -- count, without them.
  voter_id    uuid references auth.users (id) on delete set null,
  -- An anonymous voter's random browser token (contests without a voter list); it also lets
  -- that browser see the results. Never readable through the API.
  voter_token text check (char_length(voter_token) between 8 and 100),
  created_at  timestamptz not null default now(),
  -- One ballot per person, or per anonymous browser, per contest.
  unique (contest_id, voter_id),
  unique (contest_id, voter_token),
  -- A ballot is a signed-in person's or an anonymous browser's, never both. submit_vote
  -- refuses a ballot with neither; only a deleted account leaves both empty.
  constraint votes_one_identity check (voter_id is null or voter_token is null)
);

comment on table app_ranked_voting.votes is 'One row per ballot. Written only by submit_vote; a voter reads their own row.';

create index if not exists votes_voter_id_idx on app_ranked_voting.votes (voter_id) where voter_id is not null;

create table if not exists app_ranked_voting.vote_rankings (
  vote_id   uuid not null references app_ranked_voting.votes (id) on delete cascade,
  option_id uuid not null references app_ranked_voting.contest_options (id) on delete cascade,
  rank      integer not null check (rank >= 1),
  primary key (vote_id, option_id),
  unique (vote_id, rank)
);

comment on table app_ranked_voting.vote_rankings is 'The ranked ballot: one row per option per ballot. Read only through contest_ballots and contest_feedback.';

create index if not exists vote_rankings_option_id_idx on app_ranked_voting.vote_rankings (option_id);

create table if not exists app_ranked_voting.vote_comments (
  vote_id   uuid not null references app_ranked_voting.votes (id) on delete cascade,
  option_id uuid not null references app_ranked_voting.contest_options (id) on delete cascade,
  comment   text not null check (char_length(comment) between 1 and 2000),
  primary key (vote_id, option_id)
);

comment on table app_ranked_voting.vote_comments is 'A voter''s comment on one option. Read only through contest_feedback, without the ballot it came with.';

create index if not exists vote_comments_option_id_idx on app_ranked_voting.vote_comments (option_id);

-- Row level security -----------------------------------------------------------------------

alter table app_ranked_voting.contests enable row level security;
alter table app_ranked_voting.contest_options enable row level security;
alter table app_ranked_voting.allowed_voters enable row level security;
alter table app_ranked_voting.votes enable row level security;
alter table app_ranked_voting.vote_rankings enable row level security;
alter table app_ranked_voting.vote_comments enable row level security;

drop policy if exists contests_select_own on app_ranked_voting.contests;
create policy contests_select_own on app_ranked_voting.contests
  for select to authenticated
  using (admin_id = (select auth.uid()));

drop policy if exists contests_insert_own on app_ranked_voting.contests;
create policy contests_insert_own on app_ranked_voting.contests
  for insert to authenticated
  with check (admin_id = (select auth.uid()));

drop policy if exists contests_update_own on app_ranked_voting.contests;
create policy contests_update_own on app_ranked_voting.contests
  for update to authenticated
  using (admin_id = (select auth.uid()))
  with check (admin_id = (select auth.uid()));

drop policy if exists contests_delete_own on app_ranked_voting.contests;
create policy contests_delete_own on app_ranked_voting.contests
  for delete to authenticated
  using (admin_id = (select auth.uid()));

-- Options: the admin reads them always, and changes them only while the contest is a draft,
-- so a ballot never loses or gains an option.
drop policy if exists contest_options_select_admin on app_ranked_voting.contest_options;
create policy contest_options_select_admin on app_ranked_voting.contest_options
  for select to authenticated
  using (exists (
    select 1 from app_ranked_voting.contests c
    where c.id = contest_id and c.admin_id = (select auth.uid())
  ));

drop policy if exists contest_options_insert_draft on app_ranked_voting.contest_options;
create policy contest_options_insert_draft on app_ranked_voting.contest_options
  for insert to authenticated
  with check (exists (
    select 1 from app_ranked_voting.contests c
    where c.id = contest_id and c.admin_id = (select auth.uid()) and c.status = 'draft'
  ));

drop policy if exists contest_options_update_draft on app_ranked_voting.contest_options;
create policy contest_options_update_draft on app_ranked_voting.contest_options
  for update to authenticated
  using (exists (
    select 1 from app_ranked_voting.contests c
    where c.id = contest_id and c.admin_id = (select auth.uid()) and c.status = 'draft'
  ))
  with check (exists (
    select 1 from app_ranked_voting.contests c
    where c.id = contest_id and c.admin_id = (select auth.uid()) and c.status = 'draft'
  ));

drop policy if exists contest_options_delete_draft on app_ranked_voting.contest_options;
create policy contest_options_delete_draft on app_ranked_voting.contest_options
  for delete to authenticated
  using (exists (
    select 1 from app_ranked_voting.contests c
    where c.id = contest_id and c.admin_id = (select auth.uid()) and c.status = 'draft'
  ));

drop policy if exists allowed_voters_select_admin on app_ranked_voting.allowed_voters;
create policy allowed_voters_select_admin on app_ranked_voting.allowed_voters
  for select to authenticated
  using (exists (
    select 1 from app_ranked_voting.contests c
    where c.id = contest_id and c.admin_id = (select auth.uid())
  ));

drop policy if exists allowed_voters_insert_admin on app_ranked_voting.allowed_voters;
create policy allowed_voters_insert_admin on app_ranked_voting.allowed_voters
  for insert to authenticated
  with check (exists (
    select 1 from app_ranked_voting.contests c
    where c.id = contest_id and c.admin_id = (select auth.uid())
  ));

drop policy if exists allowed_voters_delete_admin on app_ranked_voting.allowed_voters;
create policy allowed_voters_delete_admin on app_ranked_voting.allowed_voters
  for delete to authenticated
  using (exists (
    select 1 from app_ranked_voting.contests c
    where c.id = contest_id and c.admin_id = (select auth.uid())
  ));

-- A voter reads their own vote row (the ballot page's "already voted" check). The admin reads
-- no vote row: contest_voters says who voted and when.
drop policy if exists votes_select_own on app_ranked_voting.votes;
create policy votes_select_own on app_ranked_voting.votes
  for select to authenticated
  using (voter_id = (select auth.uid()));

-- Nobody reads rankings or comments through the API; the functions below do, without vote ids.
drop policy if exists vote_rankings_none on app_ranked_voting.vote_rankings;
create policy vote_rankings_none on app_ranked_voting.vote_rankings
  for select to authenticated
  using (false);

drop policy if exists vote_comments_none on app_ranked_voting.vote_comments;
create policy vote_comments_none on app_ranked_voting.vote_comments
  for select to authenticated
  using (false);

-- Creating a contest -----------------------------------------------------------------------

-- Creates a contest with its options and voter list in one transaction. It runs as the caller
-- (security invoker), so the policies above apply to every row it writes.
create or replace function app_ranked_voting.create_contest_with_relations(
  p_title text,
  p_description text,
  p_max_winners integer,
  p_results_visible_to_voters boolean,
  p_randomize_options boolean,
  p_comments_required boolean,
  p_end_date timestamptz,
  p_options jsonb,
  p_allowed_emails text[]
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_admin_id uuid := auth.uid();
  v_contest_id uuid;
  v_option jsonb;
  v_email text;
  v_valid_options integer;
  v_order_index integer := 0;
begin
  if v_admin_id is null then
    raise exception 'Authentication required' using errcode = 'PT401';
  end if;
  if p_title is null or btrim(p_title) = '' then
    raise exception 'Contest title is required' using errcode = 'PT400';
  end if;
  if char_length(btrim(p_title)) > 200 then
    raise exception 'A contest title can be at most 200 characters' using errcode = 'PT400';
  end if;
  if p_max_winners is null or p_max_winners < 1 then
    raise exception 'Contest must have at least one winner' using errcode = 'PT400';
  end if;
  if p_options is null or jsonb_typeof(p_options) <> 'array' then
    raise exception 'Contest options must be an array' using errcode = 'PT400';
  end if;
  if jsonb_array_length(p_options) > 100 then
    raise exception 'A contest can have at most 100 options' using errcode = 'PT400';
  end if;
  if coalesce(cardinality(p_allowed_emails), 0) > 1000 then
    raise exception 'A voter list can have at most 1000 entries' using errcode = 'PT400';
  end if;

  select count(*) into v_valid_options
  from jsonb_array_elements(p_options) o
  where jsonb_typeof(o) = 'object' and coalesce(btrim(o ->> 'title'), '') <> '';

  if v_valid_options < 2 then
    raise exception 'At least 2 options are required' using errcode = 'PT400';
  end if;
  if p_max_winners >= v_valid_options then
    raise exception 'Number of winners must be less than the number of options' using errcode = 'PT400';
  end if;

  insert into app_ranked_voting.contests (
    admin_id, title, description, max_winners, results_visible_to_voters, randomize_options,
    comments_required, end_date
  )
  values (
    v_admin_id,
    btrim(p_title),
    nullif(btrim(coalesce(p_description, '')), ''),
    p_max_winners,
    coalesce(p_results_visible_to_voters, true),
    coalesce(p_randomize_options, true),
    coalesce(p_comments_required, false),
    p_end_date
  )
  returning id into v_contest_id;

  for v_option in select value from jsonb_array_elements(p_options)
  loop
    if jsonb_typeof(v_option) <> 'object' or coalesce(btrim(v_option ->> 'title'), '') = '' then
      continue;
    end if;
    insert into app_ranked_voting.contest_options (contest_id, title, description, order_index)
    values (
      v_contest_id,
      btrim(v_option ->> 'title'),
      nullif(btrim(coalesce(v_option ->> 'description', '')), ''),
      v_order_index
    );
    v_order_index := v_order_index + 1;
  end loop;

  foreach v_email in array coalesce(p_allowed_emails, array[]::text[])
  loop
    v_email := lower(btrim(coalesce(v_email, '')));
    if v_email = '' then
      continue;
    end if;
    if char_length(v_email) > 254 or v_email !~ '^[^@\s]*@[^@\s]+\.[^@\s]+$' then
      raise exception 'Not an email address or @domain: %', left(v_email, 254) using errcode = 'PT400';
    end if;
    insert into app_ranked_voting.allowed_voters (contest_id, email)
    values (v_contest_id, v_email)
    on conflict (contest_id, email) do nothing;
  end loop;

  return v_contest_id;
end;
$$;

-- Voting -----------------------------------------------------------------------------------

-- One open or closed contest by its voting code, with its options: what the ballot page
-- shows. Null for an unknown code or a draft. Never the admin, the voter list or any ballot;
-- require_login only says whether the contest has a voter list.
create or replace function app_ranked_voting.get_contest(p_token text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', c.id,
    'title', c.title,
    'description', c.description,
    'vote_token', c.vote_token,
    'status', c.status,
    'end_date', c.end_date,
    'require_login', exists (select 1 from app_ranked_voting.allowed_voters av where av.contest_id = c.id),
    'results_visible_to_voters', c.results_visible_to_voters,
    'randomize_options', c.randomize_options,
    'submissions_open', c.submissions_open,
    'comments_required', c.comments_required,
    'max_winners', c.max_winners,
    'contest_options', coalesce((
      select jsonb_agg(
        jsonb_build_object('id', o.id, 'title', o.title, 'description', o.description, 'order_index', o.order_index)
        order by o.order_index, o.created_at, o.id
      )
      from app_ranked_voting.contest_options o
      where o.contest_id = c.id
    ), '[]'::jsonb)
  )
  from app_ranked_voting.contests c
  where c.vote_token = p_token and c.status <> 'draft';
$$;

-- Records one ballot. The caller is the signed-in person (auth.uid()) or, without a session,
-- an anonymous browser identified by p_voter_token. Errors carry PostgREST's PTnnn codes, so
-- the HTTP status says what went wrong: 400 a bad or refused ballot, 403 not on the voter
-- list, 404 no such contest, 409 already voted.
create or replace function app_ranked_voting.submit_vote(
  p_token text,
  p_rankings jsonb,
  p_comments jsonb default null,
  p_voter_token text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_token text := nullif(btrim(coalesce(p_voter_token, '')), '');
  v_contest app_ranked_voting.contests%rowtype;
  v_email text;
  v_domain text;
  v_options integer;
  v_ok boolean;
  v_vote_id uuid;
  v_uuid constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
begin
  select * into v_contest
  from app_ranked_voting.contests c
  where c.vote_token = p_token and c.status <> 'draft';
  if not found then
    raise exception 'Contest not found' using errcode = 'PT404';
  end if;
  if v_contest.status <> 'open' then
    raise exception 'This contest is not currently open for voting' using errcode = 'PT400';
  end if;
  if not v_contest.submissions_open then
    raise exception 'Submissions are not open for this contest yet' using errcode = 'PT400';
  end if;
  if v_contest.end_date is not null and v_contest.end_date < now() then
    raise exception 'This contest has passed its end date' using errcode = 'PT400';
  end if;

  -- Who is voting. A signed-in voter is always counted by their account, never by a token.
  if v_uid is not null then
    v_token := null;
    select lower(u.email) into v_email from auth.users u where u.id = v_uid;
  elsif v_token is null then
    raise exception 'No voter identity provided' using errcode = 'PT400';
  elsif char_length(v_token) not between 8 and 100 then
    raise exception 'Invalid voter token' using errcode = 'PT400';
  end if;

  -- The voter list: a full address, or a domain rule matching the part after the last @.
  if exists (select 1 from app_ranked_voting.allowed_voters av where av.contest_id = v_contest.id) then
    if v_uid is null then
      raise exception 'You must be logged in to vote in this contest' using errcode = 'PT403';
    end if;
    v_domain := regexp_replace(coalesce(v_email, ''), '^.*@', '@');
    if coalesce(v_email, '') = '' or not exists (
      select 1 from app_ranked_voting.allowed_voters av
      where av.contest_id = v_contest.id
        and (av.email = v_email or (av.email like '@%' and av.email = v_domain))
    ) then
      raise exception 'Your email is not on the voter list for this contest' using errcode = 'PT403';
    end if;
  end if;

  -- The ranking: every option of the contest exactly once, ranks 1 to n.
  select count(*) into v_options from app_ranked_voting.contest_options o where o.contest_id = v_contest.id;
  if p_rankings is null or jsonb_typeof(p_rankings) <> 'array' or v_options = 0
     or jsonb_array_length(p_rankings) <> v_options
     or exists (
       select 1 from jsonb_array_elements(p_rankings) e
       where jsonb_typeof(e) <> 'object'
          or jsonb_typeof(e -> 'option_id') is distinct from 'string'
          or lower(e ->> 'option_id') !~ v_uuid
          or jsonb_typeof(e -> 'rank') is distinct from 'number'
          or (e ->> 'rank') !~ '^[0-9]{1,4}$'
     ) then
    raise exception 'Invalid rankings: all options must be ranked exactly once' using errcode = 'PT400';
  end if;

  with r as (
    select (e ->> 'option_id')::uuid as option_id, (e ->> 'rank')::integer as rank
    from jsonb_array_elements(p_rankings) e
  )
  select count(o.id) = v_options
     and count(distinct r.option_id) = v_options
     and count(distinct r.rank) = v_options
     and min(r.rank) = 1
     and max(r.rank) = v_options
  into v_ok
  from r
  left join app_ranked_voting.contest_options o on o.id = r.option_id and o.contest_id = v_contest.id;
  if not v_ok then
    raise exception 'Invalid rankings: all options must be ranked exactly once' using errcode = 'PT400';
  end if;

  -- Comments: optional, at most one per option of this contest, at most 2000 characters;
  -- blank ones are dropped.
  if p_comments is not null and jsonb_typeof(p_comments) <> 'null' then
    if jsonb_typeof(p_comments) <> 'array' or exists (
      select 1 from jsonb_array_elements(p_comments) e
      where jsonb_typeof(e) <> 'object'
         or jsonb_typeof(e -> 'option_id') is distinct from 'string'
         or lower(e ->> 'option_id') !~ v_uuid
         or jsonb_typeof(e -> 'comment') is distinct from 'string'
    ) then
      raise exception 'Invalid comments' using errcode = 'PT400';
    end if;
    if exists (
      select 1 from jsonb_array_elements(p_comments) e
      where char_length(btrim(e ->> 'comment')) > 2000
    ) then
      raise exception 'A comment can be at most 2000 characters' using errcode = 'PT400';
    end if;
    with c as (
      select (e ->> 'option_id')::uuid as option_id
      from jsonb_array_elements(p_comments) e
      where btrim(e ->> 'comment') <> ''
    )
    select count(o.id) = count(*) and count(distinct c.option_id) = count(*)
    into v_ok
    from c
    left join app_ranked_voting.contest_options o on o.id = c.option_id and o.contest_id = v_contest.id;
    if not v_ok then
      raise exception 'Invalid comments: one comment per option of this contest' using errcode = 'PT400';
    end if;
  end if;

  if v_contest.comments_required and exists (
    select 1 from app_ranked_voting.contest_options o
    where o.contest_id = v_contest.id
      and not exists (
        select 1 from jsonb_array_elements(coalesce(case when jsonb_typeof(p_comments) = 'array' then p_comments end, '[]'::jsonb)) e
        where lower(e ->> 'option_id') = o.id::text and btrim(e ->> 'comment') <> ''
      )
  ) then
    raise exception 'A comment is required for every option' using errcode = 'PT400';
  end if;

  begin
    insert into app_ranked_voting.votes (contest_id, voter_id, voter_token)
    values (v_contest.id, v_uid, v_token)
    returning id into v_vote_id;
  exception when unique_violation then
    raise exception 'You have already voted in this contest' using errcode = 'PT409';
  end;

  insert into app_ranked_voting.vote_rankings (vote_id, option_id, rank)
  select v_vote_id, (e ->> 'option_id')::uuid, (e ->> 'rank')::integer
  from jsonb_array_elements(p_rankings) e;

  if jsonb_typeof(p_comments) = 'array' then
    insert into app_ranked_voting.vote_comments (vote_id, option_id, comment)
    select v_vote_id, (e ->> 'option_id')::uuid, btrim(e ->> 'comment')
    from jsonb_array_elements(p_comments) e
    where btrim(e ->> 'comment') <> '';
  end if;
end;
$$;

-- Results ----------------------------------------------------------------------------------

-- What the results page needs to count the ballots (the STV count runs in the get-results
-- Netlify function): the contest's title and seats, its options, and each ballot as the
-- option ids in rank order, in random order and without vote ids. For the admin always; for
-- anyone else only when the admin shows results to voters and the caller voted, as the
-- signed-in voter or the anonymous browser whose p_voter_token is on a ballot.
create or replace function app_ranked_voting.contest_ballots(p_token text, p_voter_token text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_token text := nullif(btrim(coalesce(p_voter_token, '')), '');
  v_contest app_ranked_voting.contests%rowtype;
begin
  select * into v_contest from app_ranked_voting.contests c where c.vote_token = p_token;
  if not found then
    raise exception 'Contest not found' using errcode = 'PT404';
  end if;

  if v_uid is distinct from v_contest.admin_id then
    if not v_contest.results_visible_to_voters then
      raise exception 'Results are restricted to the contest admin' using errcode = 'PT403';
    end if;
    if not exists (
      select 1 from app_ranked_voting.votes v
      where v.contest_id = v_contest.id
        and ((v_uid is not null and v.voter_id = v_uid) or (v_token is not null and v.voter_token = v_token))
    ) then
      raise exception 'Results are only available to recorded voters or the contest admin' using errcode = 'PT403';
    end if;
  end if;

  return jsonb_build_object(
    'contest', jsonb_build_object('title', v_contest.title, 'max_winners', v_contest.max_winners),
    'options', coalesce((
      select jsonb_agg(
        jsonb_build_object('id', o.id, 'title', o.title, 'description', o.description, 'order_index', o.order_index)
        order by o.order_index, o.created_at, o.id
      )
      from app_ranked_voting.contest_options o
      where o.contest_id = v_contest.id
    ), '[]'::jsonb),
    'ballots', coalesce((
      select jsonb_agg(b.ranking order by random())
      from (
        select jsonb_agg(vr.option_id order by vr.rank) as ranking
        from app_ranked_voting.votes v
        join app_ranked_voting.vote_rankings vr on vr.vote_id = v.id
        where v.contest_id = v_contest.id
        group by v.id
      ) b
    ), '[]'::jsonb)
  );
end;
$$;

-- The admin's views ------------------------------------------------------------------------

-- Who voted and when, for the contest's admin: the voter's address, or null for an anonymous
-- browser or a deleted account. Never how they voted. Nothing for anyone else.
create or replace function app_ranked_voting.contest_voters(p_contest_id uuid)
returns table (email text, voted_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select u.email::text, v.created_at
  from app_ranked_voting.votes v
  join app_ranked_voting.contests c on c.id = v.contest_id
  left join auth.users u on u.id = v.voter_id
  where v.contest_id = p_contest_id and c.admin_id = (select auth.uid())
  order by v.created_at;
$$;

-- The comments download, for the contest's admin: the options with their average rank (lower
-- is better, null before any ballot) and every comment with its option, in random order and
-- without the ballot or voter it came from.
create or replace function app_ranked_voting.contest_feedback(p_contest_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_title text;
begin
  select c.title into v_title
  from app_ranked_voting.contests c
  where c.id = p_contest_id and c.admin_id = (select auth.uid());
  if not found then
    raise exception 'Access denied' using errcode = 'PT403';
  end if;

  return jsonb_build_object(
    'title', v_title,
    'options', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', o.id,
          'title', o.title,
          'avg_rank', (select avg(vr.rank)::float8 from app_ranked_voting.vote_rankings vr where vr.option_id = o.id)
        )
        order by o.order_index, o.created_at, o.id
      )
      from app_ranked_voting.contest_options o
      where o.contest_id = p_contest_id
    ), '[]'::jsonb),
    'comments', coalesce((
      select jsonb_agg(jsonb_build_object('option_id', vc.option_id, 'comment', vc.comment) order by random())
      from app_ranked_voting.vote_comments vc
      join app_ranked_voting.contest_options o on o.id = vc.option_id
      where o.contest_id = p_contest_id
    ), '[]'::jsonb)
  );
end;
$$;

-- The signed-in person's contests as a voter: open or closed contests they voted in, or whose
-- voter list names their address exactly (a domain rule alone does not list a contest here;
-- its voters use the link). At most 200, newest first.
create or replace function app_ranked_voting.my_voter_contests()
returns table (
  id uuid,
  title text,
  status text,
  vote_token text,
  end_date timestamptz,
  created_at timestamptz,
  has_voted boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with me as (
    select u.id as uid, lower(u.email) as email
    from auth.users u
    where u.id = (select auth.uid())
  )
  select c.id, c.title, c.status, c.vote_token, c.end_date, c.created_at,
    exists (select 1 from app_ranked_voting.votes v where v.contest_id = c.id and v.voter_id = me.uid) as has_voted
  from me
  join app_ranked_voting.contests c on c.status <> 'draft'
  where exists (select 1 from app_ranked_voting.votes v where v.contest_id = c.id and v.voter_id = me.uid)
     or exists (select 1 from app_ranked_voting.allowed_voters av where av.contest_id = c.id and av.email = me.email)
  order by c.created_at desc
  limit 200;
$$;

-- Privileges, written out in full ----------------------------------------------------------
-- New tables and functions may come with grants (Postgres gives every function to PUBLIC);
-- take everything back, then grant only what the policies and the pages need.

grant usage on schema app_ranked_voting to anon, authenticated;

revoke all on table
  app_ranked_voting.contests,
  app_ranked_voting.contest_options,
  app_ranked_voting.allowed_voters,
  app_ranked_voting.votes,
  app_ranked_voting.vote_rankings,
  app_ranked_voting.vote_comments
  from public, anon, authenticated;

-- The admin may not choose a contest's id, code, creation time or (at insert) status, nor
-- move a contest to someone else.
grant select, delete on table app_ranked_voting.contests to authenticated;
grant insert (admin_id, title, description, max_winners, results_visible_to_voters, randomize_options, comments_required, end_date)
  on table app_ranked_voting.contests to authenticated;
grant update (title, description, max_winners, results_visible_to_voters, randomize_options, comments_required, end_date, status, submissions_open)
  on table app_ranked_voting.contests to authenticated;

grant select, delete on table app_ranked_voting.contest_options to authenticated;
grant insert (contest_id, title, description, order_index) on table app_ranked_voting.contest_options to authenticated;
grant update (title, description, order_index) on table app_ranked_voting.contest_options to authenticated;

grant select, delete on table app_ranked_voting.allowed_voters to authenticated;
grant insert (contest_id, email) on table app_ranked_voting.allowed_voters to authenticated;

-- A voter's own vote row, without the anonymous token column.
grant select (id, contest_id, voter_id, created_at) on table app_ranked_voting.votes to authenticated;

revoke all on function app_ranked_voting.create_contest_with_relations(text, text, integer, boolean, boolean, boolean, timestamptz, jsonb, text[]) from public, anon, authenticated;
revoke all on function app_ranked_voting.get_contest(text) from public, anon, authenticated;
revoke all on function app_ranked_voting.submit_vote(text, jsonb, jsonb, text) from public, anon, authenticated;
revoke all on function app_ranked_voting.contest_ballots(text, text) from public, anon, authenticated;
revoke all on function app_ranked_voting.contest_voters(uuid) from public, anon, authenticated;
revoke all on function app_ranked_voting.contest_feedback(uuid) from public, anon, authenticated;
revoke all on function app_ranked_voting.my_voter_contests() from public, anon, authenticated;

grant execute on function app_ranked_voting.create_contest_with_relations(text, text, integer, boolean, boolean, boolean, timestamptz, jsonb, text[]) to authenticated;
grant execute on function app_ranked_voting.get_contest(text) to anon, authenticated;
grant execute on function app_ranked_voting.submit_vote(text, jsonb, jsonb, text) to anon, authenticated;
grant execute on function app_ranked_voting.contest_ballots(text, text) to anon, authenticated;
grant execute on function app_ranked_voting.contest_voters(uuid) to authenticated;
grant execute on function app_ranked_voting.contest_feedback(uuid) to authenticated;
grant execute on function app_ranked_voting.my_voter_contests() to authenticated;
