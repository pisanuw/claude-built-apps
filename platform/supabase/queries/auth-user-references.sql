-- Read-only inventory for self-service account deletion (run with the
-- Supabase admin workflow: command sql, arg platform/supabase/queries/auth-user-references.sql).
-- Prints table and column names and counts only: no ids, emails or row data,
-- because the workflow log is public.
select n.nspname as schema, c.relname as "table", a.attname as "column",
       case con.confdeltype when 'c' then 'cascade' when 'n' then 'set null'
         when 'd' then 'set default' when 'r' then 'restrict' else 'no action' end as on_delete,
       'fk' as kind
  from pg_constraint con
  join pg_class c on c.oid = con.conrelid
  join pg_namespace n on n.oid = c.relnamespace
  join pg_attribute a on a.attrelid = c.oid and a.attnum = any (con.conkey)
 where con.contype = 'f' and con.confrelid = 'auth.users'::regclass
   and n.nspname not in ('auth')
union all
-- uuid or text columns that look like a user id but have no foreign key
select n.nspname, c.relname, a.attname, '-', 'no fk (name only)'
  from pg_attribute a
  join pg_class c on c.oid = a.attrelid and c.relkind in ('r','p')
  join pg_namespace n on n.oid = c.relnamespace
 where a.attnum > 0 and not a.attisdropped
   and a.attname ~* '(^|_)(user|owner|author|creator|member|account)(_id)?$|^uid$'
   and n.nspname not in ('auth','pg_catalog','information_schema','storage','realtime','vault','extensions','supabase_functions','supabase_migrations','graphql','graphql_public','pgsodium','net','cron')
   and not exists (select 1 from pg_constraint con where con.contype = 'f'
         and con.conrelid = c.oid and a.attnum = any (con.conkey) and con.confrelid = 'auth.users'::regclass)
order by 1, 2, 3;
