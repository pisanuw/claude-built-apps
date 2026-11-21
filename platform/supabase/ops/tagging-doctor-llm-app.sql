-- Register Tagging Doctor (https://tagging-doctor.hintwise.org) with the LLM
-- gateway, with the default caps (hintwise-workflow projects/tagging-doctor,
-- AC-63 and CR-3: the app's own migration must not write to platform, so
-- PManager adds this row at milestone 2's release). The owner's yes to the
-- gateway row: 19 Nov 2026, 17:56Z (hintwise-workflow decisions/2026-11.md,
-- 2026-11-20T08:44Z); milestone 2 released on the owner's "td m2 yes"
-- (21 Nov 2026).
-- Run with the Supabase admin workflow: `sql` with this file. Idempotent: an
-- existing row is left as it is.
insert into platform.llm_apps (slug) values ('tagging-doctor')
on conflict do nothing;
select slug, enabled, default_model, cap_day_usd, cap_week_usd, cap_month_usd, cap_user_day_usd, max_tokens
  from platform.llm_apps where slug = 'tagging-doctor';
