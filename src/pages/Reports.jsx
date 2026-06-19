import { useCallback, useEffect, useRef, useState } from 'react'
import {
  IndianRupee,
  ShoppingBag,
  TrendingUp,
  Receipt,
  Download,
} from 'lucide-react'
import Topbar, { TopIcons } from '../layout/Topbar.jsx'
import { supabase } from '../lib/supabase.js'

/* ---------- animation hook: eases 0 → 1 on mount / data change ---------- */
function useProgress(trigger) {
  const [p, setP] = useState(0)
  const raf = useRef(0)
  useEffect(() => {
    let start
    const dur = 1100
    // First frame (k=0) sets progress to 0, so no synchronous reset is needed.
    const tick = (t) => {
      if (start == null) start = t
      const k = Math.min(1, (t - start) / dur)
      setP(1 - Math.pow(1 - k, 3)) // easeOutCubic
      if (k < 1) raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf.current)
  }, [trigger])
  return p
}

const STATUS_META = {
  delivered: { label: 'Delivered', color: '#16a34a' },
  out_for_delivery: { label: 'On the way', color: '#1d4ed8' },
  ready: { label: 'Ready', color: '#0ea5e9' },
  preparing: { label: 'Preparing', color: '#f59e0b' },
  accepted: { label: 'Accepted', color: '#6366f1' },
  pending: { label: 'Pending', color: '#9ca3af' },
  cancelled: { label: 'Cancelled', color: '#ef4444' },
}

const inr = (n) => `₹${Math.round(n).toLocaleString('en-IN')}`

/* ---------- animated donut / pie ---------- */
function Donut({ segments, progress, center }) {
  const total = segments.reduce((s, x) => s + x.value, 0)
  const r = 64
  const sw = 24
  const C = 2 * Math.PI * r
  let acc = 0
  return (
    <div className="relative h-44 w-44 shrink-0">
      <svg viewBox="0 0 160 160" className="h-full w-full -rotate-90">
        <circle cx="80" cy="80" r={r} fill="none" stroke="#edeeef" strokeWidth={sw} />
        {total > 0 &&
          segments.map((s) => {
            const frac = s.value / total
            const a = acc
            acc += frac
            const visible = Math.max(0, Math.min(frac, progress - a))
            const len = visible * C
            return (
              <circle
                key={s.label}
                cx="80"
                cy="80"
                r={r}
                fill="none"
                stroke={s.color}
                strokeWidth={sw}
                strokeDasharray={`${len} ${C - len}`}
                strokeDashoffset={-a * C}
              />
            )
          })}
      </svg>
      {center && (
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-bold text-ink">{center.value}</span>
          <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">{center.label}</span>
        </div>
      )}
    </div>
  )
}

function Legend({ segments, total }) {
  return (
    <div className="flex flex-1 flex-col justify-center gap-2.5">
      {segments.length === 0 && <p className="text-sm text-ink-soft">No data yet.</p>}
      {segments.map((s) => (
        <div key={s.label} className="flex items-center justify-between gap-3 text-sm">
          <span className="flex items-center gap-2 text-ink">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />
            {s.label}
          </span>
          <span className="font-semibold text-ink-soft">
            {s.value}
            {total ? <span className="ml-1 text-xs text-ink-soft">({Math.round((s.value / total) * 100)}%)</span> : null}
          </span>
        </div>
      ))}
    </div>
  )
}

function DonutCard({ title, segments, centerLabel }) {
  const progress = useProgress(segments.map((s) => s.value).join(','))
  const total = segments.reduce((s, x) => s + x.value, 0)
  return (
    <div className="rounded-xl border border-line bg-white p-6">
      <h3 className="text-base font-bold text-ink">{title}</h3>
      <div className="mt-4 flex items-center gap-6">
        <Donut segments={segments} progress={progress} center={{ value: total, label: centerLabel }} />
        <Legend segments={segments} total={total} />
      </div>
    </div>
  )
}

/* ---------- animated revenue area + line chart ---------- */
function RevenueChart({ data }) {
  const progress = useProgress(data.map((d) => d.total).join(','))
  const W = 720
  const H = 260
  const pad = { t: 20, r: 16, b: 28, l: 48 }
  const cw = W - pad.l - pad.r
  const ch = H - pad.t - pad.b
  const max = Math.max(1, ...data.map((d) => d.total))
  const hasSales = data.some((d) => d.total > 0)
  const n = data.length

  const x = (i) => pad.l + (n === 1 ? cw / 2 : (i * cw) / (n - 1))
  const y = (v) => pad.t + ch - (v / max) * ch

  const linePts = data.map((d, i) => `${x(i)},${y(d.total)}`)
  const linePath = `M ${linePts.join(' L ')}`
  const areaPath = `${linePath} L ${x(n - 1)},${pad.t + ch} L ${x(0)},${pad.t + ch} Z`
  const ticks = [0, 0.5, 1].map((f) => ({ v: max * f, yy: y(max * f) }))

  return (
    <div className="rounded-xl border border-line bg-white p-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-bold text-ink">Revenue — last 14 days</h3>
          <p className="text-xs text-ink-soft">Daily sales from non-cancelled orders</p>
        </div>
        <span className="text-sm font-bold text-brand">{inr(data.reduce((s, d) => s + d.total, 0))}</span>
      </div>

      {!hasSales ? (
        <div className="flex h-[260px] items-center justify-center text-sm text-ink-soft">
          No sales in the last 14 days yet.
        </div>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} className="mt-3 w-full">
          <defs>
            <linearGradient id="revFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#b51c00" stopOpacity="0.22" />
              <stop offset="100%" stopColor="#b51c00" stopOpacity="0" />
            </linearGradient>
          </defs>

          {/* gridlines + y labels */}
          {ticks.map((t) => (
            <g key={t.yy}>
              <line x1={pad.l} y1={t.yy} x2={W - pad.r} y2={t.yy} stroke="#edeeef" strokeWidth="1" />
              <text x={pad.l - 8} y={t.yy + 4} textAnchor="end" className="fill-ink-soft" fontSize="10">
                {inr(t.v)}
              </text>
            </g>
          ))}

          {/* area grows up from baseline */}
          <path
            d={areaPath}
            fill="url(#revFill)"
            style={{ transform: `scaleY(${progress})`, transformOrigin: 'bottom', transformBox: 'fill-box' }}
          />

          {/* line draws left → right */}
          <path
            d={linePath}
            fill="none"
            stroke="#b51c00"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            pathLength="1"
            strokeDasharray="1"
            strokeDashoffset={1 - progress}
          />

          {/* points + x labels */}
          {data.map((d, i) => (
            <g key={d.key}>
              <circle cx={x(i)} cy={y(d.total)} r="3" fill="#fff" stroke="#b51c00" strokeWidth="2" opacity={progress} />
              <text x={x(i)} y={H - 8} textAnchor="middle" className="fill-ink-soft" fontSize="10">
                {d.label}
              </text>
            </g>
          ))}
        </svg>
      )}
    </div>
  )
}

/* ---------- animated top-items bars ---------- */
function TopItems({ items }) {
  const progress = useProgress(items.map((i) => i.qty).join(','))
  const max = Math.max(1, ...items.map((i) => i.qty))
  return (
    <div className="rounded-xl border border-line bg-white p-6">
      <h3 className="text-base font-bold text-ink">Top selling items</h3>
      <div className="mt-4 space-y-3">
        {items.length === 0 && <p className="text-sm text-ink-soft">No items sold yet.</p>}
        {items.map((it) => (
          <div key={it.name}>
            <div className="mb-1 flex items-center justify-between text-sm">
              <span className="truncate text-ink">{it.name}</span>
              <span className="font-semibold text-ink-soft">{it.qty} sold</span>
            </div>
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-line-soft">
              <div
                className="h-full rounded-full bg-brand transition-[width] duration-700 ease-out"
                style={{ width: `${(it.qty / max) * 100 * progress}%` }}
              />
            </div>
          </div>
        ))}
      </div>
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

/* ---------- data builders ---------- */
function buildDaily(orders) {
  const days = []
  const now = new Date()
  for (let i = 13; i >= 0; i--) {
    const d = new Date(now)
    d.setDate(now.getDate() - i)
    days.push({ key: d.toISOString().slice(0, 10), label: d.getDate().toString(), total: 0 })
  }
  const byKey = Object.fromEntries(days.map((d) => [d.key, d]))
  orders.forEach((o) => {
    if (o.status === 'cancelled' || !o.created_at) return
    const key = new Date(o.created_at).toISOString().slice(0, 10)
    if (byKey[key]) byKey[key].total += o.total || 0
  })
  return days
}

function buildStatus(orders) {
  const counts = {}
  orders.forEach((o) => {
    counts[o.status] = (counts[o.status] || 0) + 1
  })
  return Object.entries(STATUS_META)
    .map(([k, m]) => ({ label: m.label, color: m.color, value: counts[k] || 0 }))
    .filter((s) => s.value > 0)
}

const PAYMENT_COLORS = ['#16a34a', '#f59e0b', '#ef4444', '#6366f1']
function buildPayment(orders) {
  const labels = { verified: 'Verified', pending_verification: 'Awaiting verify', failed: 'Failed', pending: 'Pending' }
  const counts = {}
  orders.forEach((o) => {
    const k = o.payment_status || 'pending'
    counts[k] = (counts[k] || 0) + 1
  })
  return Object.entries(counts).map(([k, v], i) => ({
    label: labels[k] || k,
    color: PAYMENT_COLORS[i % PAYMENT_COLORS.length],
    value: v,
  }))
}

function buildTopItems(orders) {
  const counts = {}
  orders.forEach((o) => {
    if (o.status === 'cancelled') return
    ;(o.order_items ?? []).forEach((it) => {
      const name = it.products?.name
      if (name) counts[name] = (counts[name] || 0) + (it.quantity || 1)
    })
  })
  return Object.entries(counts)
    .map(([name, qty]) => ({ name, qty }))
    .sort((a, b) => b.qty - a.qty)
    .slice(0, 6)
}

export default function Reports() {
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(() => {
    return supabase
      .from('orders')
      .select('id, total, status, payment_status, created_at, order_items(quantity, products(name))')
      .order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (error) console.error('Failed to load reports:', error.message)
        setOrders(data ?? [])
        setLoading(false)
      })
  }, [])

  useEffect(() => {
    load()
    const channel = supabase
      .channel('reports-page')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => load())
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [load])

  const earning = orders.filter((o) => o.status !== 'cancelled')
  const revenue = earning.reduce((s, o) => s + (o.total || 0), 0)
  const avgOrder = earning.length ? Math.round(revenue / earning.length) : 0
  const delivered = orders.filter((o) => o.status === 'delivered').length
  const completion = orders.length ? Math.round((delivered / orders.length) * 100) : 0

  const daily = buildDaily(orders)
  const statusSegs = buildStatus(orders)
  const paymentSegs = buildPayment(orders)
  const topItems = buildTopItems(orders)

  const kpis = [
    { label: 'TOTAL REVENUE', value: inr(revenue), sub: 'Non-cancelled orders', icon: IndianRupee, iconBg: 'bg-[#ffdad3] text-brand' },
    { label: 'TOTAL ORDERS', value: String(orders.length), sub: `${delivered} delivered`, icon: ShoppingBag, iconBg: 'bg-info-soft text-info' },
    { label: 'AVG. ORDER VALUE', value: inr(avgOrder), sub: 'Per order', icon: Receipt, iconBg: 'bg-pos-soft text-pos-dark' },
    { label: 'COMPLETION RATE', value: `${completion}%`, sub: 'Delivered vs all', icon: TrendingUp, iconBg: 'bg-[#fef3c7] text-[#b45309]' },
  ]

  return (
    <>
      <Topbar>
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold text-ink">Reports & Analytics</h1>
          <span className="flex items-center gap-1.5 rounded-full bg-[#ffdad3] px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-brand">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand" /> Live
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button className="flex items-center gap-2 rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white hover:bg-brand-dark">
            <Download className="h-4 w-4" /> Export
          </button>
          <TopIcons />
        </div>
      </Topbar>

      <div className="space-y-6 p-8">
        <div className="grid grid-cols-4 gap-6">
          {kpis.map((k) => (
            <Kpi key={k.label} {...k} />
          ))}
        </div>

        {loading ? (
          <div className="rounded-xl border border-line bg-white px-5 py-16 text-center text-sm text-ink-soft">
            Loading analytics…
          </div>
        ) : (
          <>
            <RevenueChart data={daily} />

            <div className="grid grid-cols-3 gap-6">
              <DonutCard title="Orders by status" segments={statusSegs} centerLabel="Orders" />
              <DonutCard title="Payment status" segments={paymentSegs} centerLabel="Orders" />
              <TopItems items={topItems} />
            </div>
          </>
        )}
      </div>
    </>
  )
}
