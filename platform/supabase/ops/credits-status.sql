-- Read-only: credits and gateway use, as totals only (no person, no email).
-- Run with the Supabase admin workflow: `sql` with this file. Safe any time.
-- One statement, because the workflow prints only the last result.
select what, app, detail, n, amount from (
  select 1 as o, 'ledger' as what, app, kind as detail, count(*)::text as n, sum(credits)::text as amount
    from platform.credit_ledger group by app, kind
  union all
  select 2, 'balances', app, 'people', count(*)::text, sum(balance)::text
    from platform.credits group by app
  union all
  select 3, 'admins', '', '', count(*)::text, ''
    from platform.admins
  union all
  select 4, 'calls today', app, case when not ok then 'failed' when paid_with_credit then 'paid with credit' else 'free' end,
         count(*)::text, round(sum(cost_usd), 4)::text
    from platform.llm_usage
   where created_at >= date_trunc('day', now(), 'UTC')
   group by app, ok, paid_with_credit
) t
order by o, app, detail;
