-- ============================================================================
-- Per-outlet dish availability.
--
-- Run this once in the Supabase SQL editor, AFTER add-outlet-staff.sql (and the
-- customer app's 022_multi_outlet.sql / 023_restaurants_insert.sql).
-- Safe to re-run.
-- ============================================================================
--
-- WHAT THIS ADDS
-- --------------
-- The menu itself stays chain-wide. One `products` row per dish: one name, one
-- photo, one description, one price, at every branch. `products` still carries
-- no restaurant_id, and nothing here duplicates a dish.
--
-- What becomes per-branch is the only thing that actually differs day to day:
-- whether a dish is being SERVED right now. Kidwai Nagar runs out of mutton;
-- Swaroop Nagar still has it. Today, turning the korma off does it everywhere.
--
-- THE MODEL: default + override
-- -----------------------------
--   products.is_available            the chain-wide DEFAULT for a dish
--   a row in this table              an OVERRIDE for ONE branch
--   no row for (dish, branch)        that branch follows the default
--
--   effective availability at outlet X
--     = (an override row for (dish, X) exists) ? that row's is_available
--                                              : products.is_available
--
-- Note it is the ROW that wins, not the value: an override saying `true` keeps
-- a dish on at that branch even while the chain-wide default is off, and it
-- carries its own next_available_at. Never coalesce the two columns
-- independently — see `public.menu_for_outlet` below, which gets this right so
-- callers don't have to.
--
-- There is nothing to back-fill. With zero rows in this table every branch
-- follows the chain-wide flag, which is exactly how the menu behaves today.

-- ---------------------------------------------------------------------------
-- 1. The override table
-- ---------------------------------------------------------------------------
-- ON DELETE CASCADE on both sides: an override is meaningless without the dish
-- or the branch it is about. (Outlets are retired with is_active = false rather
-- than deleted, so the restaurant side should never actually fire.)
create table if not exists public.product_outlet_availability (
  product_id        uuid        not null references public.products(id)    on delete cascade,
  restaurant_id     uuid        not null references public.restaurants(id) on delete cascade,
  is_available      boolean     not null default true,
  -- When the dish comes back, for a branch that turned it off "for 2 hrs".
  -- Null while it is available, or when it was turned off indefinitely.
  next_available_at timestamptz,
  updated_at        timestamptz not null default now(),
  primary key (product_id, restaurant_id)
);

-- The customer app reads "every override at THIS outlet" on every menu load.
create index if not exists product_outlet_availability_outlet_idx
  on public.product_outlet_availability (restaurant_id);

-- ---------------------------------------------------------------------------
-- 2. The one correct way to read it
-- ---------------------------------------------------------------------------
-- Returns the menu as the customer app already expects `products` to look —
-- same columns, same types — with is_available / next_available_at resolved for
-- one outlet. Callers keep their existing code and swap the source:
--
--     supabase.rpc('menu_for_outlet', { outlet: restaurantId })
--
-- rather than reimplementing the default/override rule (and getting the
-- "row wins, not value" part wrong).
--
-- Passing null returns the chain-wide defaults, i.e. today's behaviour.
create or replace function public.menu_for_outlet(outlet uuid)
returns setof public.products
language sql
stable
set search_path = public
-- Built through jsonb rather than a hand-written column list so it keeps
-- working as `products` gains columns (is_veg and sort_order both arrived after
-- the table was created), and needs no extension.
-- LATERAL rather than `select (jsonb_populate_record(...)).*`, which Postgres
-- re-evaluates once per output column.
as $$
  select r.*
    from public.products p
    left join public.product_outlet_availability a
           on a.product_id = p.id
          and a.restaurant_id = outlet
    cross join lateral jsonb_populate_record(
      null::public.products,
      to_jsonb(p) || jsonb_build_object(
        'is_available',
          coalesce(a.is_available, p.is_available),
        'next_available_at',
          case when a.product_id is null then p.next_available_at
               else a.next_available_at end
      )
    ) r;
$$;

-- Deliberately NOT security definer: it reads `products` as the caller, so the
-- customer app sees exactly the dishes its own policies already allow.
grant execute on function public.menu_for_outlet(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Who may read and write it
-- ---------------------------------------------------------------------------
alter table public.product_outlet_availability enable row level security;

-- Readable by everyone, exactly like `products`: the customer app has to see
-- which dishes its chosen outlet is serving before anyone has signed in.
drop policy if exists "product_outlet_availability_read" on public.product_outlet_availability;
create policy "product_outlet_availability_read"
  on public.product_outlet_availability
  for select
  using (true);

-- Written by dashboard logins that hold the Menu permission — and an
-- outlet-scoped staffer only for their OWN branch, so "86 the korma" can never
-- reach into the other outlet's kitchen from the API.
drop policy if exists "product_outlet_availability_write" on public.product_outlet_availability;
create policy "product_outlet_availability_write"
  on public.product_outlet_availability
  for all
  using (
    public.staff_has_perm('page.menu')
    and (
      public.staff_outlet_id() is null
      or restaurant_id = public.staff_outlet_id()
    )
  )
  with check (
    public.staff_has_perm('page.menu')
    and (
      public.staff_outlet_id() is null
      or restaurant_id = public.staff_outlet_id()
    )
  );

-- ---------------------------------------------------------------------------
-- 4. Keep updated_at honest
-- ---------------------------------------------------------------------------
create or replace function public.touch_product_outlet_availability()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists product_outlet_availability_touch on public.product_outlet_availability;
create trigger product_outlet_availability_touch
  before insert or update on public.product_outlet_availability
  for each row execute function public.touch_product_outlet_availability();

-- ---------------------------------------------------------------------------
-- 5. Realtime
-- ---------------------------------------------------------------------------
-- The dashboard keeps the menu live across tabs and staff logins, the same way
-- it does for products. Every failure here is swallowed on purpose: the table is
-- already a member (a re-run), the publication doesn't exist, or it is defined
-- FOR ALL TABLES and refuses individual adds. None of those should abort the
-- migration — realtime is a nicety here, and the dashboard re-reads the table on
-- its own after every write regardless.
do $$
begin
  alter publication supabase_realtime add table public.product_outlet_availability;
exception when others then
  raise notice 'Skipped realtime publication for product_outlet_availability: %', sqlerrm;
end;
$$;

-- ---------------------------------------------------------------------------
-- HOW TO CHECK IT WORKED
-- ---------------------------------------------------------------------------
-- Turn one dish off at one branch from the dashboard, then:
--
--   select p.name, p.is_available as chain_wide, a.is_available as at_branch
--     from public.products p
--     left join public.product_outlet_availability a on a.product_id = p.id
--    where a.restaurant_id = '<outlet id>';
--
-- and compare the two outlets:
--
--   select name, is_available from public.menu_for_outlet('<outlet A>') order by name;
--   select name, is_available from public.menu_for_outlet('<outlet B>') order by name;
