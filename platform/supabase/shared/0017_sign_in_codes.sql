-- Emailed sign-in codes (owner, 22 November 2026: "it should send a 6 digit
-- code like upvoteme"). Design and decisions D-SC-1 to D-SC-8:
-- platform/src/signin/README.md, "Sign-in codes"; docs/platform.md,
-- "Sign-in links and abuse limits".
--
-- Applied by `node platform/supabase-admin.mjs apply-shared` after
-- 0002_sign_in.sql. Idempotent: create if not exists, create or replace,
-- revoke/grant. Only the service role (the sign-in-link edge function)
-- touches the table: RLS is on with no policies, and anon and authenticated
-- have no table access and cannot execute the functions. The functions are
-- security invoker with search_path '' and every object named with its
-- schema, like 0002's.
--
-- One row per mailbox: the code sign-in-link emailed last for it. It holds
-- HMAC-SHA256 hashes only (function secret SIGN_IN_HASH_KEY): the canonical
-- mailbox (the same email_hash as sign_in_requests), the browser that asked
-- (browser:<browserId>) and the code bound to the address it went to
-- (sign-in-code:<address>:<code>). No address, browser id or code is stored.
-- It also holds the token hash of the link in the same email, which a right
-- code answers: Auth itself keeps that value in auth.users while it is valid,
-- so the row exposes nothing new to a reader who already has service-role
-- access.
--
-- Numbers mirrored in platform/src/signin/code.ts (a test checks they
-- agree): a code works 10 minutes; the 5th wrong code voids it. A newer code
-- for the mailbox replaces the row and its count (Auth's newer link has
-- replaced the old token too). Rows go when the code is used, and are pruned
-- an hour after they expire (up to 200 each time a code is issued), so none
-- stays longer than the sign-in log's 30 days unless no code is ever issued
-- again.

create table if not exists platform.sign_in_codes (
  email_hash text primary key,
  browser_hash text not null,
  code_hash text not null,
  token_hash text not null,
  wrong int not null default 0,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  constraint sign_in_codes_hash_check
    check (email_hash ~ '^[0-9a-f]{64}$' and browser_hash ~ '^[0-9a-f]{64}$' and code_hash ~ '^[0-9a-f]{64}$'),
  constraint sign_in_codes_token_check check (token_hash <> ''),
  constraint sign_in_codes_wrong_check check (wrong >= 0)
);
comment on table platform.sign_in_codes is 'Emailed sign-in codes: per mailbox hash, the hashed browser that asked, an HMAC of the code, the link token hash it unlocks, wrong tries and expiry; written by sign-in-link (service role).';
comment on column platform.sign_in_codes.code_hash is 'HMAC-SHA256 of ''sign-in-code:<lower-cased address>:<code>'' under SIGN_IN_HASH_KEY, hex.';
comment on column platform.sign_in_codes.token_hash is 'The hashed_token of the link in the same email (Auth admin generate_link); answered for the right code, deleted with the row.';

create index if not exists sign_in_codes_expires_idx on platform.sign_in_codes (expires_at);

-- ---------------------------------------------------------------------------
-- sign_in_code_issue: store a new code for a mailbox, replacing the last one
-- ---------------------------------------------------------------------------

create or replace function platform.sign_in_code_issue(p_email_hash text, p_browser_hash text, p_code_hash text, p_token_hash text)
returns timestamptz
language plpgsql
set search_path = ''
as $$
declare
  v_expires timestamptz := now() + interval '10 minutes';
begin
  if p_email_hash is null or p_browser_hash is null or p_code_hash is null or coalesce(p_token_hash, '') = '' then
    raise exception 'sign_in_code_issue: every argument is required';
  end if;
  delete from platform.sign_in_codes
   where email_hash in (
     select email_hash from platform.sign_in_codes
      where expires_at < now() - interval '1 hour'
      order by expires_at
      limit 200
      for update skip locked);
  insert into platform.sign_in_codes (email_hash, browser_hash, code_hash, token_hash, wrong, created_at, expires_at)
  values (p_email_hash, p_browser_hash, p_code_hash, p_token_hash, 0, now(), v_expires)
  on conflict (email_hash) do update
    set browser_hash = excluded.browser_hash,
        code_hash = excluded.code_hash,
        token_hash = excluded.token_hash,
        wrong = 0,
        created_at = excluded.created_at,
        expires_at = excluded.expires_at;
  return v_expires;
end;
$$;
comment on function platform.sign_in_code_issue(text, text, text, text) is 'sign-in-link: stores the code it is about to email for a mailbox (replacing any earlier one, count reset), prunes rows an hour past expiry; returns when the code expires.';

-- ---------------------------------------------------------------------------
-- sign_in_code_check: one try at a code, counted under the row lock
-- ---------------------------------------------------------------------------

-- Answers { status: 'none' } when the mailbox has no code, or its code was
-- asked for from another browser: nothing is counted, so a stranger can
-- neither guess someone's code nor void it with wrong tries (a new code for
-- the address does replace it: D-SC-3). Then 'void' after 5 wrong codes,
-- 'expired' after 10 minutes, { status: 'ok', token_hash } for the right
-- code (and the row is deleted: a code works once), and otherwise
-- { status: 'wrong', left } with the wrong try counted. The lock makes
-- parallel tries take turns, so no more than 5 wrong ones ever count.
create or replace function platform.sign_in_code_check(p_email_hash text, p_browser_hash text, p_code_hash text)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  r platform.sign_in_codes;
begin
  select * into r from platform.sign_in_codes where email_hash = p_email_hash for update;
  if not found or r.browser_hash is distinct from p_browser_hash then
    return jsonb_build_object('status', 'none');
  end if;
  if r.wrong >= 5 then
    return jsonb_build_object('status', 'void');
  end if;
  if r.expires_at <= now() then
    return jsonb_build_object('status', 'expired');
  end if;
  if r.code_hash = p_code_hash then
    delete from platform.sign_in_codes where email_hash = p_email_hash;
    return jsonb_build_object('status', 'ok', 'token_hash', r.token_hash);
  end if;
  update platform.sign_in_codes set wrong = wrong + 1 where email_hash = p_email_hash;
  return jsonb_build_object('status', 'wrong', 'left', greatest(5 - (r.wrong + 1), 0));
end;
$$;
comment on function platform.sign_in_code_check(text, text, text) is 'sign-in-link: one try at a mailbox''s code from one browser: none, void, expired, wrong (counted, with tries left) or ok with the link token hash (row deleted).';

-- ---------------------------------------------------------------------------
-- Row level security and grants: service role only
-- ---------------------------------------------------------------------------

alter table platform.sign_in_codes enable row level security;   -- no policies: service role only

revoke all on table platform.sign_in_codes from public, anon, authenticated;
grant select, insert, update, delete on table platform.sign_in_codes to service_role;

revoke all on function platform.sign_in_code_issue(text, text, text, text) from public, anon, authenticated;
revoke all on function platform.sign_in_code_check(text, text, text) from public, anon, authenticated;

grant execute on function platform.sign_in_code_issue(text, text, text, text) to service_role;
grant execute on function platform.sign_in_code_check(text, text, text) to service_role;
