# Handoff — Rider profile linking & rider reassignment

**From:** dashboard (`baba-delivery-dashboard`)
**To:** rider app (`ride_app_android`)
**Date:** 2026-07-29
**Migration to run first:** `add-rider-aadhar-image.sql` (dashboard repo, Supabase SQL editor)

Nothing here renames or removes a column the rider app already reads. Two of the
sections need a code change in the rider app; the rest is FYI.

---

## 0. TL;DR

| # | Item | Rider app change needed? |
|---|---|---|
| 1 | Column names aligned — admin edits now reach the rider app | **No** (fixed on the dashboard side) |
| 2 | Dashboard can now re-assign `orders.rider_id` | **Yes — required** |
| 3 | New dashboard-only fields the app could display | Optional |
| 4 | New RLS policies + `rider-docs` bucket | No |

---

## 1. The dashboard was writing the wrong columns (fixed)

Both apps store rider details on the **same `public.profiles` row**, but they were
using different column names for the same facts. So everything an admin typed into
the dashboard's "Add Rider" dialog went into columns the rider app never reads —
which is why rider info never showed up in the app's Profile / Vehicle Details
screens.

| Dashboard was writing | Rider app reads (`013_rider_profile_and_company_info.sql`) |
|---|---|
| `vehicle_make_model` | `vehicle_model` |
| `vehicle_registration` | `vehicle_registration_number` |
| `alternate_contact` | `emergency_contact_phone` |
| — | `emergency_contact_name` |
| — | `address` |
| `vehicle_type` ✓ | `vehicle_type` |
| `license_number` ✓ | `license_number` |

**Resolution: the rider app's names win.** They shipped first and the app's
screens already read them. `add-rider-aadhar-image.sql`:

- back-fills the three duplicate columns into the rider app's columns
  (only where the rider app's column is blank, so a value a rider typed in the
  app is never clobbered), and
- leaves the old columns in place — the drop is commented out at the bottom of
  the migration, run it once you're happy.

The dashboard now reads and writes `vehicle_model`,
`vehicle_registration_number`, `emergency_contact_name`,
`emergency_contact_phone` and `address` everywhere. **No rider app change.**

### Two small conventions to keep in sync

- **`vehicle_type` is free text** in your schema and `VehicleDetailsScreen` shows
  it verbatim, so the dashboard now writes capitalised `Bike` / `Scooter` /
  `Bicycle` instead of lowercase `bike` / `scooter`. Older rows may still hold
  lowercase — the dashboard normalises on read. Consider doing the same if you
  ever display it raw.
- **`vehicle_registration_number` is upper-cased** by the dashboard on save
  (`KA01AB1234`). `EditProfileScreen` currently saves it as typed.

---

## 2. ⚠️ The dashboard can now re-assign a delivery — please handle it

**What changed:** the order detail panel has a **Change rider / Assign / Unassign
rider** picker that does:

```sql
update orders set rider_id = <profile id or null> where id = <order id>;
```

Riders still self-claim normally via `claim_order_atomic`
(`012_fix_claim_and_ready_gate.sql`) — this is the staff override for when the
claimed rider breaks down, goes offline, or the wrong rider picked the order up.
A new RLS policy `orders_update_staff_rider` allows it (section 4 below).

**The gap:** `AppState._subscribeToActiveOrder()`
(`lib/app_state.dart`, ~line 1188) filters on `id = order.rawId` and only acts on
`status`:

```dart
final newStatus = payload.newRecord['status'] as String?;
if (newStatus == 'cancelled') { … clear active order … }
else if (newStatus != null) { await _loadActiveOrder(); }
```

If staff move the order to another rider, `status` is unchanged, so the callback
falls into the `else` branch and calls `_loadActiveOrder()`. Whether that
self-heals depends on `fetchActiveOrder`'s `.eq('rider_id', riderId)` filter
(`order_service.dart` ~line 191) returning nothing — but `_loadActiveOrder()`
assigns the result unconditionally, so please verify rather than assume. The
symptom if it doesn't: **the old rider keeps navigating to a delivery that is no
longer theirs, and can still mark it picked up / delivered.**

**Suggested change** in the same callback, before the status checks:

```dart
final newRiderId = payload.newRecord['rider_id'] as String?;
if (newRiderId != _riderId) {
  // Staff re-assigned (or unassigned) this delivery from the dashboard.
  await _activeOrderChannel?.unsubscribe();
  _activeOrderChannel = null;
  _activeOrder = null;
  _errorMessage = newRiderId == null
      ? 'Order ${order.id} was returned to the pool by the restaurant.'
      : 'Order ${order.id} was re-assigned to another rider.';
  _orderState = _isOnline ? OrderState.searching : OrderState.idle;
  if (_isOnline) await _refreshAvailableOrders();
  notifyListeners();
  return;
}
```

Also worth guarding the write path: `updateOrderStatus` / the pickup and delivery
confirmations should be `.eq('rider_id', riderId)` scoped so a stale client can't
advance an order it no longer owns.

**The receiving rider** gets the order through the existing
`rider_notifications` insert if your assign trigger fires on `rider_id` change —
if it only fires on `claim_order_atomic`, a dashboard reassignment will be silent
for the new rider. Worth checking `015_notify_on_accept.sql`.

---

## 3. New dashboard-only fields (optional to display)

The dashboard's Riders page now collects and shows these. They're on `profiles`,
so the rider app can read them with no extra work — the app currently ignores them.

| Column | Type | Meaning |
|---|---|---|
| `vehicle_color` | `text` | e.g. "Black" |
| `insurance_active` | `boolean` | Is the vehicle insurance currently valid |
| `aadhar_number` | `text` | 12-digit Aadhaar, digits only, no spaces |
| `alternate_contact_relation` | `text` | Father / Mother / Spouse … — the relation of `emergency_contact_name` |
| `aadhar_image_path` | `text` | **Storage object path** of the Aadhaar card photo — *not* a URL |

Natural home in the app: `VehicleDetailsScreen` for colour + insurance, and a KYC
card on `ProfileTab`.

### `aadhar_image_path` is a path, not a URL

Unlike `avatar_url` (public `rider-profiles` bucket), Aadhaar cards are sensitive
ID proof, so `rider-docs` is a **private** bucket. Mint a short-lived signed URL
to display it:

```dart
final signed = await supabase.storage
    .from('rider-docs')
    .createSignedUrl(profile['aadhar_image_path'] as String, 3600);
```

Files are stored as `<rider_id>/aadhaar-<timestamp>.webp`, and the policy
`rider_docs_select_own` lets a rider read their own folder — so a rider can view
their own card, but not anyone else's. **Uploading is staff-only** (the dashboard
Add/Edit Rider dialogs); if you want riders to upload their own, add an
`insert`/`update` policy mirroring `rider_docs_select_own`.

**Please don't render the raw Aadhaar number without masking.** The dashboard
shows `XXXX XXXX 1234` with an explicit "Show" toggle.

---

## 4. New database objects (no app change)

`add-rider-aadhar-image.sql` adds:

- **`public.is_dashboard_staff()`** — `security definer`, returns true when
  `auth.uid()`'s profile has `role = 'restaurant'`. Matches the convention in
  `delivery_settings_update_restaurant` / `company_info_update_restaurant`
  (this schema has no separate `admin` role).
- **`profiles_select_staff`** and **`profiles_update_staff_riders`** on
  `public.profiles` — let the dashboard read every rider and edit rows where
  `role = 'rider'`. RLS policies are OR'd, so your existing
  `profiles_select_own` / `profiles_update_own` are unaffected: a rider can still
  read and write their own row exactly as before.
- **`orders_update_staff_rider`** on `public.orders` — see section 2.
- **`rider-docs`** private storage bucket + `rider_docs_staff_all` /
  `rider_docs_select_own` policies.

⚠️ **Check for a policy collision before running:** `010_rider_online_status.sql`
does `DROP POLICY IF EXISTS "profiles_select_own"` then recreates it as
`USING (auth.uid() = id)`. If some *other* policy is currently what lets the
dashboard list riders, `profiles_select_staff` now makes that explicit — but if
you re-run 010 after this migration, nothing breaks (different policy names).

---

## 5. What the dashboard does *not* touch

- `avatar_url` — the dashboard **displays** the rider's photo (Riders table +
  detail panel) but never writes it. Photo upload stays rider-app-only via
  `uploadRiderProfilePhoto` → `rider-profiles` bucket.
- `is_online` — still driven by the `rider_locations` trigger
  (`010_rider_online_status.sql`). The dashboard reads `rider_locations.status`.
- **Login email / password** — the dashboard creates the auth user at "Add Rider"
  and never edits credentials afterwards. The Edit dialog says so explicitly and
  points riders at the app's forgot-password flow.
