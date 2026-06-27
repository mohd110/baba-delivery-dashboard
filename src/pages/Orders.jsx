import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  ClipboardList,
  ChefHat,
  CheckCircle2,
  ShieldCheck,
  Truck,
  Hash,
  MapPin,
  Bike,
  Phone,
  Wallet,
  Ban,
  ExternalLink,
  Printer,
  Search,
  Check,
  Clock,
  ChevronRight,
  TrendingUp,
} from 'lucide-react'
import Topbar, { TopIcons } from '../layout/Topbar.jsx'
import { supabase } from '../lib/supabase.js'

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

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])
  )
}

// Kitchen Order Ticket: food + quantity only, never any prices.
function buildKotHtml(order) {
  const shortId = `ORD-${order.id.slice(0, 4).toUpperCase()}`
  const placed = new Date(order.created_at).toLocaleString('en-IN')
  const items = order.order_items ?? []
  const rows = items
    .map(
      (it) => `
        <tr>
          <td class="qty">${it.quantity ?? 1}×</td>
          <td class="name">${escapeHtml(it.products?.name || 'Item')}</td>
        </tr>`
    )
    .join('')
  return `
    <div class="ticket">
      <h1>KITCHEN KOT</h1>
      <div class="meta">
        <div class="big">${shortId}</div>
        <div>${placed}</div>
        <div class="up">${escapeHtml(order.order_type || 'delivery')}</div>
        <div>${escapeHtml(order.delivery_address?.name || 'Customer')}</div>
      </div>
      <hr />
      <table>
        <tbody>${rows}</tbody>
      </table>
      <hr />
      <div class="center small">— kitchen copy · no prices —</div>
    </div>`
}

// Customer bill: full itemised pricing breakdown.
function buildBillHtml(order) {
  const shortId = `ORD-${order.id.slice(0, 4).toUpperCase()}`
  const placed = new Date(order.created_at).toLocaleString('en-IN')
  const addr = order.delivery_address || {}
  const items = order.order_items ?? []
  const subtotal = items.reduce(
    (s, it) => s + (it.price_at_order ?? 0) * (it.quantity ?? 1),
    0
  )
  const rows = items
    .map((it) => {
      const lineTotal = (it.price_at_order ?? 0) * (it.quantity ?? 1)
      return `
        <tr>
          <td class="qty">${it.quantity ?? 1}×</td>
          <td class="name">${escapeHtml(it.products?.name || 'Item')}</td>
          <td class="amt">₹${lineTotal}</td>
        </tr>`
    })
    .join('')
  const discountRow =
    order.discount_amount > 0
      ? `<div class="row"><span>Discount${
          order.coupon_code ? ` (${escapeHtml(order.coupon_code)})` : ''
        }</span><span>−₹${order.discount_amount}</span></div>`
      : ''
  return `
    <div class="ticket">
      <h1>CUSTOMER BILL</h1>
      <div class="meta">
        <div class="big">${shortId}</div>
        <div>${placed}</div>
        <div>${escapeHtml(addr.name || 'Customer')}</div>
        ${addr.phone ? `<div>${escapeHtml(addr.phone)}</div>` : ''}
        ${addr.address ? `<div class="small">${escapeHtml(addr.address)}</div>` : ''}
      </div>
      <hr />
      <table>
        <tbody>${rows}</tbody>
      </table>
      <hr />
      <div class="row"><span>Subtotal</span><span>₹${subtotal}</span></div>
      <div class="row"><span>Delivery Fee</span><span>₹${order.delivery_fee ?? 0}</span></div>
      ${discountRow}
      <div class="row total"><span>TOTAL</span><span>₹${order.total}</span></div>
      <hr />
      <div class="center small">Thank you! · Payment: UPI / Online</div>
    </div>`
}

// Open a hidden iframe with the KOT + bill and trigger the print dialog once.
// The two tickets are separated by a page break so each prints on its own slip.
function printOrderDocs(order) {
  if (!order) return
  const html = `<!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>Order ${order.id}</title>
        <style>
          @page { size: 80mm auto; margin: 4mm; }
          * { box-sizing: border-box; }
          body { font-family: 'Courier New', monospace; color: #000; margin: 0; }
          .ticket { width: 100%; page-break-after: always; }
          .ticket:last-child { page-break-after: auto; }
          h1 { text-align: center; font-size: 16px; margin: 0 0 6px; letter-spacing: 1px; }
          hr { border: none; border-top: 1px dashed #000; margin: 6px 0; }
          .meta { text-align: center; font-size: 12px; line-height: 1.4; }
          .meta .big { font-size: 15px; font-weight: bold; }
          .up { text-transform: uppercase; }
          table { width: 100%; border-collapse: collapse; font-size: 13px; }
          td { padding: 2px 0; vertical-align: top; }
          td.qty { width: 32px; font-weight: bold; }
          td.amt { text-align: right; white-space: nowrap; }
          .row { display: flex; justify-content: space-between; font-size: 13px; padding: 1px 0; }
          .row.total { font-size: 15px; font-weight: bold; margin-top: 4px; }
          .center { text-align: center; }
          .small { font-size: 11px; }
        </style>
      </head>
      <body>
        ${buildKotHtml(order)}
        ${buildBillHtml(order)}
      </body>
    </html>`

  const iframe = document.createElement('iframe')
  iframe.setAttribute('aria-hidden', 'true')
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;'
  document.body.appendChild(iframe)
  const win = iframe.contentWindow
  const doc = win.document
  doc.open()
  doc.write(html)
  doc.close()
  // Give the iframe a tick to lay out before invoking the print dialog.
  setTimeout(() => {
    try {
      win.focus()
      win.print()
    } catch {
      /* printing unavailable — ignore */
    }
    setTimeout(() => iframe.remove(), 2000)
  }, 300)
}

// Map prep status to badge styles
const STATUS = {
  pending: { label: 'Pending Payment', bg: 'bg-[#fff7ed]', text: 'text-[#b45309]', border: 'border-[#ffedd5]', dot: 'bg-[#f59e0b]' },
  accepted: { label: 'Accepted', bg: 'bg-info-soft', text: 'text-info', border: 'border-info-soft', dot: 'bg-info' },
  preparing: { label: 'Preparing', bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-100', dot: 'bg-amber-500' },
  ready: { label: 'Ready for Pickup', bg: 'bg-pos-soft', text: 'text-pos-dark', border: 'border-pos-soft', dot: 'bg-pos' },
  out_for_delivery: { label: 'Out for Delivery', bg: 'bg-indigo-50', text: 'text-indigo-700', border: 'border-indigo-100', dot: 'bg-indigo-600' },
  delivered: { label: 'Delivered', bg: 'bg-pos-soft', text: 'text-pos-dark', border: 'border-pos-soft', dot: 'bg-pos' },
  cancelled: { label: 'Cancelled', bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-100', dot: 'bg-red-500' },
}

const NEXT_ACTION = {
  pending: { label: 'Accept & Verify Payment', to: 'accepted', verifyPayment: true, icon: ShieldCheck, color: 'bg-amber-600 hover:bg-amber-700' },
  accepted: { label: 'Start Preparing', to: 'preparing', icon: ChefHat, color: 'bg-brand hover:bg-brand-dark' },
  preparing: { label: 'Mark Ready', to: 'ready', icon: CheckCircle2, color: 'bg-pos hover:bg-pos-dark' },
}

const CANCELABLE = new Set(['pending', 'accepted', 'preparing'])

const PAYMENT = {
  pending_verification: { label: 'Awaiting Verification', bg: 'bg-amber-50', text: 'text-amber-700', dot: 'bg-amber-500' },
  verified: { label: 'Verified', bg: 'bg-pos-soft', text: 'text-pos-dark', dot: 'bg-pos' },
  failed: { label: 'Failed', bg: 'bg-red-50', text: 'text-red-700', dot: 'bg-red-500' },
}

function StatusBadge({ status }) {
  const s = STATUS[status] ?? STATUS.pending
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${s.bg} ${s.text} ${s.border}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} /> {s.label}
    </span>
  )
}

function PaymentBadge({ status }) {
  const p = PAYMENT[status] ?? PAYMENT.pending_verification
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${p.bg} ${p.text}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${p.dot}`} /> {p.label}
    </span>
  )
}

export default function Orders() {
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(null)
  const [selectedOrderId, setSelectedOrderId] = useState(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [activeTab, setActiveTab] = useState('pending') // 'pending', 'preparing', 'ready'
  const [checkedItems, setCheckedItems] = useState(new Set())
  const [searchParams, setSearchParams] = useSearchParams()

  // Load orders
  const load = useCallback(() => {
    return supabase
      .from('orders')
      .select(
        '*, order_items(id, quantity, price_at_order, products(name, photo_url)), rider:profiles!orders_rider_id_fkey(full_name, phone)'
      )
      .order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (error) console.error('Failed to load orders:', error.message)
        const activeOrders = data ?? []
        setOrders(activeOrders)
        
        // Auto-select first order if none is selected
        if (activeOrders.length > 0 && !selectedOrderId) {
          // Find first order matching the default tab
          const tabOrders = activeOrders.filter(o => getTabForOrder(o) === 'pending')
          if (tabOrders.length > 0) {
            setSelectedOrderId(tabOrders[0].id)
          } else if (activeOrders.length > 0) {
            setSelectedOrderId(activeOrders[0].id)
          }
        }
        setLoading(false)
      })
  }, [selectedOrderId])

  useEffect(() => {
    load()
    const channel = supabase
      .channel('orders-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => load())
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [load])

  // Get active tab assignment for each order
  const getTabForOrder = (order) => {
    if (order.status === 'pending') return 'pending'
    if (['accepted', 'preparing'].includes(order.status)) return 'preparing'
    if (['ready', 'out_for_delivery'].includes(order.status)) return 'ready'
    return 'completed' // For delivered/cancelled
  }

  // When arriving from a new-order notification (/orders?order=<id>), jump to
  // that order's tab and select it, then clear the param so it doesn't re-fire.
  const focusOrderId = searchParams.get('order')
  useEffect(() => {
    if (!focusOrderId) return
    const target = orders.find((o) => o.id === focusOrderId)
    if (!target) return
    const tab = getTabForOrder(target)
    if (['pending', 'preparing', 'ready'].includes(tab)) setActiveTab(tab)
    setSelectedOrderId(focusOrderId)
    setSearchParams({}, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusOrderId, orders])

  // Filter orders by tab and search query
  const activeOrders = orders.filter((o) => !['delivered', 'cancelled'].includes(o.status))
  
  const tabFilteredOrders = activeOrders.filter((o) => getTabForOrder(o) === activeTab)

  const filteredOrders = tabFilteredOrders.filter((o) => {
    if (!searchQuery) return true
    const q = searchQuery.toLowerCase()
    const customerName = o.delivery_address?.name?.toLowerCase() || ''
    const orderId = `ord-${o.id.slice(0, 4)}`.toLowerCase()
    const items = o.order_items?.map(it => it.products?.name?.toLowerCase() || '').join(' ') || ''
    return customerName.includes(q) || orderId.includes(q) || items.includes(q)
  })

  // Selected order details
  const selectedOrder = orders.find(o => o.id === selectedOrderId)

  // Reset checklist when order selection changes
  useEffect(() => {
    setCheckedItems(new Set())
  }, [selectedOrderId])

  const toggleItemCheck = (itemId) => {
    setCheckedItems(prev => {
      const next = new Set(prev)
      if (next.has(itemId)) {
        next.delete(itemId)
      } else {
        next.add(itemId)
      }
      return next
    })
  }

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
    // On acceptance, auto-print the kitchen KOT (no prices) + the customer bill.
    if (order.status === 'pending') {
      printOrderDocs(order)
    }
  }

  const cancel = async (order) => {
    if (busy) return
    const shortId = `ORD-${order.id.slice(0, 4).toUpperCase()}`
    if (!window.confirm(`Cancel order ${shortId}? This cannot be undone.`)) return
    setBusy(order.id)
    const { error } = await supabase.from('orders').update({ status: 'cancelled' }).eq('id', order.id)
    setBusy(null)
    if (error) {
      alert(`Could not cancel order: ${error.message}`)
      return
    }
    patchLocal(order.id, { status: 'cancelled' })
    // Select another order
    const remaining = activeOrders.filter(o => o.id !== order.id)
    if (remaining.length > 0) {
      setSelectedOrderId(remaining[0].id)
    } else {
      setSelectedOrderId(null)
    }
  }

  // Count counts for tabs
  const pendingCount = activeOrders.filter(o => getTabForOrder(o) === 'pending').length
  const preparingCount = activeOrders.filter(o => getTabForOrder(o) === 'preparing').length
  const readyCount = activeOrders.filter(o => getTabForOrder(o) === 'ready').length

  const handlePrint = (order) => {
    printOrderDocs(order)
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-canvas">
      {/* Topbar */}
      <Topbar>
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold text-ink">Active Orders</h1>
          <span className="flex items-center gap-1.5 rounded-full bg-brand-light px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-brand animate-pulse">
            <span className="h-1.5 w-1.5 rounded-full bg-brand" /> Live Dashboard
          </span>
        </div>
        <div className="flex items-center gap-2">
          <TopIcons />
        </div>
      </Topbar>

      {/* Main Dual Column Wrapper */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left Column: Master List */}
        <div className="flex w-[400px] shrink-0 flex-col border-r border-line bg-white">
          {/* Search bar inside sidebar */}
          <div className="p-4 border-b border-line">
            <div className="relative">
              <Search className="absolute top-2.5 left-3 h-4 w-4 text-ink-soft" />
              <input
                type="text"
                placeholder="Search by ID, name, or item..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full rounded-lg border border-line bg-canvas pl-9 pr-4 py-2 text-sm text-ink placeholder-ink-soft focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
              />
            </div>
          </div>

          {/* Segmented status tabs */}
          <div className="grid grid-cols-3 border-b border-line bg-canvas/30 p-1.5 text-xs font-semibold">
            <button
              onClick={() => {
                setActiveTab('pending')
                const tabOrders = activeOrders.filter(o => getTabForOrder(o) === 'pending')
                if (tabOrders.length > 0) setSelectedOrderId(tabOrders[0].id)
              }}
              className={`flex flex-col items-center gap-1 rounded-md py-2.5 transition-colors relative ${
                activeTab === 'pending'
                  ? 'bg-white text-brand shadow-sm border border-line-soft'
                  : 'text-ink-soft hover:text-ink'
              }`}
            >
              <div className="flex items-center gap-1.5">
                <span>New</span>
                {pendingCount > 0 && (
                  <span className="flex h-4 min-w-[16px] items-center justify-center rounded-full bg-[#b51c00] text-[9px] font-bold text-white px-1">
                    {pendingCount}
                  </span>
                )}
              </div>
            </button>

            <button
              onClick={() => {
                setActiveTab('preparing')
                const tabOrders = activeOrders.filter(o => getTabForOrder(o) === 'preparing')
                if (tabOrders.length > 0) setSelectedOrderId(tabOrders[0].id)
              }}
              className={`flex flex-col items-center gap-1 rounded-md py-2.5 transition-colors ${
                activeTab === 'preparing'
                  ? 'bg-white text-[#b45309] shadow-sm border border-line-soft'
                  : 'text-ink-soft hover:text-ink'
              }`}
            >
              <div className="flex items-center gap-1.5">
                <span>Preparing</span>
                {preparingCount > 0 && (
                  <span className="flex h-4 min-w-[16px] items-center justify-center rounded-full bg-[#f59e0b] text-[9px] font-bold text-white px-1">
                    {preparingCount}
                  </span>
                )}
              </div>
            </button>

            <button
              onClick={() => {
                setActiveTab('ready')
                const tabOrders = activeOrders.filter(o => getTabForOrder(o) === 'ready')
                if (tabOrders.length > 0) setSelectedOrderId(tabOrders[0].id)
              }}
              className={`flex flex-col items-center gap-1 rounded-md py-2.5 transition-colors ${
                activeTab === 'ready'
                  ? 'bg-white text-pos-dark shadow-sm border border-line-soft'
                  : 'text-ink-soft hover:text-ink'
              }`}
            >
              <div className="flex items-center gap-1.5">
                <span>Ready</span>
                {readyCount > 0 && (
                  <span className="flex h-4 min-w-[16px] items-center justify-center rounded-full bg-pos text-[9px] font-bold text-white px-1">
                    {readyCount}
                  </span>
                )}
              </div>
            </button>
          </div>

          {/* Orders scroll area */}
          <div className="flex-1 overflow-y-auto divide-y divide-line-soft">
            {loading ? (
              <div className="flex h-32 items-center justify-center text-sm text-ink-soft">
                Loading live orders...
              </div>
            ) : filteredOrders.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
                <ClipboardList className="h-10 w-10 text-line-2 mb-2" />
                <p className="text-sm font-semibold text-ink">No active orders</p>
                <p className="text-xs text-ink-soft mt-1">
                  {searchQuery ? 'Try clearing your search query' : `No orders in the "${activeTab}" tab.`}
                </p>
              </div>
            ) : (
              filteredOrders.map((o) => {
                const items = o.order_items ?? []
                const isSelected = o.id === selectedOrderId
                const shortId = `ORD-${o.id.slice(0, 4).toUpperCase()}`
                const elapsedMin = elapsed(o.created_at)

                // Highlight cards that are running late in kitchen
                const minutes = parseInt(elapsedMin) || 0
                const isLate = activeTab === 'preparing' && minutes >= 15

                return (
                  <div
                    key={o.id}
                    onClick={() => setSelectedOrderId(o.id)}
                    className={`group relative flex cursor-pointer flex-col gap-2 p-4 text-left transition-all hover:bg-canvas/50 ${
                      isSelected
                        ? 'border-l-4 border-brand bg-brand/5'
                        : 'border-l-4 border-transparent'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-bold text-ink group-hover:text-brand transition-colors">
                        {shortId}
                      </span>
                      <div className="flex items-center gap-1.5">
                        <Clock className={`h-3 w-3 ${isLate ? 'text-brand animate-pulse' : 'text-ink-soft'}`} />
                        <span className={`text-xs font-semibold ${isLate ? 'text-brand font-bold' : 'text-ink-soft'}`}>
                          {elapsedMin}
                        </span>
                      </div>
                    </div>

                    <div className="flex justify-between items-start">
                      <div>
                        <p className="text-xs font-semibold text-ink">
                          {o.delivery_address?.name || 'Customer'}
                        </p>
                        <p className="mt-1 text-xs text-ink-soft truncate max-w-[240px]">
                          {items.map((it) => `${it.quantity}x ${it.products?.name}`).join(', ')}
                        </p>
                      </div>
                      <span className="text-xs font-bold text-ink">
                        ₹{o.total}
                      </span>
                    </div>

                    <div className="mt-1 flex items-center justify-between">
                      <div className="flex items-center gap-1">
                        <span className="rounded bg-line-soft px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-ink-soft">
                          {o.order_type || 'delivery'}
                        </span>
                        {o.payment_status === 'pending_verification' && (
                          <span className="rounded bg-amber-100 text-[#b45309] px-1.5 py-0.5 text-[9px] font-bold">
                            Unpaid
                          </span>
                        )}
                      </div>
                      <ChevronRight className="h-3.5 w-3.5 text-line-2 transition-transform group-hover:translate-x-1" />
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>

        {/* Right Column: Order Detail View */}
        <div className="flex flex-1 flex-col bg-canvas overflow-y-auto">
          {selectedOrder ? (
            <div className="flex flex-col min-h-full">
              {/* Header Details */}
              <div className="border-b border-line bg-white p-6 shadow-sm">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-3">
                      <h2 className="text-xl font-bold text-ink">
                        Order ORD-{selectedOrder.id.slice(0, 4).toUpperCase()}
                      </h2>
                      <StatusBadge status={selectedOrder.status} />
                    </div>
                    <p className="mt-1 text-xs text-ink-soft flex items-center gap-2">
                      <span>Placed {new Date(selectedOrder.created_at).toLocaleTimeString()}</span>
                      <span>•</span>
                      <span className="font-semibold text-brand">{elapsed(selectedOrder.created_at)} ago</span>
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handlePrint(selectedOrder)}
                      className="flex items-center gap-1.5 rounded-lg border border-line bg-white px-3 py-2 text-xs font-medium text-ink hover:bg-canvas transition-colors"
                      title="Print receipt"
                    >
                      <Printer className="h-4 w-4" /> Print
                    </button>
                  </div>
                </div>
              </div>

              {/* Grid content */}
              <div className="grid flex-1 grid-cols-1 lg:grid-cols-3 gap-6 p-6">
                {/* Left col: Customer, Dispatch & Payments */}
                <div className="lg:col-span-2 space-y-6">
                  {/* Delivery / Customer Details Card */}
                  <div className="rounded-xl border border-line bg-white p-5 shadow-sm">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-ink-soft mb-3">
                      Delivery Details
                    </h3>
                    <div className="flex justify-between items-start">
                      <div>
                        <p className="text-sm font-bold text-ink">
                          {selectedOrder.delivery_address?.name || 'Customer'}
                        </p>
                        {selectedOrder.delivery_address?.phone && (
                          <p className="mt-1 text-xs text-ink-soft flex items-center gap-1.5">
                            <Phone className="h-3.5 w-3.5" />
                            <a href={`tel:${selectedOrder.delivery_address.phone}`} className="hover:text-brand font-semibold underline">
                              {selectedOrder.delivery_address.phone}
                            </a>
                          </p>
                        )}
                        <p className="mt-2 text-xs text-ink-soft max-w-md">
                          {selectedOrder.delivery_address?.address || '—'}
                          {selectedOrder.delivery_address?.landmark ? ` (Landmark: ${selectedOrder.delivery_address.landmark})` : ''}
                        </p>
                      </div>

                      {selectedOrder.delivery_latitude && selectedOrder.delivery_longitude && (
                        <a
                          href={`https://www.google.com/maps/search/?api=1&query=${selectedOrder.delivery_latitude},${selectedOrder.delivery_longitude}`}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center gap-1.5 rounded-lg bg-info-soft px-3 py-1.5 text-xs font-semibold text-info hover:opacity-90 transition-opacity"
                        >
                          <MapPin className="h-3.5 w-3.5" /> View Map <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </div>
                  </div>

                  {/* Kitchen Checklist Card */}
                  <div className="rounded-xl border border-line bg-white p-5 shadow-sm">
                    <div className="flex justify-between items-center mb-3">
                      <h3 className="text-xs font-bold uppercase tracking-wider text-ink-soft">
                        Kitchen Items Checklist
                      </h3>
                      <span className="text-[11px] bg-canvas px-2 py-0.5 rounded-full text-ink-soft font-mono">
                        {checkedItems.size} / {selectedOrder.order_items?.length} Prepped
                      </span>
                    </div>

                    <div className="divide-y divide-line-soft">
                      {selectedOrder.order_items?.map((it) => {
                        const isChecked = checkedItems.has(it.id)
                        return (
                          <div
                            key={it.id}
                            onClick={() => toggleItemCheck(it.id)}
                            className="flex items-center justify-between py-3 cursor-pointer select-none group"
                          >
                            <div className="flex items-center gap-3">
                              <div className={`flex h-5 w-5 items-center justify-center rounded border transition-all ${
                                isChecked
                                  ? 'bg-pos border-pos text-white'
                                  : 'border-line group-hover:border-ink-soft'
                              }`}>
                                {isChecked && <Check className="h-3.5 w-3.5 stroke-[3]" />}
                              </div>
                              <div className="flex items-center gap-2">
                                <img
                                  src={imgFor(it.products?.name, it.products?.photo_url)}
                                  alt=""
                                  className="h-8 w-8 rounded bg-line-soft object-cover"
                                />
                                <div>
                                  <p className={`text-sm font-semibold transition-all ${
                                    isChecked ? 'text-ink-soft line-through decoration-line-2' : 'text-ink'
                                  }`}>
                                    {it.quantity} × {it.products?.name || 'Item'}
                                  </p>
                                </div>
                              </div>
                            </div>
                            <span className={`text-xs font-bold ${isChecked ? 'text-ink-soft' : 'text-ink'}`}>
                              ₹{(it.price_at_order ?? 0) * (it.quantity ?? 1)}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </div>

                {/* Right col: Rider Details & Pricing */}
                <div className="space-y-6">
                  {/* Assigned Rider Card */}
                  <div className="rounded-xl border border-line bg-white p-5 shadow-sm">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-ink-soft mb-3">
                      Assigned Rider
                    </h3>
                    {selectedOrder.rider ? (
                      <div className="space-y-3">
                        <div className="flex items-center gap-3">
                          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-indigo-50 text-indigo-700">
                            <Bike className="h-5 w-5" />
                          </span>
                          <div>
                            <p className="text-sm font-bold text-ink">
                              {selectedOrder.rider.full_name || 'Rider Assigned'}
                            </p>
                            {selectedOrder.rider.phone && (
                              <p className="text-xs text-ink-soft flex items-center gap-1 mt-0.5">
                                <Phone className="h-3 w-3" /> {selectedOrder.rider.phone}
                              </p>
                            )}
                          </div>
                        </div>
                        <div className="rounded-lg bg-indigo-50/50 p-2.5 border border-indigo-100/40 text-xs text-indigo-700 font-semibold flex items-center gap-1.5">
                          <Truck className="h-4 w-4 shrink-0" />
                          {selectedOrder.status === 'ready'
                            ? 'Rider assigned, traveling to outlet'
                            : 'Out for delivery to customer'}
                        </div>
                      </div>
                    ) : (
                      <div className="py-4 text-center">
                        <Bike className="h-8 w-8 text-line-2 mx-auto mb-2" />
                        <p className="text-xs font-medium text-ink-soft">
                          {selectedOrder.status === 'ready'
                            ? 'Awaiting rider assignment...'
                            : 'Rider will be assigned once order is ready'}
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Bill Details */}
                  <div className="rounded-xl border border-line bg-white p-5 shadow-sm space-y-4">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-ink-soft">
                      Billing Breakdown
                    </h3>
                    
                    <div className="space-y-2 text-xs">
                      <div className="flex justify-between text-ink-soft">
                        <span>Items Subtotal</span>
                        <span className="font-semibold text-ink">
                          ₹{selectedOrder.order_items?.reduce((s, it) => s + (it.price_at_order ?? 0) * (it.quantity ?? 1), 0)}
                        </span>
                      </div>
                      <div className="flex justify-between text-ink-soft">
                        <span>Delivery Fee</span>
                        <span className="font-semibold text-ink">₹{selectedOrder.delivery_fee ?? 0}</span>
                      </div>
                      {selectedOrder.discount_amount > 0 && (
                        <div className="flex justify-between text-pos-dark bg-pos-soft/50 px-2 py-1 rounded">
                          <span>Discount {selectedOrder.coupon_code ? `(${selectedOrder.coupon_code})` : ''}</span>
                          <span className="font-bold">−₹{selectedOrder.discount_amount}</span>
                        </div>
                      )}
                      
                      <div className="flex justify-between border-t border-line-soft pt-3 text-sm font-bold">
                        <span className="text-ink">Order Total</span>
                        <span className="text-brand">₹{selectedOrder.total}</span>
                      </div>
                    </div>

                    <div className="border-t border-line-soft pt-3">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-ink-soft">
                        Payment Method
                      </p>
                      <div className="mt-1 flex items-center justify-between">
                        <div className="flex items-center gap-1.5 text-xs font-semibold text-ink">
                          <Wallet className="h-3.5 w-3.5 text-ink-soft" />
                          <span>UPI / Online</span>
                        </div>
                        <PaymentBadge status={selectedOrder.payment_status} />
                      </div>
                      {selectedOrder.utr_number && (
                        <p className="mt-1.5 font-mono text-[10px] text-ink-soft">
                          UTR: <span className="font-semibold text-ink">{selectedOrder.utr_number}</span>
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Bottom Sticky Action Footer */}
              <div className="sticky bottom-0 border-t border-line bg-white p-4 shadow-[0_-2px_10px_rgba(0,0,0,0.03)]">
                <div className="flex items-center justify-end gap-3">
                  {CANCELABLE.has(selectedOrder.status) && (
                    <button
                      type="button"
                      disabled={busy === selectedOrder.id}
                      onClick={() => cancel(selectedOrder)}
                      className="flex items-center gap-1.5 rounded-lg border border-red-200 px-4 py-2.5 text-xs font-semibold text-red-600 hover:bg-red-50 hover:border-red-300 transition-colors disabled:opacity-50"
                    >
                      <Ban className="h-4 w-4" /> Cancel Order
                    </button>
                  )}

                  {NEXT_ACTION[selectedOrder.status] ? (
                    <button
                      type="button"
                      disabled={busy === selectedOrder.id}
                      onClick={() => advance(selectedOrder)}
                      className={`flex items-center gap-1.5 rounded-lg px-6 py-2.5 text-xs font-bold text-white transition-all shadow-md ${
                        NEXT_ACTION[selectedOrder.status].color
                      } disabled:opacity-50`}
                    >
                      {(() => {
                        const Icon = NEXT_ACTION[selectedOrder.status].icon
                        return <Icon className="h-4 w-4" />
                      })()}
                      {NEXT_ACTION[selectedOrder.status].label}
                    </button>
                  ) : (
                    <div className="rounded-lg bg-canvas border border-line px-4 py-2 text-xs font-semibold text-ink-soft flex items-center gap-2">
                      <Truck className="h-4 w-4" /> Operations delegated to delivery fleet app
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center flex-1 py-32 px-4 text-center">
              <div className="relative">
                <div className="absolute -inset-1 rounded-full bg-brand-light/30 blur animate-pulse" />
                <div className="relative bg-white border border-line rounded-full p-6 shadow-sm">
                  <ChefHat className="h-12 w-12 text-brand" />
                </div>
              </div>
              <h3 className="mt-6 text-lg font-bold text-ink">No Active Order Selected</h3>
              <p className="mt-1 text-sm text-ink-soft max-w-sm">
                Select an order from the list on the left to start processing, cooking, and dispatching it.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
