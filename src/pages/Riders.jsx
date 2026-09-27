import { useCallback, useEffect, useState } from 'react'
import {
  Bike,
  Truck,
  CheckCircle2,
  Users,
  Phone,
  MapPin,
  ExternalLink,
  UserPlus,
  X,
  ShieldCheck,
  ShieldAlert,
  IdCard,
  Pencil,
  Upload,
  Eye,
  EyeOff,
  FileImage,
  AlertTriangle,
} from 'lucide-react'
import Topbar, { SearchBox, TopIcons } from '../layout/Topbar.jsx'
import { supabase, createIsolatedClient } from '../lib/supabase.js'
import { compressImage } from '../lib/compressImage.js'
import DateRangeFilter from '../components/DateRangeFilter.jsx'
import LiveMap from '../components/LiveMap.jsx'
import MapModal from '../components/MapModal.jsx'
import OutletTag from '../components/OutletTag.jsx'
import { inRange, rangeLabel } from '../lib/dateRange.js'
import { gmapsLink, hasMapsKey, toCoords } from '../lib/googleMaps.js'

function initials(name = '') {
  const parts = name.split(' ').filter(Boolean).slice(0, 2)
  return parts.map((w) => w[0]).join('').toUpperCase() || 'R'
}

function ago(iso) {
  if (!iso) return '—'
  const ms = Date.now() - new Date(iso).getTime()
  const min = Math.floor(ms / 60000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  return `${Math.floor(hr / 24)}d ago`
}

const AVATAR_TONES = [
  'bg-[#ffdad3] text-brand',
  'bg-info-soft text-info',
  'bg-pos-soft text-pos-dark',
  'bg-[#fef3c7] text-[#b45309]',
]
function toneFor(id = '') {
  let sum = 0
  for (const ch of id) sum += ch.charCodeAt(0)
  return AVATAR_TONES[sum % AVATAR_TONES.length]
}

// The rider app stores vehicle_type as free text and shows it verbatim on its
// Vehicle Details screen, so we write capitalised values it can display as-is.
// Older dashboard rows hold lowercase 'bike'/'scooter' — normalise on read.
const VEHICLE_TYPES = ['Bike', 'Scooter', 'Bicycle']
function normalizeVehicleType(v) {
  if (!v) return ''
  const found = VEHICLE_TYPES.find((t) => t.toLowerCase() === String(v).trim().toLowerCase())
  return found || v
}
const RELATIONS = ['Father', 'Mother', 'Spouse', 'Brother', 'Sister', 'Son', 'Daughter', 'Friend', 'Other']

/* ── Rider profile columns ────────────────────────────────────────────────
 * These live on `public.profiles` — the SAME row the rider app's Profile,
 * Vehicle Details and Edit Profile screens read. Editing a rider here updates
 * what the rider sees in their app, and vice-versa; there is no second copy.
 *
 * IMPORTANT: the column names below are the RIDER APP's
 * (supabase/013_rider_profile_and_company_info.sql). The dashboard originally
 * invented parallel columns (vehicle_make_model, vehicle_registration,
 * alternate_contact) which the rider app never read — which is why rider
 * details entered in the admin panel never showed up in the app.
 * add-rider-aadhar-image.sql back-fills the old columns into these.
 *
 * The columns arrive in two migrations, so we degrade in steps rather than
 * blanking the page when one hasn't been run yet:
 *   full    → add-rider-aadhar-image.sql has been run
 *   details → only the rider app's 013 migration has been run
 *   min     → neither (only the always-present name/phone) */
const BASE_COLS = 'id, full_name, phone'
// Shared with the rider app.
const SHARED_COLS =
  'avatar_url, vehicle_type, vehicle_model, vehicle_registration_number, license_number, ' +
  'address, emergency_contact_name, emergency_contact_phone'
// Dashboard-only extras (the rider app has no equivalent for these).
const EXTRA_COLS =
  'vehicle_color, insurance_active, aadhar_number, alternate_contact_relation, aadhar_image_path'
const COLS_FULL = `${BASE_COLS}, ${SHARED_COLS}, ${EXTRA_COLS}`
const COLS_DETAILS = `${BASE_COLS}, ${SHARED_COLS}`

const SCHEMA_HINT = {
  details:
    'Aadhaar details & photos need add-rider-aadhar-image.sql — run it in the Supabase SQL editor.',
  min:
    "Rider vehicle & KYC details need the rider app's 013_rider_profile_and_company_info.sql, then add-rider-aadhar-image.sql — run them in the Supabase SQL editor.",
}

/* ── Aadhaar document storage ─────────────────────────────────────────────
 * An Aadhaar card is sensitive ID proof, so `rider-docs` is a PRIVATE bucket:
 * the profile row stores the object path and we mint a short-lived signed URL
 * only when the image is actually shown. Files live under `<rider_id>/…` so
 * the rider app can let a rider see their own upload (see the SQL policies). */
const DOCS_BUCKET = 'rider-docs'

async function uploadAadhaar(riderId, file) {
  // Keep it legible — an ID card needs more detail than a dish photo, so a
  // higher cap than the compressor's 1200px/0.8 default.
  const small = await compressImage(file, { maxDim: 1600, quality: 0.85 })
  const ext = small.type === 'image/webp' ? 'webp' : 'jpg'
  const path = `${riderId}/aadhaar-${Date.now()}.${ext}`
  const { data, error } = await supabase.storage
    .from(DOCS_BUCKET)
    .upload(path, small, { cacheControl: '31536000', upsert: false, contentType: small.type })
  if (error) throw new Error(error.message || 'Aadhaar upload failed')
  return data.path
}

// Renders a private Aadhaar image via a 1-hour signed URL. Callers pass
// `key={path}` so a changed path remounts this and the stale image can't linger
// while the new signed URL is being minted. Nothing is fetched without a path.
function AadhaarImage({ path, className = '' }) {
  const [url, setUrl] = useState(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    if (!path) return
    supabase.storage
      .from(DOCS_BUCKET)
      .createSignedUrl(path, 3600)
      .then(({ data, error }) => {
        if (cancelled) return
        if (error || !data?.signedUrl) setFailed(true)
        else setUrl(data.signedUrl)
      })
    return () => { cancelled = true }
  }, [path])

  if (!path) return null
  if (failed) {
    return (
      <div className={`flex items-center gap-2 rounded-lg border border-line bg-canvas px-3 py-2 text-xs text-ink-soft ${className}`}>
        <AlertTriangle className="h-3.5 w-3.5 text-[#b45309]" />
        Couldn&apos;t load the Aadhaar image — check the `rider-docs` bucket policies.
      </div>
    )
  }
  if (!url) {
    return <div className={`h-32 animate-pulse rounded-lg bg-line-soft ${className}`} />
  }
  return (
    <a href={url} target="_blank" rel="noreferrer" className={`block ${className}`} title="Open full size">
      <img
        src={url}
        alt="Rider Aadhaar card"
        className="max-h-44 w-full rounded-lg border border-line object-contain"
      />
    </a>
  )
}

// "123412341234" -> "XXXX XXXX 1234"
function maskAadhaar(num) {
  const digits = String(num || '').replace(/\D/g, '')
  if (digits.length < 4) return num || '—'
  return `XXXX XXXX ${digits.slice(-4)}`
}
function groupAadhaar(num) {
  const digits = String(num || '').replace(/\D/g, '')
  return digits.replace(/(\d{4})(?=\d)/g, '$1 ') || num || '—'
}

function StatusBadge({ onDelivery, locStatus }) {
  if (onDelivery) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-info-soft px-3 py-1 text-xs font-semibold text-info">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-info" /> On Delivery
      </span>
    )
  }
  if (locStatus === 'online') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-pos-soft px-3 py-1 text-xs font-semibold text-pos-dark">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-pos" /> Online
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-line-soft px-3 py-1 text-xs font-semibold text-ink-soft">
      <span className="h-1.5 w-1.5 rounded-full bg-line-2" /> Offline
    </span>
  )
}

function Kpi({ label, value, sub, icon: Icon, iconBg }) {
  return (
    <div className="rounded-xl border border-line bg-white p-5">
      <div className="flex items-start justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-ink-soft">{label}</span>
        <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${iconBg}`}>
          <Icon className="h-4 w-4" />
        </span>
      </div>
      <p className="mt-2 text-[28px] font-bold leading-none text-ink">{value}</p>
      <p className="mt-1 text-xs text-ink-soft">{sub}</p>
    </div>
  )
}

// A labelled read-only field in the rider detail panel.
function Field({ label, value, mono }) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-wide text-ink-soft">{label}</p>
      <p className={`mt-0.5 text-sm text-ink ${mono ? 'font-mono tracking-wide' : 'font-semibold'}`}>
        {value || <span className="font-normal text-line-2">—</span>}
      </p>
    </div>
  )
}

function SectionTitle({ icon: Icon, children }) {
  return (
    <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-ink">
      <Icon className="h-3.5 w-3.5 text-brand" /> {children}
    </div>
  )
}

/* ── Form plumbing shared by Add and Edit ─────────────────────────────── */
const EMPTY_FORM = {
  name: '',
  phone: '',
  email: '',
  password: '',
  address: '',
  vehicleType: 'Bike',
  vehicleRegistrationNumber: '',
  vehicleModel: '',
  vehicleColor: '',
  insuranceActive: false,
  licenseNumber: '',
  aadharNumber: '',
  emergencyName: '',
  emergencyPhone: '',
  emergencyRelation: 'Father',
}

// profiles row -> form state (for the Edit dialog). Riders added before the
// column alignment prefill from the rider app's columns too — the back-fill in
// add-rider-aadhar-image.sql copies their old values across.
function formFromProfile(p = {}) {
  return {
    ...EMPTY_FORM,
    name: p.full_name || '',
    phone: p.phone || '',
    address: p.address || '',
    vehicleType: normalizeVehicleType(p.vehicle_type) || 'Bike',
    vehicleRegistrationNumber: p.vehicle_registration_number || '',
    vehicleModel: p.vehicle_model || '',
    vehicleColor: p.vehicle_color || '',
    insuranceActive: !!p.insurance_active,
    licenseNumber: p.license_number || '',
    aadharNumber: p.aadhar_number || '',
    emergencyName: p.emergency_contact_name || '',
    emergencyPhone: p.emergency_contact_phone || '',
    emergencyRelation: p.alternate_contact_relation || 'Father',
  }
}

// form state -> the profile columns the rider app reads.
function sharedFromForm(form) {
  return {
    address: form.address.trim() || null,
    vehicle_type: form.vehicleType || null,
    vehicle_model: form.vehicleModel.trim() || null,
    vehicle_registration_number: form.vehicleRegistrationNumber.trim().toUpperCase() || null,
    license_number: form.licenseNumber.trim().toUpperCase() || null,
    emergency_contact_name: form.emergencyName.trim() || null,
    emergency_contact_phone: form.emergencyPhone.trim() || null,
  }
}

// The dashboard-only extras, kept separate so we can skip them when the
// add-rider-aadhar-image.sql migration hasn't been run yet.
function extrasFromForm(form) {
  return {
    vehicle_color: form.vehicleColor.trim() || null,
    insurance_active: form.insuranceActive,
    aadhar_number: form.aadharNumber.replace(/\s+/g, '') || null,
    alternate_contact_relation: form.emergencyPhone.trim() ? form.emergencyRelation : null,
  }
}

// Everything the current schema can hold.
function detailsFromForm(form, schema) {
  const out = sharedFromForm(form)
  if (schema === 'full') Object.assign(out, extrasFromForm(form))
  return out
}

/* The vehicle + KYC + Aadhaar-photo fields. Identical in the Add and Edit
 * dialogs, so they live in one component — the two flows can't drift apart and
 * end up collecting different information. */
function RiderDetailFields({ form, setForm, aadhaarFile, setAadhaarFile, existingPath, schema }) {
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const canUploadDoc = schema === 'full'

  return (
    <>
      {/* Address — shown on the rider app's profile */}
      <div className="border-t border-line-soft pt-4">
        <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-ink-soft">
          Home address
        </label>
        <textarea
          rows={2}
          value={form.address}
          onChange={set('address')}
          placeholder="House / street / area, city"
          className="w-full resize-none rounded-lg border border-line px-3 py-2 text-sm text-ink focus:border-brand focus:outline-none"
        />
      </div>

      {/* Vehicle details */}
      <div className="space-y-4 border-t border-line-soft pt-4">
        <SectionTitle icon={Bike}>Vehicle Details</SectionTitle>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-ink-soft">
              Vehicle type
            </label>
            <select
              value={form.vehicleType}
              onChange={set('vehicleType')}
              className="w-full rounded-lg border border-line px-3 py-2 text-sm text-ink focus:border-brand focus:outline-none"
            >
              {VEHICLE_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-ink-soft">
              Registration no.
            </label>
            <input
              value={form.vehicleRegistrationNumber}
              onChange={set('vehicleRegistrationNumber')}
              placeholder="e.g. KA01AB1234"
              className="w-full rounded-lg border border-line px-3 py-2 text-sm uppercase text-ink focus:border-brand focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-ink-soft">
              Model
            </label>
            <input
              value={form.vehicleModel}
              onChange={set('vehicleModel')}
              placeholder="e.g. Honda Activa 6G"
              className="w-full rounded-lg border border-line px-3 py-2 text-sm text-ink focus:border-brand focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-ink-soft">
              Colour
            </label>
            <input
              value={form.vehicleColor}
              onChange={set('vehicleColor')}
              disabled={!canUploadDoc}
              placeholder="e.g. Black"
              className="w-full rounded-lg border border-line px-3 py-2 text-sm text-ink focus:border-brand focus:outline-none disabled:bg-canvas disabled:text-ink-soft"
            />
          </div>
        </div>
        <label className={`flex items-center gap-2.5 rounded-lg border border-line bg-canvas/40 px-3 py-2.5 ${canUploadDoc ? 'cursor-pointer' : 'opacity-50'}`}>
          <input
            type="checkbox"
            checked={form.insuranceActive}
            disabled={!canUploadDoc}
            onChange={(e) => setForm((f) => ({ ...f, insuranceActive: e.target.checked }))}
            className="h-4 w-4 rounded border-line text-brand accent-brand focus:ring-brand"
          />
          <span className="flex items-center gap-1.5 text-sm font-semibold text-ink">
            <ShieldCheck className="h-4 w-4 text-pos-dark" /> Insurance active
          </span>
        </label>
      </div>

      {/* Emergency contact — emergency_contact_name / _phone are read by the
          rider app's profile screen; the relation is dashboard-only. */}
      <div className="space-y-4 border-t border-line-soft pt-4">
        <SectionTitle icon={Phone}>Emergency Contact</SectionTitle>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-ink-soft">
              Name
            </label>
            <input
              value={form.emergencyName}
              onChange={set('emergencyName')}
              placeholder="e.g. Suresh Kumar"
              className="w-full rounded-lg border border-line px-3 py-2 text-sm text-ink focus:border-brand focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-ink-soft">
              Phone
            </label>
            <input
              value={form.emergencyPhone}
              onChange={set('emergencyPhone')}
              placeholder="e.g. 98765 43210"
              className="w-full rounded-lg border border-line px-3 py-2 text-sm text-ink focus:border-brand focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-ink-soft">
              Relation
            </label>
            <select
              value={form.emergencyRelation}
              onChange={set('emergencyRelation')}
              disabled={!canUploadDoc}
              className="w-full rounded-lg border border-line px-3 py-2 text-sm text-ink focus:border-brand focus:outline-none disabled:bg-canvas disabled:text-ink-soft"
            >
              {RELATIONS.map((rel) => (
                <option key={rel} value={rel}>{rel}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Identity / KYC */}
      <div className="space-y-4 border-t border-line-soft pt-4">
        <SectionTitle icon={IdCard}>Identity &amp; KYC</SectionTitle>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-ink-soft">
              Driving licence no.
            </label>
            <input
              value={form.licenseNumber}
              onChange={set('licenseNumber')}
              placeholder="e.g. KA0120200001234"
              className="w-full rounded-lg border border-line px-3 py-2 text-sm uppercase text-ink focus:border-brand focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-ink-soft">
              Aadhaar no.
            </label>
            <input
              inputMode="numeric"
              value={form.aadharNumber}
              onChange={set('aadharNumber')}
              disabled={!canUploadDoc}
              placeholder="12-digit number"
              className="w-full rounded-lg border border-line px-3 py-2 text-sm text-ink focus:border-brand focus:outline-none disabled:bg-canvas disabled:text-ink-soft"
            />
          </div>
        </div>

        {/* Aadhaar card photo */}
        <div>
          <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-ink-soft">
            Aadhaar card photo
          </label>
          {canUploadDoc ? (
            <>
              <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-line px-3 py-2.5 text-sm text-ink-soft hover:border-brand hover:text-brand">
                <Upload className="h-4 w-4" />
                <span className="truncate">
                  {aadhaarFile ? aadhaarFile.name : existingPath ? 'Replace uploaded photo' : 'Choose an image…'}
                </span>
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => setAadhaarFile(e.target.files?.[0] || null)}
                />
              </label>
              {aadhaarFile && (
                <button
                  type="button"
                  onClick={() => setAadhaarFile(null)}
                  className="mt-1 text-[11px] font-semibold text-ink-soft underline hover:text-ink"
                >
                  Clear selection
                </button>
              )}
              {existingPath && !aadhaarFile && <AadhaarImage key={existingPath} path={existingPath} className="mt-2" />}
              <p className="mt-1 text-[11px] text-ink-soft">
                Stored in a private bucket — only dashboard staff and the rider themselves can view it.
              </p>
            </>
          ) : (
            <p className="rounded-lg border border-line bg-canvas px-3 py-2 text-[11px] text-ink-soft">
              {SCHEMA_HINT[schema]}
            </p>
          )}
        </div>
      </div>
    </>
  )
}

// Aggregate the rider roster from orders (already filtered to a date range) +
// the full profile roster + latest live locations.
function buildRiders(orders, roster, locs) {
  const map = new Map()
  const upsert = (id, name, phone, profile) => {
    if (!id) return null
    if (!map.has(id)) {
      map.set(id, {
        id, name: name || 'Rider', phone: phone || null, profile: profile || null,
        active: 0, outForDelivery: 0, assignedOrders: [],
        completed: 0, total: 0, earned: 0, lastAt: null, loc: null, locStatus: null,
      })
    }
    const r = map.get(id)
    if (name && r.name === 'Rider') r.name = name
    if (phone && !r.phone) r.phone = phone
    if (profile && !r.profile) r.profile = profile
    return r
  }

  // Seed with the full roster first so idle riders still show up. The whole
  // profile row is kept on the rider so the detail panel can show every field
  // without a second fetch.
  ;(roster ?? []).forEach((p) => upsert(p.id, p.full_name, p.phone, p))

  ;(orders ?? []).forEach((o) => {
    const r = upsert(o.rider_id || o.rider?.id, o.rider?.full_name, o.rider?.phone)
    if (!r) return
    r.total += 1
    if (o.status === 'delivered') {
      r.completed += 1
      r.earned += o.rider_payment || 0
    } else if (o.status !== 'cancelled') {
      // "Active" means the rider currently has this order in some
      // non-terminal state — not just literally out for delivery. A rider
      // who's claimed a second order but hasn't picked it up yet (still
      // 'ready' at the restaurant) is just as occupied as one already on
      // the road, and undercounting that here was hiding real multi-order
      // load from staff.
      r.active += 1
      r.assignedOrders.push({
        id: o.id,
        orderNumber: o.order_number,
        status: o.status,
        total: o.total,
        // A rider can be carrying orders from two branches at once.
        restaurantId: o.restaurant_id ?? null,
      })
      if (o.status === 'out_for_delivery') r.outForDelivery += 1
    }
    if (!r.lastAt || new Date(o.created_at) > new Date(r.lastAt)) r.lastAt = o.created_at
  })

  // Newest location per rider.
  const locByRider = {}
  ;(locs ?? []).forEach((l) => {
    const cur = locByRider[l.rider_id]
    if (!cur || new Date(l.updated_at) > new Date(cur.updated_at)) locByRider[l.rider_id] = l
  })
  map.forEach((r) => {
    r.loc = locByRider[r.id] || null
    r.locStatus = r.loc?.status || null
    const locAt = r.loc?.updated_at
    if (locAt && (!r.lastAt || new Date(locAt) > new Date(r.lastAt))) r.lastAt = locAt
  })

  return [...map.values()].sort((a, b) => {
    if (b.active !== a.active) return b.active - a.active
    return new Date(b.lastAt || 0) - new Date(a.lastAt || 0)
  })
}

export default function Riders() {
  const [ordersData, setOrdersData] = useState([])
  const [roster, setRoster] = useState([])
  const [locs, setLocs] = useState([])
  const [loading, setLoading] = useState(true)
  const [range, setRange] = useState(null)
  const [preset, setPreset] = useState('month')
  const [searchQuery, setSearchQuery] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [aadhaarFile, setAadhaarFile] = useState(null)
  // Which rider-profile columns this database actually has: 'full' | 'details' | 'min'.
  const [schema, setSchema] = useState('full')
  // Rider whose full detail panel is open, and the rider being edited.
  const [detailId, setDetailId] = useState(null)
  const [editTarget, setEditTarget] = useState(null)
  const [editForm, setEditForm] = useState(EMPTY_FORM)
  const [editFile, setEditFile] = useState(null)
  const [revealAadhaar, setRevealAadhaar] = useState(false)
  // Rider whose live position is open in the map dialog.
  const [mapRiderId, setMapRiderId] = useState(null)

  /* The three datasets are fetched separately so a change to one doesn't
   * re-download the other two — see the subscription effect below. Orders with a
   * rider assigned are always readable by the restaurant via the FK-hinted join;
   * the roster and live locations may be RLS-restricted, so we tolerate
   * empty/failed results and fall back to what the orders give us. */
  const loadOrders = useCallback(
    () =>
      supabase
        .from('orders')
        .select('id, order_number, status, total, rider_payment, created_at, delivered_at, rider_id, restaurant_id, rider:profiles!orders_rider_id_fkey(id, full_name, phone)')
        .not('rider_id', 'is', null)
        .order('created_at', { ascending: false }),
    []
  )

  const loadLocs = useCallback(
    () => supabase.from('rider_locations').select('rider_id, latitude, longitude, status, updated_at'),
    []
  )

  // Steps down through the three schema levels so a database that hasn't had
  // the migrations run still lists riders (just without the extra detail)
  // instead of showing an empty page.
  const loadRoster = useCallback(async () => {
    let res = await supabase.from('profiles').select(COLS_FULL).eq('role', 'rider')
    if (!res.error) { setSchema('full'); return res }
    res = await supabase.from('profiles').select(COLS_DETAILS).eq('role', 'rider')
    if (!res.error) { setSchema('details'); return res }
    setSchema('min')
    return supabase.from('profiles').select(BASE_COLS).eq('role', 'rider')
  }, [])

  const load = useCallback(
    () =>
      Promise.all([loadOrders(), loadRoster(), loadLocs()]).then(
        ([ordersRes, rosterRes, locRes]) => {
          if (ordersRes.error) console.error('Failed to load rider orders:', ordersRes.error.message)
          if (rosterRes.error) console.error('Failed to load rider roster:', rosterRes.error.message)
          setOrdersData(ordersRes.data ?? [])
          setRoster(rosterRes.data ?? [])
          setLocs(locRes.data ?? [])
          setLoading(false)
        }
      ),
    [loadOrders, loadRoster, loadLocs]
  )

  useEffect(() => {
    load()
    const channel = supabase
      .channel('riders-page')
      // Only the orders query is refetched for an order event — the roster and
      // the live locations can't have changed because of it. This used to run
      // all three queries for every event on any of the three tables.
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => {
        loadOrders().then(({ data, error }) => {
          if (error) return
          setOrdersData(data ?? [])
        })
      })
      // Riders upsert their GPS position continuously while on shift, so this
      // fires constantly. The payload IS the row, so patch it in — refetching
      // anything here meant every location ping from every rider re-downloaded
      // the whole rider-order history.
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rider_locations' }, (payload) => {
        const row = payload.new
        if (payload.eventType === 'DELETE' || !row?.rider_id) {
          loadLocs().then(({ data, error }) => { if (!error) setLocs(data ?? []) })
          return
        }
        setLocs((prev) => {
          const i = prev.findIndex((l) => l.rider_id === row.rider_id)
          if (i === -1) return [...prev, row]
          const next = prev.slice()
          next[i] = { ...next[i], ...row }
          return next
        })
      })
      // Scoped to riders: unscoped, every customer profile change on the whole
      // app refetched this page.
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'profiles', filter: 'role=eq.rider' },
        () => { loadRoster().then((res) => { if (!res.error) setRoster(res.data ?? []) }) }
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [load, loadOrders, loadLocs, loadRoster])

  // Create a rider login. Uses an isolated client so signUp() doesn't replace
  // the admin's session; the handle_new_user trigger turns the auth user into a
  // profiles row with role='rider' from the metadata below.
  const addRider = async (e) => {
    e.preventDefault()
    const name = form.name.trim()
    const email = form.email.trim()
    const phone = form.phone.trim()
    const password = form.password
    if (!name || !email || password.length < 6) {
      alert('Enter a name, email, and a password of at least 6 characters.')
      return
    }
    // Vehicle + KYC details persisted onto the new rider's profile row.
    const details = detailsFromForm(form, schema)

    setSaving(true)
    const client = createIsolatedClient()
    const { data, error } = await client.auth.signUp({
      email,
      password,
      options: { data: { role: 'rider', full_name: name, phone, ...details } },
    })
    if (error) {
      setSaving(false)
      alert(`Could not add rider: ${error.message}`)
      return
    }

    // Write the vehicle/KYC details onto the profile row. The signup client is
    // now authenticated as the new rider, so "update own profile" RLS covers it;
    // fall back to the admin client (and a short retry, in case the trigger
    // hasn't inserted the row yet). Non-fatal — the login is already created.
    const newId = data?.user?.id
    if (newId) {
      // The Aadhaar photo can only be filed under the rider's id, which we only
      // learn now — so it uploads after signUp and rides along with the details.
      if (aadhaarFile && schema === 'full') {
        try {
          details.aadhar_image_path = await uploadAadhaar(newId, aadhaarFile)
        } catch (err) {
          console.error('Aadhaar upload failed:', err.message)
          alert(`The rider was created, but the Aadhaar photo did not upload: ${err.message}\nYou can add it later with Edit.`)
        }
      }
      const writeDetails = async () => {
        let res = await client.from('profiles').update(details).eq('id', newId)
        if (res.error || res.count === 0) {
          res = await supabase.from('profiles').update(details).eq('id', newId)
        }
        return res.error
      }
      if (await writeDetails()) {
        await new Promise((r) => setTimeout(r, 700))
        const err = await writeDetails()
        if (err) console.error('Failed to save rider details:', err.message)
      }
    }

    setSaving(false)
    setShowAdd(false)
    setForm(EMPTY_FORM)
    setAadhaarFile(null)
    // Give the trigger a beat to insert the profile row, then refresh.
    setTimeout(load, 600)
  }

  const openEdit = (rider) => {
    setEditTarget(rider)
    setEditForm(formFromProfile(rider.profile || { full_name: rider.name, phone: rider.phone }))
    setEditFile(null)
  }

  /* Save edits back onto the rider's profiles row. This is the same row the
   * rider app reads, so the change shows up in the rider's own profile screen
   * as soon as they refresh — no separate sync step. */
  const saveEdit = async (e) => {
    e.preventDefault()
    if (!editTarget || saving) return
    const name = editForm.name.trim()
    if (!name) {
      alert('A rider needs a name.')
      return
    }

    setSaving(true)
    const patch = { full_name: name, phone: editForm.phone.trim() || null }
    if (schema !== 'min') Object.assign(patch, detailsFromForm(editForm, schema))

    if (editFile && schema === 'full') {
      try {
        patch.aadhar_image_path = await uploadAadhaar(editTarget.id, editFile)
      } catch (err) {
        setSaving(false)
        alert(`Aadhaar photo upload failed: ${err.message}`)
        return
      }
    }

    // `.select()` so an RLS refusal (0 rows updated, no error) is surfaced
    // instead of looking like a silent success.
    const { data, error } = await supabase
      .from('profiles')
      .update(patch)
      .eq('id', editTarget.id)
      .select('id')
    setSaving(false)

    if (error) {
      alert(`Could not save the rider: ${error.message}`)
      return
    }
    if (!data || data.length === 0) {
      alert(
        'Nothing was saved — the database rejected the update. Run ' +
        'add-rider-aadhar-image.sql so dashboard staff are allowed to edit rider profiles.'
      )
      return
    }
    setEditTarget(null)
    setEditFile(null)
    load()
  }

  /* Bucketed by DELIVERY date, not order date — a rider earns when they hand
   * the food over. The rider app's own totals come from get_my_earnings_summary
   * (rider app migration 009), which filters on `delivered_at`; matching that
   * here is what stops an order placed 23:50 and delivered 00:15 from being
   * counted on different days by the two apps. In-flight orders have no
   * delivered_at yet, so they fall back to when they were placed. */
  const riders = buildRiders(
    ordersData.filter((o) => inRange(o.delivered_at || o.created_at, range)),
    roster,
    locs
  )
  const q = searchQuery.trim().toLowerCase()
  const visibleRiders = q
    ? riders.filter((r) => {
        const p = r.profile || {}
        return [r.name, r.phone, p.vehicle_registration_number, p.vehicle_model, p.license_number, p.aadhar_number]
          .some((v) => (v || '').toLowerCase().includes(q))
      })
    : riders

  const detailRider = riders.find((r) => r.id === detailId) || null
  // `riders` already carries the newest location per rider (kept fresh by the
  // rider_locations subscription above), so the map needs no extra query.
  const mapRider = riders.find((r) => r.id === mapRiderId) || null
  const mapRiderCoords = mapRider?.loc ? toCoords(mapRider.loc.latitude, mapRider.loc.longitude) : null
  const detailCoords = detailRider?.loc ? toCoords(detailRider.loc.latitude, detailRider.loc.longitude) : null

  // Specifically "out for delivery" (on the road), not just "has claimed
  // something" — keeps the KPI's own "Out for delivery now" sub-label
  // accurate now that r.active also counts orders still awaiting pickup.
  const onDelivery = riders.filter((r) => r.outForDelivery > 0).length
  const available = riders.filter((r) => r.active === 0 && r.locStatus === 'online').length
  const totalDeliveries = riders.reduce((s, r) => s + r.completed, 0)

  const label = rangeLabel(preset, range)
  const kpis = [
    { label: 'TOTAL RIDERS', value: String(riders.length), sub: 'All registered riders', icon: Users, iconBg: 'bg-[#ffdad3] text-brand' },
    { label: 'ON DELIVERY', value: String(onDelivery), sub: 'Out for delivery now', icon: Truck, iconBg: 'bg-info-soft text-info' },
    { label: 'AVAILABLE', value: String(available), sub: 'Online, awaiting orders', icon: Bike, iconBg: 'bg-pos-soft text-pos-dark' },
    { label: 'DELIVERIES', value: String(totalDeliveries), sub: `Completed · ${label}`, icon: CheckCircle2, iconBg: 'bg-[#fef3c7] text-[#b45309]' },
  ]

  return (
    <>
      <Topbar>
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold text-ink">Rider Management</h1>
          <span className="flex items-center gap-1.5 rounded-full bg-[#ffdad3] px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-brand">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand" /> Live
          </span>
        </div>
        <div className="flex items-center gap-2">
          <SearchBox
            placeholder="Search name, phone, vehicle…"
            className="w-full sm:w-[260px]"
            value={searchQuery}
            onChange={setSearchQuery}
          />
          <button
            type="button"
            onClick={() => { setForm(EMPTY_FORM); setAadhaarFile(null); setShowAdd(true) }}
            className="flex shrink-0 items-center gap-2 rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-dark"
          >
            <UserPlus className="h-4 w-4" /> Add Rider
          </button>
          <TopIcons />
        </div>
      </Topbar>

      <div className="space-y-6 p-4 lg:p-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-ink-soft">
            Rider performance for <span className="font-semibold text-ink">{label}</span>
          </p>
          <DateRangeFilter defaultPreset="month" onChange={(r, p) => { setRange(r); setPreset(p) }} />
        </div>

        {schema !== 'full' && !loading && (
          <div className="flex items-start gap-2 rounded-xl border border-[#fcd34d] bg-[#fffbeb] px-4 py-3 text-xs text-[#92400e]">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{SCHEMA_HINT[schema]}</span>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-6">
          {kpis.map((k) => (
            <Kpi key={k.label} {...k} />
          ))}
        </div>

        <div className="rounded-xl border border-line bg-white">
          <div className="flex items-center justify-between p-5">
            <div>
              <h2 className="text-lg font-bold text-ink">Riders</h2>
              <p className="mt-0.5 text-xs text-ink-soft">Click a rider to see their full profile &amp; KYC.</p>
            </div>
            <span className="text-sm text-ink-soft">
              {loading ? 'Loading…' : `${visibleRiders.length} rider${visibleRiders.length === 1 ? '' : 's'}`}
            </span>
          </div>

          {/* Scrolls sideways on a phone rather than squashing the columns. */}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left">
              <thead>
                <tr className="border-y border-line text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
                  <th className="px-5 py-3 font-semibold">Rider</th>
                  <th className="px-5 py-3 font-semibold">Phone</th>
                  <th className="px-5 py-3 font-semibold">Vehicle</th>
                  <th className="px-5 py-3 font-semibold">KYC</th>
                  <th className="px-5 py-3 font-semibold">Status</th>
                  <th className="px-5 py-3 font-semibold">Active</th>
                  <th className="px-5 py-3 font-semibold">Completed</th>
                  <th className="px-5 py-3 font-semibold">Location</th>
                  <th className="px-5 py-3 text-right font-semibold">Last Active</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-soft">
                {loading ? (
                  <tr>
                    <td colSpan={9} className="px-5 py-12 text-center text-sm text-ink-soft">Loading riders…</td>
                  </tr>
                ) : visibleRiders.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-5 py-12 text-center text-sm text-ink-soft">
                      {q
                        ? 'No riders match your search.'
                        : 'No riders yet — add one with the button above, or they appear here once a rider claims a ready order in the rider app.'}
                    </td>
                  </tr>
                ) : (
                  visibleRiders.map((r) => {
                    const p = r.profile || {}
                    const kycDone = !!(p.license_number && p.aadhar_number)
                    return (
                      <tr
                        key={r.id}
                        onClick={() => { setDetailId(r.id); setRevealAadhaar(false) }}
                        className="cursor-pointer hover:bg-canvas/60"
                      >
                        <td className="px-5 py-4">
                          <div className="flex items-center gap-3">
                            {/* The rider's own photo from the app (profiles.avatar_url) */}
                            {p.avatar_url ? (
                              <img
                                src={p.avatar_url}
                                alt=""
                                loading="lazy"
                                decoding="async"
                                className="h-9 w-9 shrink-0 rounded-full object-cover"
                              />
                            ) : (
                              <span className={`flex h-9 w-9 items-center justify-center rounded-full text-xs font-bold ${toneFor(r.id)}`}>
                                {initials(r.name)}
                              </span>
                            )}
                            <div>
                              <p className="text-sm font-semibold text-ink">{r.name}</p>
                              <p className="text-xs text-ink-soft">{r.completed} delivered · ₹{r.earned.toLocaleString('en-IN')}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-5 py-4">
                          {r.phone ? (
                            <a
                              href={`tel:${r.phone}`}
                              onClick={(e) => e.stopPropagation()}
                              className="flex items-center gap-1.5 text-sm text-ink hover:text-brand"
                            >
                              <Phone className="h-3.5 w-3.5 text-ink-soft" /> {r.phone}
                            </a>
                          ) : (
                            <span className="text-sm text-ink-soft">—</span>
                          )}
                        </td>
                        <td className="px-5 py-4">
                          {p.vehicle_registration_number || p.vehicle_model ? (
                            <div className="text-xs">
                              {p.vehicle_registration_number && (
                                <span className="rounded border border-line bg-canvas px-1.5 py-0.5 font-mono font-semibold text-ink">
                                  {p.vehicle_registration_number}
                                </span>
                              )}
                              <p className="mt-1 text-ink-soft">
                                {[p.vehicle_model, p.vehicle_color].filter(Boolean).join(' · ') ||
                                  normalizeVehicleType(p.vehicle_type) || '—'}
                              </p>
                            </div>
                          ) : (
                            <span className="text-sm text-line-2">—</span>
                          )}
                        </td>
                        <td className="px-5 py-4">
                          {kycDone ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-pos-soft px-2 py-0.5 text-[11px] font-semibold text-pos-dark">
                              <ShieldCheck className="h-3 w-3" /> Verified
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-full bg-[#fef3c7] px-2 py-0.5 text-[11px] font-semibold text-[#b45309]">
                              <ShieldAlert className="h-3 w-3" /> Incomplete
                            </span>
                          )}
                        </td>
                        <td className="px-5 py-4">
                          <StatusBadge onDelivery={r.active > 0} locStatus={r.locStatus} />
                        </td>
                        <td className="px-5 py-4 text-sm font-semibold text-ink">{r.active}</td>
                        <td className="px-5 py-4 text-sm font-semibold text-ink">{r.completed}</td>
                        <td className="px-5 py-4">
                          {r.loc ? (
                            // With a Maps key the pin opens the map in-dashboard;
                            // without one it falls back to the Google Maps link.
                            hasMapsKey() ? (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setMapRiderId(r.id)
                                }}
                                className="inline-flex items-center gap-1 text-sm font-semibold text-info hover:underline"
                              >
                                <MapPin className="h-3.5 w-3.5" /> Live pin
                              </button>
                            ) : (
                              <a
                                href={gmapsLink(r.loc.latitude, r.loc.longitude)}
                                target="_blank"
                                rel="noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className="inline-flex items-center gap-1 text-sm font-semibold text-info hover:underline"
                              >
                                <MapPin className="h-3.5 w-3.5" /> Live pin <ExternalLink className="h-3 w-3" />
                              </a>
                            )
                          ) : (
                            <span className="text-sm text-ink-soft">—</span>
                          )}
                        </td>
                        <td className="px-5 py-4 text-right text-sm font-semibold text-ink-soft">{ago(r.lastAt)}</td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Rider detail panel — everything stored on the rider's profile row */}
      {detailRider && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={() => setDetailId(null)}>
          <div
            className="flex h-full w-full max-w-lg flex-col bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 border-b border-line p-5">
              <div className="flex items-center gap-3">
                {detailRider.profile?.avatar_url ? (
                  <img
                    src={detailRider.profile.avatar_url}
                    alt=""
                    className="h-12 w-12 shrink-0 rounded-full object-cover"
                  />
                ) : (
                  <span className={`flex h-12 w-12 items-center justify-center rounded-full text-sm font-bold ${toneFor(detailRider.id)}`}>
                    {initials(detailRider.name)}
                  </span>
                )}
                <div>
                  <h3 className="text-lg font-bold text-ink">{detailRider.name}</h3>
                  <div className="mt-1">
                    <StatusBadge onDelivery={detailRider.active > 0} locStatus={detailRider.locStatus} />
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => openEdit(detailRider)}
                  className="flex items-center gap-1.5 rounded-lg bg-brand px-3 py-2 text-xs font-bold text-white hover:bg-brand-dark"
                >
                  <Pencil className="h-3.5 w-3.5" /> Edit
                </button>
                <button
                  type="button"
                  onClick={() => setDetailId(null)}
                  className="rounded p-1.5 text-ink-soft hover:bg-line-soft hover:text-ink"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="flex-1 space-y-5 overflow-y-auto p-5">
              {/* Performance */}
              <div className="grid grid-cols-2 gap-3 rounded-xl border border-line bg-canvas/40 p-4 text-center sm:grid-cols-4">
                <div>
                  <p className="text-lg font-bold text-ink">{detailRider.active}</p>
                  <p className="text-[10px] font-semibold uppercase text-ink-soft">Active</p>
                </div>
                <div>
                  <p className="text-lg font-bold text-ink">{detailRider.completed}</p>
                  <p className="text-[10px] font-semibold uppercase text-ink-soft">Delivered</p>
                </div>
                <div>
                  <p className="text-lg font-bold text-ink">₹{detailRider.earned.toLocaleString('en-IN')}</p>
                  {/* Gross pay for deliveries in this range — the same figure the
                      rider app calls "total earnings". It is NOT the app's wallet
                      balance, which nets out settled payouts and is therefore
                      smaller once a payout batch is marked paid. */}
                  <p className="text-[10px] font-semibold uppercase text-ink-soft" title="Gross delivery pay for the selected range. The rider app's wallet balance excludes amounts already paid out, so it can be lower.">Total earned</p>
                </div>
                <div>
                  <p className="text-lg font-bold text-ink">{ago(detailRider.lastAt)}</p>
                  <p className="text-[10px] font-semibold uppercase text-ink-soft">Last active</p>
                </div>
              </div>

              {/* Currently assigned orders — a rider can carry more than one
                  at once (staff can assign a second order while they're
                  already out), so this lists every one individually rather
                  than just the count above. */}
              {detailRider.assignedOrders.length > 0 && (
                <div className="space-y-2">
                  <SectionTitle icon={Truck}>
                    {detailRider.assignedOrders.length > 1
                      ? `Assigned Orders (${detailRider.assignedOrders.length})`
                      : 'Assigned Order'}
                  </SectionTitle>
                  <div className="space-y-1.5">
                    {detailRider.assignedOrders.map((o) => (
                      <div
                        key={o.id}
                        className="flex items-center justify-between rounded-lg border border-line bg-canvas/40 px-3 py-2 text-xs"
                      >
                        <span className="flex min-w-0 items-center gap-1.5">
                          <span className="font-mono font-semibold text-ink">
                            {o.orderNumber || `#${o.id.slice(0, 8).toUpperCase()}`}
                          </span>
                          <OutletTag restaurantId={o.restaurantId} />
                        </span>
                        <span className="flex items-center gap-2 text-ink-soft">
                          ₹{o.total}
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                              o.status === 'out_for_delivery'
                                ? 'bg-info-soft text-info'
                                : 'bg-amber-100 text-amber-700'
                            }`}
                          >
                            {o.status.replace(/_/g, ' ')}
                          </span>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Contact */}
              <div className="space-y-3">
                <SectionTitle icon={Phone}>Contact</SectionTitle>
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Phone" value={detailRider.phone} />
                  <Field
                    label="Emergency contact"
                    value={
                      detailRider.profile?.emergency_contact_phone
                        ? [
                            detailRider.profile.emergency_contact_name,
                            detailRider.profile.emergency_contact_phone,
                          ]
                            .filter(Boolean)
                            .join(' · ') +
                          (detailRider.profile.alternate_contact_relation
                            ? ` (${detailRider.profile.alternate_contact_relation})`
                            : '')
                        : null
                    }
                  />
                </div>
                <Field label="Home address" value={detailRider.profile?.address} />
                {detailCoords && (
                  <div className="space-y-2 rounded-xl border border-line bg-canvas/40 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-ink-soft">
                        <MapPin className="h-3.5 w-3.5" /> Live location
                      </p>
                      <span className="text-[11px] font-semibold text-ink-soft">
                        {ago(detailRider.loc.updated_at)}
                      </span>
                    </div>
                    {hasMapsKey() && (
                      <LiveMap
                        rider={detailCoords}
                        className="h-44 w-full overflow-hidden rounded-lg"
                        showRoute={false}
                      />
                    )}
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-[11px] text-ink-soft">
                        {detailCoords.lat.toFixed(5)}, {detailCoords.lng.toFixed(5)}
                      </span>
                      <a
                        href={gmapsLink(detailCoords.lat, detailCoords.lng)}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-xs font-semibold text-info hover:underline"
                      >
                        Open in Google Maps <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                  </div>
                )}
              </div>

              {/* Vehicle */}
              <div className="space-y-3 border-t border-line-soft pt-4">
                <SectionTitle icon={Bike}>Vehicle</SectionTitle>
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Type" value={normalizeVehicleType(detailRider.profile?.vehicle_type)} />
                  <Field label="Registration" value={detailRider.profile?.vehicle_registration_number} mono />
                  <Field label="Model" value={detailRider.profile?.vehicle_model} />
                  <Field label="Colour" value={detailRider.profile?.vehicle_color} />
                </div>
                <div>
                  {detailRider.profile?.insurance_active ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-pos-soft px-2.5 py-1 text-xs font-semibold text-pos-dark">
                      <ShieldCheck className="h-3.5 w-3.5" /> Insurance active
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-[#fef3c7] px-2.5 py-1 text-xs font-semibold text-[#b45309]">
                      <ShieldAlert className="h-3.5 w-3.5" /> Insurance not confirmed
                    </span>
                  )}
                </div>
              </div>

              {/* Identity / KYC */}
              <div className="space-y-3 border-t border-line-soft pt-4">
                <div className="flex items-center justify-between">
                  <SectionTitle icon={IdCard}>Identity &amp; KYC</SectionTitle>
                  {detailRider.profile?.aadhar_number && (
                    <button
                      type="button"
                      onClick={() => setRevealAadhaar((v) => !v)}
                      className="flex items-center gap-1 text-[11px] font-semibold text-ink-soft hover:text-ink"
                    >
                      {revealAadhaar ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                      {revealAadhaar ? 'Hide' : 'Show'} Aadhaar
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Driving licence" value={detailRider.profile?.license_number} mono />
                  <Field
                    label="Aadhaar number"
                    value={
                      detailRider.profile?.aadhar_number
                        ? revealAadhaar
                          ? groupAadhaar(detailRider.profile.aadhar_number)
                          : maskAadhaar(detailRider.profile.aadhar_number)
                        : null
                    }
                    mono
                  />
                </div>
                <div>
                  <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-ink-soft">
                    Aadhaar card photo
                  </p>
                  {detailRider.profile?.aadhar_image_path ? (
                    <AadhaarImage key={detailRider.profile.aadhar_image_path} path={detailRider.profile.aadhar_image_path} />
                  ) : (
                    <div className="flex items-center gap-2 rounded-lg border border-dashed border-line px-3 py-3 text-xs text-ink-soft">
                      <FileImage className="h-4 w-4" />
                      Not uploaded yet — use Edit to add it.
                    </div>
                  )}
                </div>
              </div>

              <p className="rounded-lg border border-line bg-canvas/50 px-3 py-2 text-[11px] text-ink-soft">
                These details are stored on the rider&apos;s account, so the rider app&apos;s Profile
                screen shows exactly what you see here. Editing them updates both.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Edit Rider dialog */}
      {editTarget && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
          <form onSubmit={saveEdit} className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-2xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-line p-5">
              <div className="flex items-center gap-2">
                <span className="rounded-lg bg-brand-light p-2 text-brand">
                  <Pencil className="h-5 w-5" />
                </span>
                <div>
                  <h3 className="text-base font-bold text-ink">Edit rider</h3>
                  <p className="text-xs text-ink-soft">Updates the rider&apos;s profile in the delivery app too.</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setEditTarget(null)}
                className="rounded p-1 text-ink-soft hover:bg-line-soft hover:text-ink"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 space-y-5 overflow-y-auto p-5">
              <div className="space-y-4">
                <div>
                  <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-ink-soft">
                    Full name
                  </label>
                  <input
                    autoFocus
                    value={editForm.name}
                    onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                    className="w-full rounded-lg border border-line px-3 py-2 text-sm text-ink focus:border-brand focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-ink-soft">
                    Phone
                  </label>
                  <input
                    value={editForm.phone}
                    onChange={(e) => setEditForm((f) => ({ ...f, phone: e.target.value }))}
                    placeholder="e.g. 98765 43210"
                    className="w-full rounded-lg border border-line px-3 py-2 text-sm text-ink focus:border-brand focus:outline-none"
                  />
                  <p className="mt-1 text-[11px] text-ink-soft">
                    The login email and password can&apos;t be changed from here — the rider can reset
                    their password from the delivery app&apos;s login screen.
                  </p>
                </div>
              </div>

              <RiderDetailFields
                form={editForm}
                setForm={setEditForm}
                aadhaarFile={editFile}
                setAadhaarFile={setEditFile}
                existingPath={editTarget.profile?.aadhar_image_path}
                schema={schema}
              />
            </div>

            <div className="flex items-center justify-end gap-3 border-t border-line p-5">
              <button
                type="button"
                onClick={() => setEditTarget(null)}
                className="rounded-lg border border-line px-4 py-2.5 text-xs font-semibold text-ink-soft hover:bg-canvas"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="flex items-center gap-1.5 rounded-lg bg-brand px-5 py-2.5 text-xs font-bold text-white hover:bg-brand-dark disabled:opacity-50"
              >
                <CheckCircle2 className="h-4 w-4" /> {saving ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Add Rider dialog */}
      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <form onSubmit={addRider} className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-2xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-line p-5">
              <div className="flex items-center gap-2">
                <span className="rounded-lg bg-brand-light p-2 text-brand">
                  <Bike className="h-5 w-5" />
                </span>
                <div>
                  <h3 className="text-base font-bold text-ink">Add New Rider</h3>
                  <p className="text-xs text-ink-soft">Creates a rider login for the delivery app.</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowAdd(false)}
                className="rounded p-1 text-ink-soft hover:bg-line-soft hover:text-ink"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 space-y-5 overflow-y-auto p-5">
              {/* Account / login */}
              <div className="space-y-4">
                <div>
                  <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-ink-soft">
                    Full name
                  </label>
                  <input
                    autoFocus
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    placeholder="e.g. Ramesh Kumar"
                    className="w-full rounded-lg border border-line px-3 py-2 text-sm text-ink focus:border-brand focus:outline-none"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-ink-soft">
                      Phone
                    </label>
                    <input
                      value={form.phone}
                      onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                      placeholder="e.g. 98765 43210"
                      className="w-full rounded-lg border border-line px-3 py-2 text-sm text-ink focus:border-brand focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-ink-soft">
                      Login email
                    </label>
                    <input
                      type="email"
                      value={form.email}
                      onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                      placeholder="rider@example.com"
                      className="w-full rounded-lg border border-line px-3 py-2 text-sm text-ink focus:border-brand focus:outline-none"
                    />
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-ink-soft">
                    Temporary password
                  </label>
                  <input
                    type="text"
                    value={form.password}
                    onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                    placeholder="At least 6 characters"
                    className="w-full rounded-lg border border-line px-3 py-2 text-sm text-ink focus:border-brand focus:outline-none"
                  />
                  <p className="mt-1 text-[11px] text-ink-soft">Share these credentials with the rider so they can log in to the delivery app.</p>
                </div>
              </div>

              <RiderDetailFields
                form={form}
                setForm={setForm}
                aadhaarFile={aadhaarFile}
                setAadhaarFile={setAadhaarFile}
                existingPath={null}
                schema={schema}
              />
            </div>

            <div className="flex items-center justify-end gap-3 border-t border-line p-5">
              <button
                type="button"
                onClick={() => setShowAdd(false)}
                className="rounded-lg border border-line px-4 py-2.5 text-xs font-semibold text-ink-soft hover:bg-canvas"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="flex items-center gap-1.5 rounded-lg bg-brand px-5 py-2.5 text-xs font-bold text-white hover:bg-brand-dark disabled:opacity-50"
              >
                <UserPlus className="h-4 w-4" /> {saving ? 'Adding…' : 'Add Rider'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Live rider position — opened from the "Live pin" column */}
      {mapRider && (
        <MapModal
          title={`${mapRider.name} — live location`}
          subtitle={
            mapRider.loc
              ? `Last GPS ping ${ago(mapRider.loc.updated_at)}${mapRider.active > 0 ? ` · ${mapRider.active} active ${mapRider.active === 1 ? 'delivery' : 'deliveries'}` : ''}`
              : 'No GPS position reported yet'
          }
          riderName={mapRider.name}
          rider={mapRiderCoords}
          riderUpdatedAt={mapRider.loc?.updated_at ?? null}
          onClose={() => setMapRiderId(null)}
        />
      )}
    </>
  )
}
