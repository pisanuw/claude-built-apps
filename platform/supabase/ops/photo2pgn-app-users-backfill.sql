-- One-off (safe to re-run): add to platform.app_users everyone who saved a
-- game in photo2pgn before 13 Nov 2026, when the gateway started recording
-- who uses each app (shared/0009). Run with the Supabase admin workflow:
-- `sql` with this file, after apply-shared. Prints only a count.
insert into platform.app_users (user_id, app, first_seen, last_seen)
select g.user_id, 'photo2pgn', min(g.created_at), max(g.updated_at)
  from app_photo2pgn.games g
  join auth.users u on u.id = g.user_id
 group by g.user_id
on conflict (user_id, app) do update
  set first_seen = least(platform.app_users.first_seen, excluded.first_seen),
      last_seen = greatest(platform.app_users.last_seen, excluded.last_seen);
select count(*) as photo2pgn_users from platform.app_users where app = 'photo2pgn';
