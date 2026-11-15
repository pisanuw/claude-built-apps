-- udebt's gateway limits, second setting (owner, 15 Nov 2026, "1 yes, 2 yes"):
--   one person, when calling through udebt: $1.00 a day across HintWise (was $0.25;
--   the same pattern as photo2pgn), other apps' rows unchanged;
--   the app as a whole: $5 a day, $20 a week, $40 a month (was $2 / $10 / $20).
-- Model and max_tokens unchanged (claude-sonnet-5-5, 4096). Supersedes the caps in
-- udebt-llm-caps.sql. Run with the Supabase admin workflow: `sql` with this file. Idempotent.
update platform.llm_apps
   set cap_user_day_usd = 1.00, cap_day_usd = 5, cap_week_usd = 20, cap_month_usd = 40
 where slug = 'udebt';
select slug, enabled, default_model, cap_day_usd, cap_week_usd, cap_month_usd, cap_user_day_usd,
       cap_app_user_day_usd, cap_app_user_week_usd, cap_app_user_day_calls, cap_app_user_week_calls, max_tokens
  from platform.llm_apps where slug = 'udebt';
