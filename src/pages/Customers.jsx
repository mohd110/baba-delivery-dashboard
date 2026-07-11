import { useCallback, useEffect, useState } from 'react'
import {
  Users,
  Repeat,
  IndianRupee,
  ShoppingBag,
  Phone,
  Crown,
} from 'lucide-react'
import Topbar, { SearchBox, TopIcons } from '../layout/Topbar.jsx'
import { supabase } from '../lib/supabase.js'
import DateRangeFilter from '../components/DateRangeFilter.jsx'
import { inRange, rangeLabel } from '../lib/dateRange.js'

function initials(name = '') {
  const parts = name.split(' ').filter(Boolean).slice(0, 2)
  return parts.map((w) => w[0]).join('').toUpperCase() || 'C'
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

// Build a customer roster by aggregating every order. Guests with no customer_id
// are still grouped by phone (then name) so repeat guests collapse into one row.
function buildCustomers(orders) {
  const map = new Map()
  orders.forEach((o) => {
    const addr = o.delivery_address ?? {}
    const key = o.customer_id || addr.phone || addr.name
    if (!key) return
    if (!map.has(key)) {
      map.set(key, {
        key,
        name: addr.name || 'Customer',
        phone: addr.phone || null,
        orders: 0,
        spent: 0,
        cancelled: 0,
        lastAt: null,
      })
    }
    const c = map.get(key)
    if (addr.name && c.name === 'Customer') c.name = addr.name
    if (addr.phone && !c.phone) c.phone = addr.phone
    if (o.status === 'cancelled') {
      c.cancelled += 1
    } else {
      c.orders += 1
      c.spent += o.total || 0
    }
    if (!c.lastAt || new Date(o.created_at) > new Date(c.lastAt)) c.lastAt = o.created_at
  })
  return [...map.values()].sort((a, b) => b.spent - a.spent)
}

export default function Customers() {
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [range, setRange] = useState(null)
  const [preset, setPreset] = useState('month')
  const [searchQuery, setSearchQuery] = useState('')

  const load = useCallback(() => {
    return supabase
      .from('orders')
      .select('id, customer_id, total, status, created_at, delivery_address')
      .order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (error) console.error('Failed to load customers:', error.message)
        setOrders(data ?? [])
        setLoading(false)
      })
  }, [])

  useEffect(() => {
    load()
    const channel = supabase
      .channel('customers-page')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => load())
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [load])

  // Aggregate customers from only the orders inside the selected range, then
  // apply the free-text search for display.
  const customers = buildCustomers(orders.filter((o) => inRange(o.created_at, range)))
  const q = searchQuery.trim().toLowerCase()
  const visibleCustomers = q
    ? customers.filter(
        (c) => c.name.toLowerCase().includes(q) || (c.phone || '').toLowerCase().includes(q)
      )
    : customers

  const totalRevenue = customers.reduce((s, c) => s + c.spent, 0)
  const repeat = customers.filter((c) => c.orders > 1).length
  const totalOrders = customers.reduce((s, c) => s + c.orders, 0)
  const avgOrder = totalOrders ? Math.round(totalRevenue / totalOrders) : 0

  const label = rangeLabel(preset, range)
  const kpis = [
    { label: 'TOTAL CUSTOMERS', value: String(customers.length), sub: label, icon: Users, iconBg: 'bg-[#ffdad3] text-brand' },
    { label: 'REPEAT CUSTOMERS', value: String(repeat), sub: 'More than one order', icon: Repeat, iconBg: 'bg-info-soft text-info' },
    { label: 'AVG. ORDER VALUE', value: `₹${avgOrder.toLocaleString('en-IN')}`, sub: 'Per delivered order', icon: ShoppingBag, iconBg: 'bg-pos-soft text-pos-dark' },
    { label: 'TOTAL REVENUE', value: `₹${totalRevenue.toLocaleString('en-IN')}`, sub: 'From all customers', icon: IndianRupee, iconBg: 'bg-[#fef3c7] text-[#b45309]' },
  ]

  return (
    <>
      <Topbar>
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold text-ink">Customer Management</h1>
          <span className="flex items-center gap-1.5 rounded-full bg-[#ffdad3] px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-brand">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand" /> Live
          </span>
        </div>
        <div className="flex items-center gap-2">
          <SearchBox
            placeholder="Search customers..."
            className="w-[260px]"
            value={searchQuery}
            onChange={setSearchQuery}
          />
          <TopIcons />
        </div>
      </Topbar>

      <div className="space-y-6 p-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-ink-soft">
            Showing customers for <span className="font-semibold text-ink">{label}</span>
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
            <h2 className="text-lg font-bold text-ink">Customers</h2>
            <span className="text-sm text-ink-soft">
              {loading ? 'Loading…' : `${visibleCustomers.length} customer${visibleCustomers.length === 1 ? '' : 's'}`}
            </span>
          </div>

          <table className="w-full text-left">
            <thead>
              <tr className="border-y border-line text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
                <th className="px-5 py-3 font-semibold">Customer</th>
                <th className="px-5 py-3 font-semibold">Phone</th>
                <th className="px-5 py-3 font-semibold">Orders</th>
                <th className="px-5 py-3 font-semibold">Total Spent</th>
                <th className="px-5 py-3 font-semibold">Avg / Order</th>
                <th className="px-5 py-3 text-right font-semibold">Last Order</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-soft">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-5 py-12 text-center text-sm text-ink-soft">Loading customers…</td>
                </tr>
              ) : visibleCustomers.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-12 text-center text-sm text-ink-soft">
                    {q
                      ? 'No customers match your search.'
                      : 'No customers in this period — try a wider date range.'}
                  </td>
                </tr>
              ) : (
                visibleCustomers.map((c, i) => (
                  <tr key={c.key}>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        <span className={`flex h-9 w-9 items-center justify-center rounded-full text-xs font-bold ${toneFor(String(c.key))}`}>
                          {initials(c.name)}
                        </span>
                        <div>
                          <p className="flex items-center gap-1.5 text-sm font-semibold text-ink">
                            {c.name}
                            {i === 0 && c.spent > 0 && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-[#fef3c7] px-1.5 py-0.5 text-[10px] font-bold uppercase text-[#b45309]">
                                <Crown className="h-3 w-3" /> VIP
                              </span>
                            )}
                            {i !== 0 && c.orders > 1 && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-info-soft px-1.5 py-0.5 text-[10px] font-bold uppercase text-info">
                                Repeat
                              </span>
                            )}
                          </p>
                          {c.cancelled > 0 && (
                            <p className="text-xs text-ink-soft">{c.cancelled} cancelled</p>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      {c.phone ? (
                        <a href={`tel:${c.phone}`} className="flex items-center gap-1.5 text-sm text-ink hover:text-brand">
                          <Phone className="h-3.5 w-3.5 text-ink-soft" /> {c.phone}
                        </a>
                      ) : (
                        <span className="text-sm text-ink-soft">—</span>
                      )}
                    </td>
                    <td className="px-5 py-4 text-sm font-semibold text-ink">{c.orders}</td>
                    <td className="px-5 py-4 text-sm font-semibold text-ink">₹{c.spent.toLocaleString('en-IN')}</td>
                    <td className="px-5 py-4 text-sm text-ink-soft">
                      ₹{(c.orders ? Math.round(c.spent / c.orders) : 0).toLocaleString('en-IN')}
                    </td>
                    <td className="px-5 py-4 text-right text-sm font-semibold text-ink-soft">{ago(c.lastAt)}</td>
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
