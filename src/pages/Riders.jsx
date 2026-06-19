import { useCallback, useEffect, useState } from 'react'
import {
  Bike,
  Truck,
  CheckCircle2,
  Users,
  Phone,
  MapPin,
  ExternalLink,
} from 'lucide-react'
import Topbar, { SearchBox, TopIcons } from '../layout/Topbar.jsx'
import { supabase } from '../lib/supabase.js'

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

function StatusBadge({ onDelivery }) {
  return onDelivery ? (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-info-soft px-3 py-1 text-xs font-semibold text-info">
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-info" /> On Delivery
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-pos-soft px-3 py-1 text-xs font-semibold text-pos-dark">
      <span className="h-1.5 w-1.5 rounded-full bg-pos" /> Available
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

export default function Riders() {
  const [riders, setRiders] = useState([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(() => {
    // Orders with a rider assigned are always readable by the restaurant via the
    // FK-hinted join. The roster + live locations may be RLS-restricted, so we
    // tolerate empty/failed results and fall back to what the orders give us.
    return Promise.all([
      supabase
        .from('orders')
        .select('id, status, total, created_at, rider_id, rider:profiles!orders_rider_id_fkey(id, full_name, phone)')
        .not('rider_id', 'is', null)
        .order('created_at', { ascending: false }),
      supabase.from('profiles').select('id, full_name, phone').eq('role', 'rider'),
      supabase.from('rider_locations').select('rider_id, latitude, longitude, updated_at'),
    ]).then(([ordersRes, rosterRes, locRes]) => {
    if (ordersRes.error) console.error('Failed to load rider orders:', ordersRes.error.message)

    const map = new Map()
    const upsert = (id, name, phone) => {
      if (!id) return null
      if (!map.has(id)) {
        map.set(id, { id, name: name || 'Rider', phone: phone || null, active: 0, completed: 0, total: 0, earned: 0, lastAt: null, loc: null })
      }
      const r = map.get(id)
      if (name && r.name === 'Rider') r.name = name
      if (phone && !r.phone) r.phone = phone
      return r
    }

    // Seed with the full roster first so idle riders still show up.
    ;(rosterRes.data ?? []).forEach((p) => upsert(p.id, p.full_name, p.phone))

    ;(ordersRes.data ?? []).forEach((o) => {
      const r = upsert(o.rider_id || o.rider?.id, o.rider?.full_name, o.rider?.phone)
      if (!r) return
      r.total += 1
      if (o.status === 'delivered') {
        r.completed += 1
        r.earned += o.total || 0
      } else if (o.status === 'out_for_delivery') {
        r.active += 1
      }
      if (!r.lastAt || new Date(o.created_at) > new Date(r.lastAt)) r.lastAt = o.created_at
    })

    // Newest location per rider.
    const locByRider = {}
    ;(locRes.data ?? []).forEach((l) => {
      const cur = locByRider[l.rider_id]
      if (!cur || new Date(l.updated_at) > new Date(cur.updated_at)) locByRider[l.rider_id] = l
    })
    map.forEach((r) => {
      r.loc = locByRider[r.id] || null
      const locAt = r.loc?.updated_at
      if (locAt && (!r.lastAt || new Date(locAt) > new Date(r.lastAt))) r.lastAt = locAt
    })

    const list = [...map.values()].sort((a, b) => {
      if (b.active !== a.active) return b.active - a.active
      return new Date(b.lastAt || 0) - new Date(a.lastAt || 0)
    })
      setRiders(list)
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

  const onDelivery = riders.filter((r) => r.active > 0).length
  const available = riders.length - onDelivery
  const totalDeliveries = riders.reduce((s, r) => s + r.completed, 0)

  const kpis = [
    { label: 'TOTAL RIDERS', value: String(riders.length), sub: 'Assigned to orders', icon: Users, iconBg: 'bg-[#ffdad3] text-brand' },
    { label: 'ON DELIVERY', value: String(onDelivery), sub: 'Out for delivery now', icon: Truck, iconBg: 'bg-info-soft text-info' },
    { label: 'AVAILABLE', value: String(available), sub: 'Not on a delivery', icon: Bike, iconBg: 'bg-pos-soft text-pos-dark' },
    { label: 'DELIVERIES', value: String(totalDeliveries), sub: 'Completed all-time', icon: CheckCircle2, iconBg: 'bg-[#fef3c7] text-[#b45309]' },
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
          <SearchBox placeholder="Search riders..." className="w-[260px]" />
          <TopIcons />
        </div>
      </Topbar>

      <div className="space-y-6 p-8">
        <div className="grid grid-cols-4 gap-6">
          {kpis.map((k) => (
            <Kpi key={k.label} {...k} />
          ))}
        </div>

        <div className="rounded-xl border border-line bg-white">
          <div className="flex items-center justify-between p-5">
            <h2 className="text-lg font-bold text-ink">Riders</h2>
            <span className="text-sm text-ink-soft">
              {loading ? 'Loading…' : `${riders.length} rider${riders.length === 1 ? '' : 's'}`}
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
              ) : riders.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-12 text-center text-sm text-ink-soft">
                    No riders yet — they appear here once a rider claims a ready order in the rider app.
                  </td>
                </tr>
              ) : (
                riders.map((r) => (
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
                      <StatusBadge onDelivery={r.active > 0} />
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
    </>
  )
}
