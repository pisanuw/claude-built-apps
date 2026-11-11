-- Email opt-out: "Stop all email from HintWise" (docs/platform.md, "Email
-- footer, logo and opt-out"; contract in platform/src/signin/README.md).
--
-- Applied by `node platform/supabase-admin.mjs apply-shared` after
-- 0002_sign_in.sql, and before sign-in-link and auth-email-hook are
-- deployed with the opt-out check (without these functions they send
-- nothing). Idempotent: create if not exists, create or replace,
-- revoke/grant. Same rules as 0002: only the service role (the
-- sign-in-link, auth-email-hook and email-optout edge functions) touches
-- this table; RLS is on with no policies; anon and authenticated have no
-- table access and cannot execute the functions. The functions are security
-- invoker (the default, as in 0002): they run with the service role's own
-- rights, so a role without table access gets nothing from them even if it
-- could call them. Each pins search_path to '' and names every object with
-- its schema.
--
-- One row per address and scope that asked for no email. The address is
-- never stored: email_hash is the sign-in log's key, the HMAC-SHA256 of
-- 'email:<canonical mailbox>' under the function secret SIGN_IN_HASH_KEY, so
-- a Gmail dot variant or a +tag is the same address. Scope 'all' stops every
-- HintWise email, sign-in links included (the only scope built, 11 Nov
-- 2026). 'app:<slug>' is reserved for "Turn off <App> emails", which comes
-- with the app-notify sender; an 'all' row always applies as well.

create table if not exists platform.email_optouts (
  email_hash text not null,
  scope text not null default 'all',
  via text not null default 'link',
  created_at timestamptz not null default now(),
  constraint email_optouts_pkey primary key (email_hash, scope),
  constraint email_optouts_hash_check check (email_hash ~ '^[0-9a-f]{64}$'),
  constraint email_optouts_scope_check check (scope = 'all' or scope ~ '^app:[a-z0-9][a-z0-9-]{0,62}$'),
  constraint email_optouts_via_check check (via in ('link', 'support'))
);
comment on table platform.email_optouts is 'Addresses (as keyed hashes) that asked HintWise for no email, per scope; written by the email-optout function, read by sign-in-link and auth-email-hook (service role).';
comment on column platform.email_optouts.email_hash is 'HMAC-SHA256 of ''email:<canonical mailbox>'' under SIGN_IN_HASH_KEY, hex: the same key as platform.sign_in_requests.email_hash.';
comment on column platform.email_optouts.scope is '''all'' (every HintWise email, sign-in links too) or ''app:<slug>'' (reserved for per-app opt-outs).';
comment on column platform.email_optouts.via is 'link (the footer''s opt-out page) or support.';

-- ---------------------------------------------------------------------------
-- email_optout_check: does the address get no email in these scopes?
-- ---------------------------------------------------------------------------

create or replace function platform.email_optout_check(p_email_hash text, p_scopes text[] default '{}')
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1 from platform.email_optouts o
    where o.email_hash = p_email_hash
      and (o.scope = 'all' or o.scope = any (coalesce(p_scopes, '{}'::text[]))));
$$;
comment on function platform.email_optout_check(text, text[]) is 'True when the hashed address opted out of all HintWise email, or of one of p_scopes; sign-in-link and auth-email-hook send nothing then.';

-- ---------------------------------------------------------------------------
-- email_optout_set: opt out (idempotent: a second call keeps the first row)
-- ---------------------------------------------------------------------------

create or replace function platform.email_optout_set(p_email_hash text, p_scope text default 'all', p_via text default 'link')
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_scope text := coalesce(p_scope, 'all');
  v_since timestamptz;
begin
  insert into platform.email_optouts (email_hash, scope, via)
  values (p_email_hash, v_scope, coalesce(p_via, 'link'))
  on conflict (email_hash, scope) do nothing;
  select created_at into v_since from platform.email_optouts where email_hash = p_email_hash and scope = v_scope;
  return jsonb_build_object('scope', v_scope, 'since', v_since);
end;
$$;
comment on function platform.email_optout_set(text, text, text) is 'Puts the hashed address on the opt-out list for a scope (default all); a repeat keeps the first row. Returns { scope, since }.';

-- ---------------------------------------------------------------------------
-- email_optout_clear: email back on (idempotent; a null scope clears all)
-- ---------------------------------------------------------------------------

create or replace function platform.email_optout_clear(p_email_hash text, p_scope text default 'all')
returns int
language sql
set search_path = ''
as $$
  with gone as (
    delete from platform.email_optouts
    where email_hash = p_email_hash and (p_scope is null or scope = p_scope)
    returning 1
  )
  select count(*)::int from gone;
$$;
comment on function platform.email_optout_clear(text, text) is 'Takes the hashed address off the opt-out list for a scope (null: every scope); returns how many rows went (0 when it was not on the list).';

-- ---------------------------------------------------------------------------
-- email_optout_status: what support sees for one address
-- ---------------------------------------------------------------------------

create or replace function platform.email_optout_status(p_email_hash text)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('scope', o.scope, 'via', o.via, 'since', o.created_at) order by o.scope), '[]'::jsonb)
  from platform.email_optouts o
  where o.email_hash = p_email_hash;
$$;
comment on function platform.email_optout_status(text) is 'The opt-out rows of one hashed address as [{ scope, via, since }] (empty: it gets email).';

-- ---------------------------------------------------------------------------
-- Row level security and grants: service role only
-- ---------------------------------------------------------------------------

alter table platform.email_optouts enable row level security;   -- no policies: service role only

revoke all on table platform.email_optouts from public, anon, authenticated;
grant select, insert, update, delete on table platform.email_optouts to service_role;

revoke all on function platform.email_optout_check(text, text[]) from public, anon, authenticated;
revoke all on function platform.email_optout_set(text, text, text) from public, anon, authenticated;
revoke all on function platform.email_optout_clear(text, text) from public, anon, authenticated;
revoke all on function platform.email_optout_status(text) from public, anon, authenticated;

grant execute on function platform.email_optout_check(text, text[]) to service_role;
grant execute on function platform.email_optout_set(text, text, text) to service_role;
grant execute on function platform.email_optout_clear(text, text) to service_role;
grant execute on function platform.email_optout_status(text) to service_role;
