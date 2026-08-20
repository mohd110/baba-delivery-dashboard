-- ============================================================================
-- Coupons / offers, manageable from the dashboard.
--
-- Run this once in the Supabase SQL editor. Safe to re-run, and safe to run
-- either before or after the customer app's own coupon migrations
-- (024_percent_coupons.sql, 025_once_per_customer_coupons.sql,
-- 026_names_and_coupon_list.sql) — everything below is `if not exists`.
--
-- After it, the dashboard's Offers page (sidebar → Administration → Offers &
-- Coupons) can create, edit, reorder and switch off offers without anyone
-- writing SQL. The customer app reads `coupons` on every checkout, so a change
-- saved here is live immediately — no deploy, no cache to clear.
-- ============================================================================
--
-- HOW AN OFFER IS SHAPED
-- ----------------------
-- A row is either FLAT or PERCENTAGE, never both:
--
--   flat        discount_amount > 0, discount_percent null, max_discount null
--   percentage  discount_percent 1–100 AND max_discount > 0, discount_amount 0
--
-- `coupons_shape_check` below is what enforces that, so a half-filled row fails
-- loudly instead of silently discounting ₹0. The dashboard form checks the same
-- rules first (src/lib/coupons.js) and shows a readable message.
--
-- Every threshold is the FOOD SUBTOTAL. The delivery fee is never discounted
-- and never counts towards min_order_value. Only one coupon applies per order —
-- offers do not stack.

-- ---------------------------------------------------------------------------
-- 1. The table
-- ---------------------------------------------------------------------------
-- Coupons are chain-wide: there is deliberately no restaurant_id, so an offer
-- runs at every outlet. Per-outlet offers would be a schema change, not a
-- setting — the same call the shared menu makes.
create table if not exists public.coupons (
  id               uuid primary key default gen_random_uuid(),
  code             text not null unique,
  discount_amount  numeric not null default 0,
  min_order_value  numeric not null default 0,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now()
);

-- Columns the later customer-app migrations add. Listed here too so the
-- dashboard works on a project where only this file has been run.
alter table public.coupons
  add column if not exists discount_percent  integer,   -- 1–100, null for flat offers
  add column if not exists max_discount      numeric,   -- ₹ cap on a percentage offer
  add column if not exists first_order_only  boolean not null default false,
  add column if not exists once_per_customer boolean not null default false,
  add column if not exists description       text,      -- optional banner text
  add column if not exists sort_order        integer;   -- lowest shows first

-- ---------------------------------------------------------------------------
-- 2. The shape constraint
-- ---------------------------------------------------------------------------
-- Added only when it isn't already there, and NOT VALID first so an existing
-- badly-shaped row can't block the migration — validate it once you've fixed
-- any rows the validation names.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'coupons_shape_check'
  ) then
    alter table public.coupons
      add constraint coupons_shape_check check (
        (discount_percent is null and discount_amount > 0)
        or (discount_percent between 1 and 100 and coalesce(max_discount, 0) > 0)
      ) not valid;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Ordering
-- ---------------------------------------------------------------------------
-- sort_order drives the customer's coupon list, and the lowest-numbered offer
-- the cart qualifies for is the one applied by default — so it is the admin's
-- lever for "which offer do people see first". Back-filled in 10s, leaving room
-- to slot new offers in between without renumbering everything.
update public.coupons c
   set sort_order = n.rn * 10
  from (
        select id, row_number() over (order by created_at, code) as rn
          from public.coupons
         where sort_order is null
       ) n
 where c.id = n.id
   and c.sort_order is null;

create index if not exists coupons_sort_order_idx on public.coupons (sort_order);
create index if not exists coupons_active_idx     on public.coupons (is_active);

-- Redemptions are read straight off `orders.coupon_code` — there is no separate
-- ledger table — so both the app's "have they used this?" check and the
-- dashboard's usage stats want this index.
create index if not exists orders_coupon_code_idx
  on public.orders (coupon_code)
  where coupon_code is not null;

-- ---------------------------------------------------------------------------
-- 4. Who can read and write
-- ---------------------------------------------------------------------------
alter table public.coupons enable row level security;

-- Customers read active offers at checkout. (The customer app may already have
-- an equivalent policy under its own name; policies are OR'd, so both standing
-- is harmless.)
drop policy if exists "coupons_select_active" on public.coupons;
create policy "coupons_select_active"
  on public.coupons for select
  using (is_active or public.is_dashboard_staff());

-- Writes are gated on the Offers permission, not just on being a dashboard
-- login: hiding the page in the sidebar is cosmetic, this is what stops a
-- staffer inventing themselves a 100% coupon straight from the API.
-- `staff_has_perm()` comes from add-staff-permissions.sql; admins hold
-- everything.
drop policy if exists "coupons_insert_staff" on public.coupons;
create policy "coupons_insert_staff"
  on public.coupons for insert
  with check (public.staff_has_perm('page.offers'));

drop policy if exists "coupons_update_staff" on public.coupons;
create policy "coupons_update_staff"
  on public.coupons for update
  using (public.staff_has_perm('page.offers'))
  with check (public.staff_has_perm('page.offers'));

drop policy if exists "coupons_delete_staff" on public.coupons;
create policy "coupons_delete_staff"
  on public.coupons for delete
  using (public.staff_has_perm('page.offers'));

-- NOTE: the customer app's 025_once_per_customer_coupons.sql grants every
-- `role = 'restaurant'` login blanket read/write on coupons. If that policy is
-- still in place under its own name it OR's with the three above and the
-- permission gate won't bite. Drop it once this file has run:
--   select policyname from pg_policies where tablename = 'coupons';

-- ---------------------------------------------------------------------------
-- 5. Seed the offers that are live today (only if the table is empty)
-- ---------------------------------------------------------------------------
insert into public.coupons
  (code, discount_amount, discount_percent, max_discount, min_order_value,
   once_per_customer, first_order_only, is_active, sort_order, description)
select * from (values
  ('WELCOME10', 0::numeric,   10,   100::numeric, 100::numeric, true, false, true, 10, null::text),
  ('SAVE50',    50::numeric,  null, null::numeric, 349::numeric, true, false, true, 20, null::text),
  ('SAVE100',   100::numeric, null, null::numeric, 699::numeric, true, false, true, 30, null::text)
) as seed(code, discount_amount, discount_percent, max_discount, min_order_value,
          once_per_customer, first_order_only, is_active, sort_order, description)
where not exists (select 1 from public.coupons);

-- ── Verify ──────────────────────────────────────────────────────────────────
select c.sort_order,
       c.code,
       case when c.discount_percent is null
            then '₹' || c.discount_amount || ' off'
            else c.discount_percent || '% off up to ₹' || c.max_discount
       end as offer,
       '₹' || c.min_order_value as min_order,
       case when c.first_order_only  then 'first order only'
            when c.once_per_customer then 'once per customer'
            else 'every order' end as rule,
       c.is_active,
       (select count(*) from public.orders o where o.coupon_code = c.code) as redemptions
  from public.coupons c
 order by c.is_active desc, c.sort_order nulls last, c.code;
