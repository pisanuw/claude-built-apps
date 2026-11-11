-- qualified-overtime-checker: caps on the name and summary columns (final
-- review, 2026-11-11). 0003 limited only `data`; a direct API call could
-- still store a huge name or summary in up to 500 rows. The app keeps names
-- to 120 characters and writes a three-number summary. NOT VALID: rows
-- already stored are not rechecked, every new insert and update is.
-- Idempotent.

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'client_files_name_length'
      and conrelid = 'app_qualified_overtime_checker.client_files'::regclass
  ) then
    alter table app_qualified_overtime_checker.client_files
      add constraint client_files_name_length check (char_length(name) <= 200) not valid;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'client_files_summary_size'
      and conrelid = 'app_qualified_overtime_checker.client_files'::regclass
  ) then
    alter table app_qualified_overtime_checker.client_files
      add constraint client_files_summary_size check (pg_column_size(summary) < 4096) not valid;
  end if;
end
$$;
