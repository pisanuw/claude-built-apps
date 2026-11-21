-- tagging-doctor, migration 0001: courses, projects, scans, jobs and alt texts
-- (SPEC.md section 5). Schema app_tagging_doctor only: nothing here touches
-- `public`, `platform` or another app's schema (AC-63; the gateway row is
-- PManager's release step). Applied by the Deploy workflow
-- (`supabase: true` in deploy/target.yml), then checked by check-schema.
-- Idempotent; once applied, this file never changes: add 0002_<name>.sql.
--
-- Every table: user_id with the auth.uid() default and a cascading key to
-- auth.users, row level security with own-row policies, grants to
-- authenticated only (none to anon). A child names its parent with a
-- composite key (parent_id, user_id), so a row can never name another
-- user's course, project or scan, even by update. No `force row level
-- security`, so "Delete my account" (platform.delete_hintwise_data) removes
-- every row (AC-25). No sources and no PDFs are stored: a scan keeps its
-- summary and its findings (paths, lines, rules, package names, excerpts of
-- at most 200 characters; AC-23).

create schema if not exists app_tagging_doctor;
comment on schema app_tagging_doctor is 'tagging-doctor: per-user courses and saved scans. Dropping the schema retires the app.';

create table if not exists app_tagging_doctor.courses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 200),
  term text check (term is null or length(term) <= 100),
  created_at timestamptz not null default now(),
  unique (id, user_id)
);
comment on table app_tagging_doctor.courses is 'A course: a named group of projects, owned by user_id.';
create index if not exists courses_user_idx on app_tagging_doctor.courses (user_id, created_at);

create table if not exists app_tagging_doctor.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  course_id uuid not null,
  name text not null check (length(btrim(name)) between 1 and 300),
  main_file text not null check (length(main_file) between 1 and 1000),
  created_at timestamptz not null default now(),
  unique (id, user_id),
  -- With user_id, so a clash can only be with one's own project (never a hint about another user's course).
  unique (course_id, user_id, name),
  foreign key (course_id, user_id) references app_tagging_doctor.courses (id, user_id) on delete cascade
);
comment on table app_tagging_doctor.projects is 'One LaTeX document of a course (its main file). A new version is a new scan of the same project.';
create index if not exists projects_user_idx on app_tagging_doctor.projects (user_id);
create index if not exists projects_course_user_idx on app_tagging_doctor.projects (course_id, user_id);

create table if not exists app_tagging_doctor.scans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  project_id uuid not null,
  created_at timestamptz not null default now(),
  data_as_of date not null,
  summary jsonb not null check (jsonb_typeof(summary) = 'object' and octet_length(summary::text) <= 16384),
  findings jsonb not null check (
    jsonb_typeof(findings) = 'array'
    and octet_length(findings::text) <= 524288
    and not jsonb_path_exists(findings, '$[*].excerpt ? (@ like_regex "^.{201}" flag "s")')
  ),
  unique (id, user_id),
  unique (id, project_id, user_id),
  foreign key (project_id, user_id) references app_tagging_doctor.projects (id, user_id) on delete cascade
);
comment on table app_tagging_doctor.scans is 'A saved scan: summary and findings with excerpts of at most 200 characters, never the source.';
create index if not exists scans_project_idx on app_tagging_doctor.scans (project_id, created_at);
create index if not exists scans_project_user_idx on app_tagging_doctor.scans (project_id, user_id);
create index if not exists scans_user_idx on app_tagging_doctor.scans (user_id);

create table if not exists app_tagging_doctor.jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  project_id uuid not null,
  scan_id uuid not null,
  kind text not null check (kind in ('check', 'patched-check')),
  status text not null check (status in ('queued', 'running', 'done', 'failed')),
  started_at timestamptz,
  finished_at timestamptz,
  result jsonb check (result is null or (jsonb_typeof(result) = 'object' and octet_length(result::text) <= 65536)),
  error text check (error is null or length(error) <= 4000),
  created_at timestamptz not null default now(),
  foreign key (project_id, user_id) references app_tagging_doctor.projects (id, user_id) on delete cascade,
  foreign key (scan_id, project_id, user_id) references app_tagging_doctor.scans (id, project_id, user_id) on delete cascade
);
comment on table app_tagging_doctor.jobs is 'A compile-and-check run of a saved scan (milestone 3b): status, timings and a result summary, with no PDF and no source.';
create index if not exists jobs_project_idx on app_tagging_doctor.jobs (project_id, user_id);
create index if not exists jobs_scan_idx on app_tagging_doctor.jobs (scan_id, project_id, user_id);
create index if not exists jobs_user_idx on app_tagging_doctor.jobs (user_id);

create table if not exists app_tagging_doctor.alt_texts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  project_id uuid not null,
  figure_path text not null check (length(figure_path) between 1 and 1000),
  figure_hash text not null check (length(figure_hash) between 1 and 128),
  text text not null check (length(text) <= 4000),
  decision text not null check (decision in ('approved', 'decorative')),
  source text not null check (source in ('model', 'byok', 'typed')),
  updated_at timestamptz not null default now(),
  -- One slot per figure of a project; user_id is in it for the reason given at projects.
  unique (project_id, user_id, figure_path),
  foreign key (project_id, user_id) references app_tagging_doctor.projects (id, user_id) on delete cascade
);
comment on table app_tagging_doctor.alt_texts is 'An approved alt text (or decorative mark) for one figure of a project (milestone 5).';
create index if not exists alt_texts_project_user_idx on app_tagging_doctor.alt_texts (project_id, user_id);
create index if not exists alt_texts_user_idx on app_tagging_doctor.alt_texts (user_id);

-- Row level security: each signed-in user reaches only their own rows.
alter table app_tagging_doctor.courses enable row level security;
alter table app_tagging_doctor.projects enable row level security;
alter table app_tagging_doctor.scans enable row level security;
alter table app_tagging_doctor.jobs enable row level security;
alter table app_tagging_doctor.alt_texts enable row level security;

drop policy if exists courses_select_own on app_tagging_doctor.courses;
create policy courses_select_own on app_tagging_doctor.courses for select to authenticated using (user_id = auth.uid());
drop policy if exists courses_insert_own on app_tagging_doctor.courses;
create policy courses_insert_own on app_tagging_doctor.courses for insert to authenticated with check (user_id = auth.uid());
drop policy if exists courses_update_own on app_tagging_doctor.courses;
create policy courses_update_own on app_tagging_doctor.courses for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists courses_delete_own on app_tagging_doctor.courses;
create policy courses_delete_own on app_tagging_doctor.courses for delete to authenticated using (user_id = auth.uid());

drop policy if exists projects_select_own on app_tagging_doctor.projects;
create policy projects_select_own on app_tagging_doctor.projects for select to authenticated using (user_id = auth.uid());
drop policy if exists projects_insert_own on app_tagging_doctor.projects;
create policy projects_insert_own on app_tagging_doctor.projects for insert to authenticated with check (user_id = auth.uid());
drop policy if exists projects_update_own on app_tagging_doctor.projects;
create policy projects_update_own on app_tagging_doctor.projects for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists projects_delete_own on app_tagging_doctor.projects;
create policy projects_delete_own on app_tagging_doctor.projects for delete to authenticated using (user_id = auth.uid());

drop policy if exists scans_select_own on app_tagging_doctor.scans;
create policy scans_select_own on app_tagging_doctor.scans for select to authenticated using (user_id = auth.uid());
drop policy if exists scans_insert_own on app_tagging_doctor.scans;
create policy scans_insert_own on app_tagging_doctor.scans for insert to authenticated with check (user_id = auth.uid());
drop policy if exists scans_update_own on app_tagging_doctor.scans;
create policy scans_update_own on app_tagging_doctor.scans for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists scans_delete_own on app_tagging_doctor.scans;
create policy scans_delete_own on app_tagging_doctor.scans for delete to authenticated using (user_id = auth.uid());

drop policy if exists jobs_select_own on app_tagging_doctor.jobs;
create policy jobs_select_own on app_tagging_doctor.jobs for select to authenticated using (user_id = auth.uid());
drop policy if exists jobs_insert_own on app_tagging_doctor.jobs;
create policy jobs_insert_own on app_tagging_doctor.jobs for insert to authenticated with check (user_id = auth.uid());
drop policy if exists jobs_update_own on app_tagging_doctor.jobs;
create policy jobs_update_own on app_tagging_doctor.jobs for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists jobs_delete_own on app_tagging_doctor.jobs;
create policy jobs_delete_own on app_tagging_doctor.jobs for delete to authenticated using (user_id = auth.uid());

drop policy if exists alt_texts_select_own on app_tagging_doctor.alt_texts;
create policy alt_texts_select_own on app_tagging_doctor.alt_texts for select to authenticated using (user_id = auth.uid());
drop policy if exists alt_texts_insert_own on app_tagging_doctor.alt_texts;
create policy alt_texts_insert_own on app_tagging_doctor.alt_texts for insert to authenticated with check (user_id = auth.uid());
drop policy if exists alt_texts_update_own on app_tagging_doctor.alt_texts;
create policy alt_texts_update_own on app_tagging_doctor.alt_texts for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists alt_texts_delete_own on app_tagging_doctor.alt_texts;
create policy alt_texts_delete_own on app_tagging_doctor.alt_texts for delete to authenticated using (user_id = auth.uid());

-- Signed-in users only; anonymous visitors get no grants in app schemas.
grant usage on schema app_tagging_doctor to authenticated;
grant select, insert, update, delete on all tables in schema app_tagging_doctor to authenticated;
alter default privileges in schema app_tagging_doctor grant select, insert, update, delete on tables to authenticated;
