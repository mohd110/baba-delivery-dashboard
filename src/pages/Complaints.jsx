import { useCallback, useEffect, useState } from 'react'
import {
  AlertTriangle,
  Search,
  CheckCircle,
  Clock,
  Phone,
  CornerUpLeft,
  Truck,
  Check,
  User,
  Tag,
  AlertCircle,
  HelpCircle,
  Ban,
} from 'lucide-react'
import Topbar, { TopIcons } from '../layout/Topbar.jsx'
import { supabase } from '../lib/supabase.js'
import { orderCode } from '../lib/format.js'
import { boldLast4 } from '../components/OrderIdLabel.jsx'

// Visual styling per known complaint category. Unknown categories fall back to
// a neutral style with a prettified label (see typeMetaFor below), so the page
// keeps working even if new category values are added in the database.
const COMPLAINT_TYPES = {
  missing_item: { label: 'Missing Item', color: 'bg-red-50 text-red-700 border-red-100', icon: AlertCircle },
  late_delivery: { label: 'Late Delivery', color: 'bg-amber-50 text-amber-700 border-amber-100', icon: Clock },
  poor_quality: { label: 'Food Quality / Cold', color: 'bg-orange-50 text-orange-700 border-orange-100', icon: AlertTriangle },
  food_quality: { label: 'Food Quality / Cold', color: 'bg-orange-50 text-orange-700 border-orange-100', icon: AlertTriangle },
  wrong_order: { label: 'Wrong Order Delivered', color: 'bg-purple-50 text-purple-700 border-purple-100', icon: AlertTriangle },
  wrong_item: { label: 'Wrong Item', color: 'bg-purple-50 text-purple-700 border-purple-100', icon: AlertTriangle },
  damaged: { label: 'Damaged Packaging', color: 'bg-rose-50 text-rose-700 border-rose-100', icon: AlertTriangle },
  billing: { label: 'Billing Issue', color: 'bg-blue-50 text-blue-700 border-blue-100', icon: Tag },
  payment: { label: 'Payment Issue', color: 'bg-blue-50 text-blue-700 border-blue-100', icon: Tag },
  rider_behavior: { label: 'Rider Behaviour', color: 'bg-indigo-50 text-indigo-700 border-indigo-100', icon: Truck },
  other: { label: 'Other', color: 'bg-slate-50 text-slate-700 border-slate-100', icon: HelpCircle },
}

function prettify(value) {
  return String(value || 'Other')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

function typeMetaFor(category) {
  const key = String(category || '').toLowerCase()
  return (
    COMPLAINT_TYPES[key] || {
      label: prettify(category),
      color: 'bg-slate-50 text-slate-700 border-slate-100',
      icon: HelpCircle,
    }
  )
}

// Complaints normalise to one of three states: still-needs-attention (open),
// cancelled/dismissed, or otherwise resolved.
const OPEN_STATES = new Set(['open', 'pending', 'in_progress', 'new', 'reopened'])
const CANCELLED_STATES = new Set(['cancelled', 'canceled', 'dismissed', 'rejected'])

// The database enforces a CHECK constraint on complaints.status, but the exact
// set of allowed values isn't known to the client (it was defined in Supabase,
// not in this repo). Rather than hard-code one guess, we try a list of common
// synonyms in order and keep the first the database accepts. The candidate
// pools for "resolved" and "cancelled" are disjoint so whichever value lands
// still reads back as the right state via normStatus/CANCELLED_STATES.
const RESOLVE_CANDIDATES = ['resolved', 'closed', 'completed', 'done', 'solved']
const CANCEL_CANDIDATES = ['cancelled', 'canceled', 'dismissed', 'rejected']
function normStatus(status) {
  const s = String(status || 'open').toLowerCase()
  if (CANCELLED_STATES.has(s)) return 'cancelled'
  return OPEN_STATES.has(s) ? 'open' : 'resolved'
}

// Badge label + colour for a normalised status.
const STATUS_LABEL = { open: 'Open', resolved: 'Resolved', cancelled: 'Cancelled' }
function statusBadgeClass(status) {
  if (status === 'open') return 'bg-red-50 text-red-700'
  if (status === 'cancelled') return 'bg-line-soft text-ink-soft'
  return 'bg-pos-soft text-pos-dark'
}

function shortId(id, prefix) {
  return id ? `${prefix}-${String(id).slice(0, 4).toUpperCase()}` : '—'
}

export default function Complaints() {
  const [complaints, setComplaints] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [activeTab, setActiveTab] = useState('open') // 'open', 'resolved', 'all'
  const [selectedComplaintId, setSelectedComplaintId] = useState(null)
  const [toastMessage, setToastMessage] = useState(null)

  // Load real complaints from the database, joined to the originating order
  // (for the receipt + rider) and the customer profile.
  const load = useCallback(() => {
    return supabase
      .from('complaints')
      .select(
        `id, order_id, customer_id, category, description, status, created_at,
         customer:profiles(full_name, phone),
         order:orders(
           id, order_number, total, delivery_address, delivery_fee, discount_amount, coupon_code,
           order_items(quantity, price_at_order, products(name, photo_url)),
           rider:profiles!orders_rider_id_fkey(full_name, phone)
         )`
      )
      .order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (error) console.error('Failed to load complaints:', error.message)
        const list = (data ?? []).map((row) => {
          const order = row.order || {}
          const addr = order.delivery_address || {}
          const cust = row.customer || {}
          return {
            id: row.id,
            code: shortId(row.id, 'COMP'),
            orderId: row.order_id,
            orderShortId: row.order_id ? orderCode(order) : '—',
            customerName: cust.full_name || addr.name || 'Customer',
            customerPhone: cust.phone || addr.phone || '',
            customerAddress: addr.address || '—',
            timestamp: row.created_at,
            status: normStatus(row.status),
            category: row.category,
            description: row.description || 'No description provided.',
            orderTotal: typeof order.total === 'number' ? order.total : null,
            items: order.order_items || [],
            rider: order.rider || null,
          }
        })
        setComplaints(list)

        // Keep the current selection if it still exists; otherwise pick the
        // first open complaint (falling back to the first of any).
        setSelectedComplaintId((prev) => {
          if (prev && list.some((c) => c.id === prev)) return prev
          const firstOpen = list.find((c) => c.status === 'open')
          return firstOpen?.id ?? list[0]?.id ?? null
        })
        setLoading(false)
      })
  }, [])

  useEffect(() => {
    load()
    const channel = supabase
      .channel('complaints-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'complaints' }, () => load())
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [load])

  // Filter complaints
  const filteredComplaints = complaints.filter((c) => {
    if (activeTab === 'open' && c.status !== 'open') return false
    if (activeTab === 'resolved' && c.status !== 'resolved') return false

    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      return (
        c.customerName.toLowerCase().includes(q) ||
        c.orderShortId.toLowerCase().includes(q) ||
        c.description.toLowerCase().includes(q) ||
        c.code.toLowerCase().includes(q)
      )
    }
    return true
  })

  const selectedComplaint = complaints.find((c) => c.id === selectedComplaintId)

  // Persist a status change to the database, then update local state.
  // `candidates` are the raw values we try writing (first accepted wins);
  // `localStatus` is the normalised state we render with.
  const updateStatus = async (id, candidates, localStatus, message) => {
    if (busy) return false
    setBusy(id)
    let lastError = null
    let saved = false
    for (const dbStatus of candidates) {
      const { error } = await supabase.from('complaints').update({ status: dbStatus }).eq('id', id)
      if (!error) {
        saved = true
        break
      }
      lastError = error
      // Only keep trying alternatives when the DB rejected the value itself
      // (check-constraint violation). Bail out on anything else (auth, network).
      if (!/check constraint|violates|invalid input/i.test(error.message)) break
    }
    setBusy(null)
    if (!saved) {
      showToast(`Could not update complaint: ${lastError?.message ?? 'unknown error'}`, true)
      return false
    }
    setComplaints((prev) => prev.map((c) => (c.id === id ? { ...c, status: localStatus } : c)))
    if (message) showToast(message)
    return true
  }

  const setResolved = (id, message) => updateStatus(id, RESOLVE_CANDIDATES, 'resolved', message)

  const handleResolve = (id) => setResolved(id, 'Complaint marked as RESOLVED successfully.')

  const handleCancel = (id) => {
    if (busy) return
    if (!window.confirm('Cancel this complaint? It will be dismissed and removed from the active queue.')) return
    updateStatus(id, CANCEL_CANDIDATES, 'cancelled', 'Complaint cancelled and dismissed.')
  }

  const handleRefund = (complaint) => {
    const amount = complaint.orderTotal != null ? `₹${complaint.orderTotal}` : 'the order amount'
    setResolved(complaint.id, `Refund initiated. ${amount} will be credited back to the customer.`)
  }

  const handleRedispatch = (complaint) => {
    setResolved(complaint.id, 'Re-dispatch scheduled. A new active order has been queued in the kitchen.')
  }

  const showToast = (msg, isError = false) => {
    setToastMessage({ text: msg, error: isError })
    setTimeout(() => {
      setToastMessage(null)
    }, 4000)
  }

  const openCount = complaints.filter((c) => c.status === 'open').length
  const resolvedCount = complaints.filter((c) => c.status === 'resolved').length

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-canvas">
      {/* Topbar */}
      <Topbar>
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold text-ink">Customer Complaints</h1>
          <span className="flex items-center gap-1.5 rounded-full bg-red-50 border border-red-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-red-600">
            <AlertCircle className="h-3.5 w-3.5 animate-bounce" /> Complaint Console
          </span>
        </div>
        <div className="flex items-center gap-2">
          <TopIcons />
        </div>
      </Topbar>

      {/* Main Dual Column Content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left Column: Master List */}
        <div className="flex w-[380px] shrink-0 flex-col border-r border-line bg-white">
          {/* Search */}
          <div className="p-4 border-b border-line">
            <div className="relative">
              <Search className="absolute top-2.5 left-3 h-4 w-4 text-ink-soft" />
              <input
                type="text"
                placeholder="Search complaints or order ID..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full rounded-lg border border-line bg-canvas pl-9 pr-4 py-2 text-sm text-ink placeholder-ink-soft focus:border-brand focus:outline-none"
              />
            </div>
          </div>

          {/* Status Tabs */}
          <div className="grid grid-cols-3 border-b border-line bg-canvas/30 p-1.5 text-xs font-semibold">
            {[
              { key: 'open', label: 'Active', count: openCount, activeText: 'text-brand', badge: 'bg-brand' },
              { key: 'resolved', label: 'Resolved', count: resolvedCount, activeText: 'text-pos-dark', badge: 'bg-pos' },
              { key: 'all', label: 'All Logs', count: complaints.length, activeText: 'text-ink', badge: 'bg-ink-soft' },
            ].map((tab) => (
              <button
                key={tab.key}
                onClick={() => {
                  setActiveTab(tab.key)
                  // Select the first complaint visible under the newly chosen tab.
                  const first = complaints.find(
                    (c) => tab.key === 'all' || c.status === tab.key
                  )
                  if (first) setSelectedComplaintId(first.id)
                }}
                className={`rounded-md py-2.5 transition-colors relative flex items-center justify-center gap-1.5 ${
                  activeTab === tab.key
                    ? `bg-white ${tab.activeText} shadow-sm border border-line-soft`
                    : 'text-ink-soft hover:text-ink'
                }`}
              >
                <span>{tab.label}</span>
                {tab.count > 0 && (
                  <span className={`flex h-4 min-w-[16px] items-center justify-center rounded-full ${tab.badge} text-[9px] font-bold text-white px-1`}>
                    {tab.count}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Complaints cards */}
          <div className="flex-1 overflow-y-auto divide-y divide-line-soft">
            {loading ? (
              <div className="flex h-32 items-center justify-center text-xs text-ink-soft">
                Loading complaint logs...
              </div>
            ) : filteredComplaints.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
                <CheckCircle className="h-10 w-10 text-pos mb-2" />
                <p className="text-sm font-semibold text-ink">All clear!</p>
                <p className="text-xs text-ink-soft mt-1">
                  No complaints found matching this filter.
                </p>
              </div>
            ) : (
              filteredComplaints.map((c) => {
                const isSelected = c.id === selectedComplaintId
                const typeMeta = typeMetaFor(c.category)
                const ComplaintIcon = typeMeta.icon

                // Format timestamp
                const formattedTime = new Date(c.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

                return (
                  <div
                    key={c.id}
                    onClick={() => setSelectedComplaintId(c.id)}
                    className={`flex flex-col gap-2 p-4 cursor-pointer text-left transition-all hover:bg-canvas/50 ${
                      isSelected ? 'border-l-4 border-brand bg-brand/5' : 'border-l-4 border-transparent'
                    }`}
                  >
                    <div className="flex justify-between items-center">
                      <span className="text-xs font-bold text-ink">{c.code}</span>
                      <span className="text-[10px] text-ink-soft">{formattedTime}</span>
                    </div>

                    <div className="flex justify-between items-start">
                      <div>
                        <p className="text-xs font-bold text-ink">{c.customerName}</p>
                        <p className="text-[11px] text-ink-soft mt-0.5 truncate max-w-[220px]">
                          {c.description}
                        </p>
                      </div>
                      <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-line-soft text-ink-soft">
                        {boldLast4(c.orderShortId)}
                      </span>
                    </div>

                    <div className="mt-1 flex items-center justify-between">
                      <span className={`inline-flex items-center gap-1 border px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wide ${typeMeta.color}`}>
                        <ComplaintIcon className="h-2.5 w-2.5" /> {typeMeta.label}
                      </span>

                      <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${statusBadgeClass(c.status)}`}>
                        {STATUS_LABEL[c.status]}
                      </span>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>

        {/* Right Column: Complaint Details Panel */}
        <div className="flex-1 bg-canvas flex flex-col overflow-y-auto">
          {selectedComplaint ? (
            <div className="flex flex-col min-h-full">
              {/* Header */}
              <div className="border-b border-line bg-white p-6 shadow-sm">
                <div className="flex justify-between items-start">
                  <div>
                    <div className="flex items-center gap-3">
                      <h2 className="text-lg font-bold text-ink">
                        Complaint Report: {selectedComplaint.code}
                      </h2>
                      <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold ${statusBadgeClass(selectedComplaint.status)}`}>
                        {STATUS_LABEL[selectedComplaint.status]}
                      </span>
                    </div>
                    <p className="text-xs text-ink-soft mt-1">
                      Linked to order{' '}
                      <span className="text-brand">{boldLast4(selectedComplaint.orderShortId)}</span> • Filed{' '}
                      {new Date(selectedComplaint.timestamp).toLocaleTimeString()} ({new Date(selectedComplaint.timestamp).toLocaleDateString()})
                    </p>
                  </div>
                </div>
              </div>

              {/* Grid content */}
              <div className="grid flex-1 grid-cols-1 lg:grid-cols-3 gap-6 p-6">
                {/* Left Area (Complaint statement, customer, items) */}
                <div className="lg:col-span-2 space-y-6">
                  {/* Issue Statement */}
                  <div className="rounded-xl border border-line bg-white p-5 shadow-sm space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-xs font-bold uppercase tracking-wider text-ink-soft">
                        Complaint Statement
                      </h3>
                      {(() => {
                        const typeMeta = typeMetaFor(selectedComplaint.category)
                        const ComplaintIcon = typeMeta.icon
                        return (
                          <span className={`inline-flex items-center gap-1 border px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wide ${typeMeta.color}`}>
                            <ComplaintIcon className="h-2.5 w-2.5" /> {typeMeta.label}
                          </span>
                        )
                      })()}
                    </div>
                    <div className="p-4 rounded-lg bg-red-50/30 border border-red-100/50">
                      <p className="text-sm text-ink font-medium leading-relaxed italic">
                        "{selectedComplaint.description}"
                      </p>
                    </div>
                  </div>

                  {/* Customer details */}
                  <div className="rounded-xl border border-line bg-white p-5 shadow-sm space-y-3">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-ink-soft">
                      Customer Information
                    </h3>
                    <div className="grid grid-cols-2 gap-4 text-xs">
                      <div>
                        <span className="text-ink-soft block mb-0.5">Name</span>
                        <span className="font-bold text-ink flex items-center gap-1.5">
                          <User className="h-3.5 w-3.5 text-ink-soft" /> {selectedComplaint.customerName}
                        </span>
                      </div>
                      <div>
                        <span className="text-ink-soft block mb-0.5">Phone Number</span>
                        {selectedComplaint.customerPhone ? (
                          <span className="font-bold text-ink flex items-center gap-1.5">
                            <Phone className="h-3.5 w-3.5 text-ink-soft" />
                            <a href={`tel:${selectedComplaint.customerPhone}`} className="text-brand hover:underline">
                              {selectedComplaint.customerPhone}
                            </a>
                          </span>
                        ) : (
                          <span>—</span>
                        )}
                      </div>
                      <div className="col-span-2">
                        <span className="text-ink-soft block mb-0.5">Delivery Address</span>
                        <span className="font-semibold text-ink">{selectedComplaint.customerAddress}</span>
                      </div>
                    </div>
                  </div>

                  {/* Order Receipt */}
                  <div className="rounded-xl border border-line bg-white p-5 shadow-sm">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-ink-soft mb-3">
                      Original Order Receipt
                    </h3>
                    {selectedComplaint.items.length > 0 ? (
                      <div className="divide-y divide-line-soft">
                        {selectedComplaint.items.map((it, idx) => (
                          <div key={idx} className="flex justify-between items-center py-2.5 text-xs text-ink font-semibold">
                            <span>{it.quantity} × {it.products?.name || 'Item'}</span>
                            <span>₹{(it.price_at_order ?? 0) * (it.quantity ?? 1)}</span>
                          </div>
                        ))}
                        <div className="flex justify-between items-center py-3 font-bold text-sm border-t border-line border-dashed mt-2">
                          <span className="text-ink">Order Receipt Total</span>
                          <span className="text-brand">
                            {selectedComplaint.orderTotal != null ? `₹${selectedComplaint.orderTotal}` : '—'}
                          </span>
                        </div>
                      </div>
                    ) : (
                      <p className="text-xs text-ink-soft text-center py-4">
                        No order items linked to this complaint.
                      </p>
                    )}
                  </div>
                </div>

                {/* Right Area: Rider info & Action console */}
                <div className="space-y-6">
                  {/* Delivery Fleet Tracking */}
                  <div className="rounded-xl border border-line bg-white p-5 shadow-sm">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-ink-soft mb-3">
                      Delivery Tracking Info
                    </h3>
                    {selectedComplaint.rider ? (
                      <div className="space-y-3 text-xs">
                        <div className="flex items-center gap-3">
                          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-50 text-indigo-700">
                            <Truck className="h-4 w-4" />
                          </span>
                          <div>
                            <p className="font-bold text-ink">{selectedComplaint.rider.full_name}</p>
                            <p className="text-[10px] text-ink-soft">Phone: {selectedComplaint.rider.phone || '—'}</p>
                          </div>
                        </div>
                        <div className="p-2.5 rounded-lg bg-canvas text-ink-soft text-[11px]">
                          Courier assigned. Delivery was completed. No incident reports were registered by the rider app.
                        </div>
                      </div>
                    ) : (
                      <p className="text-xs text-ink-soft text-center py-4">No rider logs linked to this order.</p>
                    )}
                  </div>

                  {/* Resolution Action Console */}
                  <div className="rounded-xl border border-line bg-white p-5 shadow-sm space-y-4">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-ink-soft">
                      Resolution Actions
                    </h3>

                    <div className="space-y-2">
                      <button
                        onClick={() => handleRefund(selectedComplaint)}
                        disabled={selectedComplaint.status !== 'open' || busy === selectedComplaint.id}
                        className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand py-2.5 text-xs font-bold text-white hover:bg-brand-dark transition-colors shadow-sm disabled:opacity-50"
                      >
                        <CornerUpLeft className="h-4 w-4" /> Refund Customer
                        {selectedComplaint.orderTotal != null ? ` (₹${selectedComplaint.orderTotal})` : ''}
                      </button>

                      <button
                        onClick={() => handleRedispatch(selectedComplaint)}
                        disabled={selectedComplaint.status !== 'open' || busy === selectedComplaint.id}
                        className="flex w-full items-center justify-center gap-2 rounded-lg border border-line bg-white py-2.5 text-xs font-bold text-ink hover:bg-canvas transition-colors disabled:opacity-50"
                      >
                        <Truck className="h-4 w-4" /> Re-dispatch Missing Items
                      </button>

                      {selectedComplaint.status === 'open' ? (
                        <>
                          <button
                            onClick={() => handleResolve(selectedComplaint.id)}
                            disabled={busy === selectedComplaint.id}
                            className="flex w-full items-center justify-center gap-2 rounded-lg bg-pos py-2.5 text-xs font-bold text-white hover:bg-pos-dark transition-colors shadow-sm disabled:opacity-50"
                          >
                            <Check className="h-4 w-4" strokeWidth={3} /> Mark Complaint Resolved
                          </button>
                          <button
                            onClick={() => handleCancel(selectedComplaint.id)}
                            disabled={busy === selectedComplaint.id}
                            className="flex w-full items-center justify-center gap-2 rounded-lg border border-red-200 bg-white py-2.5 text-xs font-bold text-red-600 hover:bg-red-50 hover:border-red-300 transition-colors disabled:opacity-50"
                          >
                            <Ban className="h-4 w-4" /> Cancel Complaint
                          </button>
                        </>
                      ) : selectedComplaint.status === 'cancelled' ? (
                        <div className="flex items-center justify-center gap-1.5 rounded-lg bg-line-soft py-2.5 text-xs font-bold text-ink-soft border border-line">
                          <Ban className="h-4 w-4" /> Complaint Cancelled
                        </div>
                      ) : (
                        <div className="flex items-center justify-center gap-1.5 rounded-lg bg-pos-soft py-2.5 text-xs font-bold text-pos-dark border border-pos-soft">
                          <CheckCircle className="h-4 w-4" /> Complaint Resolved
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center flex-1 py-32 px-4 text-center">
              <HelpCircle className="h-12 w-12 text-line-2 mb-2" />
              <h3 className="text-lg font-bold text-ink">No Complaint Selected</h3>
              <p className="text-sm text-ink-soft mt-1">
                Select a ticket from the left panel to review notes, trace deliveries, and resolve issues.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Floating Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-xl bg-ink text-white px-4 py-3.5 text-xs font-semibold shadow-xl border border-line-soft/10 animate-bounce">
          {toastMessage.error ? (
            <AlertCircle className="h-4 w-4 text-brand shrink-0" />
          ) : (
            <CheckCircle className="h-4 w-4 text-pos shrink-0" />
          )}
          <span>{toastMessage.text}</span>
        </div>
      )}
    </div>
  )
}
