-- lewis-alt-text's own limits for the HintWise key (owner, 15 Nov 2026, "3 yes"
-- to the proposal from the Lewis session):
--   one person in lewis-alt-text: 20 alt texts a day, counted in successful
--   calls (no per-person dollar cap in the app);
--   the app as a whole: $3 a day, $15 a week, $40 a month;
--   one person across HintWise, when calling through lewis-alt-text: $1.50 a
--   day (owner, 15 Nov: "raise it to $1.50"; was $1.00, default $0.25), so it cannot cut the 20 short even uncached: Opus with the
--   skill cached is about $0.013 a call, about $0.06-0.08 uncached
--   (measured by the Lewis session through the claude CLI, not yet on the gateway).
-- Model and max_tokens stay at the defaults (claude-opus-5-5, 4096).
-- Run with the Supabase admin workflow: `sql` with this file. Idempotent.
insert into platform.llm_apps (slug, cap_day_usd, cap_week_usd, cap_month_usd, cap_user_day_usd, cap_app_user_day_calls)
values ('lewis-alt-text', 3, 15, 40, 1.50, 20)
on conflict (slug) do update set
  cap_day_usd = excluded.cap_day_usd,
  cap_week_usd = excluded.cap_week_usd,
  cap_month_usd = excluded.cap_month_usd,
  cap_user_day_usd = excluded.cap_user_day_usd,
  cap_app_user_day_calls = excluded.cap_app_user_day_calls;
select slug, enabled, default_model, cap_day_usd, cap_week_usd, cap_month_usd, cap_user_day_usd,
       cap_app_user_day_usd, cap_app_user_week_usd, cap_app_user_day_calls, cap_app_user_week_calls, max_tokens
  from platform.llm_apps where slug = 'lewis-alt-text';
