-- Read-only: triggers on auth.users and the functions they run (names only),
-- for account deletion (docs/platform.md). Prints no row data.
select t.tgname as trigger, n.nspname || '.' || p.proname as function,
       case when t.tgenabled = 'D' then 'disabled' else 'enabled' end as state,
       regexp_replace(substring(pg_get_functiondef(p.oid) from 'insert into ([a-z_."]+)'), '"', '', 'g') as inserts_into
  from pg_trigger t
  join pg_proc p on p.oid = t.tgfoid
  join pg_namespace n on n.oid = p.pronamespace
 where t.tgrelid = 'auth.users'::regclass and not t.tgisinternal
 order by 1;
