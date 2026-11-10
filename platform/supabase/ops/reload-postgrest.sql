-- Ask PostgREST to reload its configuration and schema cache. Harmless for
-- every app on the project. Used when `expose-schema` has changed db_schema
-- but the API still answers PGRST106 ("Invalid schema") for the new schema.
-- Run: Supabase admin workflow, command `sql`, arg this file's path.
notify pgrst, 'reload config';
notify pgrst, 'reload schema';
