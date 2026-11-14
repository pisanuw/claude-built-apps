-- delivery-canary: seed inbox (milestone 3). Applied by the Deploy workflow
-- like 0001. Idempotent; never edited once applied (add 0004_<name>.sql).
--
-- seed_inboxes: one per shop, the seed Gmail account the shop's test orders
-- go to: its address, the sender and subject words to look for, the outcome
-- of the last check, and, only when the shop asked to keep it, the app
-- password sealed by the Netlify function (AES-256-GCM with
-- DELIVERY_CANARY_KEY, bound to the user, shop, address and sender). The
-- database never sees the password itself. Column-level SELECT leaves the
-- sealed column out of every table read; the function reads it through
-- seed_inbox_secret with the user's token (so the user's own session could
-- too, which reveals nothing without the key).
-- Rows are written only through seed_inbox_save (called by the function with
-- the user's own token), which checks the shop is the caller's.
--
-- seed_checks: rate-limit log of seed checks (one row per IMAP sign-in), with
-- a keyed hash (HMAC with the server key) of the address, never the
-- address: 12 an hour per user and 20 an hour per seed address across all
-- users, so the function cannot be used to guess an app password, and a
-- stranger cannot compute a shop's tag to use up its checks.

create table if not exists app_delivery_canary.seed_inboxes (
  shop_id uuid primary key references app_delivery_canary.shops(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  address text not null check (char_length(address) between 3 and 254 and address ~ '^[^@[:space:]]+@[^@[:space:]]+$'),
  sender text not null check (char_length(sender) between 3 and 254),
  subject_hint text not null default '' check (char_length(subject_hint) <= 100),
  secret text check (secret is null or (char_length(secret) <= 800 and secret like 'v1.%')),
  has_secret boolean generated always as (secret is not null) stored,
  last_checked_at timestamptz,
  last_outcome text check (last_outcome is null or last_outcome in ('found', 'not-found', 'login-failed', 'needs-app-password', 'web-login', 'imap-off', 'unreachable', 'timeout', 'mailbox', 'protocol')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table app_delivery_canary.seed_inboxes is 'A shop''s seed Gmail account: address, sender to look for, last outcome, and (if kept) the app password sealed by the function.';
create index if not exists seed_inboxes_user_idx on app_delivery_canary.seed_inboxes (user_id);

create table if not exists app_delivery_canary.seed_checks (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  address_tag text not null check (address_tag ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now()
);
comment on table app_delivery_canary.seed_checks is 'Rate-limit log for /api/seed-check: who signed in to a seed mailbox when (address as a hash).';
create index if not exists seed_checks_user_created_idx on app_delivery_canary.seed_checks (user_id, created_at);
create index if not exists seed_checks_tag_created_idx on app_delivery_canary.seed_checks (address_tag, created_at);

alter table app_delivery_canary.seed_inboxes enable row level security;
alter table app_delivery_canary.seed_checks enable row level security;

drop policy if exists seed_inboxes_select_own on app_delivery_canary.seed_inboxes;
create policy seed_inboxes_select_own on app_delivery_canary.seed_inboxes for select to authenticated using (user_id = auth.uid());
drop policy if exists seed_inboxes_delete_own on app_delivery_canary.seed_inboxes;
create policy seed_inboxes_delete_own on app_delivery_canary.seed_inboxes for delete to authenticated using (user_id = auth.uid());

drop policy if exists seed_checks_select_own on app_delivery_canary.seed_checks;
create policy seed_checks_select_own on app_delivery_canary.seed_checks for select to authenticated using (user_id = auth.uid());
drop policy if exists seed_checks_insert_own on app_delivery_canary.seed_checks;
create policy seed_checks_insert_own on app_delivery_canary.seed_checks for insert to authenticated with check (user_id = auth.uid());

-- The rate limit, atomic like link_tests_limit: a lock per address tag (the
-- wider of the two limits), created_at fixed to now(), rows over a day old
-- pruned, then both counts. Security definer, because the per-address count
-- includes other users' rows; it returns nothing to the caller but the error.
create or replace function app_delivery_canary.seed_checks_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('app_delivery_canary.seed_checks:' || new.address_tag, 0));
  perform pg_advisory_xact_lock(hashtextextended('app_delivery_canary.seed_checks:' || new.user_id::text, 0));
  new.created_at := now();
  delete from app_delivery_canary.seed_checks where created_at < now() - interval '1 day';
  if (
    select count(*) from app_delivery_canary.seed_checks
    where user_id = new.user_id and created_at > now() - interval '1 hour'
  ) >= 12 then
    raise sqlstate 'PT429' using message = 'You have checked a seed inbox 12 times in the last hour. Try again later.';
  end if;
  if (
    select count(*) from app_delivery_canary.seed_checks
    where address_tag = new.address_tag and created_at > now() - interval '1 hour'
  ) >= 20 then
    raise sqlstate 'PT429' using message = 'This seed address has been checked 20 times in the last hour. Try again later.';
  end if;
  return new;
end
$$;

drop trigger if exists seed_checks_limit on app_delivery_canary.seed_checks;
create trigger seed_checks_limit
  before insert on app_delivery_canary.seed_checks
  for each row execute function app_delivery_canary.seed_checks_limit();

-- Saves a shop's seed inbox settings and the last outcome. p_secret_mode:
-- 'keep' leaves the stored sealed password as it is, 'set' stores p_secret,
-- 'clear' removes it. Runs as the owner (the table has no insert or update
-- grant), so it checks the caller and the shop itself. At most 20 rows per
-- account follows from one row per shop and 20 shops.
create or replace function app_delivery_canary.seed_inbox_save(
  p_shop uuid,
  p_address text,
  p_sender text,
  p_subject text,
  p_secret_mode text,
  p_secret text,
  p_outcome text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_kept boolean;
begin
  if v_user is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  if not exists (select 1 from app_delivery_canary.shops s where s.id = p_shop and s.user_id = v_user) then
    raise exception 'That shop is not yours.' using errcode = '42501';
  end if;
  if p_secret_mode not in ('keep', 'set', 'clear') or (p_secret_mode = 'set' and p_secret is null) then
    raise exception 'Bad secret mode.' using errcode = '22023';
  end if;
  insert into app_delivery_canary.seed_inboxes as t (shop_id, user_id, address, sender, subject_hint, secret, last_checked_at, last_outcome)
  values (
    p_shop, v_user, lower(p_address), p_sender, coalesce(p_subject, ''),
    case when p_secret_mode = 'set' then p_secret else null end,
    case when p_outcome is null then null else now() end,
    p_outcome
  )
  on conflict (shop_id) do update set
    address = excluded.address,
    sender = excluded.sender,
    subject_hint = excluded.subject_hint,
    -- A kept password belongs to one address and sender: changing either drops it.
    secret = case
      when p_secret_mode = 'set' then excluded.secret
      when p_secret_mode = 'clear' or t.address <> excluded.address or t.sender <> excluded.sender then null
      else t.secret
    end,
    last_checked_at = coalesce(excluded.last_checked_at, t.last_checked_at),
    last_outcome = coalesce(excluded.last_outcome, t.last_outcome),
    updated_at = now()
  where t.user_id = v_user
  returning t.secret is not null into v_kept;
  return coalesce(v_kept, false);
end
$$;

-- The sealed password of one of the caller's shops, for the function to
-- open; null when none is kept.
create or replace function app_delivery_canary.seed_inbox_secret(p_shop uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select t.secret from app_delivery_canary.seed_inboxes t
  where t.shop_id = p_shop and t.user_id = auth.uid();
$$;

-- Grants, written out in full. seed_inboxes: the browser reads every column
-- but the sealed secret, and may delete its own row (forget the inbox).
revoke all on table app_delivery_canary.seed_inboxes from public, anon, authenticated;
grant select (shop_id, user_id, address, sender, subject_hint, has_secret, last_checked_at, last_outcome, created_at, updated_at)
  on app_delivery_canary.seed_inboxes to authenticated;
grant delete on app_delivery_canary.seed_inboxes to authenticated;
revoke all on table app_delivery_canary.seed_checks from public, anon, authenticated;
grant select, insert on app_delivery_canary.seed_checks to authenticated;

revoke execute on function app_delivery_canary.seed_checks_limit() from public, anon, authenticated;
revoke execute on function app_delivery_canary.seed_inbox_save(uuid, text, text, text, text, text, text) from public, anon;
grant execute on function app_delivery_canary.seed_inbox_save(uuid, text, text, text, text, text, text) to authenticated;
revoke execute on function app_delivery_canary.seed_inbox_secret(uuid) from public, anon;
grant execute on function app_delivery_canary.seed_inbox_secret(uuid) to authenticated;
