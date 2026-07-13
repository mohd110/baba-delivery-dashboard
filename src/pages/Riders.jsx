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
} from 'lucide-react'
import Topbar, { SearchBox, TopIcons } from '../layout/Topbar.jsx'
import { supabase, createIsolatedClient } from '../lib/supabase.js'
import DateRangeFilter from '../components/DateRangeFilter.jsx'
import { inRange, rangeLabel } from '../lib/dateRange.js'

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

// Aggregate the rider roster from orders (already filtered to a date range) +
// the full profile roster + latest live locations.
function buildRiders(orders, roster, locs) {
  const map = new Map()
  const upsert = (id, name, phone) => {
    if (!id) return null
    if (!map.has(id)) {
      map.set(id, { id, name: name || 'Rider', phone: phone || null, active: 0, completed: 0, total: 0, earned: 0, lastAt: null, loc: null, locStatus: null })
    }
    const r = map.get(id)
    if (name && r.name === 'Rider') r.name = name
    if (phone && !r.phone) r.phone = phone
    return r
  }

  // Seed with the full roster first so idle riders still show up.
  ;(roster ?? []).forEach((p) => upsert(p.id, p.full_name, p.phone))

  ;(orders ?? []).forEach((o) => {
    const r = upsert(o.rider_id || o.rider?.id, o.rider?.full_name, o.rider?.phone)
    if (!r) return
    r.total += 1
    if (o.status === 'delivered') {
      r.completed += 1
      r.earned += o.rider_payment || 0
    } else if (o.status === 'out_for_delivery') {
      r.active += 1
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
  const [form, setForm] = useState({ name: '', phone: '', email: '', password: '' })

  const load = useCallback(() => {
    // Orders with a rider assigned are always readable by the restaurant via the
    // FK-hinted join. The roster + live locations may be RLS-restricted, so we
    // tolerate empty/failed results and fall back to what the orders give us.
    return Promise.all([
      supabase
        .from('orders')
        .select('id, status, total, rider_payment, created_at, rider_id, rider:profiles!orders_rider_id_fkey(id, full_name, phone)')
        .not('rider_id', 'is', null)
        .order('created_at', { ascending: false }),
      supabase.from('profiles').select('id, full_name, phone').eq('role', 'rider'),
      supabase.from('rider_locations').select('rider_id, latitude, longitude, status, updated_at'),
    ]).then(([ordersRes, rosterRes, locRes]) => {
      if (ordersRes.error) console.error('Failed to load rider orders:', ordersRes.error.message)
      setOrdersData(ordersRes.data ?? [])
      setRoster(rosterRes.data ?? [])
      setLocs(locRes.data ?? [])
      setLoading(false)
    })
  }, [])

  useEffect(() => {
    load()
    const channel = supabase
      .channel('riders-page')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rider_locations' }, () => load())
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [load])

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
    setSaving(true)
    const client = createIsolatedClient()
    const { error } = await client.auth.signUp({
      email,
      password,
      options: { data: { role: 'rider', full_name: name, phone } },
    })
    setSaving(false)
    if (error) {
      alert(`Could not add rider: ${error.message}`)
      return
    }
    setShowAdd(false)
    setForm({ name: '', phone: '', email: '', password: '' })
    // Give the trigger a beat to insert the profile row, then refresh.
    setTimeout(load, 600)
  }

  const riders = buildRiders(ordersData.filter((o) => inRange(o.created_at, range)), roster, locs)
  const q = searchQuery.trim().toLowerCase()
  const visibleRiders = q
    ? riders.filter((r) => r.name.toLowerCase().includes(q) || (r.phone || '').toLowerCase().includes(q))
    : riders

  const onDelivery = riders.filter((r) => r.active > 0).length
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
            placeholder="Search riders..."
            className="w-[260px]"
            value={searchQuery}
            onChange={setSearchQuery}
          />
          <button
            type="button"
            onClick={() => setShowAdd(true)}
            className="flex shrink-0 items-center gap-2 rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-dark"
          >
            <UserPlus className="h-4 w-4" /> Add Rider
          </button>
          <TopIcons />
        </div>
      </Topbar>

      <div className="space-y-6 p-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-ink-soft">
            Rider performance for <span className="font-semibold text-ink">{label}</span>
          </p>
          <DateRangeFilter defaultPreset="month" onChange={(r, p) => { setRange(r); setPreset(p) }} />
        </div>

        <div className="grid grid-cols-4 gap-6">
          {kpis.map((k) => (
            <Kpi key={k.label} {...k} />
          ))}
        </div>

        <div className="rounded-xl border border-line bg-white">
          <div className="flex items-center justify-between p-5">
            <h2 className="text-lg font-bold text-ink">Riders</h2>
            <span className="text-sm text-ink-soft">
              {loading ? 'Loading…' : `${visibleRiders.length} rider${visibleRiders.length === 1 ? '' : 's'}`}
            </span>
          </div>

          <table className="w-full text-left">
            <thead>
              <tr className="border-y border-line text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
                <th className="px-5 py-3 font-semibold">Rider</th>
                <th className="px-5 py-3 font-semibold">Phone</th>
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
                  <td colSpan={7} className="px-5 py-12 text-center text-sm text-ink-soft">Loading riders…</td>
                </tr>
              ) : visibleRiders.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-12 text-center text-sm text-ink-soft">
                    {q
                      ? 'No riders match your search.'
                      : 'No riders yet — they appear here once a rider claims a ready order in the rider app.'}
                  </td>
                </tr>
              ) : (
                visibleRiders.map((r) => (
                  <tr key={r.id}>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        <span className={`flex h-9 w-9 items-center justify-center rounded-full text-xs font-bold ${toneFor(r.id)}`}>
                          {initials(r.name)}
                        </span>
                        <div>
                          <p className="text-sm font-semibold text-ink">{r.name}</p>
                          <p className="text-xs text-ink-soft">{r.completed} delivered · ₹{r.earned.toLocaleString('en-IN')}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      {r.phone ? (
                        <a href={`tel:${r.phone}`} className="flex items-center gap-1.5 text-sm text-ink hover:text-brand">
                          <Phone className="h-3.5 w-3.5 text-ink-soft" /> {r.phone}
                        </a>
                      ) : (
                        <span className="text-sm text-ink-soft">—</span>
                      )}
                    </td>
                    <td className="px-5 py-4">
                      <StatusBadge onDelivery={r.active > 0} locStatus={r.locStatus} />
                    </td>
                    <td className="px-5 py-4 text-sm font-semibold text-ink">{r.active}</td>
                    <td className="px-5 py-4 text-sm font-semibold text-ink">{r.completed}</td>
                    <td className="px-5 py-4">
                      {r.loc ? (
                        <a
                          href={`https://www.google.com/maps/search/?api=1&query=${r.loc.latitude},${r.loc.longitude}`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-sm font-semibold text-info hover:underline"
                        >
                          <MapPin className="h-3.5 w-3.5" /> Live pin <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : (
                        <span className="text-sm text-ink-soft">—</span>
                      )}
                    </td>
                    <td className="px-5 py-4 text-right text-sm font-semibold text-ink-soft">{ago(r.lastAt)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add Rider dialog */}
      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <form onSubmit={addRider} className="w-full max-w-md rounded-2xl bg-white shadow-xl">
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

            <div className="space-y-4 p-5">
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
    </>
  )
}
