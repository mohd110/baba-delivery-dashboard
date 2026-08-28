-- Post-testing cleanup — wipes TRANSACTIONAL data only.
--
-- DELETES : complaints, order_items, rider_locations, orders
-- KEEPS   : profiles (riders/customers/auth users), products, menu_categories,
--           banners, restaurants — i.e. every account and all config/menu data.
--
-- Run in the Supabase SQL editor. Steps 0 and 1 are read-only — run them first.


-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 0 (READ-ONLY, IMPORTANT) — find every table that points at `orders`.
--
-- This dashboard repo only sees the tables it queries. The customer app and the
-- rider app may have added their own children of `orders` (payments,
-- order_status_history, ratings, notifications …). Any of those NOT listed in
-- step 2 will either block the delete with an FK error, or — if the FK is
-- ON DELETE CASCADE — get deleted silently. Check this list before proceeding.
-- ─────────────────────────────────────────────────────────────────────────────
select
  src.relname            as child_table,
  con.conname            as fk_constraint,
  case con.confdeltype
    when 'a' then 'NO ACTION (will block the delete)'
    when 'r' then 'RESTRICT (will block the delete)'
    when 'c' then 'CASCADE (rows deleted automatically)'
    when 'n' then 'SET NULL'
    when 'd' then 'SET DEFAULT'
  end                    as on_delete
from pg_constraint con
join pg_class src on src.oid = con.conrelid
join pg_class tgt on tgt.oid = con.confrelid
where con.contype = 'f'
  and tgt.relname = 'orders'
  and tgt.relnamespace = 'public'::regnamespace
order by src.relname;


-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 1 (READ-ONLY) — what you are about to destroy.
-- ─────────────────────────────────────────────────────────────────────────────
select 'orders'          as table_name, count(*) from public.orders
union all select 'order_items',          count(*) from public.order_items
union all select 'complaints',           count(*) from public.complaints
union all select 'rider_locations',      count(*) from public.rider_locations;


-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 2 — the cleanup. Children first, parent last (FK-safe order).
--
-- Wrapped in a transaction: if anything errors, NOTHING is deleted.
-- ─────────────────────────────────────────────────────────────────────────────
-- Child list CONFIRMED complete via step 0 (2026-08-07): complaints,
-- order_items and rider_locations are ON DELETE CASCADE; rider_notifications is
-- NO ACTION and must be cleared explicitly or it blocks the whole delete.
--
-- The cascading three are still deleted explicitly on purpose: a cascade only
-- removes rows whose order_id matches a deleted order, so any row with a NULL
-- order_id would survive. Explicit deletes clear the tables outright.
begin;

  delete from public.complaints;           -- FK → orders, profiles
  delete from public.order_items;          -- FK → orders, products
  delete from public.rider_locations;      -- FK → orders, profiles
  delete from public.rider_notifications;  -- FK → orders (rider app)
  delete from public.orders;

  -- Sanity check before committing — all five must read 0.
  select 'orders'      as table_name,       count(*) from public.orders
  union all select 'order_items',           count(*) from public.order_items
  union all select 'complaints',            count(*) from public.complaints
  union all select 'rider_locations',       count(*) from public.rider_locations
  union all select 'rider_notifications',   count(*) from public.rider_notifications;

commit;
-- ^ If the counts above are not all 0, run `rollback;` instead of `commit;`.


-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 3 (OPTIONAL) — restart the order-number counter at 1.
--
-- `orders.order_number` is text ("BB-12/07/26-0010"), so its sequential part is
-- fed by a sequence inside a trigger/default. Find it, then reset it.
-- ─────────────────────────────────────────────────────────────────────────────
-- select sequence_name from information_schema.sequences where sequence_schema = 'public';
--
-- Then, with the real name (commonly order_number_seq / orders_order_number_seq):
-- alter sequence public.order_number_seq restart with 1;


-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 4 (OPTIONAL) — clear per-rider state left over from test orders.
--
-- Only needed if your riders' profile rows cache a "currently on this order"
-- value. Harmless to skip; the columns may not exist in your schema.
-- ─────────────────────────────────────────────────────────────────────────────
-- update public.profiles set current_order_id = null where role = 'rider';
