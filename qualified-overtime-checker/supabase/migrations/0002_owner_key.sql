-- qualified-overtime-checker: key client files by owner and id (security
-- review, 2026-11-10). With `id` alone as the primary key, someone who learned
-- another user's file id first could insert a row with it and make the
-- owner's later saves fail for good. With (user_id, id) each user's ids are
-- their own. The app upserts with on_conflict=user_id,id. Idempotent.

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'client_files_pkey'
      and conrelid = 'app_qualified_overtime_checker.client_files'::regclass
      and array_length(conkey, 1) = 1
  ) then
    alter table app_qualified_overtime_checker.client_files drop constraint client_files_pkey;
    alter table app_qualified_overtime_checker.client_files add constraint client_files_pkey primary key (user_id, id);
  end if;
end
$$;
