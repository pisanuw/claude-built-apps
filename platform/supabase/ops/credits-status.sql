-- Read-only: credits and gateway use, as totals only (no person, no email).
-- Run with the Supabase admin workflow: `sql` with this file. Safe any time.
select 'ledger' as what, app, kind, count(*) as rows, sum(credits) as credits
  from platform.credit_ledger group by app, kind order by app, kind;
select 'balances' as what, app, count(*) as people, sum(balance) as credits
  from platform.credits group by app order by app;
select 'admins' as what, count(*) as admins from platform.admins;
select 'calls today' as what, app, ok, paid_with_credit, count(*) as calls, round(sum(cost_usd), 4) as usd
  from platform.llm_usage
 where created_at >= date_trunc('day', now(), 'UTC')
 group by app, ok, paid_with_credit order by app, ok, paid_with_credit;
