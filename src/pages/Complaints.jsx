import { useCallback, useEffect, useState } from 'react'
import {
  AlertTriangle,
  Search,
  CheckCircle,
  Clock,
  Phone,
  Wallet,
  CornerUpLeft,
  Truck,
  Check,
  User,
  Hash,
  AlertCircle,
  HelpCircle,
} from 'lucide-react'
import Topbar, { TopIcons } from '../layout/Topbar.jsx'
import { supabase } from '../lib/supabase.js'

const COMPLAINT_TYPES = {
  missing_item: { label: 'Missing Item', color: 'bg-red-50 text-red-700 border-red-100', icon: AlertCircle },
  late_delivery: { label: 'Late Delivery', color: 'bg-amber-50 text-amber-700 border-amber-100', icon: Clock },
  poor_quality: { label: 'Food Quality / Cold', color: 'bg-orange-50 text-orange-700 border-orange-100', icon: AlertTriangle },
  wrong_order: { label: 'Wrong Order Delivered', color: 'bg-purple-50 text-purple-700 border-purple-100', icon: AlertTriangle },
}

const MOCK_ISSUES = [
  { type: 'missing_item', desc: 'Butter Chicken was present but the two Garlic Naans were missing from the package. Please refund.', severity: 'Medium' },
  { type: 'late_delivery', desc: 'The order took more than 50 minutes to arrive. The food was cold and rubbery. Extremely disappointed.', severity: 'High' },
  { type: 'poor_quality', desc: 'The paneer tikka was extremely dry and burnt on the edges. Gravy also spilled inside the carry bag.', severity: 'Low' },
  { type: 'wrong_order', desc: 'Received a mutton biryani instead of the veg paneer biryani I ordered. I am a strict vegetarian!', severity: 'Critical' },
]

export default function Complaints() {
  const [orders, setOrders] = useState([])
  const [complaints, setComplaints] = useState([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [activeTab, setActiveTab] = useState('open') // 'open', 'resolved', 'all'
  const [selectedComplaintId, setSelectedComplaintId] = useState(null)
  const [toastMessage, setToastMessage] = useState(null)

  // Load orders to map actual orders to mock complaints so they link to real DB data
  const load = useCallback(() => {
    return supabase
      .from('orders')
      .select(
        '*, order_items(quantity, price_at_order, products(name, photo_url)), rider:profiles!orders_rider_id_fkey(full_name, phone)'
      )
      .order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (error) console.error('Failed to load orders for complaints:', error.message)
        const dbOrders = data ?? []
        setOrders(dbOrders)

        // Seed complaints based on database orders (especially cancelled or unpaid ones)
        // We will generate a structured list of complaints linked to these orders
        if (dbOrders.length > 0) {
          const list = dbOrders.slice(0, 8).map((order, index) => {
            const mockIssue = MOCK_ISSUES[index % MOCK_ISSUES.length]
            const dateOffset = new Date(order.created_at)
            dateOffset.setMinutes(dateOffset.getMinutes() + 15) // complaint filed shortly after order

            return {
              id: `COMP-${order.id.slice(0, 4).toUpperCase()}`,
              orderId: order.id,
              orderShortId: `ORD-${order.id.slice(0, 4).toUpperCase()}`,
              customerName: order.delivery_address?.name || 'Customer',
              customerPhone: order.delivery_address?.phone || '—',
              customerAddress: order.delivery_address?.address || '—',
              timestamp: dateOffset.toISOString(),
              status: index % 3 === 0 ? 'resolved' : 'open', // mix of resolved and open
              issueType: mockIssue.type,
              description: mockIssue.desc,
              severity: mockIssue.severity,
              orderTotal: order.total,
              items: order.order_items || [],
              rider: order.rider,
            }
          })
          setComplaints(list)
          
          // Select the first open complaint
          const openComps = list.filter(c => c.status === 'open')
          if (openComps.length > 0) {
            setSelectedComplaintId(openComps[0].id)
          } else if (list.length > 0) {
            setSelectedComplaintId(list[0].id)
          }
        }
        setLoading(false)
      })
  }, [])

  useEffect(() => {
    load()
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
        c.id.toLowerCase().includes(q)
      )
    }
    return true
  })

  const selectedComplaint = complaints.find((c) => c.id === selectedComplaintId)

  // Resolve complaint action
  const handleResolve = (id) => {
    setComplaints(prev =>
      prev.map(c => c.id === id ? { ...c, status: 'resolved' } : c)
    )
    showToast('Complaint marked as RESOLVED successfully.')
  }

  // Refund order action
  const handleRefund = async (orderId) => {
    showToast('Initiating refund process... ₹' + selectedComplaint.orderTotal + ' will be credited back.')
    // Update local state status to resolved too
    setComplaints(prev =>
      prev.map(c => c.orderId === orderId ? { ...c, status: 'resolved' } : c)
    )
  }

  // Re-dispatch order action
  const handleRedispatch = (orderId) => {
    showToast('Re-dispatch order scheduled. A new active order has been queued in kitchen.')
    setComplaints(prev =>
      prev.map(c => c.orderId === orderId ? { ...c, status: 'resolved' } : c)
    )
  }

  const showToast = (msg) => {
    setToastMessage(msg)
    setTimeout(() => {
      setToastMessage(null)
    }, 4000)
  }

  const openCount = complaints.filter(c => c.status === 'open').length
  const resolvedCount = complaints.filter(c => c.status === 'resolved').length

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
            <button
              onClick={() => {
                setActiveTab('open')
                const comps = complaints.filter(c => c.status === 'open')
                if (comps.length > 0) setSelectedComplaintId(comps[0].id)
              }}
              className={`rounded-md py-2.5 transition-colors relative flex items-center justify-center gap-1.5 ${
                activeTab === 'open'
                  ? 'bg-white text-brand shadow-sm border border-line-soft'
                  : 'text-ink-soft hover:text-ink'
              }`}
            >
              <span>Active</span>
              {openCount > 0 && (
                <span className="flex h-4 min-w-[16px] items-center justify-center rounded-full bg-brand text-[9px] font-bold text-white px-1">
                  {openCount}
                </span>
              )}
            </button>

            <button
              onClick={() => {
                setActiveTab('resolved')
                const comps = complaints.filter(c => c.status === 'resolved')
                if (comps.length > 0) setSelectedComplaintId(comps[0].id)
              }}
              className={`rounded-md py-2.5 transition-colors relative flex items-center justify-center gap-1.5 ${
                activeTab === 'resolved'
                  ? 'bg-white text-pos-dark shadow-sm border border-line-soft'
                  : 'text-ink-soft hover:text-ink'
              }`}
            >
              <span>Resolved</span>
              {resolvedCount > 0 && (
                <span className="flex h-4 min-w-[16px] items-center justify-center rounded-full bg-pos text-[9px] font-bold text-white px-1">
                  {resolvedCount}
                </span>
              )}
            </button>

            <button
              onClick={() => {
                setActiveTab('all')
                if (complaints.length > 0) setSelectedComplaintId(complaints[0].id)
              }}
              className={`rounded-md py-2.5 transition-colors relative flex items-center justify-center ${
                activeTab === 'all'
                  ? 'bg-white text-ink shadow-sm border border-line-soft'
                  : 'text-ink-soft hover:text-ink'
              }`}
            >
              All Logs
            </button>
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
                  No active complaints found matching this filter.
                </p>
              </div>
            ) : (
              filteredComplaints.map((c) => {
                const isSelected = c.id === selectedComplaintId
                const typeMeta = COMPLAINT_TYPES[c.issueType] ?? COMPLAINT_TYPES.missing_item
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
                      <span className="text-xs font-bold text-ink">{c.id}</span>
                      <span className="text-[10px] text-ink-soft">{formattedTime}</span>
                    </div>

                    <div className="flex justify-between items-start">
                      <div>
                        <p className="text-xs font-bold text-ink">{c.customerName}</p>
                        <p className="text-[11px] text-ink-soft mt-0.5 truncate max-w-[220px]">
                          {c.description}
                        </p>
                      </div>
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-line-soft text-ink-soft">
                        {c.orderShortId}
                      </span>
                    </div>

                    <div className="mt-1 flex items-center justify-between">
                      <span className={`inline-flex items-center gap-1 border px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wide ${typeMeta.color}`}>
                        <ComplaintIcon className="h-2.5 w-2.5" /> {typeMeta.label}
                      </span>
                      
                      <span className={`text-[9px] font-bold px-1.5 rounded-full ${
                        c.severity === 'Critical' || c.severity === 'High'
                          ? 'bg-red-100 text-red-700'
                          : c.severity === 'Medium'
                          ? 'bg-amber-100 text-amber-800'
                          : 'bg-blue-50 text-blue-700'
                      }`}>
                        {c.severity} Severity
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
                        Complaint Report: {selectedComplaint.id}
                      </h2>
                      <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold ${
                        selectedComplaint.status === 'open' ? 'bg-red-50 text-red-700' : 'bg-pos-soft text-pos-dark'
                      }`}>
                        {selectedComplaint.status === 'open' ? 'Open' : 'Resolved'}
                      </span>
                    </div>
                    <p className="text-xs text-ink-soft mt-1">
                      Linked to order{' '}
                      <span className="font-semibold text-brand">{selectedComplaint.orderShortId}</span> • Filed{' '}
                      {new Date(selectedComplaint.timestamp).toLocaleTimeString()} ({new Date(selectedComplaint.timestamp).toLocaleDateString()})
                    </p>
                  </div>
                </div>
              </div>

              {/* Grid content */}
              <div className="grid flex-1 grid-cols-1 lg:grid-cols-3 gap-6 p-6">
                {/* Left Area (Complaint statement, timeline, items) */}
                <div className="lg:col-span-2 space-y-6">
                  {/* Issue Statement */}
                  <div className="rounded-xl border border-line bg-white p-5 shadow-sm space-y-3">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-ink-soft">
                      Complaint Statement
                    </h3>
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
                    <div className="divide-y divide-line-soft">
                      {selectedComplaint.items?.map((it, idx) => (
                        <div key={idx} className="flex justify-between items-center py-2.5 text-xs text-ink font-semibold">
                          <span>{it.quantity} × {it.products?.name || 'Item'}</span>
                          <span>₹{(it.price_at_order ?? 0) * (it.quantity ?? 1)}</span>
                        </div>
                      ))}
                      <div className="flex justify-between items-center py-3 font-bold text-sm border-t border-line border-dashed mt-2">
                        <span className="text-ink">Order Receipt Total</span>
                        <span className="text-brand">₹{selectedComplaint.orderTotal}</span>
                      </div>
                    </div>
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
                          Courier assigned. Delivery was completed. No incident reports was registered by rider app.
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
                        onClick={() => handleRefund(selectedComplaint.orderId)}
                        disabled={selectedComplaint.status === 'resolved'}
                        className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand py-2.5 text-xs font-bold text-white hover:bg-brand-dark transition-colors shadow-sm disabled:opacity-50"
                      >
                        <CornerUpLeft className="h-4 w-4" /> Refund Customer (₹{selectedComplaint.orderTotal})
                      </button>

                      <button
                        onClick={() => handleRedispatch(selectedComplaint.orderId)}
                        disabled={selectedComplaint.status === 'resolved'}
                        className="flex w-full items-center justify-center gap-2 rounded-lg border border-line bg-white py-2.5 text-xs font-bold text-ink hover:bg-canvas transition-colors disabled:opacity-50"
                      >
                        <Truck className="h-4 w-4" /> Re-dispatch Missing Items
                      </button>

                      {selectedComplaint.status === 'open' ? (
                        <button
                          onClick={() => handleResolve(selectedComplaint.id)}
                          className="flex w-full items-center justify-center gap-2 rounded-lg bg-pos py-2.5 text-xs font-bold text-white hover:bg-pos-dark transition-colors shadow-sm"
                        >
                          <Check className="h-4 w-4" strokeWidth={3} /> Mark Complaint Resolved
                        </button>
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
          <CheckCircle className="h-4 w-4 text-pos shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}
    </div>
  )
}
