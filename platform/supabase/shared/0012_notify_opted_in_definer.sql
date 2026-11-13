-- App-notify: notify_opted_in runs as its owner (security definer).
--
-- Found live on 13 Nov 2026 (ops/notify-ready.sql): the service role has
-- usage on schema auth but no select on auth.users, so the security-invoker
-- notify_opted_in of 0011 could never read an address and app-notify would
-- send nothing. 0009 hit the same wall and uses security definer for the
-- same reason. This replaces only that one function; the others in 0011 stay
-- security invoker.
--
-- Why this is safe:
-- - only service_role may execute it (revoke/grant below, same as 0011);
-- - the identifiers come from platform.notify_apps, which only the Supabase
--   admin writes (the service role cannot insert or change them), whose check
--   constraints keep the opt-in table to plain names in the app's own schema
--   app_<slug>, and which format('%I') quotes regardless;
-- - it returns only (user_id, email) of confirmed, live, opted-in accounts of
--   an enabled app; search_path is '' and every object is schema-qualified.
--
-- Idempotent: create or replace, revoke/grant.

create or replace function platform.notify_opted_in(p_app text)
returns table (user_id uuid, email text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  r platform.notify_apps%rowtype;
begin
  select * into r from platform.notify_apps a where a.slug = p_app and a.enabled;
  if not found then
    raise exception 'notify_opted_in: no enabled app %', p_app using errcode = 'P0002';
  end if;
  return query execute format(
    'select u.id, u.email::text from %I.%I t join auth.users u on u.id = t.%I '
    'where t.%I is true and u.email is not null and u.deleted_at is null '
    'and u.email_confirmed_at is not null and (u.banned_until is null or u.banned_until <= now())',
    r.opt_in_schema, r.opt_in_table, r.opt_in_user_column, r.opt_in_flag_column);
end;
$$;
comment on function platform.notify_opted_in(text) is 'App-notify: the opted-in people of an enabled app (its registry''s table and flag), with their confirmed address. Security definer (0012): the service role cannot read auth.users.';

revoke all on function platform.notify_opted_in(text) from public, anon, authenticated;
grant execute on function platform.notify_opted_in(text) to service_role;
