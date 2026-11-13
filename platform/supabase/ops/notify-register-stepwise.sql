-- WRITES: registers StepWise with app-notify and switches it on. Run ONLY after the owner's yes.
-- Run: Supabase admin, command sql, arg platform/supabase/ops/notify-register-stepwise.sql
-- The next daily run (15:17 UTC) seeds: every item already in the feed is marked seen and nobody
-- is emailed. Later releases go to opted-in readers, at most one email per person per day.
-- Undo: update platform.notify_apps set enabled = false where slug = 'stepwise';
insert into platform.notify_apps (slug, display_name, feed_url,
  opt_in_schema, opt_in_table, opt_in_user_column, opt_in_flag_column, enabled)
values ('stepwise', 'StepWise', 'https://stepwise.hintwise.org/notify-feed.json',
  'app_stepwise', 'preferences', 'owner', 'notify_new_pages', true)
on conflict (slug) do update set enabled = true;
select (select jsonb_build_object('slug', slug, 'enabled', enabled, 'seeded_at', seeded_at, 'feed_url', feed_url)
        from platform.notify_apps where slug = 'stepwise')::text as stepwise_registration;
