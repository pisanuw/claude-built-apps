-- Heard-As Check: the first migration, holding the whole schema of SPEC section 5
-- (tables, policies, triggers and functions). A later migration needs the
-- owner's yes, so everything the app's seven milestones use is here and is
-- tested in milestone 1 (test/schema.test.ts, AC-7 to AC-10).
--
-- Applied by the Deploy workflow (`supabase: true` in deploy/target.yml), then
-- the schema is exposed and check-schema runs. Idempotent: running it twice is
-- harmless. A migration that has run never changes; changes go in 0002_*.sql.
--
-- No PDF and, by default, no transcript text is stored (SPEC section 5).

create schema if not exists app_heard_as_check;
comment on schema app_heard_as_check is 'heard-as-check: per-user documents, saved runs and CI keys; dropping the schema retires the app.';

-- documents ------------------------------------------------------------------
create table if not exists app_heard_as_check.documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  keep_text boolean not null default false,
  created_at timestamptz not null default now(),
  -- user_id first, so a name taken by another person is never reported as a duplicate.
  constraint documents_user_name_key unique (user_id, name),
  -- The parent half of the composite key that runs use (SPEC section 5).
  constraint documents_id_user_key unique (id, user_id)
);
comment on table app_heard_as_check.documents is 'A named PDF a person checks again and again; at most 20 per person.';

-- runs -----------------------------------------------------------------------
create table if not exists app_heard_as_check.runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  document_id uuid not null,
  -- Insertion order: "the oldest run" and "the latest 5 runs" follow it, because
  -- created_at ties inside one transaction and a client may write it (D-5).
  seq bigint generated always as identity,
  created_at timestamptz not null default now(),
  source text not null check (source in ('web', 'ci')),
  file_sha256 text not null check (file_sha256 ~ '^[0-9a-f]{64}$'),
  file_bytes integer not null check (file_bytes between 0 and 10485760),
  pages integer not null check (pages >= 0),
  pages_read integer not null check (pages_read between 0 and 60 and pages_read <= pages),
  pdfjs_version text not null check (char_length(pdfjs_version) between 1 and 40),
  chromium_version text not null check (char_length(chromium_version) between 1 and 40),
  verapdf_profile text check (char_length(verapdf_profile) <= 40),
  verapdf_version text check (char_length(verapdf_version) <= 40),
  verapdf_compliant boolean,
  verdict text not null check (verdict in (
    'Passes the validator, reads as intended',
    'Passes the validator, fails the reading',
    'Fails the validator, reads as intended',
    'Fails the validator and the reading',
    'No tags found',
    'The validator did not run; reading shown'
  )),
  error_count integer not null default 0 check (error_count >= 0),
  warning_count integer not null default 0 check (warning_count >= 0),
  quirk_count integer not null default 0 check (quirk_count >= 0),
  transcript_sha256 text not null check (transcript_sha256 ~ '^[0-9a-f]{64}$'),
  transcript_lines integer not null check (transcript_lines >= 0),
  -- 1 MB at most, and null unless the document keeps text and the run is among its latest 5.
  transcript text check (octet_length(transcript) <= 1048576),
  -- 200 kB at most (204,800 bytes of JSON text).
  faults jsonb not null default '[]'::jsonb check (jsonb_typeof(faults) = 'array' and octet_length(faults::text) <= 204800),
  is_baseline boolean not null default false,
  constraint runs_id_user_key unique (id, user_id),
  -- The composite key: a run can name only its own person's document, even by update.
  constraint runs_document_fkey foreign key (document_id, user_id)
    references app_heard_as_check.documents (id, user_id) on delete cascade
);
comment on table app_heard_as_check.runs is 'One saved check of a document: versions, verdict, counts and short fault snippets; never the file.';
create index if not exists runs_document_seq_idx on app_heard_as_check.runs (document_id, seq);
-- One baseline per document. set_baseline clears the old one before it sets
-- the new one, in two statements, because a partial unique index is checked
-- row by row and cannot be deferred (S3-8, D-6). user_id is in the key so
-- that a row naming another person's document is refused by the composite
-- key, never answered "duplicate key" about that person's baseline (D-6).
create unique index if not exists runs_one_baseline_idx on app_heard_as_check.runs (document_id, user_id) where is_baseline;

-- api_keys -------------------------------------------------------------------
create table if not exists app_heard_as_check.api_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  label text not null check (char_length(label) between 1 and 80),
  prefix text not null check (char_length(prefix) = 8),
  -- sha256 of the whole key, lower-case hex: what the page writes and what the ci_* functions compute.
  key_hash text not null check (key_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz,
  constraint api_keys_key_hash_key unique (key_hash)
);
comment on table app_heard_as_check.api_keys is 'CI keys: only the sha256 is kept, and the browser never reads it; at most 5 active per person.';

-- Row level security: every table, own rows only, signed-in people only ------
alter table app_heard_as_check.documents enable row level security;
alter table app_heard_as_check.runs enable row level security;
alter table app_heard_as_check.api_keys enable row level security;

do $$
declare t text;
begin
  foreach t in array array['documents', 'runs', 'api_keys'] loop
    execute format('drop policy if exists %I on app_heard_as_check.%I', t || '_select_own', t);
    execute format('create policy %I on app_heard_as_check.%I for select to authenticated using (user_id = auth.uid())', t || '_select_own', t);
    execute format('drop policy if exists %I on app_heard_as_check.%I', t || '_insert_own', t);
    execute format('create policy %I on app_heard_as_check.%I for insert to authenticated with check (user_id = auth.uid())', t || '_insert_own', t);
    execute format('drop policy if exists %I on app_heard_as_check.%I', t || '_update_own', t);
    execute format('create policy %I on app_heard_as_check.%I for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())', t || '_update_own', t);
    execute format('drop policy if exists %I on app_heard_as_check.%I', t || '_delete_own', t);
    execute format('create policy %I on app_heard_as_check.%I for delete to authenticated using (user_id = auth.uid())', t || '_delete_own', t);
  end loop;
end
$$;

-- Trigger functions (security invoker: they act as the caller, under row level security) --

-- A 21st document per person is refused. The advisory lock makes two inserts
-- at once wait for each other, so neither can slip past the count.
create or replace function app_heard_as_check.documents_cap()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('app_heard_as_check.documents:' || new.user_id::text, 0));
  if (select count(*) from app_heard_as_check.documents d where d.user_id = new.user_id) >= 20 then
    raise exception 'You can keep up to 20 documents.' using errcode = 'P0001', hint = 'documents-cap';
  end if;
  return new;
end
$$;
drop trigger if exists documents_cap on app_heard_as_check.documents;
create trigger documents_cap before insert on app_heard_as_check.documents
  for each row execute function app_heard_as_check.documents_cap();

-- "Keep transcript text" turned off: the text of the document's runs is set to null (AC-61).
create or replace function app_heard_as_check.documents_keep_text()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not new.keep_text and old.keep_text then
    update app_heard_as_check.runs r set transcript = null
      where r.document_id = new.id and r.user_id = new.user_id and r.transcript is not null;
  end if;
  return new;
end
$$;
drop trigger if exists documents_keep_text on app_heard_as_check.documents;
create trigger documents_keep_text after update of keep_text on app_heard_as_check.documents
  for each row execute function app_heard_as_check.documents_keep_text();

-- Before a run is written: the document is locked (runs of one document are
-- written one at a time), the text is dropped unless the document keeps it or
-- when the run comes from CI, and the document's first run is its baseline.
create or replace function app_heard_as_check.runs_before_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  keep boolean;
begin
  select d.keep_text into keep from app_heard_as_check.documents d
    where d.id = new.document_id and d.user_id = new.user_id
    for update;
  -- No such document of this person: refused as the composite key would refuse it.
  if keep is null then
    raise exception 'No such document.' using errcode = '23503', hint = 'document-not-found';
  end if;
  if not keep or new.source = 'ci' then
    new.transcript := null;
  end if;
  if not exists (select 1 from app_heard_as_check.runs r where r.document_id = new.document_id and r.is_baseline) then
    new.is_baseline := true;
  end if;
  return new;
end
$$;
drop trigger if exists runs_before_insert on app_heard_as_check.runs;
create trigger runs_before_insert before insert on app_heard_as_check.runs
  for each row execute function app_heard_as_check.runs_before_insert();

-- A saved run is a record: after insert, only the baseline flag may change,
-- and the text may only be dropped (set to null). Moving a run to another
-- document, rewriting its facts or adding text past the rules is refused;
-- the column grants below say the same, this says it for every caller (R1.1-1, D-23).
create or replace function app_heard_as_check.runs_before_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.transcript is not null and new.transcript is distinct from old.transcript then
    raise exception 'A saved run''s text can only be removed.' using errcode = 'P0001', hint = 'run-text-frozen';
  end if;
  if (new.id, new.user_id, new.document_id, new.seq, new.created_at, new.source, new.file_sha256, new.file_bytes,
      new.pages, new.pages_read, new.pdfjs_version, new.chromium_version, new.verapdf_profile, new.verapdf_version,
      new.verapdf_compliant, new.verdict, new.error_count, new.warning_count, new.quirk_count,
      new.transcript_sha256, new.transcript_lines, new.faults)
     is distinct from
     (old.id, old.user_id, old.document_id, old.seq, old.created_at, old.source, old.file_sha256, old.file_bytes,
      old.pages, old.pages_read, old.pdfjs_version, old.chromium_version, old.verapdf_profile, old.verapdf_version,
      old.verapdf_compliant, old.verdict, old.error_count, old.warning_count, old.quirk_count,
      old.transcript_sha256, old.transcript_lines, old.faults) then
    raise exception 'A saved run cannot be changed; only its baseline flag and its text (removed) can.' using errcode = 'P0001', hint = 'run-frozen';
  end if;
  return new;
end
$$;
drop trigger if exists runs_before_update on app_heard_as_check.runs;
create trigger runs_before_update before update on app_heard_as_check.runs
  for each row execute function app_heard_as_check.runs_before_update();

-- After a run is written: at most 50 runs per document (the oldest that is not
-- the baseline goes first), and text only on the latest 5.
create or replace function app_heard_as_check.runs_after_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  extra bigint;
begin
  select count(*) - 50 into extra from app_heard_as_check.runs r where r.document_id = new.document_id;
  if extra > 0 then
    delete from app_heard_as_check.runs r where r.id in (
      select o.id from app_heard_as_check.runs o
        where o.document_id = new.document_id and not o.is_baseline
        order by o.seq asc limit extra
    );
  end if;
  update app_heard_as_check.runs r set transcript = null
    where r.document_id = new.document_id and r.transcript is not null
      and r.seq < (select min(l.seq) from (
        select x.seq from app_heard_as_check.runs x where x.document_id = new.document_id order by x.seq desc limit 5
      ) l);
  return null;
end
$$;
drop trigger if exists runs_after_insert on app_heard_as_check.runs;
create trigger runs_after_insert after insert on app_heard_as_check.runs
  for each row execute function app_heard_as_check.runs_after_insert();

-- At most 5 active keys and 50 keys in all (revoked ones count) per person;
-- a revoked key stays revoked (R1.1-4).
create or replace function app_heard_as_check.api_keys_rules()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at then
    raise exception 'A revoked key cannot be used again.' using errcode = 'P0001', hint = 'key-revoked';
  end if;
  if tg_op = 'INSERT' then
    perform pg_advisory_xact_lock(hashtextextended('app_heard_as_check.api_keys:' || new.user_id::text, 0));
    if (select count(*) from app_heard_as_check.api_keys k where k.user_id = new.user_id) >= 50 then
      raise exception 'You have 50 API keys, revoked ones included. Delete some revoked keys first.' using errcode = 'P0001', hint = 'keys-total-cap';
    end if;
  end if;
  if new.revoked_at is null and (tg_op = 'INSERT' or old.revoked_at is not null) then
    perform pg_advisory_xact_lock(hashtextextended('app_heard_as_check.api_keys:' || new.user_id::text, 0));
    if (select count(*) from app_heard_as_check.api_keys k
          where k.user_id = new.user_id and k.revoked_at is null and k.id <> new.id) >= 5 then
      raise exception 'You can have up to 5 active API keys.' using errcode = 'P0001', hint = 'keys-cap';
    end if;
  end if;
  return new;
end
$$;
drop trigger if exists api_keys_rules on app_heard_as_check.api_keys;
create trigger api_keys_rules before insert or update on app_heard_as_check.api_keys
  for each row execute function app_heard_as_check.api_keys_rules();

-- set_baseline: the page's "Use this run as the baseline" (AC-60) -----------------
-- security invoker, so row level security applies: another person's run is not found.
create or replace function app_heard_as_check.set_baseline(p_run_id uuid)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  doc uuid;
begin
  select r.document_id into doc from app_heard_as_check.runs r where r.id = p_run_id;
  if doc is null then
    raise exception 'No such run.' using errcode = 'P0002', hint = 'run-not-found';
  end if;
  -- The per-document lock that inserts take too: two calls at once run one
  -- after the other, so the second sees the first's baseline (R1.1-3).
  perform 1 from app_heard_as_check.documents d where d.id = doc for update;
  -- Two statements, the old baseline first (S3-8).
  update app_heard_as_check.runs r set is_baseline = false where r.document_id = doc and r.is_baseline and r.id <> p_run_id;
  update app_heard_as_check.runs r set is_baseline = true where r.id = p_run_id and not r.is_baseline;
  return p_run_id;
end
$$;

-- The CI functions: called by the capture mount with the anon key and the
-- person's API key (the CI step has no session). security definer, so they
-- reach the tables past row level security, and therefore check everything
-- themselves and touch only the key owner's rows.

-- The key's owner and id, or an error. One message for every bad key.
create or replace function app_heard_as_check.ci_key_owner(p_key text, out key_id uuid, out owner uuid)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_key is null or p_key !~ '^hac_[A-Za-z0-9]{32}$' then
    raise exception 'invalid key' using errcode = '28000';
  end if;
  select k.id, k.user_id into key_id, owner from app_heard_as_check.api_keys k
    where k.key_hash = encode(pg_catalog.sha256(convert_to(p_key, 'UTF8')), 'hex') and k.revoked_at is null;
  if key_id is null then
    raise exception 'invalid key' using errcode = '28000';
  end if;
  update app_heard_as_check.api_keys k set last_used_at = now() where k.id = key_id;
end
$$;

-- A CI document name: 1 to 80 letters, digits, spaces, '.', '_', '-' and '/' (AC-67).
create or replace function app_heard_as_check.ci_check_name(p_document text)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_document is null or p_document !~ '^[[:alnum:] ._/-]{1,80}$' then
    raise exception 'invalid document name' using errcode = '22023';
  end if;
end
$$;

-- The baseline the next CI run is compared with (AC-66, AC-67).
-- Returns { user_id, document: {id, name} | null, baseline: {...} | null }.
create or replace function app_heard_as_check.ci_baseline(p_key text, p_document text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  k record;
  doc app_heard_as_check.documents;
  base app_heard_as_check.runs;
begin
  select * into k from app_heard_as_check.ci_key_owner(p_key);
  perform app_heard_as_check.ci_check_name(p_document);
  select * into doc from app_heard_as_check.documents d where d.user_id = k.owner and d.name = p_document;
  if doc.id is not null then
    select * into base from app_heard_as_check.runs r where r.document_id = doc.id and r.user_id = k.owner and r.is_baseline;
  end if;
  return jsonb_build_object(
    'user_id', k.owner,
    'document', case when doc.id is null then null else jsonb_build_object('id', doc.id, 'name', doc.name) end,
    'baseline', case when base.id is null then null else jsonb_build_object(
      'id', base.id, 'created_at', base.created_at, 'source', base.source,
      'file_sha256', base.file_sha256, 'pdfjs_version', base.pdfjs_version,
      'chromium_version', base.chromium_version, 'verdict', base.verdict,
      'transcript_sha256', base.transcript_sha256, 'faults', base.faults) end
  );
end
$$;

-- Saves one CI run for the key's owner (AC-66, AC-67, AC-70): creates the
-- document on first use (its first run becomes the baseline), never keeps
-- transcript text, and trims as the triggers do. Returns { run_id, document_id, is_baseline }.
create or replace function app_heard_as_check.ci_record_run(p_key text, p_document text, p_run jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  k record;
  doc_id uuid;
  r app_heard_as_check.runs;
  saved app_heard_as_check.runs;
begin
  select * into k from app_heard_as_check.ci_key_owner(p_key);
  perform app_heard_as_check.ci_check_name(p_document);
  -- A size cap before the run is read field by field (faults are 200 kB at most).
  if p_run is null or jsonb_typeof(p_run) <> 'object' or octet_length(p_run::text) > 262144 then
    raise exception 'invalid run' using errcode = '22023';
  end if;
  -- The per-person lock documents_cap takes, taken before the lookup: two first
  -- runs for one new name at once run one after the other, and the second
  -- finds the document the first created (R1.1-2).
  perform pg_advisory_xact_lock(hashtextextended('app_heard_as_check.documents:' || k.owner::text, 0));
  select d.id into doc_id from app_heard_as_check.documents d where d.user_id = k.owner and d.name = p_document;
  if doc_id is null then
    insert into app_heard_as_check.documents (user_id, name) values (k.owner, p_document) returning id into doc_id;
  end if;
  r := jsonb_populate_record(null::app_heard_as_check.runs, p_run);
  insert into app_heard_as_check.runs (
    user_id, document_id, source, file_sha256, file_bytes, pages, pages_read,
    pdfjs_version, chromium_version, verapdf_profile, verapdf_version, verapdf_compliant,
    verdict, error_count, warning_count, quirk_count, transcript_sha256, transcript_lines,
    transcript, faults
  ) values (
    k.owner, doc_id, 'ci', r.file_sha256, r.file_bytes, r.pages, r.pages_read,
    r.pdfjs_version, r.chromium_version, r.verapdf_profile, r.verapdf_version, r.verapdf_compliant,
    r.verdict, coalesce(r.error_count, 0), coalesce(r.warning_count, 0), coalesce(r.quirk_count, 0),
    r.transcript_sha256, r.transcript_lines, null, coalesce(r.faults, '[]'::jsonb)
  ) returning * into saved;
  return jsonb_build_object('run_id', saved.id, 'document_id', doc_id, 'is_baseline', saved.is_baseline);
end
$$;

-- Privileges -------------------------------------------------------------------
-- Tables: signed-in people only; nothing for anon. api_keys' key_hash is never
-- readable by the browser (a column-level grant), and last_used_at is written
-- only by the ci_* functions.
grant usage on schema app_heard_as_check to authenticated, anon;
revoke all on all tables in schema app_heard_as_check from anon, public;
grant select, insert, update, delete on app_heard_as_check.documents to authenticated;
grant select, insert, delete on app_heard_as_check.runs to authenticated;
-- Update only what set_baseline and the text-dropping triggers write as the caller (R1.1-1).
grant update (is_baseline, transcript) on app_heard_as_check.runs to authenticated;
revoke all on app_heard_as_check.api_keys from authenticated;
grant select (id, user_id, label, prefix, created_at, last_used_at, revoked_at) on app_heard_as_check.api_keys to authenticated;
grant insert (label, prefix, key_hash) on app_heard_as_check.api_keys to authenticated;
grant update (label, revoked_at) on app_heard_as_check.api_keys to authenticated;
grant delete on app_heard_as_check.api_keys to authenticated;

-- Functions: nobody by default, then exactly the three the app calls (AC-7).
revoke execute on all functions in schema app_heard_as_check from public, anon, authenticated;
alter default privileges in schema app_heard_as_check revoke execute on functions from public;
grant execute on function app_heard_as_check.ci_baseline(text, text) to anon;
grant execute on function app_heard_as_check.ci_record_run(text, text, jsonb) to anon;
grant execute on function app_heard_as_check.set_baseline(uuid) to authenticated;
