-- Read-only: how many StepWise readers opted in to app-notify email (counts only, no ids or addresses).
-- Run: Supabase admin, command sql, arg platform/supabase/ops/notify-stepwise-optins.sql
select jsonb_build_object(
  'preferences_rows', (select count(*) from app_stepwise.preferences),
  'opted_in', (select count(*) from app_stepwise.preferences where notify_new_pages is true),
  'opted_in_confirmed', (select count(*) from app_stepwise.preferences p join auth.users u on u.id = p.owner
                         where p.notify_new_pages is true and u.email is not null and u.deleted_at is null
                           and u.email_confirmed_at is not null and (u.banned_until is null or u.banned_until <= now())),
  'opted_out_all', (select count(*) from platform.email_optouts where scope = 'all'),
  'opted_out_stepwise', (select count(*) from platform.email_optouts where scope = 'app:stepwise'),
  'registered', exists (select 1 from platform.notify_apps where slug = 'stepwise')
)::text as stepwise_optins;
