-- Read-only: auth users grouped by how they sign in (their identities'
-- providers), with counts and the latest sign-in. No emails or ids printed.
-- Used on 10 Nov 2026 to see whether any app on the shared project relies on
-- email (magic link or OTP) sign-in before the send-email hook goes on.
-- (auth.audit_log_entries is empty: the project does not write the audit log
-- to the database.) Run: Supabase admin workflow, command `sql`.
select coalesce((select string_agg(distinct i.provider, '+' order by i.provider)
                 from auth.identities i where i.user_id = u.id), '(none)') as providers,
       count(*)::int as users,
       count(*) filter (where u.last_sign_in_at > now() - interval '30 days')::int as signed_in_30d,
       to_char(max(u.last_sign_in_at), 'YYYY-MM-DD HH24:MI') as latest_sign_in_utc,
       to_char(max(u.created_at), 'YYYY-MM-DD') as newest_user
from auth.users u
group by 1
order by users desc;
