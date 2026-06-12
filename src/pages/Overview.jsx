import { useEffect, useState } from 'react'
import {
  IndianRupee,
  ShoppingBag,
  Store,
  Flame,
  ChevronDown,
  Download,
  Plus,
  Clock,
  ChefHat,
  CheckCircle2,
} from 'lucide-react'
import Topbar, { SearchBox, TopIcons, Divider, ProfileChip } from '../layout/Topbar.jsx'
import { supabase } from '../lib/supabase.js'

function dishImg(name = '') {
  const n = name.toLowerCase()
  if (n.includes('mutton') || n.includes('korma')) return '/assets/mutton-korma.png'
  if (n.includes('paneer')) return '/assets/paneer-tikka.png'
  if (n.includes('butter')) return '/assets/butter-chicken.png'
  if (n.includes('tikka') || n.includes('aatishi')) return '/assets/chicken-aatishi.png'
  if (n.includes('kebab') || n.includes('galouti')) return '/assets/galouti-kebab.png'
  return '/assets/chicken-biryani.png'
}

const RECENT_STATUS = {
  pending: 'PENDING',
  accepted: 'ACCEPTED',
  preparing: 'PREPARING',
  ready: 'READY',
}

/* ---------- KPI cards ---------- */
function buildKpis(totalSales, totalOrders, topItem) {
  return [
    { label: 'Total Sales', value: totalSales, icon: IndianRupee },
    { label: 'Total Orders', value: totalOrders, icon: ShoppingBag },
    { label: 'Active Outlets', value: '1', sub: 'Wali Baba Foods', icon: Store },
    {
      label: 'Top Selling Item',
      value: topItem,
      valueSize: 'text-[20px] leading-7',
      sub: 'Most ordered dish',
      icon: Flame,
      badge: { text: 'HOT ITEM', tone: 'hot' },
    },
  ]
}

function KpiCard({ label, value, valueSize, sub, icon: Icon, badge }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-line bg-white p-[21px] drop-shadow-[0px_4px_6px_rgba(0,0,0,0.03)]">
      <div className="flex items-start justify-between">
        <span className="flex h-8 w-9 items-center text-brand">
          <Icon className="h-[22px] w-[22px]" />
        </span>
        {badge && (
          <span className="rounded px-2 py-0.5 text-[10px] font-bold leading-[15px] text-brand">
            {badge.text}
          </span>
        )}
      </div>
      <p className="mt-3 text-base text-ink-soft">{label}</p>
      <p className={`mt-1 font-bold text-ink ${valueSize ?? 'text-[36px] leading-[44px]'}`}>
        {value}
      </p>
      {sub && <p className="text-sm text-ink-soft">{sub}</p>}
    </div>
  )
}

/* ---------- Recent orders ---------- */
const statusStyles = {
  PREPARING: 'bg-[#fff7ed] text-[#b45309]',
  READY: 'bg-pos-soft text-pos-dark',
  ACCEPTED: 'bg-info-soft text-info',
  PENDING: 'bg-[#f3f4f6] text-[#374151]',
}

function OrderRow({ img, name, id, price, status }) {
  return (
    <div className="flex items-center justify-between py-2">
      <div className="flex items-center gap-3">
        <img src={img} alt="" className="h-10 w-10 rounded-lg bg-line-2 object-cover" />
        <div>
          <p className="text-sm font-semibold text-ink">{name}</p>
          <p className="text-xs text-ink-soft">{id}</p>
        </div>
      </div>
      <div className="flex flex-col items-end gap-1">
        <p className="text-sm font-semibold text-ink">{price}</p>
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${statusStyles[status]}`}>
          {status}
        </span>
      </div>
    </div>
  )
}

/* ---------- Sales chart (real: revenue per day, last 7 days) ---------- */
function buildDailySales(orders) {
  const days = []
  const now = new Date()
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now)
    d.setDate(now.getDate() - i)
    const key = d.toISOString().slice(0, 10)
    days.push({
      key,
      label: d.toLocaleDateString('en-IN', { weekday: 'short' }),
      total: 0,
    })
  }
  const byKey = Object.fromEntries(days.map((d) => [d.key, d]))
  orders.forEach((o) => {
    if (!o.created_at) return
    const key = new Date(o.created_at).toISOString().slice(0, 10)
    if (byKey[key]) byKey[key].total += o.total || 0
  })
  return days
}

function SalesChart({ data }) {
  const max = Math.max(1, ...data.map((d) => d.total))
  const hasSales = data.some((d) => d.total > 0)
  return (
    <div className="flex h-[300px] w-full flex-col">
      {!hasSales ? (
        <div className="flex flex-1 items-center justify-center text-sm text-ink-soft">
          No sales in the last 7 days yet.
        </div>
      ) : (
        <div className="flex flex-1 items-end gap-3">
          {data.map((d) => (
            <div key={d.key} className="flex flex-1 flex-col items-center justify-end gap-2">
              <span className="text-[11px] font-semibold text-ink-soft">
                {d.total > 0 ? `₹${d.total.toLocaleString('en-IN')}` : ''}
              </span>
              <div
                className="w-full rounded-t-md bg-brand/85"
                style={{ height: `${Math.max(2, (d.total / max) * 220)}px` }}
              />
            </div>
          ))}
        </div>
      )}
      <div className="mt-2 flex justify-between gap-3 px-1 text-xs text-ink-soft">
        {data.map((d) => (
          <span key={d.key} className="flex-1 text-center">
            {d.label}
          </span>
        ))}
      </div>
    </div>
  )
}

/* ---------- Bottom cards (real: live order pipeline) ---------- */
function BottomCard({ label, value, sub, subTone, icon: Icon }) {
  return (
    <div className="flex h-[122px] items-center justify-between rounded-xl border border-line bg-line-soft p-[21px]">
      <div className="flex flex-col gap-1">
        <p className="text-base text-ink-soft">{label}</p>
        <p className="text-[20px] font-semibold leading-7 text-ink">{value}</p>
        <p className={`flex items-center gap-1 text-sm font-semibold ${subTone}`}>{sub}</p>
      </div>
      <Icon className="h-7 w-7 text-ink-soft/60" />
    </div>
  )
}

/* ---------- Page ---------- */
export default function Overview() {
  const [orders, setOrders] = useState([])

  useEffect(() => {
    let alive = true
    const load = () =>
      supabase
        .from('orders')
        .select('*, order_items(quantity, products(name))')
        .order('created_at', { ascending: false })
        .then(({ data, error }) => {
          if (!alive) return
          if (error) console.error('Failed to load orders:', error.message)
          setOrders(data ?? [])
        })

    load()
    // Keep the overview live as orders arrive / change status.
    const channel = supabase
      .channel('overview-orders')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => load())
      .subscribe()

    return () => {
      alive = false
      supabase.removeChannel(channel)
    }
  }, [])

  const totalSalesNum = orders.reduce((s, o) => s + (o.total || 0), 0)
  const totalSales = `₹${totalSalesNum.toLocaleString('en-IN')}`
  const totalOrders = orders.length.toLocaleString('en-IN')

  // most-ordered dish across all order_items
  const counts = {}
  orders.forEach((o) =>
    (o.order_items ?? []).forEach((it) => {
      const name = it.products?.name
      if (name) counts[name] = (counts[name] || 0) + (it.quantity || 1)
    })
  )
  const topItem = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '—'

  const kpis = buildKpis(totalSales, totalOrders, topItem)
  const dailySales = buildDailySales(orders)

  const pending = orders.filter((o) => o.status === 'pending').length
  const preparing = orders.filter((o) => ['accepted', 'preparing'].includes(o.status)).length
  const ready = orders.filter((o) => o.status === 'ready').length

  const bottomCards = [
    { label: 'Pending', value: `${pending} order${pending === 1 ? '' : 's'}`, sub: 'Awaiting acceptance', subTone: 'text-ink-soft', icon: Clock },
    { label: 'In Kitchen', value: `${preparing} order${preparing === 1 ? '' : 's'}`, sub: 'Accepted + preparing', subTone: 'text-ink-soft', icon: ChefHat },
    { label: 'Ready', value: `${ready} order${ready === 1 ? '' : 's'}`, sub: 'Awaiting pickup', subTone: 'text-pos', icon: CheckCircle2 },
  ]

  const recent = orders.slice(0, 4).map((o) => {
    const items = o.order_items ?? []
    const first = items[0]
    const name = first?.products?.name ?? 'Order'
    const label = items.length > 1 ? `${name} +${items.length - 1}` : `${name} x ${first?.quantity ?? 1}`
    return {
      img: dishImg(name),
      name: label,
      id: `#ORD-${o.id.slice(0, 4).toUpperCase()}`,
      price: `₹${o.total}`,
      status: RECENT_STATUS[o.status] ?? 'PENDING',
    }
  })

  return (
    <>
      <Topbar>
        <SearchBox placeholder="Search orders, menus, or customers..." className="w-full max-w-[448px]" />
        <div className="flex items-center gap-1">
          <TopIcons />
          <Divider />
          <ProfileChip name="Chef Biryani" img="/assets/admin-topbar.png" />
        </div>
      </Topbar>
      <div className="relative p-8">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-[32px] font-bold leading-8 text-ink">Dashboard Overview</h1>
          <p className="mt-2 text-base text-ink-soft">
            Real-time performance metrics for Wali Baba Foods.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button className="flex items-center gap-2 rounded-lg border border-line bg-white px-4 py-2.5 text-sm font-medium text-ink">
            Last 30 Days
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
          <button className="flex items-center gap-2 rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-brand-dark">
            <Download className="h-3.5 w-3.5" />
            Export Report
          </button>
        </div>
      </div>

      {/* KPI grid */}
      <div className="mt-6 grid grid-cols-4 gap-6">
        {kpis.map((k) => (
          <KpiCard key={k.label} {...k} />
        ))}
      </div>

      {/* Main insights */}
      <div className="mt-6 grid grid-cols-[1fr_320px] gap-6">
        {/* Chart */}
        <div className="rounded-xl border border-line bg-white p-[21px]">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-xl font-semibold text-ink">Sales Performance Trend</h2>
              <p className="mt-1 text-sm text-ink-soft">
                Daily revenue over the last 7 days
              </p>
            </div>
            <div className="flex items-center gap-4 text-sm text-ink-soft">
              <span className="flex items-center gap-1.5">
                <span className="h-3 w-3 rounded-sm bg-brand" /> Revenue
              </span>
            </div>
          </div>
          <SalesChart data={dailySales} />
        </div>

        {/* Recent orders */}
        <div className="flex flex-col rounded-xl border border-line bg-white p-[21px]">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold text-ink">Recent Orders</h2>
            <button className="text-sm font-semibold text-brand">View All</button>
          </div>
          <div className="mt-2 flex-1 divide-y divide-line-soft">
            {recent.length === 0 ? (
              <p className="py-6 text-center text-sm text-ink-soft">No recent orders.</p>
            ) : (
              recent.map((o, i) => <OrderRow key={i} {...o} />)
            )}
          </div>
          <div className="mt-4 flex items-center justify-between border-t border-line pt-4">
            <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-brand">
              <span className="h-2 w-2 animate-pulse rounded-full bg-brand" />
              Live Status
            </span>
          </div>
        </div>
      </div>

      {/* Bottom bento (live order pipeline) */}
      <div className="mt-6 grid grid-cols-3 gap-6">
        {bottomCards.map((c) => (
          <BottomCard key={c.label} {...c} />
        ))}
      </div>

      {/* FAB */}
      <button className="fixed bottom-8 right-8 flex h-14 w-14 items-center justify-center rounded-full bg-brand text-white shadow-lg hover:bg-brand-dark">
        <Plus className="h-5 w-5" />
      </button>
      </div>
    </>
  )
}
