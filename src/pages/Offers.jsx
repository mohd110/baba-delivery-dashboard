import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  TicketPercent,
  Plus,
  X,
  Pencil,
  Trash2,
  ArrowUp,
  ArrowDown,
  Eye,
  EyeOff,
  AlertTriangle,
  IndianRupee,
  Users,
  Sparkles,
} from 'lucide-react'
import Topbar, { TopIcons, SearchBox } from '../layout/Topbar.jsx'
import { supabase } from '../lib/supabase.js'
import {
  EMPTY_COUPON_FORM,
  MISSING_TABLE_HINT,
  USAGE_RULES,
  USAGE_RULE_BY_ID,
  couponDiscount,
  couponErrorMessage,
  couponRowFromForm,
  couponToForm,
  isMissingCouponsTable,
  normalizeCode,
  offerSummary,
  usageRuleOf,
} from '../lib/coupons.js'

/* ── Offers & coupons ─────────────────────────────────────────────────────
 * Plain CRUD on `public.coupons`, the same table the customer app reads at
 * checkout — so anything saved here is live for customers immediately.
 *
 * Two things are worth knowing before changing this page:
 *
 *   · Offers are CHAIN-WIDE. `coupons` carries no restaurant_id, so an offer
 *     runs at every outlet and this page deliberately ignores the outlet
 *     switcher. Usage below is likewise counted across all branches.
 *   · sort_order is not cosmetic. It's the order customers see, and the
 *     lowest-numbered offer their cart qualifies for is the one already applied
 *     when they reach checkout — hence the ▲/▼ arrows and the "Applied first"
 *     badge rather than a plain list.
 *
 * Redemptions come straight off `orders.coupon_code`; there is no separate
 * ledger table. See add-coupons.sql for the schema and the RLS gate.
 */

// A cart used to preview a percentage offer in the form. Just under the point
// most percentage offers hit their cap, so the preview shows the real number.
const PREVIEW_SUBTOTAL = 800

const rupees = (n) => `₹${Math.round(Number(n) || 0).toLocaleString('en-IN')}`

function Kpi({ label, value, sub, icon: Icon, iconBg }) {
  return (
    <div className="rounded-xl border border-line bg-white p-5">
      <div className="flex items-start justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-ink-soft">{label}</span>
        <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${iconBg}`}>
          <Icon className="h-4 w-4" />
        </span>
      </div>
      <p className="mt-2 truncate text-[28px] font-bold leading-none text-ink">{value}</p>
      <p className="mt-1 text-xs text-ink-soft">{sub}</p>
    </div>
  )
}

function Field({ label, hint, children }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-ink-soft">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] leading-snug text-ink-soft">{hint}</span>}
    </label>
  )
}

const inputClass =
  'w-full rounded-lg border border-line bg-white px-3 py-2.5 text-sm text-ink placeholder:text-ink-soft focus:border-brand focus:outline-none'

export default function Offers() {
  const [coupons, setCoupons] = useState([])
  const [stats, setStats] = useState({})
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)
  const [q, setQ] = useState('')

  const [showForm, setShowForm] = useState(false)
  const [editTarget, setEditTarget] = useState(null)
  const [form, setForm] = useState(EMPTY_COUPON_FORM)
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const [busyId, setBusyId] = useState(null)

  /* ── Load the offers ── */
  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('coupons')
      .select('*')
      .order('sort_order', { ascending: true, nullsFirst: false })
      .order('code', { ascending: true })
    if (error) {
      console.error('Failed to load coupons:', error.message)
      setLoadError(isMissingCouponsTable(error) ? MISSING_TABLE_HINT : couponErrorMessage(error))
      setCoupons([])
    } else {
      setLoadError(null)
      // Active first — the offers costing money today are the ones the admin
      // came here to look at.
      setCoupons([...(data ?? [])].sort((a, b) => Number(b.is_active) - Number(a.is_active)))
    }
    setLoading(false)
  }, [])

  /* ── What each offer has actually cost ───────────────────────────────────
   * One pass over the orders that carry a coupon code. Cancelled orders are
   * counted as redemptions (the customer app burns a once-per-customer code
   * regardless of what happens to the order afterwards) but not as money off,
   * because nobody paid — the split is shown in the row's tooltip. */
  const loadStats = useCallback(async () => {
    const { data, error } = await supabase
      .from('orders')
      .select('coupon_code, discount_amount, status')
      .not('coupon_code', 'is', null)
    if (error) { console.error('Failed to load coupon usage:', error.message); return }
    const by = {}
    ;(data ?? []).forEach((o) => {
      const code = normalizeCode(o.coupon_code)
      if (!code) return
      const s = (by[code] ||= { redemptions: 0, cancelled: 0, totalOff: 0 })
      s.redemptions += 1
      if (o.status === 'cancelled') s.cancelled += 1
      else s.totalOff += Number(o.discount_amount) || 0
    })
    setStats(by)
  }, [])

  useEffect(() => {
    load()
    loadStats()
    const channel = supabase
      .channel('coupons-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'coupons' }, () => load())
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [load, loadStats])

  const statsFor = (code) => stats[normalizeCode(code)] ?? { redemptions: 0, cancelled: 0, totalOff: 0 }

  /* The offer a qualifying cart gets by default: the lowest sort_order that's
   * switched on. Worth flagging, because it's the one most customers see. */
  const defaultCode = useMemo(() => {
    const active = coupons.filter((c) => c.is_active)
    return active.length ? active[0].code : null
  }, [coupons])

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return coupons
    return coupons.filter(
      (c) =>
        c.code?.toLowerCase().includes(needle) ||
        c.description?.toLowerCase().includes(needle) ||
        offerSummary(c).toLowerCase().includes(needle),
    )
  }, [coupons, q])

  const totals = useMemo(() => {
    const codes = new Set(coupons.map((c) => normalizeCode(c.code)))
    let redemptions = 0
    let totalOff = 0
    Object.entries(stats).forEach(([code, s]) => {
      if (!codes.has(code)) return // an offer that has since been deleted
      redemptions += s.redemptions
      totalOff += s.totalOff
    })
    return { redemptions, totalOff, active: coupons.filter((c) => c.is_active).length }
  }, [coupons, stats])

  /* ── Form ── */
  const openAdd = () => {
    // Slot a new offer at the end of the list by default.
    const nextSort = coupons.reduce((m, c) => Math.max(m, c.sort_order ?? 0), 0) + 10
    setEditTarget(null)
    setForm({ ...EMPTY_COUPON_FORM, sort_order: String(nextSort) })
    setFormError('')
    setShowForm(true)
  }
  const openEdit = (c) => {
    setEditTarget(c)
    setForm(couponToForm(c))
    setFormError('')
    setShowForm(true)
  }
  const closeForm = () => { setShowForm(false); setEditTarget(null); setFormError(''); setForm(EMPTY_COUPON_FORM) }
  const set = (patch) => setForm((f) => ({ ...f, ...patch }))

  const save = async (e) => {
    e.preventDefault()
    const built = couponRowFromForm(form)
    if (built.error) { setFormError(built.error); return }
    setSaving(true)
    const { error } = editTarget
      ? await supabase.from('coupons').update(built.row).eq('id', editTarget.id)
      : await supabase.from('coupons').insert(built.row)
    setSaving(false)
    if (error) { setFormError(couponErrorMessage(error)); return }
    closeForm()
    load()
  }

  /* ── The fastest lever: switch an offer off ── */
  const toggleActive = async (c) => {
    setBusyId(c.id)
    setCoupons((prev) => prev.map((x) => (x.id === c.id ? { ...x, is_active: !x.is_active } : x)))
    const { error } = await supabase.from('coupons').update({ is_active: !c.is_active }).eq('id', c.id)
    setBusyId(null)
    if (error) { alert(couponErrorMessage(error)); load() }
  }

  const remove = async (c) => {
    const { redemptions } = statsFor(c.code)
    const warning = redemptions
      ? `\n\n${redemptions} order${redemptions === 1 ? ' has' : 's have'} used it. Those orders keep the code and the discount already applied — but the usage figures on this page will disappear with the row.`
      : ''
    if (!window.confirm(`Delete ${c.code}? This cannot be undone.${warning}\n\nTo stop an offer without losing its history, switch it off instead.`)) return
    setCoupons((prev) => prev.filter((x) => x.id !== c.id))
    const { error } = await supabase.from('coupons').delete().eq('id', c.id)
    if (error) { alert(couponErrorMessage(error)); load() }
  }

  /* ── Reorder ─────────────────────────────────────────────────────────────
   * Swaps sort_order with the neighbour, which moves the offer up or down the
   * customer's coupon sheet — and, at the top, changes which offer is applied
   * before they open it. Only meaningful within the active block, so the arrows
   * are disabled once the list crosses into the switched-off offers. */
  const move = async (index, dir) => {
    const target = visible[index]
    const swap = visible[index + dir]
    if (!target || !swap || target.is_active !== swap.is_active) return
    const a = target.sort_order ?? (index + 1) * 10
    const b = swap.sort_order ?? (index + dir + 1) * 10
    if (a === b) return
    setBusyId(target.id)
    const [{ error: e1 }, { error: e2 }] = await Promise.all([
      supabase.from('coupons').update({ sort_order: b }).eq('id', target.id),
      supabase.from('coupons').update({ sort_order: a }).eq('id', swap.id),
    ])
    setBusyId(null)
    if (e1 || e2) alert(couponErrorMessage(e1 || e2))
    load()
  }

  const previewSubtotal = Math.max(PREVIEW_SUBTOTAL, Number(form.min_order_value) || 0)
  const previewRow = couponRowFromForm(form).row
  const previewOff = previewRow ? couponDiscount(previewRow, previewSubtotal) : 0

  return (
    <>
      <Topbar>
        <h1 className="text-xl font-bold text-ink">Offers &amp; Coupons</h1>
        <div className="ml-auto flex items-center gap-3">
          <SearchBox placeholder="Search a code…" className="w-64" value={q} onChange={setQ} />
          <TopIcons />
        </div>
      </Topbar>

      <div className="flex-1 space-y-6 overflow-y-auto p-4 lg:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm text-ink-soft">
              {loading ? 'Loading…' : `${coupons.length} offer${coupons.length === 1 ? '' : 's'} · ${totals.active} live`}
            </p>
            <p className="max-w-2xl text-xs text-ink-soft">
              Codes customers can apply at checkout. Changes go live immediately, at every outlet.
              Every minimum is the <b>food subtotal</b> — the delivery fee is never discounted, and only
              one coupon applies per order.
            </p>
          </div>
          <button
            type="button"
            onClick={openAdd}
            className="flex shrink-0 items-center gap-2 rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold uppercase tracking-wide text-white hover:bg-brand-dark"
          >
            <Plus className="h-4 w-4" /> New Offer
          </button>
        </div>

        {loadError && (
          <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <div>
              <p className="text-sm font-bold text-amber-900">Offers aren’t set up yet</p>
              <p className="mt-0.5 text-xs text-amber-800">{loadError}</p>
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-6">
          <Kpi
            label="Live offers"
            value={loading ? '—' : totals.active}
            sub={`${coupons.length - totals.active} switched off`}
            icon={TicketPercent}
            iconBg="bg-brand-light text-brand"
          />
          <Kpi
            label="Redemptions"
            value={loading ? '—' : totals.redemptions.toLocaleString('en-IN')}
            sub="All time, all outlets"
            icon={Users}
            iconBg="bg-info-soft text-info"
          />
          <Kpi
            label="Discounted"
            value={loading ? '—' : rupees(totals.totalOff)}
            sub="Off customers’ bills, cancelled orders excluded"
            icon={IndianRupee}
            iconBg="bg-pos-soft text-pos-dark"
          />
          <Kpi
            label="Applied first"
            value={loading ? '—' : defaultCode || 'None'}
            sub={defaultCode ? 'Pre-applied when the cart qualifies' : 'No live offers'}
            icon={Sparkles}
            iconBg="bg-[#fef3c7] text-[#b45309]"
          />
        </div>

        <div className="rounded-xl border border-line bg-white">
          {/* Scrolls sideways on a phone rather than squashing the columns. */}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left">
              <thead>
                <tr className="border-b border-line text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
                  <th className="px-5 py-3 font-semibold">Order</th>
                  <th className="px-5 py-3 font-semibold">Code</th>
                  <th className="px-5 py-3 font-semibold">Offer</th>
                  <th className="px-5 py-3 font-semibold">Min order</th>
                  <th className="px-5 py-3 font-semibold">Who can use it</th>
                  <th className="px-5 py-3 font-semibold">Used</th>
                  <th className="px-5 py-3 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-soft">
                {loading ? (
                  <tr><td colSpan={7} className="px-5 py-12 text-center text-sm text-ink-soft">Loading offers…</td></tr>
                ) : visible.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-5 py-12 text-center text-sm text-ink-soft">
                      {q
                        ? 'No offer matches that search.'
                        : loadError
                          ? 'Run the migration above, then reload this page.'
                          : 'No offers yet — create one and it’s live at checkout straight away.'}
                    </td>
                  </tr>
                ) : (
                  visible.map((c, i) => {
                    const rule = USAGE_RULE_BY_ID[usageRuleOf(c)]
                    const s = statsFor(c.code)
                    const isDefault = c.is_active && c.code === defaultCode
                    const canUp = i > 0 && visible[i - 1]?.is_active === c.is_active
                    const canDown = i < visible.length - 1 && visible[i + 1]?.is_active === c.is_active
                    return (
                      <tr key={c.id} className={c.is_active ? '' : 'bg-canvas/40 opacity-60'}>
                        <td className="px-5 py-4">
                          <div className="flex items-center gap-2">
                            <span className="w-6 text-xs font-bold text-ink-soft">{c.sort_order ?? '—'}</span>
                            <div className="flex flex-col">
                              <button
                                type="button"
                                disabled={!canUp || busyId === c.id || !!q}
                                onClick={() => move(i, -1)}
                                title={q ? 'Clear the search to reorder' : 'Show earlier'}
                                className="rounded border border-line px-1 text-ink-soft hover:border-brand hover:text-brand disabled:opacity-30"
                              >
                                <ArrowUp className="h-3 w-3" />
                              </button>
                              <button
                                type="button"
                                disabled={!canDown || busyId === c.id || !!q}
                                onClick={() => move(i, 1)}
                                title={q ? 'Clear the search to reorder' : 'Show later'}
                                className="mt-0.5 rounded border border-line px-1 text-ink-soft hover:border-brand hover:text-brand disabled:opacity-30"
                              >
                                <ArrowDown className="h-3 w-3" />
                              </button>
                            </div>
                          </div>
                        </td>
                        <td className="px-5 py-4">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded-md bg-line-soft px-2 py-1 font-mono text-xs font-bold tracking-wider text-ink">
                              {c.code}
                            </span>
                            {isDefault && (
                              <span
                                title="Lowest position of the live offers — customers see this one already applied, as long as their cart meets its minimum."
                                className="inline-flex items-center gap-1 rounded-full bg-[#fef3c7] px-1.5 py-0.5 text-[10px] font-bold uppercase text-[#b45309]"
                              >
                                <Sparkles className="h-3 w-3" /> Applied first
                              </span>
                            )}
                            {!c.is_active && (
                              <span className="rounded-full bg-line-2 px-1.5 py-0.5 text-[10px] font-bold uppercase text-ink-soft">
                                Off
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-5 py-4">
                          <p className="text-sm font-semibold text-ink">{offerSummary(c)}</p>
                          {c.description && <p className="mt-0.5 text-xs text-ink-soft">“{c.description}”</p>}
                        </td>
                        <td className="px-5 py-4 text-sm text-ink-soft">
                          {Number(c.min_order_value) > 0 ? rupees(c.min_order_value) : 'None'}
                        </td>
                        <td className="px-5 py-4">
                          <span className="text-sm text-ink" title={rule.hint}>{rule.short}</span>
                        </td>
                        <td className="px-5 py-4">
                          <p className="text-sm font-semibold text-ink">{s.redemptions.toLocaleString('en-IN')}</p>
                          <p
                            className="text-xs text-ink-soft"
                            title={s.cancelled ? `${s.cancelled} of those orders were cancelled and aren’t counted in the rupees.` : undefined}
                          >
                            {rupees(s.totalOff)} off{s.cancelled ? ` · ${s.cancelled} cancelled` : ''}
                          </p>
                        </td>
                        <td className="px-5 py-4">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              type="button"
                              disabled={busyId === c.id}
                              onClick={() => toggleActive(c)}
                              className="flex items-center gap-1 rounded-md border border-line px-2 py-1.5 text-[11px] font-semibold text-ink-soft hover:border-brand hover:text-brand disabled:opacity-50"
                            >
                              {c.is_active ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                              {c.is_active ? 'Switch off' : 'Switch on'}
                            </button>
                            <button
                              type="button"
                              onClick={() => openEdit(c)}
                              className="flex items-center gap-1 rounded-md border border-line px-2 py-1.5 text-[11px] font-semibold text-ink-soft hover:border-brand hover:text-brand"
                            >
                              <Pencil className="h-3.5 w-3.5" /> Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => remove(c)}
                              title="Delete"
                              className="rounded-md border border-red-200 p-1.5 text-red-400 hover:border-red-400 hover:bg-red-50 hover:text-red-600"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Create / edit */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <form onSubmit={save} className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-line p-5">
              <h3 className="text-base font-bold text-ink">{editTarget ? `Edit ${editTarget.code}` : 'New Offer'}</h3>
              <button type="button" onClick={closeForm} className="rounded p-1 text-ink-soft hover:bg-line-soft hover:text-ink">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-4 p-5">
              <Field label="Code" hint="What the customer types. Letters and numbers only — saved in capitals.">
                <input
                  autoFocus
                  value={form.code}
                  onChange={(e) => set({ code: normalizeCode(e.target.value) })}
                  placeholder="WELCOME10"
                  className={`${inputClass} font-mono tracking-wider`}
                />
              </Field>

              {/* Flat and percentage are mutually exclusive — the database
                  rejects a row that tries to be both. */}
              <div>
                <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-ink-soft">Offer type</span>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { id: 'flat', label: 'Flat ₹ off' },
                    { id: 'percent', label: '% off' },
                  ].map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => set({ type: t.id })}
                      className={`rounded-lg border px-3 py-2.5 text-sm font-semibold transition-colors ${
                        form.type === t.id ? 'border-brand bg-brand-light/40 text-brand' : 'border-line text-ink-soft hover:bg-canvas'
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>

              {form.type === 'flat' ? (
                <Field label="Amount ₹ off" hint="Comes straight off the food subtotal.">
                  <input
                    type="number" min="1" step="1" inputMode="numeric"
                    value={form.discount_amount}
                    onChange={(e) => set({ discount_amount: e.target.value })}
                    placeholder="50"
                    className={inputClass}
                  />
                </Field>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Percent off">
                    <input
                      type="number" min="1" max="100" step="1" inputMode="numeric"
                      value={form.discount_percent}
                      onChange={(e) => set({ discount_percent: e.target.value })}
                      placeholder="10"
                      className={inputClass}
                    />
                  </Field>
                  <Field label="Max ₹ off" hint="Required — the cap on a big order.">
                    <input
                      type="number" min="1" step="1" inputMode="numeric"
                      value={form.max_discount}
                      onChange={(e) => set({ max_discount: e.target.value })}
                      placeholder="100"
                      className={inputClass}
                    />
                  </Field>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <Field label="Minimum order ₹" hint="Food subtotal, delivery fee excluded. 0 for no minimum.">
                  <input
                    type="number" min="0" step="1" inputMode="numeric"
                    value={form.min_order_value}
                    onChange={(e) => set({ min_order_value: e.target.value })}
                    placeholder="0"
                    className={inputClass}
                  />
                </Field>
                <Field label="List position" hint="Lowest shows first, and is applied by default.">
                  <input
                    type="number" min="0" step="1" inputMode="numeric"
                    value={form.sort_order}
                    onChange={(e) => set({ sort_order: e.target.value })}
                    placeholder="10"
                    className={inputClass}
                  />
                </Field>
              </div>

              <div>
                <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-ink-soft">Who can use it</span>
                <div className="space-y-2">
                  {USAGE_RULES.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => set({ rule: r.id })}
                      className={`flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors ${
                        form.rule === r.id ? 'border-brand bg-brand-light/40' : 'border-line hover:bg-canvas'
                      }`}
                    >
                      <span
                        className={`mt-0.5 h-3.5 w-3.5 shrink-0 rounded-full border-4 ${
                          form.rule === r.id ? 'border-brand bg-white' : 'border-line-2 bg-white'
                        }`}
                      />
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold text-ink">{r.label}</span>
                        <span className="mt-0.5 block text-[11px] leading-snug text-ink-soft">{r.hint}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              <Field
                label="Banner text (optional)"
                hint="What the customer reads on the coupon sheet. Leave blank and the app writes it from the numbers."
              >
                <input
                  value={form.description}
                  onChange={(e) => set({ description: e.target.value })}
                  placeholder="10% off up to ₹100"
                  className={inputClass}
                />
              </Field>

              <label className="flex cursor-pointer items-center justify-between rounded-lg border border-line px-3 py-2.5">
                <span>
                  <span className="block text-sm font-semibold text-ink">Live for customers</span>
                  <span className="text-[11px] text-ink-soft">Switching this off hides the offer instantly.</span>
                </span>
                <input
                  type="checkbox"
                  checked={form.is_active}
                  onChange={(e) => set({ is_active: e.target.checked })}
                  className="h-4 w-4 accent-brand"
                />
              </label>

              {/* Same maths the customer app runs, so the admin can see what
                  they're actually giving away before saving. */}
              {previewRow && (
                <div className="rounded-lg border border-line bg-canvas p-3 text-xs text-ink-soft">
                  On a {rupees(previewSubtotal)} order this takes off{' '}
                  <b className="text-ink">{rupees(previewOff)}</b>
                  {Number(form.min_order_value) > 0 && ` · nothing below ${rupees(form.min_order_value)}`}
                </div>
              )}

              {formError && (
                <p className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs font-semibold text-red-700">
                  <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" /> {formError}
                </p>
              )}
            </div>

            <div className="flex items-center justify-end gap-3 border-t border-line p-5">
              <button
                type="button"
                onClick={closeForm}
                className="rounded-lg border border-line px-4 py-2.5 text-xs font-semibold text-ink-soft hover:bg-canvas"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="rounded-lg bg-brand px-5 py-2.5 text-xs font-bold text-white hover:bg-brand-dark disabled:opacity-50"
              >
                {saving ? 'Saving…' : editTarget ? 'Save Changes' : 'Create Offer'}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  )
}
