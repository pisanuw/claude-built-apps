-- Read-only: the 10 latest sign-in requests, with shortened hashes only
-- (no addresses or IPs exist in the table). Used after deploys to check
-- which IP header reaches the function: requests sent with different
-- spoofed X-Forwarded-For values must share one ip key.
-- Run: Supabase admin workflow, command `sql`.
select id,
       to_char(created_at, 'HH24:MI:SS') as at_utc,
       app,
       outcome,
       left(coalesce(ip_hash, ''), 10) as ip,
       left(coalesce(email_hash, ''), 10) as email,
       left(coalesce(detail, ''), 60) as detail
from platform.sign_in_requests
order by id desc
limit 10;
