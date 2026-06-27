import { useCallback, useEffect, useState } from 'react'
import {
  History,
  Search,
  Calendar,
  Clock,
  X,
  FileSpreadsheet,
  CheckCircle,
  XCircle,
  Hash,
  MapPin,
  Bike,
  Phone,
  Wallet,
  ExternalLink,
} from 'lucide-react'
import Topbar, { TopIcons } from '../layout/Topbar.jsx'
import { supabase } from '../lib/supabase.js'
import { orderCode } from '../lib/format.js'

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
}

export default function OrderHistory() {
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('all') // 'all', 'delivered', 'cancelled'
  const [dateFilter, setDateFilter] = useState('7d') // 'today', '7d', '30d', 'all'
  const [selectedOrderId, setSelectedOrderId] = useState(null)

  const load = useCallback(() => {
    return supabase
      .from('orders')
      .select(
        '*, order_items(quantity, price_at_order, products(name, photo_url)), rider:profiles!orders_rider_id_fkey(full_name, phone)'
      )
      .in('status', ['delivered', 'cancelled'])
      .order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (error) console.error('Failed to load order history:', error.message)
        setOrders(data ?? [])
        setLoading(false)
      })
  }, [])

  useEffect(() => {
    load()
  }, [load])

  // Filter logic
  const filteredOrders = orders.filter((o) => {
    // Status check
    if (statusFilter !== 'all' && o.status !== statusFilter) return false

    // Search query check
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      const customerName = o.delivery_address?.name?.toLowerCase() || ''
      const orderId = orderCode(o).toLowerCase()
      const items = o.order_items?.map(it => it.products?.name?.toLowerCase() || '').join(' ') || ''
      if (!customerName.includes(q) && !orderId.includes(q) && !items.includes(q)) return false
    }

    // Date filter check
    if (dateFilter !== 'all') {
      const date = new Date(o.created_at)
      const now = new Date()
      const diffTime = Math.abs(now - date)
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))

      if (dateFilter === 'today') {
        const isToday = date.toDateString() === now.toDateString()
        if (!isToday) return false
      } else if (dateFilter === '7d' && diffDays > 7) {
        return false
      } else if (dateFilter === '30d' && diffDays > 30) {
        return false
      }
    }

    return true
  })

  // Selected Order
  const selectedOrder = orders.find((o) => o.id === selectedOrderId)

  // Calculations for KPIs based on history
  const deliveredCount = orders.filter(o => o.status === 'delivered').length
  const cancelledCount = orders.filter(o => o.status === 'cancelled').length
  const totalRevenue = orders.filter(o => o.status === 'delivered').reduce((sum, o) => sum + (o.total ?? 0), 0)

  const handleExportCSV = () => {
    // Mock export
    alert('Exporting historical order records to CSV...')
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
                All Orders ({orders.length})
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
              {/* Date Filter selector */}
              <div className="relative">
                <Calendar className="absolute top-2.5 left-3 h-3.5 w-3.5 text-ink-soft" />
                <select
                  value={dateFilter}
                  onChange={(e) => setDateFilter(e.target.value)}
                  className="rounded-lg border border-line bg-white pl-9 pr-8 py-2 text-xs font-semibold text-ink-soft focus:border-brand focus:outline-none"
                >
                  <option value="today">Today</option>
                  <option value="7d">Last 7 Days</option>
                  <option value="30d">Last 30 Days</option>
                  <option value="all">All Time</option>
                </select>
              </div>

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
                          <span className="flex items-center gap-1.5 text-xs font-bold text-brand">
                            <span className="flex h-5 w-5 items-center justify-center rounded bg-line-soft text-ink-soft">
                              <Hash className="h-3 w-3" />
                            </span>
                            {shortId}
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
                <h3 className="text-sm font-bold text-ink">
                  Details for {orderCode(selectedOrder)}
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
              <div className="flex justify-between items-center rounded-lg border border-line bg-canvas p-3">
                <span className="text-xs font-semibold text-ink-soft">Settled Status</span>
                <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                  selectedOrder.status === 'delivered' ? 'bg-pos-soft text-pos-dark' : 'bg-red-50 text-red-700'
                }`}>
                  {selectedOrder.status === 'delivered' ? 'Delivered successfully' : 'Cancelled'}
                </span>
              </div>

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
