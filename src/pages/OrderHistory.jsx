import { useCallback, useEffect, useState } from 'react'
import {
  History,
  Search,
  X,
  FileSpreadsheet,
  CheckCircle,
  XCircle,
  Clock,
  Hash,
  Phone,
  Wallet,
  Check,
} from 'lucide-react'
import Topbar, { TopIcons } from '../layout/Topbar.jsx'
import { supabase } from '../lib/supabase.js'
import { orderCode } from '../lib/format.js'
import { boldLast4 } from '../components/OrderIdLabel.jsx'
import DateRangeFilter from '../components/DateRangeFilter.jsx'
import { inRange } from '../lib/dateRange.js'
import { exportToCsv } from '../lib/csv.js'

function imgFor(name = '') {
  const n = name.toLowerCase()
  if (n.includes('mutton') || n.includes('korma')) return '/assets/mutton-korma.png'
  if (n.includes('paneer')) return '/assets/paneer-tikka.png'
  if (n.includes('butter')) return '/assets/butter-chicken.png'
  if (n.includes('tikka') || n.includes('aatishi')) return '/assets/chicken-aatishi.png'
  if (n.includes('kebab') || n.includes('galouti')) return '/assets/galouti-kebab.png'
  return '/assets/chicken-biryani.png'
}

const HISTORICAL_STATUS = {
  delivered: { label: 'Delivered', bg: 'bg-pos-soft', text: 'text-pos-dark', dot: 'bg-pos' },
  cancelled: { label: 'Cancelled', bg: 'bg-red-50', text: 'text-red-700', dot: 'bg-red-500' },
  ready: { label: 'Ready for Pickup', bg: 'bg-amber-50', text: 'text-amber-700', dot: 'bg-amber-500' },
  out_for_delivery: { label: 'Out for Delivery', bg: 'bg-indigo-50', text: 'text-indigo-700', dot: 'bg-indigo-600' },
}

// Statuses treated as "in progress" in the history view.
const IN_PROGRESS = ['ready', 'out_for_delivery']

// Zomato-style order timeline. Each step is backed by a timestamp column on the
// orders row (see ORDER_TIMELINE_HANDOFF.md); a step shows "done" when its
// timestamp is set, or when the order's status has already moved past it (so a
// delivered order still checks every step even if a rider-app timestamp is
// missing). Times render where known.
const TIMELINE_STEPS = [
  { key: 'created_at',       label: 'Placed' },
  { key: 'accepted_at',      label: 'Accepted' },
  { key: 'rider_arrived_at', label: 'Delivery partner arrived' },
  { key: 'ready_at',         label: 'Ready' },
  { key: 'picked_up_at',     label: 'Picked up' },
  { key: 'delivered_at',     label: 'Delivered' },
]

// Furthest step index a non-cancelled status has reached.
const STATUS_REACHED = {
  pending: 0, accepted: 1, preparing: 1, ready: 3, out_for_delivery: 4, delivered: 5,
}

function fmtStepTime(iso) {
  if (!iso) return null
  const d = new Date(iso)
  return isNaN(d.getTime()) ? null : d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })
}

// "14 minutes" between two timestamps, for the "Delivered in …" caption.
function durationText(fromIso, toIso) {
  if (!fromIso || !toIso) return null
  const mins = Math.round((new Date(toIso).getTime() - new Date(fromIso).getTime()) / 60000)
  return Number.isFinite(mins) && mins >= 0 ? `${mins} minute${mins === 1 ? '' : 's'}` : null
}

function OrderTimeline({ order }) {
  const cancelled = order.status === 'cancelled'
  let steps
  if (cancelled) {
    // Show Placed plus any milestone actually reached, then a Cancelled endpoint.
    steps = TIMELINE_STEPS
      .map((s) => ({ label: s.label, at: order[s.key] || null, done: order[s.key] != null }))
      .filter((s, i) => i === 0 || s.at != null)
    steps.push({ label: 'Cancelled', at: order.cancelled_at || null, done: true, cancelled: true })
  } else {
    const reached = STATUS_REACHED[order.status] ?? 0
    steps = TIMELINE_STEPS.map((s, i) => ({
      label: s.label,
      at: order[s.key] || null,
      done: order[s.key] != null || i <= reached,
    }))
  }

  const delivered = durationText(order.created_at, order.delivered_at)

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h4 className="text-[10px] font-bold uppercase tracking-wider text-ink-soft">Order Timeline</h4>
        {cancelled ? (
          <span className="text-[11px] font-semibold text-red-600">Order cancelled</span>
        ) : delivered ? (
          <span className="text-[11px] font-semibold text-pos-dark">Delivered in {delivered}</span>
        ) : null}
      </div>
      <ol className="rounded-lg border border-line p-3">
        {steps.map((s, i) => {
          const isLast = i === steps.length - 1
          const nextDone = !isLast && steps[i + 1].done
          const time = fmtStepTime(s.at)
          return (
            <li key={i} className="flex gap-3">
              <div className="flex flex-col items-center self-stretch">
                <span
                  className={`z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
                    s.cancelled
                      ? 'bg-red-500 text-white'
                      : s.done
                        ? 'bg-pos text-white'
                        : 'border-2 border-line-2 bg-white'
                  }`}
                >
                  {s.cancelled ? (
                    <X className="h-3.5 w-3.5" />
                  ) : s.done ? (
                    <Check className="h-3.5 w-3.5" />
                  ) : (
                    <span className="h-1.5 w-1.5 rounded-full bg-line-2" />
                  )}
                </span>
                {!isLast && <span className={`w-0.5 flex-1 ${nextDone ? 'bg-pos' : 'bg-line-2'}`} />}
              </div>
              <div className={`-mt-0.5 ${isLast ? 'pb-0' : 'pb-4'}`}>
                <p className={`text-xs font-semibold ${s.done ? 'text-ink' : 'text-ink-soft'}`}>{s.label}</p>
                {(time || !s.done) && (
                  <p className="text-[11px] text-ink-soft">{time || 'Pending'}</p>
                )}
              </div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

export default function OrderHistory() {
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('all') // 'all', 'delivered', 'cancelled'
  const [range, setRange] = useState(null)
  const [preset, setPreset] = useState('today')
  const [selectedOrderId, setSelectedOrderId] = useState(null)

  const load = useCallback(() => {
    return supabase
      .from('orders')
      .select(
        '*, order_items(quantity, price_at_order, products(name, photo_url)), rider:profiles!orders_rider_id_fkey(full_name, phone)'
      )
      .in('status', ['delivered', 'cancelled', ...IN_PROGRESS])
      .order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (error) console.error('Failed to load order history:', error.message)
        setOrders(data ?? [])
        setLoading(false)
      })
  }, [])

  useEffect(() => {
    load()
    // In-progress orders are live, so keep the list in sync as they advance.
    const channel = supabase
      .channel('order-history-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => load())
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [load])

  // Filter logic
  const filteredOrders = orders.filter((o) => {
    // Status check ('in_progress' groups the two live statuses)
    if (statusFilter === 'in_progress') {
      if (!IN_PROGRESS.includes(o.status)) return false
    } else if (statusFilter !== 'all' && o.status !== statusFilter) return false

    // Search query check
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      const customerName = o.delivery_address?.name?.toLowerCase() || ''
      const orderId = orderCode(o).toLowerCase()
      const items = o.order_items?.map(it => it.products?.name?.toLowerCase() || '').join(' ') || ''
      if (!customerName.includes(q) && !orderId.includes(q) && !items.includes(q)) return false
    }

    // Date range check
    if (!inRange(o.created_at, range)) return false

    return true
  })

  // Selected Order
  const selectedOrder = orders.find((o) => o.id === selectedOrderId)

  // Tab counts reflect the selected date range (but not the status/search filter).
  const dateScoped = orders.filter((o) => inRange(o.created_at, range))
  const deliveredCount = dateScoped.filter(o => o.status === 'delivered').length
  const cancelledCount = dateScoped.filter(o => o.status === 'cancelled').length
  const inProgressCount = dateScoped.filter(o => IN_PROGRESS.includes(o.status)).length

  const handleExportCSV = () => {
    if (filteredOrders.length === 0) {
      alert('No historical records in the current filter to export.')
      return
    }
    const headers = ['Order ID', 'Date', 'Customer', 'Items', 'Total', 'Status']
    const rows = filteredOrders.map((o) => [
      orderCode(o),
      o.created_at ? new Date(o.created_at).toLocaleString('en-IN') : '',
      o.delivery_address?.name || 'Customer',
      o.order_items?.map((it) => `${it.quantity}x ${it.products?.name || 'Item'}`).join('; ') || '',
      o.total ?? 0,
      o.status,
    ])
    exportToCsv(`order-history-${preset}-${new Date().toISOString().slice(0, 10)}.csv`, headers, rows)
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-canvas">
      {/* Topbar */}
      <Topbar>
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold text-ink">Order History</h1>
          <span className="flex items-center gap-1.5 rounded-full bg-line-soft px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-ink-soft">
            <History className="h-3 w-3" /> Archive Logs
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleExportCSV}
            className="flex items-center gap-2 rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white hover:bg-brand-dark transition-colors shadow-sm"
          >
            <FileSpreadsheet className="h-4 w-4" /> Export Report
          </button>
          <TopIcons />
        </div>
      </Topbar>

      {/* Page Body */}
      <div className="flex flex-1 overflow-hidden p-6 gap-6">
        {/* Main List Column */}
        <div className="flex-1 flex flex-col rounded-xl border border-line bg-white shadow-sm overflow-hidden">
          {/* Filters Bar */}
          <div className="p-5 border-b border-line flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-center gap-2 overflow-x-auto pb-1 md:pb-0">
              <button
                onClick={() => setStatusFilter('all')}
                className={`px-4 py-2 rounded-lg text-xs font-bold border transition-all ${
                  statusFilter === 'all'
                    ? 'bg-ink text-white border-ink'
                    : 'bg-white text-ink-soft border-line hover:border-ink-soft'
                }`}
              >
                All Orders ({dateScoped.length})
              </button>
              <button
                onClick={() => setStatusFilter('in_progress')}
                className={`px-4 py-2 rounded-lg text-xs font-bold border transition-all flex items-center gap-1.5 ${
                  statusFilter === 'in_progress'
                    ? 'bg-amber-50 text-amber-700 border-amber-100 font-bold'
                    : 'bg-white text-ink-soft border-line hover:border-amber-200'
                }`}
              >
                <Clock className="h-3.5 w-3.5" /> In Progress ({inProgressCount})
              </button>
              <button
                onClick={() => setStatusFilter('delivered')}
                className={`px-4 py-2 rounded-lg text-xs font-bold border transition-all flex items-center gap-1.5 ${
                  statusFilter === 'delivered'
                    ? 'bg-pos-soft text-pos-dark border-pos-soft font-bold'
                    : 'bg-white text-ink-soft border-line hover:border-ink-soft'
                }`}
              >
                <CheckCircle className="h-3.5 w-3.5" /> Completed ({deliveredCount})
              </button>
              <button
                onClick={() => setStatusFilter('cancelled')}
                className={`px-4 py-2 rounded-lg text-xs font-bold border transition-all flex items-center gap-1.5 ${
                  statusFilter === 'cancelled'
                    ? 'bg-red-50 text-red-700 border-red-100 font-bold'
                    : 'bg-white text-ink-soft border-line hover:border-red-200'
                }`}
              >
                <XCircle className="h-3.5 w-3.5" /> Cancelled ({cancelledCount})
              </button>
            </div>

            <div className="flex items-center gap-3">
              {/* Date range filter: Today / Yesterday / This Month / Custom */}
              <DateRangeFilter defaultPreset="today" onChange={(r, p) => { setRange(r); setPreset(p) }} />

              {/* Search */}
              <div className="relative w-64">
                <Search className="absolute top-2.5 left-3 h-3.5 w-3.5 text-ink-soft" />
                <input
                  type="text"
                  placeholder="Search order ID or customer..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full rounded-lg border border-line bg-white pl-9 pr-4 py-2 text-xs text-ink placeholder-ink-soft focus:border-brand focus:outline-none"
                />
              </div>
            </div>
          </div>

          {/* Table list */}
          <div className="flex-1 overflow-y-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-line bg-canvas/30 text-[10px] font-bold uppercase tracking-wider text-ink-soft">
                  <th className="px-6 py-3.5">Order ID</th>
                  <th className="px-6 py-3.5">Date & Time</th>
                  <th className="px-6 py-3.5">Customer</th>
                  <th className="px-6 py-3.5">Items Summary</th>
                  <th className="px-6 py-3.5">Total Amount</th>
                  <th className="px-6 py-3.5">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-soft">
                {loading ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-12 text-center text-xs text-ink-soft">
                      Loading history log...
                    </td>
                  </tr>
                ) : filteredOrders.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-16 text-center text-xs text-ink-soft">
                      <History className="h-8 w-8 mx-auto text-line-2 mb-2" />
                      <p className="font-semibold text-ink">No historical records found</p>
                      <p className="mt-1">Adjust filters or check back later</p>
                    </td>
                  </tr>
                ) : (
                  filteredOrders.map((o) => {
                    const shortId = orderCode(o)
                    const timestamp = new Date(o.created_at).toLocaleString('en-IN', {
                      day: 'numeric',
                      month: 'short',
                      hour: '2-digit',
                      minute: '2-digit',
                    })
                    const itemsText = o.order_items?.map(it => `${it.quantity}x ${it.products?.name || 'Item'}`).join(', ') || '—'
                    const s = HISTORICAL_STATUS[o.status] ?? HISTORICAL_STATUS.delivered

                    return (
                      <tr
                        key={o.id}
                        onClick={() => setSelectedOrderId(o.id)}
                        className={`cursor-pointer hover:bg-canvas/40 transition-colors ${
                          selectedOrderId === o.id ? 'bg-line-soft/40 font-medium' : ''
                        }`}
                      >
                        <td className="px-6 py-4">
                          <span className="flex items-center gap-1.5 text-xs font-medium text-brand">
                            <span className="flex h-5 w-5 items-center justify-center rounded bg-line-soft text-ink-soft">
                              <Hash className="h-3 w-3" />
                            </span>
                            {boldLast4(shortId)}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-xs text-ink-soft">{timestamp}</td>
                        <td className="px-6 py-4 text-xs font-semibold text-ink">
                          {o.delivery_address?.name || 'Customer'}
                        </td>
                        <td className="px-6 py-4 text-xs text-ink-soft truncate max-w-[280px]" title={itemsText}>
                          {itemsText}
                        </td>
                        <td className="px-6 py-4 text-xs font-bold text-ink">₹{o.total}</td>
                        <td className="px-6 py-4">
                          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${s.bg} ${s.text}`}>
                            <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} /> {s.label}
                          </span>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Selected Order Detail Drawer / Right Pane */}
        {selectedOrder && (
          <div className="w-[380px] shrink-0 border border-line bg-white rounded-xl shadow-sm overflow-hidden flex flex-col animate-in slide-in-from-right duration-200">
            {/* Header */}
            <div className="p-4 border-b border-line flex justify-between items-center bg-canvas/30">
              <div>
                <h3 className="text-sm font-medium text-ink">
                  Details for {boldLast4(orderCode(selectedOrder))}
                </h3>
                <p className="text-[10px] text-ink-soft mt-0.5">
                  Logged on {new Date(selectedOrder.created_at).toLocaleString()}
                </p>
              </div>
              <button
                onClick={() => setSelectedOrderId(null)}
                className="p-1 rounded hover:bg-line-soft text-ink-soft hover:text-ink transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Content body */}
            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              {/* Status block */}
              {(() => {
                const s = HISTORICAL_STATUS[selectedOrder.status] ?? HISTORICAL_STATUS.delivered
                const inProgress = IN_PROGRESS.includes(selectedOrder.status)
                return (
                  <div className="flex justify-between items-center rounded-lg border border-line bg-canvas p-3">
                    <span className="text-xs font-semibold text-ink-soft">{inProgress ? 'Current Status' : 'Settled Status'}</span>
                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${s.bg} ${s.text}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} /> {s.label}
                    </span>
                  </div>
                )
              })()}

              {/* Zomato-style order timeline */}
              <OrderTimeline order={selectedOrder} />

              {/* Cancellation reason (shown to customer) */}
              {selectedOrder.status === 'cancelled' && selectedOrder.cancellation_reason && (
                <div className="rounded-lg border border-red-100 bg-red-50 p-3">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-red-700 mb-1">
                    Cancellation Reason
                  </p>
                  <p className="text-xs text-red-800">{selectedOrder.cancellation_reason}</p>
                </div>
              )}

              {/* Customer */}
              <div>
                <h4 className="text-[10px] font-bold uppercase tracking-wider text-ink-soft mb-1.5">
                  Customer Information
                </h4>
                <div className="rounded-lg border border-line p-3 text-xs space-y-1.5">
                  <p className="font-bold text-ink">{selectedOrder.delivery_address?.name || 'Customer'}</p>
                  {selectedOrder.delivery_address?.phone && (
                    <p className="text-ink-soft flex items-center gap-1">
                      <Phone className="h-3 w-3" /> {selectedOrder.delivery_address.phone}
                    </p>
                  )}
                  <p className="text-ink-soft">{selectedOrder.delivery_address?.address || '—'}</p>
                </div>
              </div>

              {/* Items List */}
              <div>
                <h4 className="text-[10px] font-bold uppercase tracking-wider text-ink-soft mb-1.5">
                  Order Items
                </h4>
                <div className="rounded-lg border border-line divide-y divide-line-soft p-1">
                  {selectedOrder.order_items?.map((it, idx) => (
                    <div key={idx} className="flex justify-between items-center py-2.5 px-2 text-xs">
                      <div className="flex items-center gap-2">
                        <img
                          src={imgFor(it.products?.name)}
                          alt=""
                          className="h-6 w-6 rounded bg-line-soft object-cover"
                        />
                        <span className="text-ink font-semibold">
                          <span className="text-ink-soft font-normal">{it.quantity}x</span> {it.products?.name}
                        </span>
                      </div>
                      <span className="font-bold text-ink">₹{(it.price_at_order ?? 0) * (it.quantity ?? 1)}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Payment Details */}
              <div>
                <h4 className="text-[10px] font-bold uppercase tracking-wider text-ink-soft mb-1.5">
                  Transaction Information
                </h4>
                <div className="rounded-lg border border-line p-3 text-xs space-y-2">
                  <div className="flex justify-between">
                    <span className="text-ink-soft">Payment Method</span>
                    <span className="font-semibold text-ink flex items-center gap-1">
                      <Wallet className="h-3.5 w-3.5 text-ink-soft" /> UPI
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-ink-soft">Payment Status</span>
                    <span className={`font-semibold ${selectedOrder.payment_status === 'verified' ? 'text-pos-dark' : 'text-red-700'}`}>
                      {selectedOrder.payment_status === 'verified' ? 'Verified' : 'Verification Failed'}
                    </span>
                  </div>
                  {selectedOrder.utr_number && (
                    <div className="flex justify-between border-t border-line-soft pt-2">
                      <span className="text-ink-soft">UTR Reference</span>
                      <span className="font-mono font-bold text-ink">{selectedOrder.utr_number}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Financials */}
              <div className="rounded-lg border border-line p-3 bg-canvas/30 text-xs space-y-1.5">
                <div className="flex justify-between text-ink-soft">
                  <span>Items Subtotal</span>
                  <span>₹{selectedOrder.order_items?.reduce((s, it) => s + (it.price_at_order ?? 0) * (it.quantity ?? 1), 0)}</span>
                </div>
                <div className="flex justify-between text-ink-soft">
                  <span>Delivery Fee</span>
                  <span>₹{selectedOrder.delivery_fee ?? 0}</span>
                </div>
                {selectedOrder.discount_amount > 0 && (
                  <div className="flex justify-between text-pos-dark">
                    <span>Discount</span>
                    <span>−₹{selectedOrder.discount_amount}</span>
                  </div>
                )}
                <div className="flex justify-between border-t border-line-soft pt-2 font-bold text-sm">
                  <span className="text-ink">Final Receipt Total</span>
                  <span className="text-brand">₹{selectedOrder.total}</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
