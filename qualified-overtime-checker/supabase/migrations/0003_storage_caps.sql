-- qualified-overtime-checker: storage caps (security review, 2026-11-11).
-- Without them any signed-in account could fill the shared database. A client
-- file's stored data stays under 10 MB (a year of a small employer's time
-- entries is well under 1 MB in the compact form), and an account keeps at
-- most 500 client files. The count leaves out the row being written, so an
-- upsert of an existing file still works at the limit. Idempotent.

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'client_files_data_size'
      and conrelid = 'app_qualified_overtime_checker.client_files'::regclass
  ) then
    alter table app_qualified_overtime_checker.client_files
      add constraint client_files_data_size check (pg_column_size(data) < 10485760);
  end if;
end
$$;

create or replace function app_qualified_overtime_checker.client_files_limit()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (
    select count(*) from app_qualified_overtime_checker.client_files
    where user_id = new.user_id and id <> new.id
  ) >= 500 then
    raise exception 'An account keeps at most 500 client files. Delete some and try again.';
  end if;
  return new;
end
$$;

drop trigger if exists client_files_limit on app_qualified_overtime_checker.client_files;
create trigger client_files_limit
  before insert on app_qualified_overtime_checker.client_files
  for each row execute function app_qualified_overtime_checker.client_files_limit();
