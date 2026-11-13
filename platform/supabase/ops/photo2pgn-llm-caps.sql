-- photo2pgn's own, stricter limits for the HintWise key. Run with the
-- Supabase admin workflow: `sql` with this file, after apply-shared has run
-- shared/0007_llm_app_user_call_caps.sql.
--   the app as a whole: $1 a day, $5 a week, $10 a month (owner, 12 Nov:
--   "yes those numbers"), the ceiling on the owner's key;
--   one person in photo2pgn: 3 readings a day, 9 a week, counted in
--   successful calls (owner, 13 Nov: "2 yes 3/9"; earlier $0.25 a day and
--   $1.00 a week, and before that $0.10 and $0.40), so the per-person dollar
--   caps in this app are off (null);
--   one person across all HintWise apps, when calling through photo2pgn:
--   $1.00 a day (was the default $0.25), so it cannot cut the 3 readings
--   short: a long game costs up to about $0.27 at max_tokens 12000;
--   max_tokens 12000 per call (owner, 12 Nov: "yes 12000"; 8000 failed past
--   about 75 moves, measured by the photo2pgn session at ~90 output tokens a
--   move plus ~1k thinking; earlier 8000, and 4096 cut long games off).
-- Registers the app if its own migration has not yet; that migration's
-- `insert ... on conflict do nothing` then leaves these numbers alone.
-- Idempotent: re-running sets the same numbers.
insert into platform.llm_apps (slug, cap_day_usd, cap_week_usd, cap_month_usd, cap_user_day_usd,
                               cap_app_user_day_usd, cap_app_user_week_usd,
                               cap_app_user_day_calls, cap_app_user_week_calls, max_tokens)
values ('photo2pgn', 1, 5, 10, 1.00, null, null, 3, 9, 12000)
on conflict (slug) do update set
  cap_day_usd = excluded.cap_day_usd,
  cap_week_usd = excluded.cap_week_usd,
  cap_month_usd = excluded.cap_month_usd,
  cap_user_day_usd = excluded.cap_user_day_usd,
  cap_app_user_day_usd = excluded.cap_app_user_day_usd,
  cap_app_user_week_usd = excluded.cap_app_user_week_usd,
  cap_app_user_day_calls = excluded.cap_app_user_day_calls,
  cap_app_user_week_calls = excluded.cap_app_user_week_calls,
  max_tokens = excluded.max_tokens;
select slug, enabled, default_model, cap_day_usd, cap_week_usd, cap_month_usd, cap_user_day_usd,
       cap_app_user_day_usd, cap_app_user_week_usd, cap_app_user_day_calls, cap_app_user_week_calls, max_tokens
  from platform.llm_apps where slug = 'photo2pgn';
