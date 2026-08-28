-- ============================================================================
-- Outlet-scoped dashboard logins.
--
-- Run this once in the Supabase SQL editor, AFTER add-staff-permissions.sql
-- and after the customer app's 022_multi_outlet.sql / 023_restaurants_insert.sql.
-- Safe to re-run.
-- ============================================================================
--
-- WHAT THIS ADDS
-- --------------
-- add-staff-permissions.sql split dashboard logins into owner (is_admin) and
-- staff. This adds the second axis the client asked for — WHICH OUTLET a login
-- belongs to:
--
--   restaurant_id IS NULL   every outlet. The owner/super-admin: sees all
--                           orders, gets notified for all of them, and picks an
--                           outlet from a dropdown on each page.
--   restaurant_id = <id>    that outlet only. Their order board, order history,
--                           reports, complaints, badges and new-order alarm are
--                           all filtered to it, and the open/closed switch acts
--                           on their outlet alone.
--
-- The menu itself is deliberately NOT scoped: `products` carries no
-- restaurant_id (see the customer app's 022_multi_outlet.sql), so every outlet
-- serves the same dishes at the same prices. What an outlet DOES control on its
-- own is whether a dish is being served right now — that came later, in
-- add-outlet-menu-availability.sql, as an override table rather than a
-- restaurant_id on products. Separate per-outlet dish lists and per-outlet
-- prices remain a schema change, not a setting.

-- ---------------------------------------------------------------------------
-- 1. Which outlet a login belongs to
-- ---------------------------------------------------------------------------
-- ON DELETE SET NULL rather than CASCADE: losing an outlet must never delete
-- the people who worked at it. (Outlets are retired with is_active = false
-- anyway — there is deliberately no DELETE policy on restaurants.)
alter table public.profiles
  add column if not exists restaurant_id uuid
    references public.restaurants(id) on delete set null;

-- Every login that exists today is an owner and stays unscoped (all outlets).
-- Nothing to back-fill: the column defaults to null, which already means that.

create index if not exists profiles_restaurant_idx
  on public.profiles (restaurant_id)
  where restaurant_id is not null;

-- ---------------------------------------------------------------------------
-- 2. A staffer can't move themselves to another outlet
-- ---------------------------------------------------------------------------
-- Extends the guard from add-staff-permissions.sql. Same rule: role, admin
-- flag, permissions, active flag — and now the outlet — are the owner's to set.
create or replace function public.guard_profile_privileges()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_dashboard_admin() then
    return new;
  end if;
  if new.role          is distinct from old.role
     or new.is_admin      is distinct from old.is_admin
     or new.permissions   is distinct from old.permissions
     or new.is_active     is distinct from old.is_active
     or new.restaurant_id is distinct from old.restaurant_id then
    raise exception 'Only a dashboard admin can change roles, permissions or the assigned outlet';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_guard_privileges on public.profiles;
create trigger profiles_guard_privileges
  before update on public.profiles
  for each row execute function public.guard_profile_privileges();

-- ---------------------------------------------------------------------------
-- 3. The outlet a login is allowed to act on
-- ---------------------------------------------------------------------------
-- Null for admins (any outlet). The dashboard filters by this for what a
-- staffer SEES; this function is what stops them WRITING across outlets.
create or replace function public.staff_outlet_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select p.restaurant_id
    from public.profiles p
   where p.id = auth.uid()
     and p.role = 'restaurant'
     and coalesce(p.is_active, true)
     and not coalesce(p.is_admin, false);
$$;

-- ---------------------------------------------------------------------------
-- 4. Staff act on their own outlet's orders only
-- ---------------------------------------------------------------------------
-- Folded into the guard from add-staff-permissions.sql so orders keep ONE
-- BEFORE UPDATE trigger. Riders self-claiming and the customer app are
-- untouched — only dashboard logins are checked.
create or replace function public.guard_order_staff_actions()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  outlet uuid;
begin
  if not public.is_dashboard_staff() then
    return new;
  end if;

  -- Outlet-scoped staff may only touch orders placed at their own outlet.
  outlet := public.staff_outlet_id();
  if outlet is not null
     and coalesce(new.restaurant_id, old.restaurant_id) is distinct from outlet then
    raise exception 'This order belongs to another outlet';
  end if;
  -- ...and may not move an order to a different outlet.
  if outlet is not null and new.restaurant_id is distinct from old.restaurant_id then
    raise exception 'You cannot move an order to another outlet';
  end if;

  if new.rider_id is distinct from old.rider_id
     and not public.staff_has_perm('action.assign_rider') then
    raise exception 'You do not have permission to assign or change the rider';
  end if;
  if new.status is distinct from old.status
     and new.status = 'cancelled'
     and not public.staff_has_perm('action.cancel_order') then
    raise exception 'You do not have permission to cancel orders';
  end if;
  return new;
end;
$$;

drop trigger if exists orders_guard_staff_actions on public.orders;
create trigger orders_guard_staff_actions
  before update on public.orders
  for each row execute function public.guard_order_staff_actions();

-- ---------------------------------------------------------------------------
-- 5. Staff open/close their own outlet only
-- ---------------------------------------------------------------------------
create or replace function public.guard_restaurant_staff_actions()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  outlet uuid;
begin
  if not public.is_dashboard_staff() then
    return new;
  end if;

  outlet := public.staff_outlet_id();
  if outlet is not null and new.id is distinct from outlet then
    raise exception 'You can only change your own outlet';
  end if;

  if new.is_open is distinct from old.is_open
     and not public.staff_has_perm('action.restaurant_toggle') then
    raise exception 'You do not have permission to open or close the restaurant';
  end if;
  if (new.opening_time is distinct from old.opening_time
      or new.closing_time is distinct from old.closing_time)
     and not public.staff_has_perm('page.settings') then
    raise exception 'You do not have permission to change the trading hours';
  end if;
  return new;
end;
$$;

drop trigger if exists restaurants_guard_staff_actions on public.restaurants;
create trigger restaurants_guard_staff_actions
  before update on public.restaurants
  for each row execute function public.guard_restaurant_staff_actions();

-- ---------------------------------------------------------------------------
-- 6. Only the owner creates outlets
-- ---------------------------------------------------------------------------
-- 023_restaurants_insert.sql granted INSERT to every role = 'restaurant'
-- account, which now includes staff logins. Its own scope note asked for this
-- to be narrowed once per-outlet staff existed — that's now.
drop policy if exists "restaurants_insert_restaurant" on public.restaurants;
create policy "restaurants_insert_restaurant"
  on public.restaurants for insert
  with check (public.is_dashboard_admin());

-- ── Verify ──────────────────────────────────────────────────────────────────
select p.full_name,
       p.email,
       case when p.is_admin then 'ADMIN (all outlets)' else 'staff' end as level,
       coalesce(r.area_name, r.name, 'ALL OUTLETS') as outlet,
       p.is_active,
       p.permissions
  from public.profiles p
  left join public.restaurants r on r.id = p.restaurant_id
 where p.role = 'restaurant'
 order by p.is_admin desc, outlet, p.full_name;
