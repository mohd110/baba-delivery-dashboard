import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ClipboardList,
  ChefHat,
  CheckCircle2,
  TrendingUp,
  Truck,
  SlidersHorizontal,
  Download,
  Hash,
  ChevronRight,
  ChevronDown,
  Check,
} from 'lucide-react'
import Topbar, { SearchBox, TopIcons } from '../layout/Topbar.jsx'
import { supabase } from '../lib/supabase.js'

/* map dish name -> brand photo */
function imgFor(name = '') {
  const n = name.toLowerCase()
  if (n.includes('mutton') || n.includes('korma')) return '/assets/mutton-korma.png'
  if (n.includes('paneer')) return '/assets/paneer-tikka.png'
  if (n.includes('butter')) return '/assets/butter-chicken.png'
  if (n.includes('tikka') || n.includes('aatishi')) return '/assets/chicken-aatishi.png'
  if (n.includes('kebab') || n.includes('galouti')) return '/assets/galouti-kebab.png'
  return '/assets/chicken-biryani.png'
}

function elapsed(iso) {
  const ms = Date.now() - new Date(iso).getTime()
  const min = Math.floor(ms / 60000)
  if (min < 60) return `${min}m`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ${min % 60}m`
  return `${Math.floor(hr / 24)}d`
}

/* status values allowed by the DB CHECK constraint, in workflow order */
const STATUS = {
  pending: { label: 'Pending', bg: 'bg-line-soft', text: 'text-[#374151]', dot: 'bg-ink-soft' },
  accepted: { label: 'Accepted', bg: 'bg-info-soft', text: 'text-info', dot: 'bg-info' },
  preparing: { label: 'Preparing', bg: 'bg-[#fff7ed]', text: 'text-[#b45309]', dot: 'bg-[#f59e0b]' },
  ready: { label: 'Ready', bg: 'bg-pos-soft', text: 'text-pos-dark', dot: 'bg-pos' },
}
const STATUS_KEYS = Object.keys(STATUS)

/* Clickable status pill — opens a menu to move an order through the workflow. */
function StatusSelect({ order, onChange }) {
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const ref = useRef(null)
  const s = STATUS[order.status] ?? STATUS.pending

  useEffect(() => {
    if (!open) return
    const onDoc = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const pick = async (status) => {
    setOpen(false)
    if (status === order.status) return
    setSaving(true)
    const { error } = await supabase.from('orders').update({ status }).eq('id', order.id)
    setSaving(false)
    if (error) {
      console.error('Failed to update status:', error.message)
      alert(`Could not update status: ${error.message}`)
      return
    }
    onChange(order.id, status)
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={saving}
        className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${s.bg} ${s.text} ${
          saving ? 'opacity-60' : 'hover:brightness-95'
        }`}
      >
        <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} /> {s.label}
        <ChevronDown className="h-3 w-3 opacity-70" />
      </button>
      {open && (
        <div className="absolute left-0 z-30 mt-1 w-44 overflow-hidden rounded-lg border border-line bg-white py-1 shadow-[0_8px_24px_rgba(0,0,0,0.12)]">
          {STATUS_KEYS.map((key) => {
            const v = STATUS[key]
            const current = key === order.status
            return (
              <button
                key={key}
                type="button"
                onClick={() => pick(key)}
                className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium hover:bg-line-soft ${
                  current ? 'text-ink' : 'text-ink-soft'
                }`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${v.dot}`} /> {v.label}
                {current && <Check className="ml-auto h-3.5 w-3.5 text-brand" />}
              </button>
            )
          })}
        </div>
      )}
    </div>
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

export default function Orders() {
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(() => {
    return supabase
      .from('orders')
      .select('*, order_items(quantity, products(name, photo_url))')
      .order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (error) console.error('Failed to load orders:', error.message)
        setOrders(data ?? [])
        setLoading(false)
      })
  }, [])

  useEffect(() => {
    load()
    // Live-refresh the table whenever any order is inserted/updated/deleted.
    const channel = supabase
      .channel('orders-table')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => load())
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [load])

  const updateStatus = (id, status) =>
    setOrders((prev) => prev.map((o) => (o.id === id ? { ...o, status } : o)))

  const inKitchen = orders.filter((o) => ['accepted', 'preparing'].includes(o.status)).length
  const ready = orders.filter((o) => o.status === 'ready').length
  const potential = orders.reduce((sum, o) => sum + (o.total || 0), 0)

  const kpis = [
    { label: 'TOTAL ACTIVE', value: String(orders.length), sub: 'All live orders', icon: ClipboardList, iconBg: 'bg-[#ffdad3] text-brand' },
    { label: 'IN KITCHEN', value: String(inKitchen), sub: 'Accepted + preparing', icon: ChefHat, iconBg: 'bg-[#fef3c7] text-[#b45309]' },
    { label: 'READY', value: String(ready), sub: 'Awaiting pickup', icon: CheckCircle2, iconBg: 'bg-pos-soft text-pos-dark' },
    { label: 'POTENTIAL REV.', value: `₹${potential.toLocaleString('en-IN')}`, sub: 'Real-time valuation', icon: TrendingUp, iconBg: 'bg-info-soft text-info' },
  ]

  return (
    <>
      <Topbar>
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold text-ink">Order Monitoring</h1>
          <span className="flex items-center gap-1.5 rounded-full bg-[#ffdad3] px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-brand">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand" /> Live Status
          </span>
        </div>
        <div className="flex items-center gap-2">
          <SearchBox placeholder="Search orders..." className="w-[260px]" />
          <TopIcons />
          <button className="ml-1 flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm font-medium text-ink">
            <Truck className="h-4 w-4 text-ink-soft" /> Global Fleet
            <ChevronRight className="h-3.5 w-3.5 rotate-90 text-ink-soft" />
          </button>
        </div>
      </Topbar>

      <div className="space-y-6 p-8">
        {/* KPIs */}
        <div className="grid grid-cols-4 gap-6">
          {kpis.map((k) => (
            <Kpi key={k.label} {...k} />
          ))}
        </div>

        {/* table */}
        <div className="rounded-xl border border-line bg-white">
          <div className="flex items-center justify-between p-5">
            <div className="flex items-center gap-4">
              <h2 className="text-lg font-bold text-ink">Active Orders</h2>
            </div>
            <div className="flex items-center gap-2">
              <button className="flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm font-medium text-ink">
                <SlidersHorizontal className="h-4 w-4" /> Filters
              </button>
              <button className="flex items-center gap-2 rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white hover:bg-brand-dark">
                <Download className="h-4 w-4" /> Export Log
              </button>
            </div>
          </div>

          <table className="w-full text-left">
            <thead>
              <tr className="border-y border-line text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
                <th className="px-5 py-3 font-semibold">Order ID</th>
                <th className="px-5 py-3 font-semibold">Customer</th>
                <th className="px-5 py-3 font-semibold">Items</th>
                <th className="px-5 py-3 font-semibold">Total Price</th>
                <th className="px-5 py-3 font-semibold">Status</th>
                <th className="px-5 py-3 text-right font-semibold">Time Elapsed</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-soft">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-5 py-12 text-center text-sm text-ink-soft">Loading orders…</td>
                </tr>
              ) : orders.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-12 text-center text-sm text-ink-soft">No active orders.</td>
                </tr>
              ) : (
                orders.map((o) => {
                  const items = o.order_items ?? []
                  const addr = o.delivery_address ?? {}
                  return (
                    <tr key={o.id}>
                      <td className="px-5 py-4">
                        <span className="flex items-center gap-2">
                          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-line-soft text-ink-soft">
                            <Hash className="h-3.5 w-3.5" />
                          </span>
                          <span className="text-sm font-semibold text-brand">
                            ORD-{o.id.slice(0, 4).toUpperCase()}
                          </span>
                        </span>
                      </td>
                      <td className="px-5 py-4">
                        <p className="text-sm font-semibold text-ink">{addr.name || 'Customer'}</p>
                        <p className="max-w-[200px] truncate text-xs text-ink-soft">{addr.address || '—'}</p>
                      </td>
                      <td className="px-5 py-4">
                        <span className="flex items-center gap-2">
                          <span className="flex -space-x-2">
                            {items.slice(0, 2).map((it, i) => (
                              <img
                                key={i}
                                src={imgFor(it.products?.name)}
                                alt=""
                                className="h-7 w-7 rounded-full border-2 border-white bg-line-2 object-cover"
                              />
                            ))}
                          </span>
                          <span className="text-xs text-ink-soft">
                            {items.length === 1 ? '1 item' : `${items.length} items`}
                          </span>
                        </span>
                      </td>
                      <td className="px-5 py-4 text-sm font-semibold text-ink">₹{o.total}</td>
                      <td className="px-5 py-4">
                        <StatusSelect order={o} onChange={updateStatus} />
                      </td>
                      <td className="px-5 py-4 text-right text-sm font-semibold text-ink-soft">
                        {elapsed(o.created_at)}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>

          <div className="flex items-center justify-between p-5">
            <span className="text-sm text-ink-soft">
              {loading ? 'Loading…' : `Showing ${orders.length} order${orders.length === 1 ? '' : 's'}`}
            </span>
            <div className="flex items-center gap-1 text-sm">
              <button className="flex h-8 w-8 items-center justify-center rounded-md border border-line text-ink-soft">‹</button>
              <button className="flex h-8 w-8 items-center justify-center rounded-md bg-brand font-semibold text-white">1</button>
              <button className="flex h-8 w-8 items-center justify-center rounded-md border border-line text-ink-soft">›</button>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
