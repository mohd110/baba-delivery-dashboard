import { useCallback, useEffect, useState } from 'react'
import {
  Store,
  DoorOpen,
  DoorClosed,
  Bike,
  Phone,
  MapPin,
  Clock,
  Wallet,
  ExternalLink,
  UtensilsCrossed,
  Plus,
  Pencil,
  X,
  Loader2,
  EyeOff,
  AlertTriangle,
} from 'lucide-react'
import Topbar, { SearchBox, TopIcons } from '../layout/Topbar.jsx'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../lib/AuthContext.jsx'

function initials(name = '') {
  const parts = name.split(' ').filter(Boolean).slice(0, 2)
  return parts.map((w) => w[0]).join('').toUpperCase() || 'O'
}

const TONES = [
  'bg-[#ffdad3] text-brand',
  'bg-info-soft text-info',
  'bg-pos-soft text-pos-dark',
  'bg-[#fef3c7] text-[#b45309]',
]
function toneFor(id = '') {
  let sum = 0
  for (const ch of id) sum += ch.charCodeAt(0)
  return TONES[sum % TONES.length]
}

// "10:00:00" -> "10:00 AM"
function fmtTime(t) {
  if (!t) return '—'
  const [hStr, m] = t.split(':')
  let h = Number(hStr)
  const ampm = h >= 12 ? 'PM' : 'AM'
  h = h % 12 || 12
  return `${h}:${m} ${ampm}`
}

function StatusBadge({ open }) {
  return open ? (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-pos-soft px-3 py-1 text-xs font-semibold text-pos-dark">
      <span className="h-1.5 w-1.5 rounded-full bg-pos" /> Open
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-line-soft px-3 py-1 text-xs font-semibold text-ink-soft">
      <span className="h-1.5 w-1.5 rounded-full bg-ink-soft" /> Closed
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

function DetailRow({ icon: Icon, children }) {
  return (
    <div className="flex items-start gap-2 text-sm text-ink">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-ink-soft" />
      <span className="min-w-0 break-words">{children}</span>
    </div>
  )
}

/* ── Add / edit an outlet ─────────────────────────────────────────────────
 * Writes to `public.restaurants` — the same rows the customer app reads — so a
 * saved outlet shows up in the customer's picker straight away, with no other
 * wiring. Needs the customer app's 022_multi_outlet.sql (the columns) and
 * add-outlet-staff.sql (which narrows INSERT to the owner). */
const EMPTY_OUTLET = {
  name: 'Wali Baba Foods',
  area_name: '',
  address: '',
  phone: '',
  upi_id: '',
  latitude: '',
  longitude: '',
  opening_time: '10:00',
  closing_time: '23:00',
  delivery_fee: '30',
  min_order_value: '100',
  delivery_radius_km: '12',
  sort_order: '0',
  is_active: true,
}

const toTime = (t) => (t ? `${String(t).slice(0, 5)}:00` : null)
const num = (v) => (v === '' || v == null ? null : Number(v))

function formFromOutlet(o) {
  return {
    name: o.name || 'Wali Baba Foods',
    area_name: o.area_name || '',
    address: o.address || '',
    phone: o.phone || '',
    upi_id: o.upi_id || '',
    latitude: o.latitude ?? '',
    longitude: o.longitude ?? '',
    opening_time: (o.opening_time || '10:00:00').slice(0, 5),
    closing_time: (o.closing_time || '23:00:00').slice(0, 5),
    delivery_fee: String(o.delivery_fee ?? 30),
    min_order_value: String(o.min_order_value ?? 100),
    delivery_radius_km: String(o.delivery_radius_km ?? 12),
    sort_order: String(o.sort_order ?? 0),
    is_active: o.is_active !== false,
  }
}

// Straight-line km between two pins — only used to sanity-check a new one.
function kmBetween(a, b) {
  const R = 6371
  const toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

function OutletField({ label, hint, className = '', ...props }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-ink-soft">{label}</span>
      <input
        {...props}
        className="w-full rounded-lg border border-line px-3 py-2 text-sm text-ink focus:border-brand focus:outline-none"
      />
      {hint && <span className="mt-1 block text-[11px] text-ink-soft">{hint}</span>}
    </label>
  )
}

function OutletForm({ target, others, onClose, onSaved }) {
  const [form, setForm] = useState(() => (target ? formFromOutlet(target) : EMPTY_OUTLET))
  const [saving, setSaving] = useState(false)
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const lat = num(form.latitude)
  const lng = num(form.longitude)
  const hasPin = lat != null && lng != null && !Number.isNaN(lat) && !Number.isNaN(lng)

  // A mistyped coordinate is the one mistake here that silently misprices every
  // order from this branch, so flag a pin that's nowhere near the others.
  const farFrom = hasPin
    ? others
        .filter((o) => o.latitude != null && o.longitude != null)
        .map((o) => kmBetween({ lat, lng }, { lat: Number(o.latitude), lng: Number(o.longitude) }))
        .sort((a, b) => a - b)[0] ?? null
    : null
  const suspiciousPin = farFrom != null && farFrom > 50

  const submit = async (e) => {
    e.preventDefault()
    if (!form.area_name.trim()) {
      alert('Give the outlet a name customers will recognise, e.g. "Swaroop Nagar".')
      return
    }
    if (!form.name.trim()) { alert('The business name is required.'); return }
    if (!hasPin) {
      alert('This outlet needs its map coordinates — every delivery fee and distance is calculated from them.')
      return
    }
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      alert('Those coordinates are out of range. Latitude is -90…90, longitude -180…180.')
      return
    }
    if (
      suspiciousPin &&
      !confirm(
        `This pin is about ${Math.round(farFrom)} km from your nearest other outlet. ` +
        'That usually means the latitude and longitude are swapped or mistyped.\n\nSave it anyway?'
      )
    ) return

    const row = {
      name: form.name.trim(),
      area_name: form.area_name.trim(),
      address: form.address.trim() || null,
      phone: form.phone.trim() || null,
      upi_id: form.upi_id.trim() || null,
      latitude: lat,
      longitude: lng,
      opening_time: toTime(form.opening_time),
      closing_time: toTime(form.closing_time),
      delivery_fee: num(form.delivery_fee) ?? 0,
      min_order_value: num(form.min_order_value) ?? 0,
      delivery_radius_km: num(form.delivery_radius_km) ?? 25,
      sort_order: num(form.sort_order) ?? 0,
      is_active: !!form.is_active,
    }

    setSaving(true)
    const res = target
      ? await supabase.from('restaurants').update(row).eq('id', target.id).select('id')
      : await supabase.from('restaurants').insert({ ...row, is_open: true }).select('id')
    setSaving(false)

    if (res.error) {
      alert(
        `Could not save the outlet: ${res.error.message}\n\n` +
        "If it mentions a missing column, the customer app's 022_multi_outlet.sql " +
        'has not been run yet. If it mentions row-level security, run ' +
        'add-outlet-staff.sql — only the owner may add outlets.'
      )
      return
    }
    if (!res.data || res.data.length === 0) {
      alert('Nothing was saved — the database rejected it. Run add-outlet-staff.sql, then try again as the owner.')
      return
    }
    onSaved()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <form
        onSubmit={submit}
        className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-line p-5">
          <div className="flex items-center gap-3">
            <span className="rounded-lg bg-brand-light p-2 text-brand"><Store className="h-5 w-5" /></span>
            <div>
              <h3 className="text-base font-bold text-ink">{target ? 'Edit outlet' : 'Add an outlet'}</h3>
              <p className="text-xs text-ink-soft">
                Saved outlets appear in the customer app's picker immediately.
              </p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="rounded p-1 text-ink-soft hover:bg-line-soft hover:text-ink">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <OutletField
              label="Outlet name"
              hint="What customers see. Keep it to the locality."
              value={form.area_name}
              onChange={set('area_name')}
              placeholder="Swaroop Nagar"
              required
            />
            <OutletField
              label="Business name"
              hint="Same on every outlet."
              value={form.name}
              onChange={set('name')}
              required
            />
          </div>

          <OutletField
            label="Address"
            value={form.address}
            onChange={set('address')}
            placeholder="123 Some Road, Swaroop Nagar, Kanpur 208002"
          />

          <div className="rounded-lg border border-line bg-canvas/40 p-4">
            <p className="text-xs font-bold uppercase tracking-wide text-ink-soft">Location</p>
            <p className="mt-1 text-[11px] text-ink-soft">
              In Google Maps, right-click the outlet's exact spot and click the numbers at the top of
              the menu — that copies <code className="font-mono">26.4499, 80.3319</code>. Latitude
              first. Every delivery fee and distance is calculated from this pin.
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <OutletField label="Latitude" value={form.latitude} onChange={set('latitude')} placeholder="26.4499" inputMode="decimal" required />
              <OutletField label="Longitude" value={form.longitude} onChange={set('longitude')} placeholder="80.3319" inputMode="decimal" required />
            </div>
            {hasPin && (
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${lat},${lng}`}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-info hover:underline"
              >
                <MapPin className="h-3.5 w-3.5" /> Check this pin on Google Maps <ExternalLink className="h-3 w-3" />
              </a>
            )}
            {suspiciousPin && (
              <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-amber-50 p-2 text-[11px] font-semibold text-amber-800">
                <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
                This pin is ~{Math.round(farFrom)} km from your nearest other outlet — check the
                latitude and longitude aren't swapped.
              </p>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <OutletField label="Opens at" type="time" value={form.opening_time} onChange={set('opening_time')} />
            <OutletField label="Closes at" type="time" value={form.closing_time} onChange={set('closing_time')} />
            <OutletField label="Phone" value={form.phone} onChange={set('phone')} placeholder="9876543210" />
            <OutletField
              label="UPI ID"
              hint="Customers paying by UPI pay this outlet directly."
              value={form.upi_id}
              onChange={set('upi_id')}
              placeholder="walibaba@upi"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <OutletField
              label="Delivery radius (km)"
              hint={`Delivers within ${form.delivery_radius_km || '—'} km.`}
              value={form.delivery_radius_km}
              onChange={set('delivery_radius_km')}
              inputMode="decimal"
            />
            <OutletField
              label="Fallback fee (₹)"
              hint="Only used if the pin is missing."
              value={form.delivery_fee}
              onChange={set('delivery_fee')}
              inputMode="numeric"
            />
            <OutletField label="Min. order (₹)" value={form.min_order_value} onChange={set('min_order_value')} inputMode="numeric" />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <OutletField
              label="Position in the picker"
              hint="Lower shows first."
              value={form.sort_order}
              onChange={set('sort_order')}
              inputMode="numeric"
            />
            <label className="flex items-start gap-3 rounded-lg border border-line p-3">
              <input
                type="checkbox"
                checked={form.is_active}
                onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))}
                className="mt-0.5 h-4 w-4 accent-[#c1350f]"
              />
              <span>
                <span className="block text-sm font-semibold text-ink">Visible to customers</span>
                <span className="block text-[11px] text-ink-soft">
                  Untick to retire an outlet. Never delete one — its orders would lose the branch
                  that cooked them.
                </span>
              </span>
            </label>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-line p-5">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-lg border border-line px-4 py-2.5 text-xs font-semibold text-ink-soft hover:bg-canvas disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="flex items-center gap-2 rounded-lg bg-brand px-5 py-2.5 text-xs font-bold text-white hover:bg-brand-dark disabled:opacity-50"
          >
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {saving ? 'Saving…' : target ? 'Save changes' : 'Add outlet'}
          </button>
        </div>
      </form>
    </div>
  )
}

function OutletCard({ o, onEdit }) {
  return (
    <div className={`flex flex-col rounded-xl border border-line bg-white p-5 ${o.is_active === false ? 'opacity-60' : ''}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          {o.logo_url ? (
            <img src={o.logo_url} alt={o.name} className="h-11 w-11 rounded-xl bg-line-2 object-cover" loading="lazy" decoding="async" />
          ) : (
            <span className={`flex h-11 w-11 items-center justify-center rounded-xl text-sm font-bold ${toneFor(o.id)}`}>
              {initials(o.name)}
            </span>
          )}
          <div>
            {/* The area is what the customer picks between; the business name
                is the same on every outlet, so it's the subtitle. */}
            <p className="text-sm font-bold text-ink">{(o.area_name || '').trim() || o.name}</p>
            <p className="flex items-center gap-1 text-xs text-ink-soft">
              <UtensilsCrossed className="h-3 w-3" /> {o.area_name ? o.name : o.cuisine_type || 'Outlet'}
            </p>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <StatusBadge open={o.is_open} />
          {o.is_active === false && (
            <span className="inline-flex items-center gap-1 rounded-full bg-line-soft px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-ink-soft">
              <EyeOff className="h-3 w-3" /> Hidden
            </span>
          )}
        </div>
      </div>

      <div className="mt-4 space-y-2.5">
        {o.address && <DetailRow icon={MapPin}>{o.address}</DetailRow>}
        <DetailRow icon={Clock}>
          {fmtTime(o.opening_time)} – {fmtTime(o.closing_time)}
        </DetailRow>
        {o.phone && (
          <DetailRow icon={Phone}>
            <a href={`tel:${o.phone}`} className="hover:text-brand">{o.phone}</a>
          </DetailRow>
        )}
        {o.upi_id && <DetailRow icon={Wallet}>{o.upi_id}</DetailRow>}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 border-t border-line-soft pt-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">Delivery Fee</p>
          <p className="text-sm font-bold text-ink">₹{(o.delivery_fee ?? 0).toLocaleString('en-IN')}</p>
        </div>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">Min. Order</p>
          <p className="text-sm font-bold text-ink">₹{(o.min_order_value ?? 0).toLocaleString('en-IN')}</p>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between gap-3">
        {o.latitude != null && o.longitude != null ? (
          <a
            href={`https://www.google.com/maps/search/?api=1&query=${o.latitude},${o.longitude}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-sm font-semibold text-info hover:underline"
          >
            <MapPin className="h-3.5 w-3.5" /> View on map <ExternalLink className="h-3 w-3" />
          </a>
        ) : (
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700">
            <AlertTriangle className="h-3.5 w-3.5" /> No map pin — flat fee only
          </span>
        )}
        {onEdit && (
          <button
            type="button"
            onClick={() => onEdit(o)}
            className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-ink-soft hover:bg-canvas hover:text-ink"
          >
            <Pencil className="h-3.5 w-3.5" /> Edit
          </button>
        )}
      </div>
    </div>
  )
}

export default function Outlets() {
  const [outlets, setOutlets] = useState([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  // Only the owner may add or change an outlet — the database enforces the
  // same (add-outlet-staff.sql narrows the INSERT policy to admins).
  const { isAdmin } = useAuth()
  const [formTarget, setFormTarget] = useState(null) // outlet row, or 'new'

  const load = useCallback(() => {
    return supabase
      .from('restaurants')
      .select('*')
      // Same order the customer's picker uses. Falls back to name-only on a
      // database that hasn't had 022_multi_outlet.sql run yet.
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true })
      .then(async ({ data, error }) => {
        if (error) {
          // sort_order arrives with 022_multi_outlet.sql — without it, sort by
          // name alone rather than blanking the page.
          const retry = await supabase.from('restaurants').select('*').order('name', { ascending: true })
          if (retry.error) console.error('Failed to load outlets:', retry.error.message)
          data = retry.data
        }
        setOutlets(data ?? [])
        setLoading(false)
      })
  }, [])

  useEffect(() => {
    load()
    const channel = supabase
      .channel('outlets-page')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'restaurants' }, () => load())
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [load])

  const q = searchQuery.trim().toLowerCase()
  const visibleOutlets = q
    ? outlets.filter((o) =>
        [o.area_name, o.name, o.cuisine_type, o.address].some((v) => (v || '').toLowerCase().includes(q))
      )
    : outlets

  const open = outlets.filter((o) => o.is_open).length
  const closed = outlets.length - open
  const avgFee = outlets.length
    ? Math.round(outlets.reduce((s, o) => s + (o.delivery_fee || 0), 0) / outlets.length)
    : 0

  const kpis = [
    { label: 'TOTAL OUTLETS', value: String(outlets.length), sub: 'All branches', icon: Store, iconBg: 'bg-[#ffdad3] text-brand' },
    { label: 'OPEN NOW', value: String(open), sub: 'Accepting orders', icon: DoorOpen, iconBg: 'bg-pos-soft text-pos-dark' },
    { label: 'CLOSED', value: String(closed), sub: 'Not taking orders', icon: DoorClosed, iconBg: 'bg-line-soft text-ink-soft' },
    { label: 'AVG. DELIVERY FEE', value: `₹${avgFee}`, sub: 'Across outlets', icon: Bike, iconBg: 'bg-info-soft text-info' },
  ]

  return (
    <>
      <Topbar>
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold text-ink">Outlet Management</h1>
          <span className="flex items-center gap-1.5 rounded-full bg-[#ffdad3] px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-brand">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand" /> Live
          </span>
        </div>
        <div className="flex items-center gap-2">
          <SearchBox
            placeholder="Search outlets..."
            className="w-[260px]"
            value={searchQuery}
            onChange={setSearchQuery}
          />
          {isAdmin && (
            <button
              type="button"
              onClick={() => setFormTarget('new')}
              className="flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-bold text-white hover:bg-brand-dark"
            >
              <Plus className="h-4 w-4" /> Add Outlet
            </button>
          )}
          <TopIcons />
        </div>
      </Topbar>

      <div className="space-y-6 p-8">
        <div className="grid grid-cols-4 gap-6">
          {kpis.map((k) => (
            <Kpi key={k.label} {...k} />
          ))}
        </div>

        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-ink">Outlets</h2>
          <span className="text-sm text-ink-soft">
            {loading ? 'Loading…' : `${visibleOutlets.length} outlet${visibleOutlets.length === 1 ? '' : 's'}`}
          </span>
        </div>

        {loading ? (
          <div className="rounded-xl border border-line bg-white px-5 py-12 text-center text-sm text-ink-soft">
            Loading outlets…
          </div>
        ) : visibleOutlets.length === 0 ? (
          <div className="rounded-xl border border-line bg-white px-5 py-12 text-center text-sm text-ink-soft">
            {q ? 'No outlets match your search.' : 'No outlets yet — they appear here once a restaurant is added.'}
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-6">
            {visibleOutlets.map((o) => (
              <OutletCard key={o.id} o={o} onEdit={isAdmin ? setFormTarget : null} />
            ))}
          </div>
        )}
      </div>

      {formTarget && (
        <OutletForm
          target={formTarget === 'new' ? null : formTarget}
          others={outlets.filter((o) => o.id !== formTarget?.id)}
          onClose={() => setFormTarget(null)}
          onSaved={() => {
            setFormTarget(null)
            load()
          }}
        />
      )}
    </>
  )
}
