-- udebt's row for the HintWise LLM gateway. Run with the Supabase admin workflow:
-- `sql` with this file. Owner, 15 Nov 2026 (relayed by the UDebt session: "3 yes"):
-- default model claude-sonnet-5-5; every cap and max_tokens stay at the defaults
-- ($2/day app, $10/week, $20/month, $0.25/day per person, 4096 tokens).
-- Registers the app if its migration has not yet. Idempotent.
insert into platform.llm_apps (slug, default_model) values ('udebt', 'claude-sonnet-5-5')
on conflict (slug) do update set default_model = excluded.default_model;
select slug, enabled, default_model, allowed_models, cap_day_usd, cap_week_usd, cap_month_usd,
       cap_user_day_usd, max_tokens
  from platform.llm_apps where slug = 'udebt';
