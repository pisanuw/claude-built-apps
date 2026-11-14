-- Read-only: app-notify state per registered app (counts only, no ids or addresses).
-- Run: Supabase admin, command sql, arg platform/supabase/ops/notify-status.sql
select coalesce(jsonb_agg(jsonb_build_object(
  'app', a.slug,
  'enabled', a.enabled,
  'seeded_at', a.seeded_at,
  'items_seen', (select count(*) from platform.notify_items_seen s where s.app = a.slug),
  'items_seeded', (select count(*) from platform.notify_items_seen s where s.app = a.slug and s.seed),
  'sends', (select count(*) from platform.notify_sends n where n.app = a.slug),
  'sends_by_status', (select coalesce(jsonb_object_agg(status, c), '{}'::jsonb)
                      from (select status, count(*) c from platform.notify_sends n where n.app = a.slug group by status) t)
) order by a.slug), '[]'::jsonb)::text as notify_status
from platform.notify_apps a;
