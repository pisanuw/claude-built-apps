-- Read-only: PostgREST's in-database settings (ALTER ROLE authenticator SET
-- pgrst.*), which take precedence over the Management API's db_schema.
select rolname, rolconfig from pg_roles where rolname in ('authenticator', 'anon', 'authenticated');
