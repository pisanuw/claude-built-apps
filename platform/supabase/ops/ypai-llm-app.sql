-- Register YPai (pisanuw/digitalme, https://ypai.hintwise.org) with the LLM
-- gateway, so anon-setup can give its server an app key (owner, 18 Nov 2026:
-- "3 will do"; the key's sha256 was sent the same day).
-- Default caps and models for now: $2 a day, $10 a week, $20 a month, $0.25 a
-- person a day, the three 5.5 models, max_tokens 4096. No traffic reaches it
-- until YPai's LLM_PROVIDER is switched to gateway, and the owner sets YPai's
-- own caps before that (owner, 18 Nov: "want higher caps for ypai for
-- anonymous users"), in a separate ops file.
-- Run with the Supabase admin workflow: `sql` with this file. Idempotent: an
-- existing row is left as it is.
insert into platform.llm_apps (slug) values ('ypai') on conflict (slug) do nothing;
select slug, enabled, default_model, allowed_models, cap_day_usd, cap_week_usd, cap_month_usd, cap_user_day_usd,
       cap_app_user_day_usd, cap_app_user_week_usd, cap_app_user_day_calls, cap_app_user_week_calls, max_tokens
  from platform.llm_apps where slug = 'ypai';
