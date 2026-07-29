-- ============================================================================
-- Link the dashboard's rider records to the rider app's profile screen,
-- + Aadhaar photo upload, + admin edit/reassign permissions.
--
-- Run this once in the Supabase SQL editor, AFTER add-rider-details.sql.
-- Safe to re-run.
-- ============================================================================
--
-- WHY THIS EXISTS
-- ---------------
-- Both apps store rider details on the SAME `public.profiles` row, but they
-- were writing DIFFERENT COLUMNS for the same facts, so nothing the admin
-- panel entered ever appeared in the rider app (and vice-versa):
--
--   dashboard (add-rider-details.sql)  |  rider app (013_rider_profile…sql)
--   -----------------------------------+-----------------------------------
--   vehicle_make_model                 |  vehicle_model
--   vehicle_registration               |  vehicle_registration_number
--   alternate_contact                  |  emergency_contact_phone
--   (none)                             |  emergency_contact_name
--   (none)                             |  address
--   (none)                             |  avatar_url
--   vehicle_type        ✓ same         |  vehicle_type
--   license_number      ✓ same         |  license_number
--
-- The rider app's names win — it shipped them first and its Profile / Vehicle
-- Details / Edit Profile screens read them. This migration copies whatever the
-- dashboard already wrote into the rider app's columns, and from now on the
-- dashboard reads and writes the rider app's names too.

-- ---------------------------------------------------------------------------
-- 1. Make sure the rider app's columns exist (no-op if 013 was already run)
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists vehicle_type                text,
  add column if not exists vehicle_model               text,
  add column if not exists vehicle_registration_number text,
  add column if not exists license_number              text,
  add column if not exists address                     text,
  add column if not exists emergency_contact_name      text,
  add column if not exists emergency_contact_phone     text,
  add column if not exists avatar_url                  text;

-- ---------------------------------------------------------------------------
-- 2. Dashboard-only extras that the rider app has no equivalent for
-- ---------------------------------------------------------------------------
--   vehicle_color               e.g. "Black"
--   insurance_active            is the vehicle insurance currently valid
--   aadhar_number               12-digit Aadhaar (identity/KYC)
--   alternate_contact_relation  Father / Mother / Spouse … for the emergency contact
--   aadhar_image_path           storage OBJECT PATH of the Aadhaar card photo
--                               (not a public URL — see section 4)
alter table public.profiles
  add column if not exists vehicle_color              text,
  add column if not exists insurance_active           boolean default false,
  add column if not exists aadhar_number              text,
  add column if not exists alternate_contact_relation text,
  add column if not exists aadhar_image_path          text;

-- ---------------------------------------------------------------------------
-- 3. Back-fill: move anything the dashboard already wrote into the rider
--    app's columns. Only fills blanks, so it never clobbers a value the rider
--    entered in the app themselves.
-- ---------------------------------------------------------------------------
update public.profiles
   set vehicle_model = coalesce(nullif(vehicle_model, ''), vehicle_make_model)
 where vehicle_make_model is not null
   and coalesce(vehicle_model, '') = '';

update public.profiles
   set vehicle_registration_number =
         coalesce(nullif(vehicle_registration_number, ''), vehicle_registration)
 where vehicle_registration is not null
   and coalesce(vehicle_registration_number, '') = '';

update public.profiles
   set emergency_contact_phone =
         coalesce(nullif(emergency_contact_phone, ''), alternate_contact)
 where alternate_contact is not null
   and coalesce(emergency_contact_phone, '') = '';

-- The old dashboard-only duplicates are now unused by both apps. They are left
-- in place so this migration is non-destructive; drop them once you've
-- confirmed the Riders page shows everything correctly:
--
-- alter table public.profiles
--   drop column if exists vehicle_make_model,
--   drop column if exists vehicle_registration,
--   drop column if exists alternate_contact;

-- ---------------------------------------------------------------------------
-- 4. Private storage bucket for the Aadhaar photo
-- ---------------------------------------------------------------------------
-- An Aadhaar card is sensitive ID proof, so unlike `rider-profiles` (public
-- avatars) this bucket is PRIVATE. `profiles.aadhar_image_path` stores the
-- object path and both apps mint a short-lived signed URL to display it:
--
--   supabase.storage.from('rider-docs').createSignedUrl(path, 3600)
--
insert into storage.buckets (id, name, public)
values ('rider-docs', 'rider-docs', false)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 5. Who counts as "dashboard staff"?
-- ---------------------------------------------------------------------------
-- This schema's roles are customer / restaurant / rider (there is no separate
-- 'admin' role — see 013's note), so the dashboard logs in as 'restaurant',
-- matching delivery_settings_update_restaurant and company_info_update_restaurant.
create or replace function public.is_dashboard_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'restaurant'
  );
$$;

-- Storage: staff upload/read rider docs; a rider can read their own folder
-- (files are stored as "<rider_id>/aadhaar-<ts>.webp"), which is what would let
-- the rider app show a rider their own uploaded card.
drop policy if exists "rider_docs_staff_all" on storage.objects;
create policy "rider_docs_staff_all" on storage.objects
  for all
  using (bucket_id = 'rider-docs' and public.is_dashboard_staff())
  with check (bucket_id = 'rider-docs' and public.is_dashboard_staff());

drop policy if exists "rider_docs_select_own" on storage.objects;
create policy "rider_docs_select_own" on storage.objects
  for select
  using (
    bucket_id = 'rider-docs'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ---------------------------------------------------------------------------
-- 6. Profile RLS — this is what actually links the two apps
-- ---------------------------------------------------------------------------
-- RLS policies are OR'd, so these ADD staff access alongside the rider app's
-- existing "profiles_select_own" / "profiles_update_own". Without the UPDATE
-- policy, saving an edit from the admin panel silently affects 0 rows.
drop policy if exists "profiles_select_staff" on public.profiles;
create policy "profiles_select_staff" on public.profiles
  for select
  using (public.is_dashboard_staff());

drop policy if exists "profiles_update_staff_riders" on public.profiles;
create policy "profiles_update_staff_riders" on public.profiles
  for update
  using (public.is_dashboard_staff() and role = 'rider')
  with check (public.is_dashboard_staff() and role = 'rider');

-- ---------------------------------------------------------------------------
-- 7. Re-assigning a delivery to a different rider
-- ---------------------------------------------------------------------------
-- The order detail now has a "Change rider" picker, which does
-- `update orders set rider_id = <profile id>`. Riders normally self-claim via
-- 012_fix_claim_and_ready_gate.sql; this is the manual staff override.
--
-- If you already have a broad "restaurant can update own orders" policy this is
-- redundant — check your existing policies first.
drop policy if exists "orders_update_staff_rider" on public.orders;
create policy "orders_update_staff_rider" on public.orders
  for update
  using (public.is_dashboard_staff())
  with check (public.is_dashboard_staff());

-- ── Verify ──────────────────────────────────────────────────────────────────
select column_name, data_type
  from information_schema.columns
 where table_schema = 'public' and table_name = 'profiles'
   and column_name in (
     'vehicle_type', 'vehicle_model', 'vehicle_registration_number',
     'license_number', 'address', 'emergency_contact_name',
     'emergency_contact_phone', 'avatar_url', 'vehicle_color',
     'insurance_active', 'aadhar_number', 'alternate_contact_relation',
     'aadhar_image_path'
   )
 order by column_name;
