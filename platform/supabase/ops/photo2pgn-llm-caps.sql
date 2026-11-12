-- photo2pgn's own, stricter limits for the HintWise key (owner, 12 Nov 2026:
-- "yes those numbers"). Run with the Supabase admin workflow: `sql` with this
-- file, after apply-shared has run shared/0006_llm_app_user_caps.sql.
--   the app as a whole: $1 a day, $5 a week, $10 a month;
--   one person in photo2pgn: $0.10 a day, $0.40 a week;
--   one person across all HintWise apps: the default $0.25 a day, unchanged;
--   max_tokens 8000 per call (owner, 12 Nov: "8000"; 4096 cut long games off).
-- Registers the app if its own migration has not yet; that migration's
-- `insert ... on conflict do nothing` then leaves these numbers alone.
-- Idempotent: re-running sets the same numbers.
insert into platform.llm_apps (slug, cap_day_usd, cap_week_usd, cap_month_usd, cap_app_user_day_usd, cap_app_user_week_usd, max_tokens)
values ('photo2pgn', 1, 5, 10, 0.10, 0.40, 8000)
on conflict (slug) do update set
  cap_day_usd = excluded.cap_day_usd,
  cap_week_usd = excluded.cap_week_usd,
  cap_month_usd = excluded.cap_month_usd,
  cap_app_user_day_usd = excluded.cap_app_user_day_usd,
  cap_app_user_week_usd = excluded.cap_app_user_week_usd,
  max_tokens = excluded.max_tokens;
select slug, enabled, default_model, cap_day_usd, cap_week_usd, cap_month_usd,
       cap_user_day_usd, cap_app_user_day_usd, cap_app_user_week_usd, max_tokens
  from platform.llm_apps where slug = 'photo2pgn';
