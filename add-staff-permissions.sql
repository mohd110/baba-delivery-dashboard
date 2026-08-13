-- ============================================================================
-- Dashboard staff logins with per-user permissions.
--
-- Run this once in the Supabase SQL editor, AFTER add-rider-aadhar-image.sql.
-- Safe to re-run.
-- ============================================================================
--
-- WHAT THIS ADDS
-- --------------
-- Until now every dashboard login was the same: role = 'restaurant' meant "can
-- see and do everything". This splits that role in two:
--
--   is_admin = true   the restaurant owner. Sees every page, and is the only
--                     one who can create logins or change anyone's permissions.
--   is_admin = false  a STAFF login. Sees only the pages listed in its
--                     `permissions` array, and can only perform the actions
--                     listed there.
--
-- `permissions` is a jsonb array of the keys defined in src/lib/permissions.js,
-- e.g. the operations staff the client asked for:
--
--   ["page.orders","page.order_history","page.reports","page.overview",
--    "page.complaints","action.restaurant_toggle","action.assign_rider"]
--
-- Adding a new permission later is a code change in src/lib/permissions.js
-- only — nothing in this file lists the individual keys, so the database never
-- needs another migration for it.
--
-- The dashboard hides pages and buttons a staffer lacks, but hiding a button is
-- only cosmetic: sections 5–7 below are what actually stop a staff login from
-- granting itself permissions, flipping the restaurant open/closed, or
-- re-assigning a rider from outside the UI.

-- ---------------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------------
--   is_admin     owner-level login (all pages, may manage other logins)
--   permissions  jsonb array of permission keys — only read when is_admin=false
--   is_active    turn a login off without deleting it
--   email        so the Users page can show who a login belongs to
--                (auth.users is not readable from the browser)
alter table public.profiles
  add column if not exists is_admin    boolean not null default false,
  add column if not exists permissions jsonb   not null default '[]'::jsonb,
  add column if not exists is_active   boolean not null default true,
  add column if not exists email       text;

-- ---------------------------------------------------------------------------
-- 2. Back-fill
-- ---------------------------------------------------------------------------
-- Every dashboard login that exists today is an owner/admin — nobody gets
-- locked out of their own dashboard by running this migration.
update public.profiles
   set is_admin = true
 where role = 'restaurant'
   and is_admin is distinct from true;

-- Copy the sign-in email onto the profile row (blanks only, never clobbers).
update public.profiles p
   set email = u.email
  from auth.users u
 where u.id = p.id
   and coalesce(p.email, '') = '';

-- Keep it in step for logins created from now on.
create or replace function public.sync_profile_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles set email = new.email where id = new.id;
  return new;
end;
$$;

drop trigger if exists sync_profile_email_on_auth_user on auth.users;
create trigger sync_profile_email_on_auth_user
  after insert or update of email on auth.users
  for each row execute function public.sync_profile_email();

-- ---------------------------------------------------------------------------
-- 3. Who is who
-- ---------------------------------------------------------------------------
-- `is_dashboard_staff()` already existed (add-rider-aadhar-image.sql) and gates
-- rider/storage access. It now also requires the login to still be active, so
-- deactivating someone in the Users page really does cut their access off.
create or replace function public.is_dashboard_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role = 'restaurant'
      and coalesce(p.is_active, true)
  );
$$;

-- The restaurant owner: allowed to manage other logins.
create or replace function public.is_dashboard_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role = 'restaurant'
      and coalesce(p.is_active, true)
      and coalesce(p.is_admin, false)
  );
$$;

-- Does the caller hold `perm`? Admins hold everything.
create or replace function public.staff_has_perm(perm text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role = 'restaurant'
      and coalesce(p.is_active, true)
      and (coalesce(p.is_admin, false) or coalesce(p.permissions, '[]'::jsonb) ? perm)
  );
$$;

-- ---------------------------------------------------------------------------
-- 4. Admins may edit any profile (that's how permissions get saved)
-- ---------------------------------------------------------------------------
-- Policies are OR'd, so this sits alongside the rider app's
-- "profiles_update_own" and the dashboard's "profiles_update_staff_riders".
drop policy if exists "profiles_update_admin" on public.profiles;
create policy "profiles_update_admin" on public.profiles
  for update
  using (public.is_dashboard_admin())
  with check (public.is_dashboard_admin());

-- ---------------------------------------------------------------------------
-- 5. Nobody promotes themselves
-- ---------------------------------------------------------------------------
-- Without this, "profiles_update_own" (every user may edit their own row) would
-- let a staff login run one update from the browser console and set
-- is_admin = true. RLS can't restrict individual COLUMNS, so this is a trigger:
-- role / is_admin / permissions / is_active may only ever be changed by an
-- admin. Everything else on the row (name, phone, avatar…) is untouched, so the
-- rider app's own profile editing keeps working exactly as before.
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
  if new.role        is distinct from old.role
     or new.is_admin is distinct from old.is_admin
     or new.permissions is distinct from old.permissions
     or new.is_active   is distinct from old.is_active then
    raise exception 'Only a dashboard admin can change roles or permissions';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_guard_privileges on public.profiles;
create trigger profiles_guard_privileges
  before update on public.profiles
  for each row execute function public.guard_profile_privileges();

-- ---------------------------------------------------------------------------
-- 6. Order actions a staff login may not have
-- ---------------------------------------------------------------------------
-- The dashboard's orders UPDATE policy is deliberately broad (staff accept,
-- mark ready, extend prep time…). Two specific changes are permission-gated
-- instead, which a policy can't express because it has to compare the old row
-- with the new one.
--
-- Only dashboard logins are checked: riders self-claiming an order and the
-- customer app are left alone.
create or replace function public.guard_order_staff_actions()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_dashboard_staff() then
    return new;
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
-- 7. Opening / closing the restaurant, and the trading hours
-- ---------------------------------------------------------------------------
create or replace function public.guard_restaurant_staff_actions()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_dashboard_staff() then
    return new;
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

-- ── Verify ──────────────────────────────────────────────────────────────────
-- Who can sign in to the dashboard, and with what?
select full_name,
       email,
       case when is_admin then 'ADMIN (everything)' else 'staff' end as level,
       is_active,
       permissions
  from public.profiles
 where role = 'restaurant'
 order by is_admin desc, full_name;
