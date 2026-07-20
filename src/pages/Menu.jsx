import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Plus, LayoutGrid, CookingPot, Beef, IceCream, Flame, Soup,
  Sandwich, TrendingUp, CheckCircle2, AlertTriangle,
  XCircle, X, Upload, ImagePlus, Trash2, Pencil, Tag,
  ChevronLeft, ChevronRight, Salad, Utensils,
  ZoomIn, ZoomOut, Move, RotateCcw, Download,
} from 'lucide-react'
import Topbar, { SearchBox, TopIcons, Divider, ProfileChip } from '../layout/Topbar.jsx'
import { supabase } from '../lib/supabase.js'
import { exportToCsv } from '../lib/csv.js'

// Canonical menu categories, in the exact order they should appear. Slugs are
// kept stable (fry/gravy/tandoor/other) so existing dishes stay categorised;
// only the display names changed. "Others" is always rendered last.
const DEFAULT_CATEGORIES = [
  { name: 'Biryani & Rice', slug: 'biryani' },
  { name: 'Fried',          slug: 'fry'     },
  { name: 'Kebabs',         slug: 'kebabs'  },
  { name: 'Roasted',        slug: 'tandoor' },
  { name: 'Gravies',        slug: 'gravy'   },
  { name: 'Breads',         slug: 'breads'  },
  { name: 'Dessert',        slug: 'dessert' },
  { name: 'Veg',            slug: 'veg'     },
  { name: 'Combos',         slug: 'combos'  },
  { name: 'Others',         slug: 'other'   },
]

const CAT_ICONS = {
  biryani: CookingPot, fry: Flame, gravy: Soup, kebabs: Beef,
  tandoor: Flame, breads: Sandwich, dessert: IceCream,
  veg: Salad, combos: Utensils,
}
const catIcon = (slug) => CAT_ICONS[slug] ?? null

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

function effectiveCategory(cat, name = '') {
  const c = String(cat || '').toLowerCase()
  return c || guessCategory(name)
}

// Guess veg / non-veg from a dish name when the DB has no is_veg flag. Veg
// keywords win over non-veg ones (e.g. "Paneer Tikka" is veg despite "tikka").
const VEG_RE = /paneer|veg\b|veggie|aloo|dal|daal|chana|chole|rajma|gobi|mushroom|palak|bhindi|jeera|soya|tofu|salad|raita|corn|mutter|matar|kaju/i
const NONVEG_RE = /chicken|mutton|lamb|beef|fish|prawn|shrimp|egg|meat|keema|kheema|qeema|kebab|kabab|galouti|seekh|tikka|tangdi|tandoori|korma|qorma|murgh|gosht|biryani|nihari|haleem/i
function guessVeg(name = '') {
  const n = String(name).toLowerCase()
  if (VEG_RE.test(n)) return true
  if (NONVEG_RE.test(n)) return false
  return false // menu is non-veg-forward; treat unknowns as non-veg
}

// Resolve a product's veg flag: the stored column wins, else infer from name.
function productIsVeg(p) {
  if (typeof p?.is_veg === 'boolean') return p.is_veg
  return guessVeg(p?.name)
}

// The classic FSSAI food symbol: a bordered square with a centered dot,
// green for veg and red for non-veg.
function VegDot({ veg }) {
  const color = veg ? '#16a34a' : '#dc2626'
  return (
    <span
      className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[3px] border-[1.5px]"
      style={{ borderColor: color }}
      title={veg ? 'Veg' : 'Non-veg'}
      aria-label={veg ? 'Veg' : 'Non-veg'}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />
    </span>
  )
}

function categoryLabel(cat, name = '', categories = DEFAULT_CATEGORIES) {
  const slug = effectiveCategory(cat, name)
  const found = categories.find((c) => c.slug === slug)
  return found ? found.name : slug.charAt(0).toUpperCase() + slug.slice(1)
}

/* Resolve dish image */
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

/* Upload a dish photo to the `menu-photos` storage bucket and return its public
 * URL. We deliberately do NOT fall back to a base64 data-URI: storing image
 * bytes inline in the products row bloats every `select('*')` and wrecks menu
 * query timing. On failure we throw so the caller can surface the error and
 * abort — the row only ever holds a short bucket URL. */
async function uploadPhoto(file) {
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
  const path = `dishes/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
  const { data, error } = await supabase.storage
    .from('menu-photos').upload(path, file, { cacheControl: '3600', upsert: false, contentType: file.type })
  if (error) throw new Error(error.message || 'Photo upload failed')
  const { data: urlData } = supabase.storage.from('menu-photos').getPublicUrl(data.path)
  return urlData.publicUrl
}

function loadImageEl(src, crossOrigin) {
  return new Promise((res, rej) => {
    const img = new Image()
    if (crossOrigin) img.crossOrigin = crossOrigin
    img.onload = () => res(img)
    img.onerror = () => rej(new Error('Could not load image'))
    img.src = src
  })
}

/* Draw a loaded image "contain-fit at scale 1, then the manager's zoom/pan"
 * into a square JPEG File — identical math to the CSS transform in
 * PhotoUploader. Shared by the file-based and URL-based renderers. */
async function bakeFramedImage(img, transform, size, name) {
  const t = transform || { scale: 1, x: 0, y: 0 }
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, size, size)
  const ratio = Math.min(size / img.naturalWidth, size / img.naturalHeight)
  const dw = img.naturalWidth * ratio * t.scale
  const dh = img.naturalHeight * ratio * t.scale
  const left = size / 2 - dw / 2 + t.x * size
  const top = size / 2 - dh / 2 + t.y * size
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, left, top, dw, dh)
  const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.9))
  if (!blob) return null
  const base = (name || 'dish').replace(/\.\w+$/, '')
  return new File([blob], `${base}.jpg`, { type: 'image/jpeg' })
}

/* Bake the framed view (contain-fit at scale 1, then the manager's zoom/pan)
 * into a square JPEG so the stored image is exactly what they framed. This
 * keeps display trivial everywhere and needs no transform data on the customer
 * app. If nothing was adjusted, the original file is uploaded untouched. */
async function renderAdjustedPhoto(file, transform, size = 720) {
  const t = transform || { scale: 1, x: 0, y: 0 }
  if (t.scale === 1 && t.x === 0 && t.y === 0) return file
  const url = URL.createObjectURL(file)
  try {
    const img = await loadImageEl(url)
    const baked = await bakeFramedImage(img, t, size, file.name)
    return baked || file // any canvas failure -> upload the original untouched
  } catch {
    return file
  } finally {
    URL.revokeObjectURL(url)
  }
}

/* Re-crop an already-uploaded photo. We load it through an <img> with
 * crossOrigin='anonymous' (so the canvas stays untainted and toBlob works) and
 * a cache-buster query param. Using fetch() here fails with "Failed to fetch":
 * the preview <img> caches an opaque (non-CORS) response, which a later CORS
 * fetch of the same URL then reuses and rejects. */
async function renderAdjustedPhotoFromUrl(src, transform, size = 720) {
  const bust = src.includes('?') ? '&' : '?'
  const img = await loadImageEl(`${src}${bust}cb=${Date.now()}`, 'anonymous')
  const baked = await bakeFramedImage(img, transform, size, 'dish')
  if (!baked) throw new Error('Could not render crop')
  return baked
}

/* ── Toggle ─────────────────────────────────────────── */
function Toggle({ on, onChange, disabled }) {
  return (
    <button type="button" role="switch" aria-checked={on} disabled={disabled} onClick={onChange}
      className={`flex h-6 w-11 items-center rounded-full p-0.5 transition-colors ${on ? 'bg-brand' : 'bg-line-2'} ${disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}>
      <span className={`h-5 w-5 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-5' : 'translate-x-0'}`} />
    </button>
  )
}

/* Format Future Date */
function formatFutureTime(isoString) {
  if (!isoString) return ''
  const d = new Date(isoString)
  if (isNaN(d.getTime())) return ''
  
  const today = new Date()
  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)
  
  const timeStr = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  
  if (d.toDateString() === today.toDateString()) {
    return `Today, ${timeStr}`
  } else if (d.toDateString() === tomorrow.toDateString()) {
    return `Tomorrow, ${timeStr}`
  } else {
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + `, ${timeStr}`
  }
}

/* ── Photo Uploader widget (with zoom / pan / center) ─── */
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

function PhotoUploader({ value, onChange, onTransform, transform, uploading }) {
  const fileRef = useRef(null)
  const frameRef = useRef(null)
  const drag = useRef(null)
  const t = transform || { scale: 1, x: 0, y: 0 }

  const pick = () => { if (!uploading) fileRef.current?.click() }
  const setScale = (s) => onTransform?.({ ...t, scale: clamp(Number(s.toFixed(2)), 0.4, 4) })
  const reset = () => onTransform?.({ scale: 1, x: 0, y: 0 })

  const onPointerDown = (e) => {
    if (!value) return
    const rect = frameRef.current?.getBoundingClientRect()
    drag.current = { sx: e.clientX, sy: e.clientY, ox: t.x, oy: t.y, w: rect?.width || 1, h: rect?.height || 1 }
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }
  const onPointerMove = (e) => {
    const d = drag.current
    if (!d) return
    onTransform?.({ ...t, x: d.ox + (e.clientX - d.sx) / d.w, y: d.oy + (e.clientY - d.sy) / d.h })
  }
  const endDrag = () => { drag.current = null }

  const iconBtn = 'flex h-7 w-7 items-center justify-center rounded-lg border border-line text-ink-soft hover:border-brand hover:text-brand transition-colors'

  return (
    <div>
      <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-ink-soft">Photo (optional)</label>
      <div
        ref={frameRef}
        onClick={() => { if (!value) pick() }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerLeave={endDrag}
        style={{ touchAction: 'none', cursor: value ? 'grab' : 'pointer' }}
        className={`relative mx-auto flex h-44 w-44 flex-col items-center justify-center gap-2 overflow-hidden rounded-xl border-2 border-dashed transition-colors ${value ? 'border-brand/40' : 'border-line hover:border-brand/50'} bg-line-soft`}
      >
        {value ? (
          <img
            src={value}
            alt="preview"
            draggable={false}
            className="absolute inset-0 h-full w-full select-none object-contain"
            style={{ transform: `translate(${t.x * 100}%, ${t.y * 100}%) scale(${t.scale})` }}
          />
        ) : (
          <>
            <ImagePlus className="h-6 w-6 text-ink-soft" />
            <span className="px-3 text-center text-xs text-ink-soft">{uploading ? 'Uploading…' : 'Click to upload dish photo'}</span>
          </>
        )}
      </div>

      {value && (
        <>
          <div className="mt-2 flex items-center justify-center gap-2">
            <button type="button" className={iconBtn} title="Zoom out" onClick={() => setScale(t.scale - 0.2)}><ZoomOut className="h-4 w-4" /></button>
            <button type="button" className={iconBtn} title="Zoom in" onClick={() => setScale(t.scale + 0.2)}><ZoomIn className="h-4 w-4" /></button>
            <button type="button" className={iconBtn} title="Center / reset" onClick={reset}><RotateCcw className="h-4 w-4" /></button>
            <button type="button" onClick={pick} className="flex items-center gap-1 rounded-lg border border-line px-2.5 py-1 text-[11px] font-semibold text-ink-soft hover:border-brand hover:text-brand transition-colors">
              <Upload className="h-3 w-3" /> Change
            </button>
          </div>
          <p className="mt-1 flex items-center justify-center gap-1 text-[10px] text-ink-soft">
            <Move className="h-3 w-3" /> Drag to reposition · use +/− to zoom
          </p>
        </>
      )}

      <input ref={fileRef} type="file" accept="image/*" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onChange(f); e.target.value = '' }} />
    </div>
  )
}

/* ── Category count badge (theme-coloured circle) ───── */
function CountBadge({ count, active }) {
  return (
    <span
      className={`flex h-5 min-w-[20px] items-center justify-center rounded-full px-1.5 text-[10px] font-bold ${
        active ? 'bg-brand text-white' : 'bg-brand-light text-brand'
      }`}
    >
      {count}
    </span>
  )
}

/* ── Variants editor ────────────────────────────────── */
function VariantsEditor({ variants, onChange }) {
  const add = () => onChange([...variants, { name: '', price: '' }])
  const remove = (i) => onChange(variants.filter((_, idx) => idx !== i))
  const update = (i, field, val) => onChange(variants.map((v, idx) => idx === i ? { ...v, [field]: val } : v))

  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <label className="text-xs font-bold uppercase tracking-wide text-ink-soft">Variants (optional)</label>
        <button type="button" onClick={add}
          className="flex items-center gap-1 rounded-md bg-line-soft px-2 py-1 text-[11px] font-semibold text-ink-soft hover:text-brand hover:bg-brand/10 transition-colors">
          <Plus className="h-3 w-3" /> Add Variant
        </button>
      </div>
      {variants.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line py-3 text-center text-xs text-ink-soft">
          e.g. Half / Full with different prices
        </p>
      ) : (
        <div className="space-y-2">
          {variants.map((v, i) => (
            <div key={i} className="flex items-center gap-2">
              <input value={v.name} onChange={(e) => update(i, 'name', e.target.value)}
                placeholder="e.g. Half" className="flex-1 rounded-lg border border-line px-3 py-2 text-sm text-ink focus:border-brand focus:outline-none" />
              <input value={v.price} onChange={(e) => update(i, 'price', e.target.value)}
                placeholder="₹ Price" type="number" min="0"
                className="w-24 rounded-lg border border-line px-3 py-2 text-sm text-ink focus:border-brand focus:outline-none" />
              <button type="button" onClick={() => remove(i)}
                className="rounded-lg p-2 text-ink-soft hover:bg-red-50 hover:text-red-500 transition-colors">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/* ─────────────────────────────────────────────────────
   Main component
───────────────────────────────────────────────────── */
const EMPTY_FORM = { name: '', price: '', description: '', category: 'biryani', isVeg: false, photoFile: null, photoPreview: null, photoTransform: { scale: 1, x: 0, y: 0 }, variants: [] }

// Show at most this many dishes per page. Pagination is client-side: the menu
// is small and (now that photos live in the `menu-photos` bucket) each row is
// tiny, so one slim query keeps category-guessing, search and the stat cards
// consistent while we render only a 15-row window at a time.
const PAGE_SIZE = 15

export default function Menu() {
  const [active, setActive]       = useState('all')
  const [products, setProducts]   = useState([])
  const [loading, setLoading]     = useState(true)
  const [busy, setBusy]           = useState(() => new Set())
  const [searchQuery, setSearch]  = useState('')
  const [page, setPage]           = useState(1)   // 1-indexed page for the dish table

  // Dynamic categories from DB
  const [categories, setCategories] = useState(DEFAULT_CATEGORIES)

  // Modals
  const [showAdd, setShowAdd]         = useState(false)
  const [showAddCat, setShowAddCat]   = useState(false)
  const [editTarget, setEditTarget]   = useState(null)   // product being edited

  // Form state (shared between Add & Edit)
  const [form, setForm]               = useState(EMPTY_FORM)
  const [saving, setSaving]           = useState(false)
  const [photoUploading, setPhotoUp]  = useState(false)

  // New-category form
  const [newCatName, setNewCatName]   = useState('')
  const [savingCat, setSavingCat]     = useState(false)

  // Photo-update for existing row
  const [photoTarget, setPhotoTarget] = useState(null)
  const [photoUpdating, setPhotoUpd]  = useState(false)
  const photoInputRef                 = useRef(null)

  // Turn off modal
  const [turnOffTarget, setTurnOffTarget] = useState(null)
  const [turnOffCustom, setTurnOffCustom] = useState('')

  /* ── Load products ── */
  // Ordered serial-wise: canonical category order first, then oldest-added
  // within each category, so the menu reads top-to-bottom in a stable sequence.
  const load = useCallback(() =>
    supabase.from('products').select('*')
      .then(({ data, error }) => {
        if (error) console.error('Failed to load products:', error.message)
        const order = DEFAULT_CATEGORIES.map((c) => c.slug)
        const rank = (p) => { const i = order.indexOf(effectiveCategory(p.category, p.name)); return i === -1 ? 999 : i }
        const sorted = [...(data ?? [])].sort((a, b) =>
          rank(a) - rank(b) ||
          (a.created_at || '').localeCompare(b.created_at || '') ||
          (a.name || '').localeCompare(b.name || ''))
        setProducts(sorted)
        setLoading(false)
      }), [])

  /* ── Load categories from DB ── */
  // The canonical DEFAULT_CATEGORIES list (and its order) always wins. Any
  // custom category added via the DB that isn't one of ours is appended just
  // before "Others" so the requested order is preserved.
  const loadCategories = useCallback(async () => {
    const { data, error } = await supabase.from('menu_categories').select('name, slug')
    if (error) return
    const known = new Set(DEFAULT_CATEGORIES.map((c) => c.slug))
    const extras = (data ?? []).filter((c) => c.slug && !known.has(c.slug))
    if (extras.length === 0) return // defaults already in state
    const base = DEFAULT_CATEGORIES.filter((c) => c.slug !== 'other')
    const others = DEFAULT_CATEGORIES.filter((c) => c.slug === 'other')
    setCategories([...base, ...extras, ...others])
  }, [])

  useEffect(() => {
    load()
    loadCategories()
    const channel = supabase.channel('menu-products')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, () => load())
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [load, loadCategories])

  /* ── Upload photo helper ── */
  const handlePhotoFile = async (file, setPreview) => {
    const preview = URL.createObjectURL(file)
    setPreview(preview)
    return file
  }

  /* ── Open edit modal ── */
  const openEdit = (p) => {
    setEditTarget(p)
    setForm({
      name: p.name || '',
      price: p.price ?? '',
      description: p.description || '',
      category: effectiveCategory(p.category, p.name),
      isVeg: productIsVeg(p),
      photoFile: null,
      photoPreview: p.photo_url || null,
      photoTransform: { scale: 1, x: 0, y: 0 },
      variants: Array.isArray(p.variants) ? p.variants : [],
    })
  }

  /* ── Add new dish ── */
  const addDish = async (e) => {
    e.preventDefault()
    const name = form.name.trim()
    const price = Number(form.price)
    if (!name || !Number.isFinite(price) || price <= 0) { alert('Enter a dish name and a price > 0.'); return }
    setSaving(true)

    let photo_url = null
    if (form.photoFile) {
      setPhotoUp(true)
      try {
        const baked = await renderAdjustedPhoto(form.photoFile, form.photoTransform)
        photo_url = await uploadPhoto(baked)
      }
      catch (err) { setPhotoUp(false); setSaving(false); alert(`Could not upload photo: ${err.message}`); return }
      setPhotoUp(false)
    }

    const variants = form.variants.filter(v => v.name.trim()).map(v => ({ name: v.name.trim(), price: Number(v.price) || 0 }))
    const row = { name, price, description: form.description.trim() || '', is_available: true, category: form.category, is_veg: form.isVeg, variants, ...(photo_url ? { photo_url } : {}) }

    let { error } = await supabase.from('products').insert(row)
    // Retry without is_veg if that column hasn't been added to the table yet.
    if (error && /is_veg|schema cache|column/i.test(error.message)) {
      const { is_veg: _v, ...noVeg } = row
      ;({ error } = await supabase.from('products').insert(noVeg))
    }
    if (error?.message?.toLowerCase().includes('category')) {
      const { category: _c, is_veg: _v2, ...r2 } = row
      ;({ error } = await supabase.from('products').insert(r2))
    }
    setSaving(false)
    if (error) { alert(`Could not add dish: ${error.message}`); return }
    setShowAdd(false); setForm(EMPTY_FORM); load()
  }

  /* ── Save edits to existing dish ── */
  const saveEdit = async (e) => {
    e.preventDefault()
    if (!editTarget) return
    const name = form.name.trim()
    const price = Number(form.price)
    if (!name || !Number.isFinite(price) || price <= 0) { alert('Enter a dish name and a price > 0.'); return }
    setSaving(true)

    let photo_url = editTarget.photo_url
    const t = form.photoTransform || { scale: 1, x: 0, y: 0 }
    const transformApplied = t.scale !== 1 || t.x !== 0 || t.y !== 0

    if (form.photoFile) {
      // New file picked — bake the current transform into it before uploading.
      setPhotoUp(true)
      try {
        const baked = await renderAdjustedPhoto(form.photoFile, form.photoTransform)
        photo_url = await uploadPhoto(baked)
      }
      catch (err) { setPhotoUp(false); setSaving(false); alert(`Could not upload photo: ${err.message}`); return }
      setPhotoUp(false)
    } else if (transformApplied && editTarget.photo_url) {
      // No new file, but the manager zoomed / panned the existing photo.
      // Load it (CORS-safe), bake the transform, and re-upload.
      setPhotoUp(true)
      try {
        const baked = await renderAdjustedPhotoFromUrl(editTarget.photo_url, form.photoTransform)
        photo_url = await uploadPhoto(baked)
      }
      catch (err) { setPhotoUp(false); setSaving(false); alert(`Could not apply crop: ${err.message}`); return }
      setPhotoUp(false)
    }

    const variants = form.variants.filter(v => v.name.trim()).map(v => ({ name: v.name.trim(), price: Number(v.price) || 0 }))
    const updates = { name, price, description: form.description.trim() || '', category: form.category, is_veg: form.isVeg, photo_url, variants }

    let { error } = await supabase.from('products').update(updates).eq('id', editTarget.id)
    // Retry without is_veg if that column hasn't been added to the table yet.
    if (error && /is_veg|schema cache|column/i.test(error.message)) {
      const { is_veg: _v, ...noVeg } = updates
      ;({ error } = await supabase.from('products').update(noVeg).eq('id', editTarget.id))
    }
    setSaving(false)
    if (error) { alert(`Could not save changes: ${error.message}`); return }
    setEditTarget(null); setForm(EMPTY_FORM); load()
  }

  /* ── Update photo for row ── */
  const updateDishPhoto = async (file) => {
    if (!photoTarget || !file) return
    setPhotoUpd(true)
    let url
    try { url = await uploadPhoto(file) }
    catch (err) { setPhotoUpd(false); setPhotoTarget(null); alert(`Could not upload photo: ${err.message}`); return }
    const { error } = await supabase.from('products').update({ photo_url: url }).eq('id', photoTarget)
    setPhotoUpd(false)
    if (error) alert(`Could not update photo: ${error.message}`)
    else load()
    setPhotoTarget(null)
  }

  /* ── Delete dish ── */
  const deleteDish = async (id, name) => {
    if (!window.confirm(`Delete "${name}"? This cannot be undone.`)) return
    setProducts((prev) => prev.filter((p) => p.id !== id))
    const { error } = await supabase.from('products').delete().eq('id', id)
    if (error) { alert(`Could not delete: ${error.message}`); load() }
  }

  /* ── Availability toggle ── */
  const setAvailability = async (id, next) => {
    if (busy.has(id)) return
    if (!next) {
      // Trying to turn off -> show modal instead of doing it instantly
      const p = products.find(x => x.id === id)
      if (p) setTurnOffTarget(p)
      return
    }

    // Turning back ON
    setBusy((prev) => new Set(prev).add(id))
    setProducts((prev) => prev.map((p) => (p.id === id ? { ...p, is_available: true, next_available_at: null } : p)))
    const { error } = await supabase.from('products').update({ is_available: true, next_available_at: null }).eq('id', id)
    if (error) {
      setProducts((prev) => prev.map((p) => (p.id === id ? { ...p, is_available: false } : p)))
      alert(`Could not update availability: ${error.message}`)
    }
    setBusy((prev) => { const n = new Set(prev); n.delete(id); return n })
  }

  /* ── Confirm turn off with time ── */
  const confirmTurnOff = async (option) => {
    if (!turnOffTarget) return
    const id = turnOffTarget.id
    
    let nextAvailableAt = null
    const now = new Date()
    if (option === '2_hrs') {
      nextAvailableAt = new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString()
    } else if (option === '4_hrs') {
      nextAvailableAt = new Date(now.getTime() + 4 * 60 * 60 * 1000).toISOString()
    } else if (option === 'tomorrow') {
      // next day at the same time
      nextAvailableAt = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString()
    } else if (option === 'custom') {
      if (!turnOffCustom) { alert('Please select a custom date/time'); return }
      nextAvailableAt = new Date(turnOffCustom).toISOString()
    }

    setTurnOffTarget(null)
    setTurnOffCustom('')
    setBusy((prev) => new Set(prev).add(id))
    
    setProducts((prev) => prev.map((p) => (p.id === id ? { ...p, is_available: false, next_available_at: nextAvailableAt } : p)))
    const { error } = await supabase.from('products').update({ is_available: false, next_available_at: nextAvailableAt }).eq('id', id)
    if (error) {
      setProducts((prev) => prev.map((p) => (p.id === id ? { ...p, is_available: true, next_available_at: null } : p)))
      alert(`Could not update availability: ${error.message}`)
    }
    setBusy((prev) => { const n = new Set(prev); n.delete(id); return n })
  }

  /* ── Bulk mark available ── */
  const [bulkBusy, setBulkBusy] = useState(false)
  const updateAllAvailable = async () => {
    const offIds = products.filter((p) => !p.is_available).map((p) => p.id)
    if (bulkBusy || offIds.length === 0) return
    setBulkBusy(true)
    const prev = products
    setProducts((p) => p.map((x) => ({ ...x, is_available: true })))
    const { error } = await supabase.from('products').update({ is_available: true }).in('id', offIds)
    if (error) { setProducts(prev); alert(`Could not update: ${error.message}`) }
    setBulkBusy(false)
  }

  /* ── Add new category ── */
  const addCategory = async (e) => {
    e.preventDefault()
    const name = newCatName.trim()
    if (!name) return
    const slug = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
    if (categories.find((c) => c.slug === slug)) { alert('Category already exists.'); return }
    setSavingCat(true)
    const { error } = await supabase.from('menu_categories').insert({ name, slug })
    setSavingCat(false)
    if (error) {
      // If table doesn't exist yet, add locally only (newest first)
      if (error.message.includes('relation') || error.message.includes('does not exist')) {
        setCategories((prev) => [{ name, slug }, ...prev])
      } else {
        alert(`Could not save category: ${error.message}`)
        setSavingCat(false)
        return
      }
    } else {
      await loadCategories()
    }
    setShowAddCat(false)
    setNewCatName('')
  }

  /* ── Filter ── */
  const q = searchQuery.trim().toLowerCase()
  const visibleProducts = products.filter((p) => {
    if (active !== 'all' && effectiveCategory(p.category, p.name) !== active) return false
    if (!q) return true
    const n = (p.name || '').toLowerCase()
    return n.includes(q) || (p.description || '').toLowerCase().includes(q) || (p.category || '').toLowerCase().includes(q)
  })

  /* ── Pagination (client-side, 15 per page) ── */
  const pageCount    = Math.max(1, Math.ceil(visibleProducts.length / PAGE_SIZE))
  const safePage     = Math.min(page, pageCount)          // clamp if list shrank
  const pageStart    = (safePage - 1) * PAGE_SIZE
  const pagedProducts = visibleProducts.slice(pageStart, pageStart + PAGE_SIZE)
  // The filter handlers reset to page 1 when the category/search changes. All
  // reads use `safePage`, so a page that falls off the end after a delete still
  // renders correctly without needing to write state back.
  const selectCategory = (slug) => { setActive(slug); setPage(1) }
  const handleSearch   = (v) => { setSearch(v); setPage(1) }

  const inStock  = products.filter((p) => p.is_available).length
  const soldOut  = products.filter((p) => !p.is_available).length
  // Item count per category slug, for the tab badges.
  const catCounts = products.reduce((acc, p) => {
    const slug = effectiveCategory(p.category, p.name)
    acc[slug] = (acc[slug] || 0) + 1
    return acc
  }, {})
  const pad      = (n) => String(n).padStart(2, '0')
  const avgPrice = products.length ? Math.round(products.reduce((s, p) => s + (p.price || 0), 0) / products.length) : 0
  const categoryCount = new Set(products.map((p) => effectiveCategory(p.category, p.name))).size

  const perf  = [
    { label: 'TOTAL DISHES', value: String(products.length), sub: 'On the menu',         subTone: 'text-ink-soft' },
    { label: 'AVAILABLE',    value: pad(inStock),            sub: `${pad(soldOut)} sold out`, subTone: 'text-pos' },
    { label: 'AVG. PRICE',   value: `₹${avgPrice}`,         sub: `${categoryCount} categories`, subTone: 'text-ink-soft' },
  ]
  const stock = [
    { label: 'In Stock',  count: pad(inStock), icon: CheckCircle2, tone: 'text-pos',        bg: 'bg-pos-soft'     },
    { label: 'Low Stock', count: '00',         icon: AlertTriangle, tone: 'text-[#b45309]', bg: 'bg-[#fef3c7]'   },
    { label: 'Sold Out',  count: pad(soldOut), icon: XCircle,       tone: 'text-brand',      bg: 'bg-[#ffdad3]'   },
  ]

  /* ── Export the full menu to CSV, in canonical category order ── */
  const exportMenu = () => {
    if (products.length === 0) { alert('No dishes to export.'); return }
    const order = DEFAULT_CATEGORIES.map((c) => c.slug)
    const rank = (p) => { const i = order.indexOf(effectiveCategory(p.category, p.name)); return i === -1 ? 999 : i }
    const sorted = [...products].sort((a, b) =>
      rank(a) - rank(b) ||
      (a.created_at || '').localeCompare(b.created_at || '') ||
      (a.name || '').localeCompare(b.name || ''))
    const headers = ['#', 'Dish', 'Category', 'Price', 'Available', 'Veg', 'Variants', 'Description']
    const rows = sorted.map((p, i) => [
      i + 1,
      p.name || '',
      categoryLabel(p.category, p.name, categories),
      p.price ?? '',
      p.is_available ? 'Yes' : 'Sold out',
      productIsVeg(p) ? 'Veg' : 'Non-veg',
      Array.isArray(p.variants) ? p.variants.filter((v) => v.name).map((v) => `${v.name}: ${v.price}`).join(' | ') : '',
      p.description || '',
    ])
    exportToCsv(`menu-${new Date().toISOString().slice(0, 10)}.csv`, headers, rows)
  }

  /* ── Shared modal form fields ── */
  const renderDishFormFields = (isEdit) => (
    <div className="space-y-4 p-5">
      <PhotoUploader
        value={form.photoPreview}
        uploading={photoUploading}
        transform={form.photoTransform}
        onTransform={(tr) => setForm((f) => ({ ...f, photoTransform: tr }))}
        onChange={(file) => {
          const preview = URL.createObjectURL(file)
          setForm((f) => ({ ...f, photoFile: file, photoPreview: preview, photoTransform: { scale: 1, x: 0, y: 0 } }))
        }}
      />
      <div>
        <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-ink-soft">Dish Name</label>
        <input autoFocus={!isEdit} value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          placeholder="e.g. Chicken Biryani"
          className="w-full rounded-lg border border-line px-3 py-2 text-sm text-ink focus:border-brand focus:outline-none" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-ink-soft">Price (₹)</label>
          <input type="number" min="1" value={form.price}
            onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
            placeholder="e.g. 249"
            className="w-full rounded-lg border border-line px-3 py-2 text-sm text-ink focus:border-brand focus:outline-none" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-ink-soft">Category</label>
          <select value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
            className="w-full rounded-lg border border-line px-3 py-2 text-sm text-ink focus:border-brand focus:outline-none">
            {categories.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
          </select>
        </div>
      </div>
      <div>
        <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-ink-soft">Food Type</label>
        <div className="flex gap-2">
          <button type="button" onClick={() => setForm((f) => ({ ...f, isVeg: true }))}
            className={`flex flex-1 items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold transition-colors ${
              form.isVeg ? 'border-pos bg-pos-soft text-pos-dark' : 'border-line text-ink-soft hover:border-ink-soft'
            }`}>
            <VegDot veg={true} /> Veg
          </button>
          <button type="button" onClick={() => setForm((f) => ({ ...f, isVeg: false }))}
            className={`flex flex-1 items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold transition-colors ${
              !form.isVeg ? 'border-brand bg-brand-light text-brand' : 'border-line text-ink-soft hover:border-ink-soft'
            }`}>
            <VegDot veg={false} /> Non-veg
          </button>
        </div>
      </div>
      <div>
        <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-ink-soft">Description (optional)</label>
        <textarea rows={2} value={form.description}
          onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          placeholder="Short description shown to customers…"
          className="w-full resize-none rounded-lg border border-line px-3 py-2 text-sm text-ink focus:border-brand focus:outline-none" />
      </div>
      <VariantsEditor
        variants={form.variants}
        onChange={(v) => setForm((f) => ({ ...f, variants: v }))}
      />
    </div>
  )

  /* ═══════════════════════════════════════════════════════
     RENDER
  ═══════════════════════════════════════════════════════ */
  return (
    <>
      <Topbar>
        <SearchBox placeholder="Search dishes, prices, or categories..." className="w-full max-w-[420px]"
          value={searchQuery} onChange={handleSearch} />
        <div className="flex items-center gap-1">
          <TopIcons /><Divider />
          <ProfileChip name="Wali Baba Foods" sub="Restaurant Admin" initials="WB" />
        </div>
      </Topbar>

      {/* Hidden photo-update input */}
      <input ref={photoInputRef} type="file" accept="image/*" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) updateDishPhoto(f); e.target.value = '' }} />

      <div className="space-y-6 p-8">
        {/* ── Header ── */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-[32px] font-bold leading-8 text-ink">Menu Management</h1>
            <p className="mt-2 text-base text-ink-soft">Organize your culinary offerings, update pricing, and manage availability in real-time.</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={exportMenu}
              className="flex items-center gap-2 rounded-lg border border-line bg-white px-4 py-2.5 text-sm font-semibold text-ink hover:bg-line-soft">
              <Download className="h-4 w-4" /> Export
            </button>
            <button onClick={() => setShowAddCat(true)}
              className="flex items-center gap-2 rounded-lg border border-line bg-white px-4 py-2.5 text-sm font-semibold text-ink hover:bg-line-soft">
              <Tag className="h-4 w-4" /> Add Category
            </button>
            <button onClick={() => { setForm(EMPTY_FORM); setShowAdd(true) }}
              className="flex items-center gap-2 rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold uppercase tracking-wide text-white hover:bg-brand-dark">
              <Plus className="h-4 w-4" /> Add New Dish
            </button>
          </div>
        </div>

        {/* ── Table card ── */}
        <div className="rounded-xl border border-line bg-white">
          {/* Tabs */}
          <div className="flex items-center border-b border-line px-5">
            <div className="flex items-center gap-4 overflow-x-auto">
              {/* All tab */}
              <button onClick={() => selectCategory('all')}
                className={`flex shrink-0 items-center gap-2 border-b-2 py-4 text-sm font-semibold transition-colors ${active === 'all' ? 'border-brand text-brand' : 'border-transparent text-ink-soft hover:text-ink'}`}>
                <LayoutGrid className="h-4 w-4" /> All
                <CountBadge count={products.length} active={active === 'all'} />
              </button>
              {/* Dynamic category tabs */}
              {categories.map((cat) => {
                const Icon = catIcon(cat.slug)
                return (
                  <button key={cat.slug} onClick={() => selectCategory(cat.slug)}
                    className={`flex shrink-0 items-center gap-2 border-b-2 py-4 text-sm font-semibold transition-colors ${active === cat.slug ? 'border-brand text-brand' : 'border-transparent text-ink-soft hover:text-ink'}`}>
                    {Icon && <Icon className="h-4 w-4" />} {cat.name}
                    <CountBadge count={catCounts[cat.slug] || 0} active={active === cat.slug} />
                  </button>
                )
              })}
            </div>
          </div>

          {/* Table */}
          <table className="w-full text-left">
            <thead>
              <tr className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
                <th className="px-5 py-3">Dish Details</th>
                <th className="px-5 py-3">Category</th>
                <th className="px-5 py-3">Price / Variants</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3">Availability</th>
                <th className="px-5 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-soft">
              {loading ? (
                <tr><td colSpan={6} className="px-5 py-12 text-center text-sm text-ink-soft">Loading dishes…</td></tr>
              ) : visibleProducts.length === 0 ? (
                <tr><td colSpan={6} className="px-5 py-12 text-center text-sm text-ink-soft">
                  {q || active !== 'all' ? 'No dishes match this filter.' : 'No dishes found.'}
                </td></tr>
              ) : pagedProducts.map((p) => {
                const variants = Array.isArray(p.variants) ? p.variants.filter(v => v.name) : []
                return (
                  <tr key={p.id} className="hover:bg-line-soft/40 transition-colors">
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        <img src={imgFor(p.name, p.photo_url)} alt="" className="h-12 w-12 rounded-lg bg-line-2 object-contain object-center" />
                        <div>
                          <p className="flex items-center gap-1.5 text-sm font-semibold text-ink">
                            <VegDot veg={productIsVeg(p)} /> {p.name}
                          </p>
                          <p className="max-w-[220px] truncate text-xs text-ink-soft">{p.description || '—'}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      <span className="rounded bg-[#fdf0d5] px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-[#92710e]">
                        {categoryLabel(p.category, p.name, categories)}
                      </span>
                    </td>
                    <td className="px-5 py-4">
                      <p className="text-sm font-semibold text-ink">₹{p.price}</p>
                      {variants.length > 0 && (
                        <div className="mt-1 space-y-0.5">
                          {variants.map((v, i) => (
                            <p key={i} className="text-[11px] text-ink-soft">{v.name} — ₹{v.price}</p>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex flex-col">
                        <span className={`flex items-center gap-1.5 text-sm font-medium ${p.is_available ? 'text-pos' : 'text-brand'}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${p.is_available ? 'bg-pos' : 'bg-brand'}`} />
                          {p.is_available ? 'Active' : 'Unavailable'}
                        </span>
                        {!p.is_available && p.next_available_at && (
                          <span className="mt-1 text-[10px] font-semibold text-ink-soft">
                            Until {formatFutureTime(p.next_available_at)}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      <Toggle on={p.is_available} disabled={busy.has(p.id)} onChange={() => setAvailability(p.id, !p.is_available)} />
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-2">
                        <button type="button" onClick={() => openEdit(p)}
                          className="flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-[11px] font-semibold text-ink-soft hover:border-brand hover:text-brand transition-colors">
                          <Pencil className="h-3 w-3" /> Edit
                        </button>
                        <button type="button" onClick={() => deleteDish(p.id, p.name)}
                          className="flex items-center gap-1.5 rounded-lg border border-red-200 px-2.5 py-1.5 text-[11px] font-semibold text-red-400 hover:border-red-400 hover:bg-red-50 hover:text-red-600 transition-colors">
                          <Trash2 className="h-3 w-3" /> Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          <div className="flex flex-wrap items-center justify-between gap-3 p-5">
            <span className="text-sm text-ink-soft">
              {loading
                ? 'Loading…'
                : visibleProducts.length === 0
                  ? 'No dishes to show'
                  : `Showing ${pageStart + 1}–${Math.min(pageStart + PAGE_SIZE, visibleProducts.length)} of ${visibleProducts.length} dishes`}
            </span>
            {!loading && pageCount > 1 && (
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={safePage <= 1}
                  className="flex items-center gap-1 rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-ink-soft hover:border-brand hover:text-brand disabled:cursor-not-allowed disabled:opacity-40 transition-colors">
                  <ChevronLeft className="h-3.5 w-3.5" /> Prev
                </button>
                <span className="px-1 text-xs font-semibold text-ink-soft">Page {safePage} of {pageCount}</span>
                <button type="button" onClick={() => setPage((p) => Math.min(pageCount, p + 1))} disabled={safePage >= pageCount}
                  className="flex items-center gap-1 rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-ink-soft hover:border-brand hover:text-brand disabled:cursor-not-allowed disabled:opacity-40 transition-colors">
                  Next <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
          </div>
        </div>

        {/* ── Bottom stats ── */}
        <div className="grid grid-cols-[1fr_360px] gap-6">
          <div className="rounded-xl border border-line bg-white p-5">
            <h2 className="text-base font-bold text-ink">Menu Performance</h2>
            <div className="mt-4 grid grid-cols-3 gap-4">
              {perf.map((p) => (
                <div key={p.label} className="rounded-xl bg-line-soft p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">{p.label}</p>
                  <p className="mt-2 text-lg font-bold text-ink">{p.value}</p>
                  <p className={`mt-1 flex items-center gap-1 text-xs font-semibold ${p.subTone}`}>
                    <TrendingUp className="h-3.5 w-3.5" />{p.sub}
                  </p>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-xl border border-line bg-white p-5">
            <h2 className="text-base font-bold text-ink">Stock Overview</h2>
            <div className="mt-4 space-y-3">
              {stock.map((s) => (
                <div key={s.label} className="flex items-center justify-between">
                  <span className="flex items-center gap-2 text-sm text-ink">
                    <span className={`flex h-7 w-7 items-center justify-center rounded-full ${s.bg} ${s.tone}`}><s.icon className="h-4 w-4" /></span>
                    {s.label}
                  </span>
                  <span className="text-sm font-bold text-ink">{s.count}</span>
                </div>
              ))}
            </div>
            <button onClick={updateAllAvailable} disabled={bulkBusy || soldOut === 0}
              className="mt-5 w-full rounded-lg border border-line py-2.5 text-sm font-semibold text-ink hover:bg-line-soft disabled:cursor-not-allowed disabled:opacity-50">
              {bulkBusy ? 'Updating…' : soldOut === 0 ? 'All Dishes Available' : `Mark ${pad(soldOut)} Sold Out Available`}
            </button>
          </div>
        </div>
      </div>

      {/* ════════════════════════════════════════
          ADD NEW DISH MODAL
      ════════════════════════════════════════ */}
      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <form onSubmit={addDish} className="w-full max-w-md rounded-2xl bg-white shadow-xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-line p-5">
              <h3 className="text-base font-bold text-ink">Add New Dish</h3>
              <button type="button" onClick={() => { setShowAdd(false); setForm(EMPTY_FORM) }}
                className="rounded p-1 text-ink-soft hover:bg-line-soft hover:text-ink"><X className="h-4 w-4" /></button>
            </div>
            {renderDishFormFields(false)}
            <div className="flex items-center justify-end gap-3 border-t border-line p-5">
              <button type="button" onClick={() => { setShowAdd(false); setForm(EMPTY_FORM) }}
                className="rounded-lg border border-line px-4 py-2.5 text-xs font-semibold text-ink-soft hover:bg-canvas">Cancel</button>
              <button type="submit" disabled={saving || photoUploading}
                className="flex items-center gap-1.5 rounded-lg bg-brand px-5 py-2.5 text-xs font-bold text-white hover:bg-brand-dark disabled:opacity-50">
                <Plus className="h-4 w-4" />
                {photoUploading ? 'Uploading photo…' : saving ? 'Adding…' : 'Add Dish'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ════════════════════════════════════════
          EDIT DISH MODAL
      ════════════════════════════════════════ */}
      {editTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <form onSubmit={saveEdit} className="w-full max-w-md rounded-2xl bg-white shadow-xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-line p-5">
              <div>
                <h3 className="text-base font-bold text-ink">Edit Dish</h3>
                <p className="text-xs text-ink-soft">{editTarget.name}</p>
              </div>
              <button type="button" onClick={() => { setEditTarget(null); setForm(EMPTY_FORM) }}
                className="rounded p-1 text-ink-soft hover:bg-line-soft hover:text-ink"><X className="h-4 w-4" /></button>
            </div>
            {renderDishFormFields(true)}
            <div className="flex items-center justify-end gap-3 border-t border-line p-5">
              <button type="button" onClick={() => { setEditTarget(null); setForm(EMPTY_FORM) }}
                className="rounded-lg border border-line px-4 py-2.5 text-xs font-semibold text-ink-soft hover:bg-canvas">Cancel</button>
              <button type="submit" disabled={saving || photoUploading}
                className="flex items-center gap-1.5 rounded-lg bg-brand px-5 py-2.5 text-xs font-bold text-white hover:bg-brand-dark disabled:opacity-50">
                <Pencil className="h-4 w-4" />
                {photoUploading ? 'Uploading…' : saving ? 'Saving…' : 'Save Changes'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ════════════════════════════════════════
          ADD CATEGORY MODAL
      ════════════════════════════════════════ */}
      {showAddCat && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <form onSubmit={addCategory} className="w-full max-w-sm rounded-2xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-line p-5">
              <div>
                <h3 className="text-base font-bold text-ink">Add New Category</h3>
                <p className="text-xs text-ink-soft">Visible in tabs and customer app filters</p>
              </div>
              <button type="button" onClick={() => { setShowAddCat(false); setNewCatName('') }}
                className="rounded p-1 text-ink-soft hover:bg-line-soft hover:text-ink"><X className="h-4 w-4" /></button>
            </div>
            <div className="p-5">
              <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-ink-soft">Category Name</label>
              <input autoFocus value={newCatName} onChange={(e) => setNewCatName(e.target.value)}
                placeholder="e.g. Veg, Rolls, Starters…"
                className="w-full rounded-lg border border-line px-3 py-2 text-sm text-ink focus:border-brand focus:outline-none" />
              {newCatName.trim() && (
                <p className="mt-1.5 text-xs text-ink-soft">
                  Slug: <span className="font-mono text-brand">
                    {newCatName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')}
                  </span>
                </p>
              )}
            </div>
            <div className="flex items-center justify-end gap-3 border-t border-line p-5">
              <button type="button" onClick={() => { setShowAddCat(false); setNewCatName('') }}
                className="rounded-lg border border-line px-4 py-2.5 text-xs font-semibold text-ink-soft hover:bg-canvas">Cancel</button>
              <button type="submit" disabled={savingCat || !newCatName.trim()}
                className="flex items-center gap-1.5 rounded-lg bg-brand px-5 py-2.5 text-xs font-bold text-white hover:bg-brand-dark disabled:opacity-50">
                <Tag className="h-4 w-4" />
                {savingCat ? 'Saving…' : 'Create Category'}
              </button>
            </div>
          </form>
        </div>
      )}
      {/* ════════════════════════════════════════
          TURN OFF DISH MODAL
      ════════════════════════════════════════ */}
      {turnOffTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-line p-5">
              <div>
                <h3 className="text-base font-bold text-ink">Turn Off Dish</h3>
                <p className="text-xs text-ink-soft">{turnOffTarget.name}</p>
              </div>
              <button type="button" onClick={() => setTurnOffTarget(null)}
                className="rounded p-1 text-ink-soft hover:bg-line-soft hover:text-ink"><X className="h-4 w-4" /></button>
            </div>
            
            <div className="p-5 space-y-3">
              <p className="text-sm text-ink-soft mb-2">When should this item be available again?</p>
              
              <button onClick={() => confirmTurnOff('2_hrs')}
                className="w-full text-left rounded-lg border border-line px-4 py-3 text-sm font-semibold text-ink hover:border-brand hover:text-brand transition-colors">
                2 Hrs
              </button>
              <button onClick={() => confirmTurnOff('4_hrs')}
                className="w-full text-left rounded-lg border border-line px-4 py-3 text-sm font-semibold text-ink hover:border-brand hover:text-brand transition-colors">
                4 Hrs
              </button>
              <button onClick={() => confirmTurnOff('tomorrow')}
                className="w-full text-left rounded-lg border border-line px-4 py-3 text-sm font-semibold text-ink hover:border-brand hover:text-brand transition-colors">
                Tomorrow
              </button>
              <button onClick={() => confirmTurnOff('indefinite')}
                className="w-full text-left rounded-lg border border-line px-4 py-3 text-sm font-semibold text-ink hover:border-brand hover:text-brand transition-colors">
                Temporarily Closed
              </button>
              
              <div className="pt-2">
                <label className="mb-1 flex items-center justify-between text-xs font-bold uppercase tracking-wide text-ink-soft">
                  <span>Custom Date & Time</span>
                  {turnOffCustom && <span className="text-brand lowercase normal-case">{formatFutureTime(turnOffCustom)}</span>}
                </label>
                <div className="flex gap-2">
                  <input type="datetime-local" value={turnOffCustom} onChange={(e) => setTurnOffCustom(e.target.value)}
                    className="flex-1 rounded-lg border border-line px-3 py-2 text-sm text-ink focus:border-brand focus:outline-none" />
                  <button onClick={() => confirmTurnOff('custom')} disabled={!turnOffCustom}
                    className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-50 transition-colors">
                    Apply
                  </button>
                </div>
                <p className="mt-1.5 text-[11px] text-ink-soft">
                  Select the exact date and time this item should become available again.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
