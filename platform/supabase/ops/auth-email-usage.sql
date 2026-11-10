-- Read-only: which sign-in and email actions Supabase Auth recorded in the
-- last 180 days, by action and provider, with the latest time. Used on
-- 10 Nov 2026 to see whether any app on the shared project sends magic
-- links or signup emails directly (they stop once the send-email hook is on).
-- No emails or ids are printed. Run: Supabase admin workflow, command `sql`.
select payload->>'action' as action,
       coalesce(payload->'traits'->>'provider', '') as provider,
       count(*)::int as n,
       to_char(max(created_at), 'YYYY-MM-DD HH24:MI') as latest_utc
from auth.audit_log_entries
where created_at > now() - interval '180 days'
group by 1, 2
order by n desc
limit 40;
