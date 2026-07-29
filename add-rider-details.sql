-- Rider KYC + vehicle details.
--
-- ⚠️ SUPERSEDED by add-rider-aadhar-image.sql — run that instead (it is safe to
-- run on top of this one, and safe to run on its own).
--
-- Three of the columns below duplicate ones the RIDER APP already had, under
-- different names, so nothing entered in the dashboard ever reached the rider
-- app's profile screen:
--     vehicle_make_model    →  rider app's vehicle_model
--     vehicle_registration  →  rider app's vehicle_registration_number
--     alternate_contact     →  rider app's emergency_contact_phone
-- add-rider-aadhar-image.sql back-fills those into the rider app's columns and
-- the dashboard now reads/writes the rider app's names. Kept here for history.
--
-- Riders are `profiles` rows (role = 'rider') created from the dashboard's
-- "Add Rider" dialog via auth signUp. These columns store the vehicle and
-- identity details the dialog now collects:
--
--   vehicle_type          'bike' | 'scooter'   (two-wheeler category)
--   vehicle_registration  RTO plate, e.g. KA01AB1234
--   vehicle_make_model    e.g. "Honda Activa 6G"
--   vehicle_color         e.g. "Black"
--   insurance_active      boolean — is the vehicle insurance currently valid
--   license_number        rider's driving licence number
--   aadhar_number         rider's 12-digit Aadhaar number (identity/KYC)
--   alternate_contact             emergency / next-of-kin phone number
--   alternate_contact_relation    relation to the rider (Father, Mother, …)
--
-- All are nullable so existing riders are unaffected.

alter table public.profiles
  add column if not exists vehicle_type               text,
  add column if not exists vehicle_registration       text,
  add column if not exists vehicle_make_model          text,
  add column if not exists vehicle_color               text,
  add column if not exists insurance_active            boolean default false,
  add column if not exists license_number              text,
  add column if not exists aadhar_number               text,
  add column if not exists alternate_contact           text,
  add column if not exists alternate_contact_relation  text;

-- The dashboard writes these fields with an authenticated UPDATE on the rider's
-- own profile row immediately after signUp (the isolated signup client is signed
-- in as the new rider, so "users can update own profile" RLS covers it).
--
-- OPTIONAL — persist them straight from the signUp metadata via the
-- handle_new_user trigger instead, so the values land even if the follow-up
-- UPDATE is ever skipped. Only apply this if your existing handle_new_user
-- already inserts into profiles; adjust the column list to match your trigger.
--
-- create or replace function public.handle_new_user()
-- returns trigger language plpgsql security definer as $$
-- begin
--   insert into public.profiles (
--     id, role, full_name, phone,
--     vehicle_type, vehicle_registration, vehicle_make_model, vehicle_color,
--     insurance_active, license_number, aadhar_number,
--     alternate_contact, alternate_contact_relation
--   ) values (
--     new.id,
--     new.raw_user_meta_data ->> 'role',
--     new.raw_user_meta_data ->> 'full_name',
--     new.raw_user_meta_data ->> 'phone',
--     new.raw_user_meta_data ->> 'vehicle_type',
--     new.raw_user_meta_data ->> 'vehicle_registration',
--     new.raw_user_meta_data ->> 'vehicle_make_model',
--     new.raw_user_meta_data ->> 'vehicle_color',
--     coalesce((new.raw_user_meta_data ->> 'insurance_active')::boolean, false),
--     new.raw_user_meta_data ->> 'license_number',
--     new.raw_user_meta_data ->> 'aadhar_number',
--     new.raw_user_meta_data ->> 'alternate_contact',
--     new.raw_user_meta_data ->> 'alternate_contact_relation'
--   );
--   return new;
-- end;
-- $$;
