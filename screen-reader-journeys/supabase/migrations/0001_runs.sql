-- Screen Reader Journeys, migration 0001: runs, their results and reports, and the worker's
-- functions, in the app's own schema on the shared HintWise project.
--
-- Who may do what:
--   signed-in people  read their own runs, results and reports; queue runs (status 'queued',
--                     at most 3 waiting or running at once); delete their own runs
--   the worker        only through the worker_* functions below, which it calls with the anon
--                     key and WORKER_TOKEN. Each function checks the token's SHA-256 against
--                     worker_config, and refuses every token until that row exists. The hash is
--                     pinned by a separate ops SQL file after the owner's yes, never here.
--   anonymous         nothing else
--
-- Limits (proposed; the owner may change them):
--   per run     at most 200 report files and 20 MiB of reports in all (2 MiB each), and one
--               result per journey and mode of the run (a unique constraint)
--   retention   each person keeps their 20 latest runs; finished runs older than 30 days are
--               deleted (worker_prune_runs, which the worker calls about once an hour)
--
-- No service-role key anywhere. Idempotent: a second run changes nothing.

create schema if not exists app_screen_reader_journeys;

comment on schema app_screen_reader_journeys is 'Screen Reader Journeys (screen-reader-journeys.hintwise.org): runs, results and reports.';

-- Runs -------------------------------------------------------------------------------------

create table if not exists app_screen_reader_journeys.runs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  base_url    text not null check (char_length(base_url) <= 2048 and base_url ~ '^https?://'),
  -- Repo-relative journey paths, e.g. 'targets/generic/home-tab-order.journey.js'. The worker
  -- checks them against its own targets/ again before running.
  journeys    text[] not null check (cardinality(journeys) between 1 and 100),
  -- The hosted service runs only walker and virtual; the real screen readers need their own OS.
  modes       text[] not null check (cardinality(modes) between 1 and 2 and modes <@ array['walker', 'virtual']),
  status      text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  error       text check (char_length(error) <= 2000),
  created_at  timestamptz not null default now(),
  started_at  timestamptz,
  finished_at timestamptz,
  summary     jsonb check (summary is null or octet_length(summary::text) <= 65536)
);

comment on table app_screen_reader_journeys.runs is 'Screen reader journey runs. People queue them; the worker runs them through the worker_* functions.';

create index if not exists runs_queued_idx on app_screen_reader_journeys.runs (created_at) where status = 'queued';
create index if not exists runs_running_idx on app_screen_reader_journeys.runs (started_at) where status = 'running';
create index if not exists runs_user_id_idx on app_screen_reader_journeys.runs (user_id, created_at desc);
create index if not exists runs_finished_idx on app_screen_reader_journeys.runs (finished_at) where status in ('done', 'failed');

-- Results: one row per journey and mode ----------------------------------------------------

create table if not exists app_screen_reader_journeys.run_results (
  id            uuid primary key default gen_random_uuid(),
  run_id        uuid not null references app_screen_reader_journeys.runs (id) on delete cascade,
  -- The run's owner, copied by worker_add_results, so that row level security and account
  -- deletion need no join.
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  journey       text not null check (char_length(journey) <= 300),
  mode          text not null check (mode in ('walker', 'virtual')),
  status        text not null check (status in ('pass', 'fail', 'error')),
  checks_passed integer not null default 0 check (checks_passed >= 0),
  checks_total  integer not null default 0 check (checks_total >= 0),
  errors        integer not null default 0 check (errors >= 0),
  warnings      integer not null default 0 check (warnings >= 0),
  -- The Markdown report in run_reports, e.g. 'home-page-tab-order.walker.md'.
  report_path   text check (char_length(report_path) <= 200),
  -- One result per journey and mode of a run.
  constraint run_results_one_per_journey_mode unique (run_id, journey, mode)
);

create index if not exists run_results_run_id_idx on app_screen_reader_journeys.run_results (run_id);
create index if not exists run_results_user_id_idx on app_screen_reader_journeys.run_results (user_id);

-- Reports: the files a run wrote (Markdown, HTML, JSON, CSV, JUnit, SARIF), as text ----------
-- In a table rather than Storage, because an upload to Storage needs a privileged key.

create table if not exists app_screen_reader_journeys.run_reports (
  run_id       uuid not null references app_screen_reader_journeys.runs (id) on delete cascade,
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  path         text not null check (char_length(path) <= 200 and path ~ '^[A-Za-z0-9][A-Za-z0-9._-]*(/[A-Za-z0-9][A-Za-z0-9._-]*)*$'),
  content_type text not null check (char_length(content_type) <= 100),
  body         text not null check (octet_length(body) <= 2097152),
  created_at   timestamptz not null default now(),
  primary key (run_id, path)
);

create index if not exists run_reports_user_id_idx on app_screen_reader_journeys.run_reports (user_id);

-- The worker's token: its SHA-256 (hex), one row, pinned by ops SQL --------------------------

create table if not exists app_screen_reader_journeys.worker_config (
  id           boolean primary key default true check (id),
  token_sha256 text not null check (token_sha256 ~ '^[0-9a-f]{64}$'),
  updated_at   timestamptz not null default now()
);

comment on table app_screen_reader_journeys.worker_config is 'The SHA-256 of the worker''s WORKER_TOKEN (not secret). Empty until ops SQL pins it; the worker_* functions refuse every token until then.';

-- Row level security -----------------------------------------------------------------------

alter table app_screen_reader_journeys.runs enable row level security;
alter table app_screen_reader_journeys.run_results enable row level security;
alter table app_screen_reader_journeys.run_reports enable row level security;
alter table app_screen_reader_journeys.worker_config enable row level security;

drop policy if exists runs_select_own on app_screen_reader_journeys.runs;
create policy runs_select_own on app_screen_reader_journeys.runs
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists runs_insert_own on app_screen_reader_journeys.runs;
create policy runs_insert_own on app_screen_reader_journeys.runs
  for insert to authenticated
  with check (user_id = (select auth.uid()) and status = 'queued');

drop policy if exists runs_delete_own on app_screen_reader_journeys.runs;
create policy runs_delete_own on app_screen_reader_journeys.runs
  for delete to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists run_results_select_own on app_screen_reader_journeys.run_results;
create policy run_results_select_own on app_screen_reader_journeys.run_results
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists run_reports_select_own on app_screen_reader_journeys.run_reports;
create policy run_reports_select_own on app_screen_reader_journeys.run_reports
  for select to authenticated
  using (user_id = (select auth.uid()));

-- Nobody reads the token's hash through the API.
drop policy if exists worker_config_none on app_screen_reader_journeys.worker_config;
create policy worker_config_none on app_screen_reader_journeys.worker_config
  for select to authenticated
  using (false);

-- At most 3 runs waiting or running per person, so one account cannot fill the queue. A
-- trigger, because a policy on runs that counts runs is refused as recursive. The error code
-- lets the API answer 429.
create or replace function app_screen_reader_journeys.limit_active_runs()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- An insert for someone else fails the policy anyway; counting their runs here would tell
  -- the caller how many they have.
  if new.user_id is distinct from (select auth.uid()) then
    return new;
  end if;
  -- One insert at a time per person, so two at once cannot both pass the count.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('srj.limit_active_runs:' || new.user_id::text, 0));
  if (select count(*) from app_screen_reader_journeys.runs r
       where r.user_id = new.user_id and r.status in ('queued', 'running')) >= 3 then
    raise exception 'You already have 3 runs waiting or running. Try again when one finishes.'
      using errcode = '53400';
  end if;
  -- Retention: with this new run, the person keeps their 20 latest runs. Older finished runs
  -- go, with their results and reports (on delete cascade).
  delete from app_screen_reader_journeys.runs r
   where r.user_id = new.user_id
     and r.status in ('done', 'failed')
     and r.id not in (
           select k.id from app_screen_reader_journeys.runs k
            where k.user_id = new.user_id
            order by k.created_at desc, k.id desc
            limit 19
         );
  return new;
end;
$$;

drop trigger if exists runs_limit_active on app_screen_reader_journeys.runs;
create trigger runs_limit_active
  before insert on app_screen_reader_journeys.runs
  for each row execute function app_screen_reader_journeys.limit_active_runs();

-- The worker's functions -------------------------------------------------------------------

-- Raises 42501 unless p_token's SHA-256 is the pinned one. Called by every worker_* function;
-- granted to nobody.
create or replace function app_screen_reader_journeys.worker_token_ok(p_token text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  -- 32 to 200 printable ASCII characters, as the server's config.js requires.
  if p_token is null or p_token !~ '^[!-~]{32,200}$'
     or not exists (
       select 1 from app_screen_reader_journeys.worker_config c
        where c.token_sha256 = pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_token, 'UTF8')), 'hex')
     ) then
    raise exception 'Bad worker token.' using errcode = '42501';
  end if;
end;
$$;

-- Claim the oldest queued run and mark it running. Concurrent workers each get a different
-- run (FOR UPDATE SKIP LOCKED), or none.
create or replace function app_screen_reader_journeys.worker_claim_next_run(p_token text)
returns setof app_screen_reader_journeys.runs
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform app_screen_reader_journeys.worker_token_ok(p_token);
  return query
    update app_screen_reader_journeys.runs r
       set status = 'running', started_at = pg_catalog.now(), finished_at = null, error = null
     where r.id = (
             select q.id
               from app_screen_reader_journeys.runs q
              where q.status = 'queued'
              order by q.created_at, q.id
              limit 1
                for update skip locked
           )
       and r.status = 'queued'
    returning r.*;
end;
$$;

-- Fail runs still 'running' that started more than p_older_than_seconds ago: they belonged to
-- a worker that stopped. Returns how many.
create or replace function app_screen_reader_journeys.worker_fail_stale_runs(p_token text, p_older_than_seconds integer)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  perform app_screen_reader_journeys.worker_token_ok(p_token);
  if p_older_than_seconds is null or p_older_than_seconds < 60 then
    raise exception 'p_older_than_seconds must be at least 60.' using errcode = '22023';
  end if;
  update app_screen_reader_journeys.runs r
     set status = 'failed', error = 'The server stopped before this run finished.', finished_at = pg_catalog.now()
   where r.status = 'running'
     and r.started_at < pg_catalog.now() - pg_catalog.make_interval(secs => p_older_than_seconds);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Retention: delete finished runs that finished more than 30 days ago, with their results and
-- reports. Returns how many.
create or replace function app_screen_reader_journeys.worker_prune_runs(p_token text)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  perform app_screen_reader_journeys.worker_token_ok(p_token);
  delete from app_screen_reader_journeys.runs r
   where r.status in ('done', 'failed')
     and r.finished_at < pg_catalog.now() - interval '30 days';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Put a running run back in the queue (the worker is shutting down).
create or replace function app_screen_reader_journeys.worker_requeue_run(p_token text, p_run_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform app_screen_reader_journeys.worker_token_ok(p_token);
  update app_screen_reader_journeys.runs r
     set status = 'queued', started_at = null
   where r.id = p_run_id and r.status = 'running';
  return found;
end;
$$;

-- Save one report file of a running run (replacing a file of the same path). At most 200 files
-- and 20 MiB in all per run. Returns false when the run is not running (deleted, say).
create or replace function app_screen_reader_journeys.worker_save_report(
  p_token text,
  p_run_id uuid,
  p_path text,
  p_content_type text,
  p_body text
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid;
begin
  perform app_screen_reader_journeys.worker_token_ok(p_token);
  select r.user_id into v_user
    from app_screen_reader_journeys.runs r
   where r.id = p_run_id and r.status = 'running';
  if v_user is null then
    return false;
  end if;
  if (select count(*) from app_screen_reader_journeys.run_reports f where f.run_id = p_run_id and f.path <> p_path) >= 200 then
    raise exception 'A run keeps at most 200 report files.' using errcode = '54000';
  end if;
  if (select coalesce(sum(pg_catalog.octet_length(f.body)), 0) from app_screen_reader_journeys.run_reports f
       where f.run_id = p_run_id and f.path <> p_path) + coalesce(pg_catalog.octet_length(p_body), 0) > 20971520 then
    raise exception 'A run keeps at most 20 MiB of reports.' using errcode = '54000';
  end if;
  insert into app_screen_reader_journeys.run_reports (run_id, user_id, path, content_type, body)
  values (p_run_id, v_user, p_path, p_content_type, p_body)
  on conflict (run_id, path) do update
    set content_type = excluded.content_type, body = excluded.body, created_at = pg_catalog.now();
  return true;
end;
$$;

-- Record a running run's results: a JSON array of
-- { journey, mode, status, checks_passed, checks_total, errors, warnings, report_path }.
-- Each must be for one of the run's own journeys and modes, and there is at most one result per
-- journey and mode (the unique constraint). Returns how many rows were added (0 when the run is
-- not running).
create or replace function app_screen_reader_journeys.worker_add_results(p_token text, p_run_id uuid, p_results jsonb)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid;
  v_journeys text[];
  v_modes text[];
  v_count integer;
begin
  perform app_screen_reader_journeys.worker_token_ok(p_token);
  if p_results is null or pg_catalog.jsonb_typeof(p_results) <> 'array' or pg_catalog.jsonb_array_length(p_results) > 200 then
    raise exception 'p_results must be a JSON array of at most 200 results.' using errcode = '22023';
  end if;
  select r.user_id, r.journeys, r.modes into v_user, v_journeys, v_modes
    from app_screen_reader_journeys.runs r
   where r.id = p_run_id and r.status = 'running';
  if v_user is null then
    return 0;
  end if;
  if exists (
    select 1 from pg_catalog.jsonb_to_recordset(p_results) as x(journey text, mode text)
     where x.journey is null or x.mode is null or not (x.journey = any (v_journeys)) or not (x.mode = any (v_modes))
  ) then
    raise exception 'A result must be for one of the run''s journeys and modes.' using errcode = '54000';
  end if;
  insert into app_screen_reader_journeys.run_results
    (run_id, user_id, journey, mode, status, checks_passed, checks_total, errors, warnings, report_path)
  select p_run_id, v_user, x.journey, x.mode, x.status,
         coalesce(x.checks_passed, 0), coalesce(x.checks_total, 0), coalesce(x.errors, 0), coalesce(x.warnings, 0), x.report_path
    from pg_catalog.jsonb_to_recordset(p_results)
      as x(journey text, mode text, status text, checks_passed integer, checks_total integer, errors integer, warnings integer, report_path text);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Finish a running run: status 'done' or 'failed', with an error and a summary. Returns false
-- when the run is not running.
create or replace function app_screen_reader_journeys.worker_finish_run(
  p_token text,
  p_run_id uuid,
  p_status text,
  p_error text,
  p_summary jsonb
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform app_screen_reader_journeys.worker_token_ok(p_token);
  if p_status is null or p_status not in ('done', 'failed') then
    raise exception 'p_status must be done or failed.' using errcode = '22023';
  end if;
  update app_screen_reader_journeys.runs r
     set status = p_status, error = p_error, summary = p_summary, finished_at = pg_catalog.now()
   where r.id = p_run_id and r.status = 'running';
  return found;
end;
$$;

-- Privileges, written out in full ---------------------------------------------------------
-- New tables and functions may come with grants (Postgres gives every function to PUBLIC);
-- take everything back, then grant only what the policies and the worker need.

grant usage on schema app_screen_reader_journeys to authenticated, anon;

revoke all on table
  app_screen_reader_journeys.runs,
  app_screen_reader_journeys.run_results,
  app_screen_reader_journeys.run_reports,
  app_screen_reader_journeys.worker_config
  from public, anon, authenticated;

grant select, delete on table app_screen_reader_journeys.runs to authenticated;
-- People may set only these columns when queueing a run, so they cannot choose its id,
-- timestamps (and so its place in the queue), error or summary.
grant insert (user_id, base_url, journeys, modes, status) on table app_screen_reader_journeys.runs to authenticated;
grant select on table app_screen_reader_journeys.run_results, app_screen_reader_journeys.run_reports to authenticated;

revoke execute on function app_screen_reader_journeys.limit_active_runs() from public, anon, authenticated;
revoke execute on function app_screen_reader_journeys.worker_token_ok(text) from public, anon, authenticated;
revoke execute on function app_screen_reader_journeys.worker_claim_next_run(text) from public, authenticated;
revoke execute on function app_screen_reader_journeys.worker_fail_stale_runs(text, integer) from public, authenticated;
revoke execute on function app_screen_reader_journeys.worker_prune_runs(text) from public, authenticated;
revoke execute on function app_screen_reader_journeys.worker_requeue_run(text, uuid) from public, authenticated;
revoke execute on function app_screen_reader_journeys.worker_save_report(text, uuid, text, text, text) from public, authenticated;
revoke execute on function app_screen_reader_journeys.worker_add_results(text, uuid, jsonb) from public, authenticated;
revoke execute on function app_screen_reader_journeys.worker_finish_run(text, uuid, text, text, jsonb) from public, authenticated;

grant execute on function app_screen_reader_journeys.worker_claim_next_run(text) to anon;
grant execute on function app_screen_reader_journeys.worker_fail_stale_runs(text, integer) to anon;
grant execute on function app_screen_reader_journeys.worker_prune_runs(text) to anon;
grant execute on function app_screen_reader_journeys.worker_requeue_run(text, uuid) to anon;
grant execute on function app_screen_reader_journeys.worker_save_report(text, uuid, text, text, text) to anon;
grant execute on function app_screen_reader_journeys.worker_add_results(text, uuid, jsonb) to anon;
grant execute on function app_screen_reader_journeys.worker_finish_run(text, uuid, text, text, jsonb) to anon;
