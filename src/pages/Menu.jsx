import { useCallback, useEffect, useState } from 'react'
import {
  Plus,
  LayoutGrid,
  CookingPot,
  Beef,
  IceCream,
  CupSoda,
  TrendingUp,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  X,
} from 'lucide-react'
import Topbar, { SearchBox, TopIcons, Divider, ProfileChip } from '../layout/Topbar.jsx'
import { supabase } from '../lib/supabase.js'

// Category tabs actually filter the table. Each tab matches a dish by keywords
// in its name; "All" shows everything so nothing is ever hidden.
const tabs = [
  { label: 'All', icon: LayoutGrid, match: () => true },
  { label: 'Biryani', icon: CookingPot, match: (n) => /biryani|rice|pulao/.test(n) },
  { label: 'Kebabs', icon: Beef, match: (n) => /kebab|tikka|galouti|seekh|chicken|mutton|korma|curry|butter|paneer|masala|beef/.test(n) },
  { label: 'Desserts', icon: IceCream, match: (n) => /brownie|tukda|kheer|dessert|gulab|halwa|ice ?cream|firni|phirni/.test(n) },
  { label: 'Beverages', icon: CupSoda, match: (n) => /coffee|lassi|drink|juice|soda|tea|water|shake|cola|mojito/.test(n) },
]

/* map a product name to one of our brand dish photos */
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

function categoryFor(name = '') {
  const n = name.toLowerCase()
  if (n.includes('coffee') || n.includes('lassi') || n.includes('drink') || n.includes('juice'))
    return 'BEVERAGE'
  if (n.includes('brownie') || n.includes('tukda') || n.includes('kheer') || n.includes('dessert'))
    return 'DESSERT'
  if (n.includes('veg') || n.includes('paneer')) return 'VEG'
  return 'MAIN COURSE'
}

function Toggle({ on, onChange, disabled }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={onChange}
      className={`flex h-6 w-11 items-center rounded-full p-0.5 transition-colors ${
        on ? 'bg-brand' : 'bg-line-2'
      } ${disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
    >
      <span
        className={`h-5 w-5 rounded-full bg-white shadow transition-transform ${
          on ? 'translate-x-5' : 'translate-x-0'
        }`}
      />
    </button>
  )
}

export default function Menu() {
  const [active, setActive] = useState('All')
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(() => new Set())
  const [searchQuery, setSearchQuery] = useState('')
  const [restaurantId, setRestaurantId] = useState(null)
  const [showAdd, setShowAdd] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ name: '', price: '', description: '' })

  const load = useCallback(
    () =>
      supabase
        .from('products')
        .select('*')
        .order('price', { ascending: false })
        .then(({ data, error }) => {
          if (error) console.error('Failed to load products:', error.message)
          setProducts(data ?? [])
          setLoading(false)
        }),
    []
  )

  useEffect(() => {
    load()
    // Keep availability in sync if it's flipped elsewhere (another admin, the app).
    const channel = supabase
      .channel('menu-products')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, () => load())
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [load])

  // Grab a restaurant id so newly-added dishes attach to the outlet.
  useEffect(() => {
    supabase
      .from('restaurants')
      .select('id')
      .limit(1)
      .then(({ data }) => {
        if (data && data[0]) setRestaurantId(data[0].id)
      })
  }, [])

  // Create a new dish in the products table.
  const addDish = async (e) => {
    e.preventDefault()
    const name = form.name.trim()
    const price = Number(form.price)
    if (!name || !Number.isFinite(price) || price <= 0) {
      alert('Enter a dish name and a price greater than 0.')
      return
    }
    setSaving(true)
    const row = { name, price, description: form.description.trim() || null, is_available: true }
    if (restaurantId) row.restaurant_id = restaurantId
    const { error } = await supabase.from('products').insert(row)
    setSaving(false)
    if (error) {
      alert(`Could not add dish: ${error.message}`)
      return
    }
    setShowAdd(false)
    setForm({ name: '', price: '', description: '' })
    load()
  }

  // Flip one dish's availability with an optimistic update; roll back on failure.
  const setAvailability = async (id, next) => {
    if (busy.has(id)) return
    setBusy((prev) => new Set(prev).add(id))
    setProducts((prev) => prev.map((p) => (p.id === id ? { ...p, is_available: next } : p)))
    const { error } = await supabase.from('products').update({ is_available: next }).eq('id', id)
    if (error) {
      console.error('Failed to update availability:', error.message)
      setProducts((prev) => prev.map((p) => (p.id === id ? { ...p, is_available: !next } : p)))
      alert(`Could not update availability: ${error.message}`)
    }
    setBusy((prev) => {
      const n = new Set(prev)
      n.delete(id)
      return n
    })
  }

  // Bulk action: mark every sold-out dish as available again.
  const [bulkBusy, setBulkBusy] = useState(false)
  const updateAllAvailable = async () => {
    const offIds = products.filter((p) => !p.is_available).map((p) => p.id)
    if (bulkBusy || offIds.length === 0) return
    setBulkBusy(true)
    const prev = products
    setProducts((p) => p.map((x) => ({ ...x, is_available: true })))
    const { error } = await supabase.from('products').update({ is_available: true }).in('id', offIds)
    if (error) {
      console.error('Failed bulk availability update:', error.message)
      setProducts(prev)
      alert(`Could not update availability: ${error.message}`)
    }
    setBulkBusy(false)
  }

  // Table respects the active category tab + the search box.
  const activeTab = tabs.find((t) => t.label === active) ?? tabs[0]
  const q = searchQuery.trim().toLowerCase()
  const visibleProducts = products.filter((p) => {
    const n = (p.name || '').toLowerCase()
    if (!activeTab.match(n)) return false
    if (!q) return true
    return (
      n.includes(q) ||
      (p.description || '').toLowerCase().includes(q) ||
      categoryFor(p.name).toLowerCase().includes(q)
    )
  })

  const inStock = products.filter((p) => p.is_available).length
  const soldOut = products.filter((p) => !p.is_available).length
  const pad = (n) => String(n).padStart(2, '0')

  const avgPrice = products.length
    ? Math.round(products.reduce((s, p) => s + (p.price || 0), 0) / products.length)
    : 0
  const categoryCount = new Set(products.map((p) => categoryFor(p.name))).size

  const perf = [
    { label: 'TOTAL DISHES', value: String(products.length), sub: 'On the menu', subTone: 'text-ink-soft' },
    { label: 'AVAILABLE', value: pad(inStock), sub: `${pad(soldOut)} sold out`, subTone: 'text-pos' },
    { label: 'AVG. PRICE', value: `₹${avgPrice}`, sub: `${categoryCount} categories`, subTone: 'text-ink-soft' },
  ]

  const stock = [
    { label: 'In Stock', count: pad(inStock), icon: CheckCircle2, tone: 'text-pos', bg: 'bg-pos-soft' },
    { label: 'Low Stock', count: '00', icon: AlertTriangle, tone: 'text-[#b45309]', bg: 'bg-[#fef3c7]' },
    { label: 'Sold Out', count: pad(soldOut), icon: XCircle, tone: 'text-brand', bg: 'bg-[#ffdad3]' },
  ]

  return (
    <>
      <Topbar>
        <SearchBox
          placeholder="Search dishes, prices, or categories..."
          className="w-full max-w-[420px]"
          value={searchQuery}
          onChange={setSearchQuery}
        />
        <div className="flex items-center gap-1">
          <TopIcons />
          <Divider />
          <ProfileChip name="Spice Route - Downtown" sub="Main Hub" initials="SR" />
        </div>
      </Topbar>

      <div className="space-y-6 p-8">
        {/* header */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-[32px] font-bold leading-8 text-ink">Menu Management</h1>
            <p className="mt-2 text-base text-ink-soft">
              Organize your culinary offerings, update pricing, and manage availability in real-time.
            </p>
          </div>
          <button
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-2 rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold uppercase tracking-wide text-white hover:bg-brand-dark"
          >
            <Plus className="h-4 w-4" /> Add New Dish
          </button>
        </div>

        {/* table card */}
        <div className="rounded-xl border border-line bg-white">
          {/* tabs */}
          <div className="flex items-center justify-between border-b border-line px-5">
            <div className="flex items-center gap-6">
              {tabs.map((t) => {
                const isActive = active === t.label
                return (
                  <button
                    key={t.label}
                    onClick={() => setActive(t.label)}
                    className={`flex items-center gap-2 border-b-2 py-4 text-sm font-semibold transition-colors ${
                      isActive
                        ? 'border-brand text-brand'
                        : 'border-transparent text-ink-soft hover:text-ink'
                    }`}
                  >
                    <t.icon className="h-4 w-4" /> {t.label}
                  </button>
                )
              })}
            </div>
          </div>

          {/* table */}
          <table className="w-full text-left">
            <thead>
              <tr className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
                <th className="px-5 py-3 font-semibold">Dish Details</th>
                <th className="px-5 py-3 font-semibold">Category</th>
                <th className="px-5 py-3 font-semibold">Price</th>
                <th className="px-5 py-3 font-semibold">Status</th>
                <th className="px-5 py-3 font-semibold">Availability</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-soft">
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-5 py-12 text-center text-sm text-ink-soft">
                    Loading dishes…
                  </td>
                </tr>
              ) : visibleProducts.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-5 py-12 text-center text-sm text-ink-soft">
                    {q || active !== 'All' ? 'No dishes match this filter.' : 'No dishes found.'}
                  </td>
                </tr>
              ) : (
                visibleProducts.map((p) => (
                  <tr key={p.id}>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        <img
                          src={imgFor(p.name, p.photo_url)}
                          alt=""
                          className="h-12 w-12 rounded-lg bg-line-2 object-cover"
                        />
                        <div>
                          <p className="text-sm font-semibold text-ink">{p.name}</p>
                          <p className="max-w-[260px] truncate text-xs text-ink-soft">
                            {p.description || '—'}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      <span className="rounded bg-[#fdf0d5] px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-[#92710e]">
                        {categoryFor(p.name)}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-sm font-semibold text-ink">₹{p.price}</td>
                    <td className="px-5 py-4">
                      <span
                        className={`flex items-center gap-1.5 text-sm font-medium ${
                          p.is_available ? 'text-pos' : 'text-brand'
                        }`}
                      >
                        <span
                          className={`h-1.5 w-1.5 rounded-full ${p.is_available ? 'bg-pos' : 'bg-brand'}`}
                        />
                        {p.is_available ? 'Active' : 'Unavailable'}
                      </span>
                    </td>
                    <td className="px-5 py-4">
                      <Toggle
                        on={p.is_available}
                        disabled={busy.has(p.id)}
                        onChange={() => setAvailability(p.id, !p.is_available)}
                      />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>

          {/* footer */}
          <div className="flex items-center justify-between p-5">
            <span className="text-sm text-ink-soft">
              {loading ? 'Loading…' : `Showing ${visibleProducts.length} of ${products.length} dishes`}
            </span>
          </div>
        </div>

        {/* bottom */}
        <div className="grid grid-cols-[1fr_360px] gap-6">
          {/* menu performance */}
          <div className="rounded-xl border border-line bg-white p-5">
            <h2 className="text-base font-bold text-ink">Menu Performance</h2>
            <div className="mt-4 grid grid-cols-3 gap-4">
              {perf.map((p) => (
                <div key={p.label} className="rounded-xl bg-line-soft p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
                    {p.label}
                  </p>
                  <p className="mt-2 text-lg font-bold text-ink">{p.value}</p>
                  <p className={`mt-1 flex items-center gap-1 text-xs font-semibold ${p.subTone}`}>
                    {p.icon ? <p.icon className="h-3.5 w-3.5" /> : <TrendingUp className="h-3.5 w-3.5" />}
                    {p.sub}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* stock overview */}
          <div className="rounded-xl border border-line bg-white p-5">
            <h2 className="text-base font-bold text-ink">Stock Overview</h2>
            <div className="mt-4 space-y-3">
              {stock.map((s) => (
                <div key={s.label} className="flex items-center justify-between">
                  <span className="flex items-center gap-2 text-sm text-ink">
                    <span className={`flex h-7 w-7 items-center justify-center rounded-full ${s.bg} ${s.tone}`}>
                      <s.icon className="h-4 w-4" />
                    </span>
                    {s.label}
                  </span>
                  <span className="text-sm font-bold text-ink">{s.count}</span>
                </div>
              ))}
            </div>
            <button
              onClick={updateAllAvailable}
              disabled={bulkBusy || soldOut === 0}
              className="mt-5 w-full rounded-lg border border-line py-2.5 text-sm font-semibold text-ink hover:bg-line-soft disabled:cursor-not-allowed disabled:opacity-50"
            >
              {bulkBusy ? 'Updating…' : soldOut === 0 ? 'All Dishes Available' : `Mark ${pad(soldOut)} Sold Out Available`}
            </button>
          </div>
        </div>
      </div>

      {/* Add New Dish dialog */}
      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <form onSubmit={addDish} className="w-full max-w-md rounded-2xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-line p-5">
              <h3 className="text-base font-bold text-ink">Add New Dish</h3>
              <button
                type="button"
                onClick={() => setShowAdd(false)}
                className="rounded p-1 text-ink-soft hover:bg-line-soft hover:text-ink"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-4 p-5">
              <div>
                <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-ink-soft">
                  Dish name
                </label>
                <input
                  autoFocus
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. Chicken Biryani"
                  className="w-full rounded-lg border border-line px-3 py-2 text-sm text-ink focus:border-brand focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-ink-soft">
                  Price (₹)
                </label>
                <input
                  type="number"
                  min="1"
                  value={form.price}
                  onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
                  placeholder="e.g. 249"
                  className="w-full rounded-lg border border-line px-3 py-2 text-sm text-ink focus:border-brand focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-ink-soft">
                  Description (optional)
                </label>
                <textarea
                  rows={3}
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  placeholder="Short description shown to customers…"
                  className="w-full resize-none rounded-lg border border-line px-3 py-2 text-sm text-ink focus:border-brand focus:outline-none"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 border-t border-line p-5">
              <button
                type="button"
                onClick={() => setShowAdd(false)}
                className="rounded-lg border border-line px-4 py-2.5 text-xs font-semibold text-ink-soft hover:bg-canvas"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="flex items-center gap-1.5 rounded-lg bg-brand px-5 py-2.5 text-xs font-bold text-white hover:bg-brand-dark disabled:opacity-50"
              >
                <Plus className="h-4 w-4" /> {saving ? 'Adding…' : 'Add Dish'}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  )
}
