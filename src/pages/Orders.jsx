import { useCallback, useEffect, useState } from 'react'
import {
  ClipboardList,
  ChefHat,
  CheckCircle2,
  ShieldCheck,
  Truck,
  SlidersHorizontal,
  Download,
  Hash,
  ChevronRight,
  ChevronDown,
  MapPin,
  Bike,
  Phone,
  Wallet,
  Ban,
  ExternalLink,
} from 'lucide-react'
import Topbar, { SearchBox, TopIcons } from '../layout/Topbar.jsx'
import { supabase } from '../lib/supabase.js'

/* map dish name -> brand photo */
function imgFor(name = '', photoUrl) {
  if (photoUrl) return photoUrl
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

/* Full order lifecycle. The restaurant only drives pending→accepted→preparing→ready
   (plus cancel); ready→out_for_delivery→delivered is the rider app's job and shown
   here read-only. */
const STATUS = {
  pending: { label: 'Pending', bg: 'bg-line-soft', text: 'text-[#374151]', dot: 'bg-ink-soft' },
  accepted: { label: 'Accepted', bg: 'bg-info-soft', text: 'text-info', dot: 'bg-info' },
  preparing: { label: 'Preparing', bg: 'bg-[#fff7ed]', text: 'text-[#b45309]', dot: 'bg-[#f59e0b]' },
  ready: { label: 'Ready', bg: 'bg-pos-soft', text: 'text-pos-dark', dot: 'bg-pos' },
  out_for_delivery: { label: 'Out for Delivery', bg: 'bg-info-soft', text: 'text-info', dot: 'bg-info' },
  delivered: { label: 'Delivered', bg: 'bg-pos-soft', text: 'text-pos-dark', dot: 'bg-pos' },
  cancelled: { label: 'Cancelled', bg: 'bg-[#fee2e2]', text: 'text-[#b91c1c]', dot: 'bg-[#ef4444]' },
}

/* Restaurant-controlled forward step for each status. pending→accepted is the
   payment gate: it verifies the UPI payment in the SAME update. */
const NEXT_ACTION = {
  pending: { label: 'Verify Payment & Accept', to: 'accepted', verifyPayment: true, icon: ShieldCheck },
  accepted: { label: 'Start Preparing', to: 'preparing', icon: ChefHat },
  preparing: { label: 'Mark Ready', to: 'ready', icon: CheckCircle2 },
}
const CANCELABLE = new Set(['pending', 'accepted', 'preparing'])

const PAYMENT = {
  pending_verification: { label: 'Unverified', bg: 'bg-[#fff7ed]', text: 'text-[#b45309]', dot: 'bg-[#f59e0b]' },
  verified: { label: 'Verified', bg: 'bg-pos-soft', text: 'text-pos-dark', dot: 'bg-pos' },
  failed: { label: 'Failed', bg: 'bg-[#fee2e2]', text: 'text-[#b91c1c]', dot: 'bg-[#ef4444]' },
}

function StatusBadge({ status }) {
  const s = STATUS[status] ?? STATUS.pending
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${s.bg} ${s.text}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} /> {s.label}
    </span>
  )
}

function PaymentBadge({ status }) {
  const p = PAYMENT[status] ?? PAYMENT.pending_verification
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${p.bg} ${p.text}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${p.dot}`} /> {p.label}
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

/* Expanded detail panel: payment/UTR, delivery address, rider, items, totals,
   and the gated workflow actions. */
function OrderDetail({ order, busy, onAdvance, onCancel }) {
  const addr = order.delivery_address ?? {}
  const items = order.order_items ?? []
  const rider = order.rider ?? null
  const action = NEXT_ACTION[order.status]
  const canCancel = CANCELABLE.has(order.status)
  const lat = order.delivery_latitude
  const lng = order.delivery_longitude
  const itemsTotal = items.reduce((s, it) => s + (it.price_at_order ?? 0) * (it.quantity ?? 1), 0)

  return (
    <div className="grid grid-cols-[1.1fr_1fr_0.9fr] gap-6 border-t border-line-soft bg-canvas/40 px-5 py-5">
      {/* left: delivery + payment */}
      <div className="space-y-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">Delivery</p>
          <p className="mt-1 text-sm font-semibold text-ink">{addr.name || 'Customer'}</p>
          {addr.phone && (
            <p className="flex items-center gap-1.5 text-xs text-ink-soft">
              <Phone className="h-3 w-3" /> {addr.phone}
            </p>
          )}
          <p className="mt-1 text-xs text-ink-soft">
            {addr.address || '—'}
            {addr.landmark ? `, ${addr.landmark}` : ''}
            {addr.pincode ? ` — ${addr.pincode}` : ''}
          </p>
          <div className="mt-1.5 flex items-center gap-2">
            <span className="rounded bg-line-soft px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-ink-soft">
              {order.order_type || 'delivery'}
            </span>
            {lat != null && lng != null && (
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${lat},${lng}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-[11px] font-semibold text-info hover:underline"
              >
                <MapPin className="h-3 w-3" /> GPS pin <ExternalLink className="h-2.5 w-2.5" />
              </a>
            )}
          </div>
        </div>

        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">Payment</p>
          <div className="mt-1 flex items-center gap-2">
            <PaymentBadge status={order.payment_status} />
          </div>
          <p className="mt-1.5 flex items-center gap-1.5 text-xs text-ink-soft">
            <Wallet className="h-3 w-3" /> UTR:&nbsp;
            <span className="font-mono font-semibold text-ink">{order.utr_number || '—'}</span>
          </p>
          {order.payment_status === 'pending_verification' && (
            <p className="mt-1 text-[11px] text-[#b45309]">
              Check this UTR landed in your UPI account before accepting.
            </p>
          )}
        </div>
      </div>

      {/* middle: rider + items */}
      <div className="space-y-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">Rider</p>
          {rider ? (
            <>
              <p className="mt-1 flex items-center gap-1.5 text-sm font-semibold text-ink">
                <Bike className="h-3.5 w-3.5 text-ink-soft" /> {rider.full_name || 'Rider'}
              </p>
              {rider.phone && (
                <p className="flex items-center gap-1.5 text-xs text-ink-soft">
                  <Phone className="h-3 w-3" /> {rider.phone}
                </p>
              )}
            </>
          ) : (
            <p className="mt-1 text-xs text-ink-soft">
              {order.status === 'ready' ? 'Waiting for a rider to claim…' : 'No rider assigned yet.'}
            </p>
          )}
        </div>

        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">Items</p>
          <ul className="mt-1 space-y-1">
            {items.map((it, i) => (
              <li key={i} className="flex items-center justify-between text-xs text-ink">
                <span className="flex items-center gap-2">
                  <img src={imgFor(it.products?.name, it.products?.photo_url)} alt="" className="h-6 w-6 rounded bg-line-2 object-cover" />
                  <span className="text-ink-soft">{it.quantity}×</span> {it.products?.name || 'Item'}
                </span>
                <span className="font-semibold text-ink">₹{(it.price_at_order ?? 0) * (it.quantity ?? 1)}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* right: totals + actions */}
      <div className="space-y-4">
        <div className="rounded-lg border border-line bg-white p-3 text-xs">
          <div className="flex justify-between text-ink-soft">
            <span>Items</span>
            <span className="font-semibold text-ink">₹{itemsTotal}</span>
          </div>
          <div className="mt-1 flex justify-between text-ink-soft">
            <span>Delivery fee</span>
            <span className="font-semibold text-ink">₹{order.delivery_fee ?? 0}</span>
          </div>
          {order.discount_amount > 0 && (
            <div className="mt-1 flex justify-between text-pos">
              <span>Discount {order.coupon_code ? `(${order.coupon_code})` : ''}</span>
              <span className="font-semibold">−₹{order.discount_amount}</span>
            </div>
          )}
          <div className="mt-2 flex justify-between border-t border-line-soft pt-2 text-sm">
            <span className="font-semibold text-ink">Total</span>
            <span className="font-bold text-ink">₹{order.total}</span>
          </div>
        </div>

        <div className="space-y-2">
          {action && (
            <button
              type="button"
              disabled={busy}
              onClick={() => onAdvance(order)}
              className={`flex w-full items-center justify-center gap-2 rounded-lg bg-brand px-3 py-2.5 text-sm font-semibold text-white hover:bg-brand-dark ${
                busy ? 'opacity-60' : ''
              }`}
            >
              <action.icon className="h-4 w-4" /> {action.label}
            </button>
          )}
          {canCancel && (
            <button
              type="button"
              disabled={busy}
              onClick={() => onCancel(order)}
              className={`flex w-full items-center justify-center gap-2 rounded-lg border border-line px-3 py-2.5 text-sm font-semibold text-[#b91c1c] hover:bg-[#fee2e2] ${
                busy ? 'opacity-60' : ''
              }`}
            >
              <Ban className="h-4 w-4" /> Cancel Order
            </button>
          )}
          {!action && !canCancel && (
            <p className="rounded-lg bg-line-soft px-3 py-2.5 text-center text-xs text-ink-soft">
              Now handled by the rider app.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

export default function Orders() {
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(() => new Set())
  const [busy, setBusy] = useState(null)

  const load = useCallback(() => {
    return supabase
      .from('orders')
      // rider has its own FK into profiles, so it MUST be disambiguated with an
      // explicit FK hint or PostgREST rejects the join once a rider is assigned.
      .select(
        '*, order_items(quantity, price_at_order, products(name, photo_url)), rider:profiles!orders_rider_id_fkey(full_name, phone)'
      )
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

  const toggle = (id) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  const patchLocal = (id, patch) =>
    setOrders((prev) => prev.map((o) => (o.id === id ? { ...o, ...patch } : o)))

  const advance = async (order) => {
    const action = NEXT_ACTION[order.status]
    if (!action || busy) return
    const patch = { status: action.to }
    if (action.verifyPayment) patch.payment_status = 'verified'
    setBusy(order.id)
    const { error } = await supabase.from('orders').update(patch).eq('id', order.id)
    setBusy(null)
    if (error) {
      alert(`Could not update order: ${error.message}`)
      return
    }
    patchLocal(order.id, patch)
  }

  const cancel = async (order) => {
    if (busy) return
    if (!window.confirm(`Cancel order ORD-${order.id.slice(0, 4).toUpperCase()}? This cannot be undone.`)) return
    setBusy(order.id)
    const { error } = await supabase.from('orders').update({ status: 'cancelled' }).eq('id', order.id)
    setBusy(null)
    if (error) {
      alert(`Could not cancel order: ${error.message}`)
      return
    }
    patchLocal(order.id, { status: 'cancelled' })
  }

  const active = orders.filter((o) => !['delivered', 'cancelled'].includes(o.status))
  const awaitingVerify = orders.filter((o) => o.payment_status === 'pending_verification' && o.status !== 'cancelled').length
  const inKitchen = orders.filter((o) => ['accepted', 'preparing'].includes(o.status)).length
  const ready = orders.filter((o) => o.status === 'ready').length

  const kpis = [
    { label: 'TOTAL ACTIVE', value: String(active.length), sub: 'Live, not yet delivered', icon: ClipboardList, iconBg: 'bg-[#ffdad3] text-brand' },
    { label: 'AWAITING VERIFY', value: String(awaitingVerify), sub: 'UPI payment to check', icon: ShieldCheck, iconBg: 'bg-[#fef3c7] text-[#b45309]' },
    { label: 'IN KITCHEN', value: String(inKitchen), sub: 'Accepted + preparing', icon: ChefHat, iconBg: 'bg-info-soft text-info' },
    { label: 'READY', value: String(ready), sub: 'Awaiting pickup', icon: CheckCircle2, iconBg: 'bg-pos-soft text-pos-dark' },
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
              <h2 className="text-lg font-bold text-ink">Orders</h2>
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
                <th className="w-8 px-5 py-3" />
                <th className="px-5 py-3 font-semibold">Order ID</th>
                <th className="px-5 py-3 font-semibold">Customer</th>
                <th className="px-5 py-3 font-semibold">Items</th>
                <th className="px-5 py-3 font-semibold">Total</th>
                <th className="px-5 py-3 font-semibold">Payment</th>
                <th className="px-5 py-3 font-semibold">Status</th>
                <th className="px-5 py-3 text-right font-semibold">Time Elapsed</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-soft">
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-5 py-12 text-center text-sm text-ink-soft">Loading orders…</td>
                </tr>
              ) : orders.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-5 py-12 text-center text-sm text-ink-soft">No orders yet.</td>
                </tr>
              ) : (
                orders.map((o) => {
                  const items = o.order_items ?? []
                  const addr = o.delivery_address ?? {}
                  const isOpen = expanded.has(o.id)
                  return (
                    <Fragmentish key={o.id}>
                      <tr
                        className={`cursor-pointer hover:bg-line-soft/40 ${isOpen ? 'bg-line-soft/40' : ''}`}
                        onClick={() => toggle(o.id)}
                      >
                        <td className="px-5 py-4 text-ink-soft">
                          <ChevronDown className={`h-4 w-4 transition-transform ${isOpen ? '' : '-rotate-90'}`} />
                        </td>
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
                                  src={imgFor(it.products?.name, it.products?.photo_url)}
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
                          <PaymentBadge status={o.payment_status} />
                        </td>
                        <td className="px-5 py-4">
                          <StatusBadge status={o.status} />
                        </td>
                        <td className="px-5 py-4 text-right text-sm font-semibold text-ink-soft">
                          {elapsed(o.created_at)}
                        </td>
                      </tr>
                      {isOpen && (
                        <tr>
                          <td colSpan={8} className="p-0">
                            <OrderDetail order={o} busy={busy === o.id} onAdvance={advance} onCancel={cancel} />
                          </td>
                        </tr>
                      )}
                    </Fragmentish>
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

/* A <tbody> can only contain <tr>; this renders two sibling rows without an
   intermediate element that would break table semantics. */
function Fragmentish({ children }) {
  return children
}
