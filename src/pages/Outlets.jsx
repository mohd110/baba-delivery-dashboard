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
} from 'lucide-react'
import Topbar, { SearchBox, TopIcons } from '../layout/Topbar.jsx'
import { supabase } from '../lib/supabase.js'

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

function OutletCard({ o }) {
  return (
    <div className="flex flex-col rounded-xl border border-line bg-white p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          {o.logo_url ? (
            <img src={o.logo_url} alt={o.name} className="h-11 w-11 rounded-xl bg-line-2 object-cover" />
          ) : (
            <span className={`flex h-11 w-11 items-center justify-center rounded-xl text-sm font-bold ${toneFor(o.id)}`}>
              {initials(o.name)}
            </span>
          )}
          <div>
            <p className="text-sm font-bold text-ink">{o.name}</p>
            {o.cuisine_type && (
              <p className="flex items-center gap-1 text-xs text-ink-soft">
                <UtensilsCrossed className="h-3 w-3" /> {o.cuisine_type}
              </p>
            )}
          </div>
        </div>
        <StatusBadge open={o.is_open} />
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

      {o.latitude != null && o.longitude != null && (
        <a
          href={`https://www.google.com/maps/search/?api=1&query=${o.latitude},${o.longitude}`}
          target="_blank"
          rel="noreferrer"
          className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-info hover:underline"
        >
          <MapPin className="h-3.5 w-3.5" /> View on map <ExternalLink className="h-3 w-3" />
        </a>
      )}
    </div>
  )
}

export default function Outlets() {
  const [outlets, setOutlets] = useState([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')

  const load = useCallback(() => {
    return supabase
      .from('restaurants')
      .select('*')
      .order('name', { ascending: true })
      .then(({ data, error }) => {
        if (error) console.error('Failed to load outlets:', error.message)
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
        [o.name, o.cuisine_type, o.address].some((v) => (v || '').toLowerCase().includes(q))
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
              <OutletCard key={o.id} o={o} />
            ))}
          </div>
        )}
      </div>
    </>
  )
}
