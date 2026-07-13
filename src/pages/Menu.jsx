import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Plus,
  LayoutGrid,
  CookingPot,
  Beef,
  IceCream,
  Flame,
  Soup,
  Sandwich,
  MoreHorizontal,
  TrendingUp,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  X,
  Upload,
  ImagePlus,
  Trash2,
} from 'lucide-react'
import Topbar, { SearchBox, TopIcons, Divider, ProfileChip } from '../layout/Topbar.jsx'
import { supabase } from '../lib/supabase.js'

// Categories matching the customer app (+ other as catch-all)
const CATEGORIES = ['biryani', 'fry', 'gravy', 'kebabs', 'tandoor', 'breads', 'dessert', 'other']

const tabs = [
  { label: 'All',     key: 'all',     icon: LayoutGrid },
  { label: 'Biryani', key: 'biryani', icon: CookingPot },
  { label: 'Fry',     key: 'fry',     icon: Flame },
  { label: 'Gravy',   key: 'gravy',   icon: Soup },
  { label: 'Kebabs',  key: 'kebabs',  icon: Beef },
  { label: 'Tandoor', key: 'tandoor', icon: Flame },
  { label: 'Breads',  key: 'breads',  icon: Sandwich },
  { label: 'Dessert', key: 'dessert', icon: IceCream },
  { label: 'Other',   key: 'other',   icon: MoreHorizontal },
]

// Guess category from name when DB field is null
function guessCategory(name = '') {
  const n = name.toLowerCase()
  if (/biryani|pulao/.test(n)) return 'biryani'
  if (/naan|roti|paratha|bread|bun/.test(n)) return 'breads'
  if (/tandoor|tangdi|barra|lollipop|shami|afghani|peshawari|malai|aatishi/.test(n)) return 'tandoor'
  if (/tikka/.test(n) && !/rice/.test(n)) return 'tandoor'
  if (/kebab|galouti|adana/.test(n)) return 'kebabs'
  if (/korma|stew|rogan|masala/.test(n)) return 'gravy'
  if (/butter/.test(n) && !/bun|naan/.test(n)) return 'gravy'
  if (/fry|kaleji|leg|chest/.test(n)) return 'fry'
  if (/kheer|tukda|dessert|sweet|lassi/.test(n)) return 'dessert'
  if (/rice/.test(n)) return 'biryani'
  return 'other'
}

function categoryLabel(cat, name = '') {
  const c = String(cat || '').toLowerCase()
  if (c && CATEGORIES.includes(c)) return c.charAt(0).toUpperCase() + c.slice(1)
  // fallback: guess
  const g = guessCategory(name)
  return g.charAt(0).toUpperCase() + g.slice(1)
}

function effectiveCategory(cat, name = '') {
  const c = String(cat || '').toLowerCase()
  if (c && CATEGORIES.includes(c)) return c
  return guessCategory(name)
}

/* map a product name to one of our brand dish photos */
function imgFor(name = '', photoUrl) {
  if (photoUrl) return photoUrl
  const n = name.toLowerCase()
  if (n.includes('mutton') || n.includes('korma')) return '/assets/mutton-korma.png'
  if (n.includes('paneer')) return '/assets/paneer-tikka.png'
  if (n.includes('butter') && n.includes('chicken')) return '/assets/butter-chicken.png'
  if (n.includes('tikka') || n.includes('aatishi')) return '/assets/chicken-aatishi.png'
  if (n.includes('kebab') || n.includes('galouti')) return '/assets/galouti-kebab.png'
  return '/assets/chicken-biryani.png'
}

// Upload an image file to Supabase Storage and return its public URL.
// Falls back to a base64 data URL if the bucket doesn't exist yet.
async function uploadPhoto(file) {
  const ext = file.name.split('.').pop()
  const path = `dishes/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`

  const { data, error } = await supabase.storage.from('menu-photos').upload(path, file, {
    cacheControl: '3600',
    upsert: false,
    contentType: file.type,
  })

  if (error) {
    // Bucket may not exist — store as data URL so the dish still saves
    return new Promise((resolve) => {
      const reader = new FileReader()
      reader.onload = (e) => resolve(e.target.result)
      reader.readAsDataURL(file)
    })
  }

  const { data: urlData } = supabase.storage.from('menu-photos').getPublicUrl(data.path)
  return urlData.publicUrl
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

// ─── Photo Upload Widget ────────────────────────────────────────────────────
function PhotoUploader({ value, onChange, uploading }) {
  const inputRef = useRef(null)

  return (
    <div>
      <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-ink-soft">
        Photo (optional)
      </label>
      <div
        onClick={() => !uploading && inputRef.current?.click()}
        className={`relative flex h-28 w-full cursor-pointer flex-col items-center justify-center gap-2 overflow-hidden rounded-xl border-2 border-dashed transition-colors ${
          value ? 'border-brand/40' : 'border-line hover:border-brand/50'
        } bg-line-soft`}
      >
        {value ? (
          <>
            <img src={value} alt="preview" className="absolute inset-0 h-full w-full object-cover" />
            <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 hover:opacity-100 transition-opacity">
              <span className="flex items-center gap-1.5 rounded-lg bg-white/90 px-3 py-1.5 text-xs font-bold text-ink">
                <Upload className="h-3.5 w-3.5" /> Change Photo
              </span>
            </div>
          </>
        ) : (
          <>
            <ImagePlus className="h-6 w-6 text-ink-soft" />
            <span className="text-xs text-ink-soft">
              {uploading ? 'Uploading…' : 'Click to upload dish photo'}
            </span>
          </>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) onChange(file)
          e.target.value = ''
        }}
      />
    </div>
  )
}

export default function Menu() {
  const [active, setActive] = useState('all')
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(() => new Set())
  const [searchQuery, setSearchQuery] = useState('')

  // Add dish dialog
  const [showAdd, setShowAdd] = useState(false)
  const [saving, setSaving] = useState(false)
  const [photoUploading, setPhotoUploading] = useState(false)
  const [form, setForm] = useState({
    name: '', price: '', description: '', category: 'biryani', photoFile: null, photoPreview: null,
  })

  // Photo update for existing dish
  const [photoTarget, setPhotoTarget] = useState(null) // product id being updated
  const [photoUpdating, setPhotoUpdating] = useState(false)
  const photoInputRef = useRef(null)

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
    const channel = supabase
      .channel('menu-products')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, () => load())
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [load])



  // ── Handle photo selection for the "Add Dish" form ──
  const handleFormPhoto = async (file) => {
    const preview = URL.createObjectURL(file)
    setForm((f) => ({ ...f, photoFile: file, photoPreview: preview }))
  }

  // ── Add a new dish ──
  const addDish = async (e) => {
    e.preventDefault()
    const name = form.name.trim()
    const price = Number(form.price)
    if (!name || !Number.isFinite(price) || price <= 0) {
      alert('Enter a dish name and a price greater than 0.')
      return
    }
    setSaving(true)

    // Upload photo first (if selected)
    let photo_url = null
    if (form.photoFile) {
      setPhotoUploading(true)
      photo_url = await uploadPhoto(form.photoFile)
      setPhotoUploading(false)
    }

    const row = {
      name,
      price,
      // Send empty string as fallback if description column is NOT NULL in DB
      description: form.description.trim() || '',
      is_available: true,
      category: form.category,
      ...(photo_url ? { photo_url } : {}),
    }

    // Try with category; if column missing, retry without
    let { error } = await supabase.from('products').insert(row)
    if (error && error.message?.toLowerCase().includes('category')) {
      const { category: _c, ...rowWithout } = row
      const retry = await supabase.from('products').insert(rowWithout)
      error = retry.error
    }

    setSaving(false)
    if (error) {
      alert(`Could not add dish: ${error.message}`)
      return
    }
    setShowAdd(false)
    setForm({ name: '', price: '', description: '', category: 'biryani', photoFile: null, photoPreview: null })
    load()
  }

  // ── Update photo for an existing dish ──
  const updateDishPhoto = async (file) => {
    if (!photoTarget || !file) return
    setPhotoUpdating(true)
    const url = await uploadPhoto(file)
    const { error } = await supabase.from('products').update({ photo_url: url }).eq('id', photoTarget)
    setPhotoUpdating(false)
    if (error) {
      alert(`Could not update photo: ${error.message}`)
    } else {
      load()
    }
    setPhotoTarget(null)
  }

  // ── Delete a dish ──
  const deleteDish = async (id, name) => {
    if (!window.confirm(`Delete "${name}"? This cannot be undone.`)) return
    // Optimistic remove
    setProducts((prev) => prev.filter((p) => p.id !== id))
    const { error } = await supabase.from('products').delete().eq('id', id)
    if (error) {
      alert(`Could not delete dish: ${error.message}`)
      load() // restore on failure
    }
  }

  // ── Availability toggle ──
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
    setBusy((prev) => { const n = new Set(prev); n.delete(id); return n })
  }

  // ── Bulk mark all available ──
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

  // ── Filter logic ──
  const q = searchQuery.trim().toLowerCase()
  const visibleProducts = products.filter((p) => {
    if (active !== 'all') {
      const eff = effectiveCategory(p.category, p.name)
      if (eff !== active) return false
    }
    if (!q) return true
    const n = (p.name || '').toLowerCase()
    return (
      n.includes(q) ||
      (p.description || '').toLowerCase().includes(q) ||
      (p.category || '').toLowerCase().includes(q)
    )
  })

  const inStock = products.filter((p) => p.is_available).length
  const soldOut = products.filter((p) => !p.is_available).length
  const pad = (n) => String(n).padStart(2, '0')
  const avgPrice = products.length
    ? Math.round(products.reduce((s, p) => s + (p.price || 0), 0) / products.length)
    : 0
  const categoryCount = new Set(products.map((p) => effectiveCategory(p.category, p.name))).size

  const perf = [
    { label: 'TOTAL DISHES', value: String(products.length), sub: 'On the menu', subTone: 'text-ink-soft' },
    { label: 'AVAILABLE', value: pad(inStock), sub: `${pad(soldOut)} sold out`, subTone: 'text-pos' },
    { label: 'AVG. PRICE', value: `₹${avgPrice}`, sub: `${categoryCount} categories`, subTone: 'text-ink-soft' },
  ]

  const stock = [
    { label: 'In Stock',  count: pad(inStock), icon: CheckCircle2, tone: 'text-pos',         bg: 'bg-pos-soft' },
    { label: 'Low Stock', count: '00',         icon: AlertTriangle, tone: 'text-[#b45309]',  bg: 'bg-[#fef3c7]' },
    { label: 'Sold Out',  count: pad(soldOut), icon: XCircle,       tone: 'text-brand',       bg: 'bg-[#ffdad3]' },
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
          <ProfileChip name="Wali Baba Foods" sub="Restaurant Admin" initials="WB" />
        </div>
      </Topbar>

      {/* Hidden file input for updating existing dish photos */}
      <input
        ref={photoInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) updateDishPhoto(file)
          e.target.value = ''
        }}
      />

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
            <div className="flex items-center gap-4 overflow-x-auto">
              {tabs.map((t) => {
                const isActive = active === t.key
                return (
                  <button
                    key={t.key}
                    onClick={() => setActive(t.key)}
                    className={`flex shrink-0 items-center gap-2 border-b-2 py-4 text-sm font-semibold transition-colors ${
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
                <th className="px-5 py-3 font-semibold">Photo</th>
                <th className="px-5 py-3 font-semibold">Availability</th>
                <th className="px-5 py-3 font-semibold">Delete</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-soft">
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-5 py-12 text-center text-sm text-ink-soft">
                    Loading dishes…
                  </td>
                </tr>
              ) : visibleProducts.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-12 text-center text-sm text-ink-soft">
                    {q || active !== 'all' ? 'No dishes match this filter.' : 'No dishes found.'}
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
                        {categoryLabel(p.category, p.name)}
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
                      <button
                        type="button"
                        disabled={photoUpdating && photoTarget === p.id}
                        onClick={() => {
                          setPhotoTarget(p.id)
                          photoInputRef.current?.click()
                        }}
                        className="flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-[11px] font-semibold text-ink-soft hover:border-brand hover:text-brand disabled:opacity-50 transition-colors"
                      >
                        <Upload className="h-3 w-3" />
                        {photoUpdating && photoTarget === p.id ? 'Uploading…' : 'Update'}
                      </button>
                    </td>
                    <td className="px-5 py-4">
                      <Toggle
                        on={p.is_available}
                        disabled={busy.has(p.id)}
                        onChange={() => setAvailability(p.id, !p.is_available)}
                      />
                    </td>
                    <td className="px-5 py-4">
                      <button
                        type="button"
                        onClick={() => deleteDish(p.id, p.name)}
                        className="flex items-center gap-1.5 rounded-lg border border-red-200 px-2.5 py-1.5 text-[11px] font-semibold text-red-400 hover:border-red-400 hover:bg-red-50 hover:text-red-600 transition-colors"
                      >
                        <Trash2 className="h-3 w-3" /> Delete
                      </button>
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
                    <TrendingUp className="h-3.5 w-3.5" />
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

      {/* ── Add New Dish dialog ── */}
      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <form
            onSubmit={addDish}
            className="w-full max-w-md rounded-2xl bg-white shadow-xl max-h-[90vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between border-b border-line p-5">
              <h3 className="text-base font-bold text-ink">Add New Dish</h3>
              <button
                type="button"
                onClick={() => {
                  setShowAdd(false)
                  setForm({ name: '', price: '', description: '', category: 'biryani', photoFile: null, photoPreview: null })
                }}
                className="rounded p-1 text-ink-soft hover:bg-line-soft hover:text-ink"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-4 p-5">
              {/* Photo uploader */}
              <PhotoUploader
                value={form.photoPreview}
                uploading={photoUploading}
                onChange={handleFormPhoto}
              />

              {/* Name */}
              <div>
                <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-ink-soft">
                  Dish Name
                </label>
                <input
                  autoFocus
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. Chicken Biryani"
                  className="w-full rounded-lg border border-line px-3 py-2 text-sm text-ink focus:border-brand focus:outline-none"
                />
              </div>

              {/* Price + Category */}
              <div className="grid grid-cols-2 gap-3">
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
                    Category
                  </label>
                  <select
                    value={form.category}
                    onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                    className="w-full rounded-lg border border-line px-3 py-2 text-sm text-ink focus:border-brand focus:outline-none"
                  >
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c.charAt(0).toUpperCase() + c.slice(1)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Description */}
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
                onClick={() => {
                  setShowAdd(false)
                  setForm({ name: '', price: '', description: '', category: 'biryani', photoFile: null, photoPreview: null })
                }}
                className="rounded-lg border border-line px-4 py-2.5 text-xs font-semibold text-ink-soft hover:bg-canvas"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving || photoUploading}
                className="flex items-center gap-1.5 rounded-lg bg-brand px-5 py-2.5 text-xs font-bold text-white hover:bg-brand-dark disabled:opacity-50"
              >
                <Plus className="h-4 w-4" />
                {photoUploading ? 'Uploading photo…' : saving ? 'Adding…' : 'Add Dish'}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  )
}
