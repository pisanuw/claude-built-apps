-- YPai's own caps on the HintWise gateway (owner, 18 Nov 2026, answering the
-- YPai session's three questions: "1 confirm, 2 $2 3 keep YPAIs own cap at
-- $50"; he had proposed "$5/day $25/week $100/month total limits"):
--   the app as a whole: $5 a day, $25 a week, $100 a month;
--   one person across all HintWise apps, when calling through ypai: $2.00 a
--   day (was the default $0.25). This also covers the anonymous stand-in
--   (visitors+ypai@hintwise.org), which every visitor who is not signed in
--   shares. YPai's own 30-exchanges-per-IP-a-day limit still applies before
--   the gateway, and its own $50 monthly limit stays as an inner backstop;
--   the per-person-in-app caps stay off (null).
-- max_tokens stays 8192 (ypai-llm-app.sql). Idempotent.
-- The second statement is read-only: ypai's gateway calls in the last three
-- hours (times, model, status, token counts, cost and the error text; no
-- user ids or contents), to find why chat answered 400 after the switch to
-- LLM_PROVIDER=gateway (hintwise-workflow runs/2026-11-18T1450Z-incident-ypai-key.md).
-- Run: Supabase admin, command sql, arg platform/supabase/ops/ypai-caps.sql
update platform.llm_apps set
  cap_day_usd = 5,
  cap_week_usd = 25,
  cap_month_usd = 100,
  cap_user_day_usd = 2.00,
  cap_app_user_day_usd = null,
  cap_app_user_week_usd = null,
  cap_app_user_day_calls = null,
  cap_app_user_week_calls = null
where slug = 'ypai';

select jsonb_build_object(
  'ypai_row', (select to_jsonb(a) - 'created_at' - 'updated_at' from platform.llm_apps a where a.slug = 'ypai'),
  'ypai_calls_last_3h', (select coalesce(jsonb_agg(jsonb_build_object(
      'at', to_char(u.created_at at time zone 'UTC', 'HH24:MI:SS'),
      'ok', u.ok, 'model', u.model, 'in', u.input_tokens, 'out', u.output_tokens,
      'cost', u.cost_usd, 'error', left(u.error, 300),
      'stand_in', exists (select 1 from platform.llm_app_anon s where s.user_id = u.user_id)) order by u.created_at), '[]'::jsonb)
    from platform.llm_usage u
    where u.app = 'ypai' and u.created_at >= now() - interval '3 hours')
)::text as ypai;
