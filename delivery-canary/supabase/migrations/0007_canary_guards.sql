-- Delivery Canary, migration 0007: guards on canary rows (day 6 security
-- review).
--
-- M1: a signed-in user could PATCH their own scheduled canaries back to
-- 'placed' with an old placed_at, so job_waiting (oldest placed_at first,
-- 10 a run) spent every run's budget on their rows and never reached the
-- claim step for anyone else. Now, for the page's roles, a scheduled row's
-- placed_at, order id and name never change and its status never moves back
-- to placing, placed or unknown (the page only settles rows: arrived,
-- no-email); and job_waiting takes at most two rows per user per run,
-- oldest created_at first (a column nobody can change).
--
-- L1: the 5-a-day cap left out every 'failed' row, and the page may set
-- status, so a script could mark real canaries 'failed' and place more.
-- Now an order id, once set, cannot be changed or cleared by the page's
-- roles, and the cap leaves out only failed rows that never got an order.
--
-- The job's functions run as the owner, so these guards do not apply to them.
-- Idempotent: create or replace only.

create or replace function app_delivery_canary.canary_orders_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.id := old.id;
  new.user_id := old.user_id;
  new.shop_id := old.shop_id;
  new.created_at := old.created_at;
  new.variant_id := old.variant_id;
  new.updated_at := now();
  if current_user in ('authenticated', 'anon') then
    -- An order id, once Shopify gave one, stays (the 5-a-day cap counts it).
    if old.order_id is not null then
      new.order_id := old.order_id;
    end if;
    -- A scheduled canary is placed by the job only: the page may settle it,
    -- never re-arm it.
    if old.source = 'schedule' then
      new.placed_at := old.placed_at;
      new.order_id := old.order_id;
      new.order_name := old.order_name;
      if new.status is distinct from old.status and new.status in ('placing', 'placed', 'unknown') then
        raise exception 'A scheduled canary cannot be reopened.' using errcode = '42501';
      end if;
    end if;
  end if;
  return new;
end
$$;

-- Canary orders: 5 a day per user (each is a real order in the shop; a
-- refused one that never got an order id does not count), none while the
-- shop's last canary is still 'placing' or 'unknown' and under 10 minutes
-- old, at most 500 kept per account, and the row starts as 'placing'
-- whatever the caller sent. Same as migration 0004 except the count.
create or replace function app_delivery_canary.canary_orders_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('app_delivery_canary.canary_orders:' || new.user_id::text, 0));
  new.created_at := now();
  new.updated_at := now();
  new.status := 'placing';
  new.order_id := null;
  new.order_name := '';
  new.placed_at := null;
  new.arrived_at := null;
  new.transit_seconds := null;
  new.placement := null;
  new.seed_where := null;
  new.check_id := null;
  if exists (
    select 1 from app_delivery_canary.canary_orders
    where shop_id = new.shop_id and status in ('placing', 'unknown') and created_at > now() - interval '10 minutes'
  ) then
    raise sqlstate 'PT409' using message = 'A canary for this shop is still being placed. Try again in a few minutes.';
  end if;
  if (
    select count(*) from app_delivery_canary.canary_orders
    where user_id = new.user_id and created_at > now() - interval '1 day'
      and (status <> 'failed' or order_id is not null)
  ) >= 5 then
    raise sqlstate 'PT429' using message = 'You have placed 5 canary orders in the last day. Try again tomorrow.';
  end if;
  delete from app_delivery_canary.canary_orders where id in (
    select id from app_delivery_canary.canary_orders where user_id = new.user_id
    order by created_at desc offset 499
  );
  return new;
end
$$;

-- Scheduled canaries placed in the last day whose email has not been found
-- yet, with the seed inbox to look in (password still sealed): at most two
-- per user, oldest created first, ten in all; returned oldest placed first.
create or replace function app_delivery_canary.job_waiting(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app_delivery_canary.job_token_ok(p_token);
  return (
    select coalesce(jsonb_agg(q order by q."placedAt"), '[]'::jsonb) from (
      select r."canaryId", r."shopId", r."userId", r."placedAt", r."orderName", r."variantTitle", r."shopName", r.baseline, r.alerts, r.seed
      from (
        select o.id as "canaryId", o.shop_id as "shopId", o.user_id as "userId", o.placed_at as "placedAt", o.order_name as "orderName",
          o.variant_title as "variantTitle", sh.name as "shopName", sh.baseline as baseline, s.alerts as alerts,
          case when i.shop_id is null then null else jsonb_build_object('address', i.address, 'sender', i.sender, 'subject', i.subject_hint, 'secret', i.secret) end as seed,
          o.created_at,
          row_number() over (partition by o.user_id order by o.created_at) as n
        from app_delivery_canary.canary_orders o
        join app_delivery_canary.canary_schedules s on s.shop_id = o.shop_id and s.user_id = o.user_id
        join app_delivery_canary.shops sh on sh.id = o.shop_id
        left join app_delivery_canary.seed_inboxes i on i.shop_id = o.shop_id and i.user_id = o.user_id
        where o.source = 'schedule' and o.status = 'placed' and o.placed_at > now() - interval '1 day'
          and s.tag = app_delivery_canary.job_tag(p_token, s.shop_id)
      ) r
      where r.n <= 2
      order by r.created_at
      limit 10
    ) q
  );
end
$$;

revoke execute on function app_delivery_canary.canary_orders_touch() from public, anon, authenticated;
revoke execute on function app_delivery_canary.canary_orders_limit() from public, anon, authenticated;
revoke execute on function app_delivery_canary.job_waiting(text) from public, authenticated;
grant execute on function app_delivery_canary.job_waiting(text) to anon;
