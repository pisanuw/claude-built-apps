-- Register YPai (pisanuw/digitalme, https://ypai.hintwise.org) with the LLM
-- gateway, so anon-setup can give its server an app key (owner, 18 Nov 2026:
-- "3 will do", then "10 yes 6 yes"; the key's sha256 was sent the same day).
-- Default caps and models for now: $2 a day, $10 a week, $20 a month, $0.25 a
-- person a day, the three 5.5 models. max_tokens is 8192 (owner, 18 Nov 2026,
-- "6 yes"): YPai's persona-rewrite call needs up to 8000. No traffic reaches it
-- until YPai's LLM_PROVIDER is switched to gateway, and the owner sets YPai's
-- own caps before that (owner, 18 Nov: "want higher caps for ypai for
-- anonymous users"), in a separate ops file.
-- Run with the Supabase admin workflow: `sql` with this file. Idempotent: an
-- existing row keeps its caps; only max_tokens is set.
insert into platform.llm_apps (slug, max_tokens) values ('ypai', 8192)
on conflict (slug) do update set max_tokens = excluded.max_tokens;
select slug, enabled, default_model, allowed_models, cap_day_usd, cap_week_usd, cap_month_usd, cap_user_day_usd,
       cap_app_user_day_usd, cap_app_user_week_usd, cap_app_user_day_calls, cap_app_user_week_calls, max_tokens
  from platform.llm_apps where slug = 'ypai';
