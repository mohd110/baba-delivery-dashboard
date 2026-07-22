import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Plus, X, Upload, ImagePlus, Trash2, Image as ImageIcon,
  Eye, EyeOff, ArrowUp, ArrowDown, AlertTriangle, Download,
  ZoomIn, ZoomOut, RotateCcw, Move,
} from 'lucide-react'
import Topbar, { TopIcons } from '../layout/Topbar.jsx'
import { supabase } from '../lib/supabase.js'
import { supportsWebp } from '../lib/compressImage.js'

// Hero slideshow images live in this bucket — never inline in the DB row.
const BUCKET = 'banner-photos'

// Where the customer app falls back to when no banner row is active. Listed
// read-only here so the manager can see what's live today.
const DEFAULTS_BUCKET = 'menu-photos'
const DEFAULTS_PATH = 'dishes/hero section photos'

// Upload rules from the customer app — a 171 MB hero folder previously blew
// through egress and timed out queries, so every upload is downscaled here.
const MAX_WIDTH = 1600
const JPEG_QUALITY = 0.8
const TARGET_BYTES = 500 * 1024
const HARD_MAX_BYTES = 2 * 1024 * 1024

// title / subtitle / link_url still exist on the table but the customer app
// never renders them, so they're deliberately absent from this form.
const EMPTY_FORM = { is_active: true, photoFile: null, photoPreview: null, portrait: false, bytes: 0, photoTransform: { scale: 1, x: 0, y: 0 } }

/* Clamp helper */
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

function loadImageEl(src, crossOrigin) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    if (crossOrigin) img.crossOrigin = crossOrigin
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Could not load image'))
    img.src = src
  })
}

/* Downscale to at most MAX_WIDTH and re-encode as JPEG so a phone photo can't
 * land in the bucket at full size. Returns the shape too — the hero is a short
 * full-width strip using object-cover, so portrait crops badly. */
async function compressBanner(file) {
  const url = URL.createObjectURL(file)
  try {
    const img = await loadImageEl(url)
    const portrait = img.naturalHeight > img.naturalWidth
    const w = Math.min(img.naturalWidth, MAX_WIDTH)
    const h = Math.round(img.naturalHeight * (w / img.naturalWidth))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, w, h)
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(img, 0, 0, w, h)
    const webp = supportsWebp()
    const type = webp ? 'image/webp' : 'image/jpeg'
    const blob = await new Promise((res) => canvas.toBlob(res, type, JPEG_QUALITY))
    if (!blob) return { file, portrait }
    const base = (file.name || 'banner').replace(/\.\w+$/, '')
    return { file: new File([blob], `${base}.${webp ? 'webp' : 'jpg'}`, { type }), portrait }
  } catch {
    return { file, portrait: false } // any canvas failure -> keep the original
  } finally {
    URL.revokeObjectURL(url)
  }
}

/* Upload a hero image to the bucket and return its public URL. Like the menu
 * uploader, we never fall back to a base64 data-URI — on failure we throw so the
 * caller can surface the error and the row only ever stores a short bucket URL. */
async function uploadBanner(file) {
  const ext = (file.name?.split('.').pop() || 'jpg').toLowerCase()
  const path = `banners/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
  const { data, error } = await supabase.storage
    .from(BUCKET).upload(path, file, { cacheControl: '31536000', upsert: false, contentType: file.type })
  if (error) throw new Error(error.message || 'Banner upload failed')
  const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(data.path)
  return urlData.publicUrl
}

function kb(bytes) {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`
}

/* Bake the manager's zoom/pan into the image before upload so the stored
 * image exactly matches what they framed — identical logic to Menu's version
 * but targeting a wide 16:7 banner aspect ratio (1600×700 px). */
function bakeBanner(img, transform, w, h, name) {
  const t = transform || { scale: 1, x: 0, y: 0 }
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, w, h)
  // cover-fit at scale 1: fill the frame, crop overflowing edges
  const ratio = Math.max(w / img.naturalWidth, h / img.naturalHeight)
  const dw = img.naturalWidth * ratio * t.scale
  const dh = img.naturalHeight * ratio * t.scale
  const left = w / 2 - dw / 2 + t.x * w
  const top  = h / 2 - dh / 2 + t.y * h
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, left, top, dw, dh)
  const webp = supportsWebp()
  const type = webp ? 'image/webp' : 'image/jpeg'
  return new Promise((res) => canvas.toBlob((blob) => {
    if (!blob) return res(null)
    const base = (name || 'banner').replace(/\.\w+$/, '')
    res(new File([blob], `${base}.${webp ? 'webp' : 'jpg'}`, { type }))
  }, type, JPEG_QUALITY))
}

async function renderAdjustedBanner(file, transform, w = 1600, h = 700) {
  const t = transform || { scale: 1, x: 0, y: 0 }
  if (t.scale === 1 && t.x === 0 && t.y === 0) return file
  const url = URL.createObjectURL(file)
  try {
    const img = await loadImageEl(url)
    return (await bakeBanner(img, t, w, h, file.name)) || file
  } catch {
    return file
  } finally {
    URL.revokeObjectURL(url)
  }
}

/* Re-crop an already-uploaded banner. Loaded through an <img> with
 * crossOrigin='anonymous' + a cache-buster so the canvas stays untainted and
 * toBlob works. fetch() fails here with "Failed to fetch": the preview <img>
 * caches an opaque response that a later CORS fetch reuses and rejects. */
async function renderAdjustedBannerFromUrl(src, transform, w = 1600, h = 700) {
  const bust = src.includes('?') ? '&' : '?'
  const img = await loadImageEl(`${src}${bust}cb=${Date.now()}`, 'anonymous')
  const baked = await bakeBanner(img, transform, w, h, 'banner')
  if (!baked) throw new Error('Could not render crop')
  return baked
}

/* ── Banner image uploader with zoom / pan / crop ─── */
function BannerUploader({ value, onPick, onTransform, transform, uploading, portrait, bytes }) {
  const fileRef  = useRef(null)
  const frameRef = useRef(null)
  const drag     = useRef(null)
  const t        = transform || { scale: 1, x: 0, y: 0 }

  const pick     = () => { if (!uploading) fileRef.current?.click() }
  const setScale = (s) => onTransform?.({ ...t, scale: clamp(Number(s.toFixed(2)), 0.5, 4) })
  const reset    = () => onTransform?.({ scale: 1, x: 0, y: 0 })

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
      <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-ink-soft">Slideshow photo</label>
      <div
        ref={frameRef}
        onClick={() => { if (!value) pick() }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerLeave={endDrag}
        style={{ touchAction: 'none', cursor: value ? 'grab' : 'pointer' }}
        className={`relative flex h-40 w-full flex-col items-center justify-center gap-2 overflow-hidden rounded-xl border-2 border-dashed transition-colors ${value ? 'border-brand/40' : 'border-line hover:border-brand/50'} bg-line-soft`}
      >
        {value ? (
          <img
            src={value}
            alt="preview"
            draggable={false}
            className="absolute inset-0 h-full w-full select-none object-cover"
            style={{ transform: `translate(${t.x * 100}%, ${t.y * 100}%) scale(${t.scale})` }}
          />
        ) : (
          <>
            <ImagePlus className="h-6 w-6 text-ink-soft" />
            <span className="text-xs text-ink-soft">{uploading ? 'Uploading…' : 'Click to upload — landscape / wide photo'}</span>
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

      <p className="mt-1.5 text-[11px] text-ink-soft">
        Resized to {MAX_WIDTH}px wide, JPEG. Keep it under {Math.round(TARGET_BYTES / 1024)} KB.
        {bytes ? <span className="font-semibold text-ink"> · this one: {kb(bytes)}</span> : null}
      </p>
      {portrait && (
        <p className="mt-1 flex items-start gap-1.5 text-[11px] font-semibold text-amber-700">
          <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
          That's a portrait photo. Use the zoom/drag controls above to frame the best part.
        </p>
      )}
      <input ref={fileRef} type="file" accept="image/*" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onPick(f); e.target.value = '' }} />
    </div>
  )
}

export default function Banners() {
  const [banners, setBanners] = useState([])
  const [defaults, setDefaults] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editTarget, setEditTarget] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [busyId, setBusyId] = useState(null)
  const [importing, setImporting] = useState(false)

  /* ── Load banner rows ── */
  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('banners')
      .select('*')
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: false })
    if (error) console.error('Failed to load banners:', error.message)
    setBanners(data ?? [])
    setLoading(false)
  }, [])

  /* ── Load the Storage fallback photos the app uses when nothing is active ── */
  const loadDefaults = useCallback(async () => {
    const { data, error } = await supabase.storage
      .from(DEFAULTS_BUCKET)
      .list(DEFAULTS_PATH, { limit: 100, sortBy: { column: 'name', order: 'asc' } })
    if (error) { console.error('Failed to list default hero photos:', error.message); return }
    const files = (data ?? []).filter((f) => f.id && !f.name.startsWith('.'))
    setDefaults(files.map((f) => ({
      name: f.name,
      url: supabase.storage.from(DEFAULTS_BUCKET).getPublicUrl(`${DEFAULTS_PATH}/${f.name}`).data.publicUrl,
    })))
  }, [])

  useEffect(() => {
    load()
    loadDefaults()
    const channel = supabase.channel('banners-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'banners' }, () => load())
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [load, loadDefaults])

  const activeCount = useMemo(() => banners.filter((b) => b.is_active).length, [banners])
  // The customer app only falls back to Storage when *no* row is active.
  const showingDefaults = activeCount === 0

  /* ── Modal helpers ── */
  const openAdd = () => { setEditTarget(null); setForm(EMPTY_FORM); setShowForm(true) }
  const openEdit = (b) => {
    setEditTarget(b)
    setForm({ ...EMPTY_FORM, is_active: b.is_active ?? true, photoPreview: b.image_url || null, photoTransform: { scale: 1, x: 0, y: 0 } })
    setShowForm(true)
  }
  const closeForm = () => { setShowForm(false); setEditTarget(null); setForm(EMPTY_FORM) }

  /* Compress on pick so the manager sees the real size before saving. */
  const pickPhoto = async (file) => {
    const { file: out, portrait } = await compressBanner(file)
    if (out.size > HARD_MAX_BYTES) {
      alert(`That photo is ${kb(out.size)} even after resizing — too large for the hero. Please use a smaller or less detailed image.`)
      return
    }
    setForm((f) => ({ ...f, photoFile: out, photoPreview: URL.createObjectURL(out), portrait, bytes: out.size, photoTransform: { scale: 1, x: 0, y: 0 } }))
  }

  /* ── Save (add or edit) ── */
  const save = async (e) => {
    e.preventDefault()
    if (!editTarget && !form.photoFile) { alert('Please upload a photo.'); return }
    setSaving(true)

    let image_url = editTarget?.image_url || null
    if (form.photoFile) {
      setUploading(true)
      try {
        const baked = await renderAdjustedBanner(form.photoFile, form.photoTransform)
        image_url = await uploadBanner(baked)
      }
      catch (err) { setUploading(false); setSaving(false); alert(`Could not upload photo: ${err.message}`); return }
      setUploading(false)
    } else if (editTarget?.image_url) {
      // No new file picked but a zoom/pan transform was applied — load the
      // existing image (CORS-safe), bake the crop into it, and re-upload.
      const t = form.photoTransform || { scale: 1, x: 0, y: 0 }
      const transformApplied = t.scale !== 1 || t.x !== 0 || t.y !== 0
      if (transformApplied) {
        setUploading(true)
        try {
          const baked = await renderAdjustedBannerFromUrl(editTarget.image_url, form.photoTransform)
          image_url = await uploadBanner(baked)
        }
        catch (err) { setUploading(false); setSaving(false); alert(`Could not apply crop: ${err.message}`); return }
        setUploading(false)
      }
    }

    const row = { image_url, is_active: form.is_active }

    let error
    if (editTarget) {
      ;({ error } = await supabase.from('banners').update(row).eq('id', editTarget.id))
    } else {
      // Place new slides at the end of the current order.
      const nextOrder = banners.reduce((m, b) => Math.max(m, b.sort_order ?? 0), 0) + 1
      ;({ error } = await supabase.from('banners').insert({ ...row, sort_order: nextOrder }))
    }
    setSaving(false)
    if (error) { alert(`Could not save: ${error.message}`); return }
    closeForm(); load()
  }

  /* ── Copy the Storage defaults into rows so they can be edited/reordered ── */
  const importDefaults = async () => {
    if (defaults.length === 0) return
    if (!window.confirm(
      `Copy the ${defaults.length} default photos into the slideshow as editable slides?\n\n` +
      `They will look the same to customers, but from then on the slideshow is driven by this page.`
    )) return
    setImporting(true)
    const base = banners.reduce((m, b) => Math.max(m, b.sort_order ?? 0), 0)
    const rows = defaults.map((d, i) => ({ image_url: d.url, is_active: true, sort_order: base + i + 1 }))
    const { error } = await supabase.from('banners').insert(rows)
    setImporting(false)
    if (error) { alert(`Could not import: ${error.message}`); return }
    load()
  }

  /* ── Toggle active ── */
  const toggleActive = async (b) => {
    setBusyId(b.id)
    setBanners((prev) => prev.map((x) => x.id === b.id ? { ...x, is_active: !x.is_active } : x))
    const { error } = await supabase.from('banners').update({ is_active: !b.is_active }).eq('id', b.id)
    setBusyId(null)
    if (error) { alert(`Could not update: ${error.message}`); load() }
  }

  /* ── Delete ── */
  const remove = async (b) => {
    if (!window.confirm('Delete this slide? This cannot be undone.')) return
    setBanners((prev) => prev.filter((x) => x.id !== b.id))
    const { error } = await supabase.from('banners').delete().eq('id', b.id)
    if (error) { alert(`Could not delete: ${error.message}`); load() }
  }

  /* ── Reorder (swap sort_order with the neighbour) ── */
  const move = async (index, dir) => {
    const target = banners[index]
    const swap = banners[index + dir]
    if (!target || !swap) return
    const a = target.sort_order ?? index
    const b = swap.sort_order ?? index + dir
    setBusyId(target.id)
    const { error } = await supabase.from('banners').upsert([
      { id: target.id, sort_order: b },
      { id: swap.id, sort_order: a },
    ])
    setBusyId(null)
    if (error) alert(`Could not reorder: ${error.message}`)
    load()
  }

  return (
    <>
      <Topbar>
        <h1 className="text-xl font-bold text-ink">Hero Slideshow</h1>
        <TopIcons />
      </Topbar>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <p className="text-sm text-ink-soft">
              {loading ? 'Loading…' : `${banners.length} slide${banners.length === 1 ? '' : 's'} · ${activeCount} active`}
            </p>
            <p className="text-xs text-ink-soft">
              Photos that rotate at the top of the customer's menu screen. They crossfade every 4 seconds, in this order.
            </p>
          </div>
          <button type="button" onClick={openAdd}
            className="flex shrink-0 items-center gap-2 rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold uppercase tracking-wide text-white hover:bg-brand-dark">
            <Plus className="h-4 w-4" /> Add Photo
          </button>
        </div>

        {/* The all-or-nothing switch: one active slide replaces every default photo. */}
        {!loading && showingDefaults && defaults.length > 0 && (
          <div className="mb-5 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-amber-900">
                Currently showing — {defaults.length} default photos
              </p>
              <p className="mt-0.5 text-xs text-amber-800">
                Nothing on this page is active, so the app falls back to the stored photo set below.
                The moment you activate one slide here, it <b>replaces all {defaults.length}</b> — customers will
                see only what's on this page.
              </p>
              <button type="button" onClick={importDefaults} disabled={importing}
                className="mt-2.5 flex items-center gap-1.5 rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-bold text-amber-900 hover:bg-amber-100 disabled:opacity-50 transition-colors">
                <Download className="h-3.5 w-3.5" />
                {importing ? 'Importing…' : `Import these ${defaults.length} photos as slides`}
              </button>
            </div>
          </div>
        )}

        {loading ? (
          <div className="rounded-2xl border border-line bg-white p-12 text-center text-sm text-ink-soft">Loading slideshow…</div>
        ) : banners.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-line bg-white p-12 text-center">
            <ImageIcon className="h-8 w-8 text-ink-soft" />
            <p className="text-sm font-semibold text-ink">No slides of your own yet</p>
            <p className="max-w-sm text-xs text-ink-soft">
              Add a photo to take over the hero slideshow, or import the default photos below to start from them.
            </p>
            <button type="button" onClick={openAdd}
              className="mt-1 flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-xs font-bold text-white hover:bg-brand-dark">
              <Plus className="h-4 w-4" /> Add your first photo
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {banners.map((b, i) => (
              <div key={b.id} className={`overflow-hidden rounded-2xl border bg-white transition-opacity ${b.is_active ? 'border-line' : 'border-line opacity-60'}`}>
                <div className="relative aspect-[16/7] w-full bg-line-2">
                  <img src={b.image_url} alt="" className="h-full w-full object-cover" />
                  <span className={`absolute left-2 top-2 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${b.is_active ? 'bg-pos-soft text-pos-dark' : 'bg-line-2 text-ink-soft'}`}>
                    {b.is_active ? 'Live' : 'Hidden'}
                  </span>
                </div>
                <div className="flex items-center justify-between p-3">
                  <div className="flex items-center gap-1">
                    <button type="button" disabled={i === 0 || busyId === b.id} onClick={() => move(i, -1)}
                      className="rounded-md border border-line p-1.5 text-ink-soft hover:border-brand hover:text-brand disabled:opacity-30 transition-colors" title="Move earlier">
                      <ArrowUp className="h-3.5 w-3.5" />
                    </button>
                    <button type="button" disabled={i === banners.length - 1 || busyId === b.id} onClick={() => move(i, 1)}
                      className="rounded-md border border-line p-1.5 text-ink-soft hover:border-brand hover:text-brand disabled:opacity-30 transition-colors" title="Move later">
                      <ArrowDown className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div className="flex items-center gap-1">
                    <button type="button" disabled={busyId === b.id} onClick={() => toggleActive(b)}
                      className="flex items-center gap-1 rounded-md border border-line px-2 py-1.5 text-[11px] font-semibold text-ink-soft hover:border-brand hover:text-brand disabled:opacity-50 transition-colors">
                      {b.is_active ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                      {b.is_active ? 'Hide' : 'Show'}
                    </button>
                    <button type="button" onClick={() => openEdit(b)}
                      className="rounded-md border border-line px-2 py-1.5 text-[11px] font-semibold text-ink-soft hover:border-brand hover:text-brand transition-colors" title="Replace photo">
                      Replace
                    </button>
                    <button type="button" onClick={() => remove(b)}
                      className="rounded-md border border-red-200 p-1.5 text-red-400 hover:border-red-400 hover:bg-red-50 hover:text-red-600 transition-colors" title="Delete">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Read-only view of the Storage fallback set. */}
        {!loading && defaults.length > 0 && (
          <div className="mt-8">
            <div className="mb-3 flex items-baseline gap-2">
              <h2 className="text-sm font-bold text-ink">Default photos</h2>
              <p className="text-xs text-ink-soft">
                {showingDefaults
                  ? `Live now — these ${defaults.length} rotate in the app.`
                  : `Not showing — your active slides above replace these.`}
                {' '}Read-only · <code className="text-[11px]">{DEFAULTS_BUCKET}/{DEFAULTS_PATH}</code>
              </p>
            </div>
            <div className={`grid grid-cols-3 gap-3 md:grid-cols-5 xl:grid-cols-6 ${showingDefaults ? '' : 'opacity-50'}`}>
              {defaults.map((d) => (
                <div key={d.name} className="overflow-hidden rounded-lg border border-line bg-white">
                  <div className="aspect-[16/7] w-full bg-line-2">
                    <img src={d.url} alt="" className="h-full w-full object-cover" loading="lazy" />
                  </div>
                  <p className="truncate px-2 py-1.5 text-[10px] text-ink-soft" title={d.name}>{d.name}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Add / Replace modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <form onSubmit={save} className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-line p-5">
              <h3 className="text-base font-bold text-ink">{editTarget ? 'Replace Photo' : 'Add Photo'}</h3>
              <button type="button" onClick={closeForm} className="rounded p-1 text-ink-soft hover:bg-line-soft hover:text-ink transition-colors">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-4 p-5">
              {/* Adding the first active slide silently drops the whole default set. */}
              {!editTarget && showingDefaults && defaults.length > 0 && (
                <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 p-3">
                  <AlertTriangle className="mt-px h-4 w-4 shrink-0 text-amber-600" />
                  <p className="text-xs text-amber-900">
                    Adding a photo replaces the {defaults.length} default hero photos. Only your uploaded slides will show.
                  </p>
                </div>
              )}
              <BannerUploader
                value={form.photoPreview}
                uploading={uploading}
                portrait={form.portrait}
                bytes={form.bytes}
                transform={form.photoTransform}
                onTransform={(tr) => setForm((f) => ({ ...f, photoTransform: tr }))}
                onPick={pickPhoto}
              />
              <label className="flex cursor-pointer items-center justify-between rounded-lg border border-line px-3 py-2.5">
                <span className="text-sm font-semibold text-ink">Show in customer app</span>
                <input type="checkbox" checked={form.is_active}
                  onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))}
                  className="h-4 w-4 accent-brand" />
              </label>
            </div>

            <div className="flex items-center justify-end gap-3 border-t border-line p-5">
              <button type="button" onClick={closeForm}
                className="rounded-lg border border-line px-4 py-2.5 text-xs font-semibold text-ink-soft hover:bg-canvas transition-colors">
                Cancel
              </button>
              <button type="submit" disabled={saving || uploading}
                className="flex items-center gap-1.5 rounded-lg bg-brand px-5 py-2.5 text-xs font-bold text-white hover:bg-brand-dark disabled:opacity-50">
                {uploading ? 'Uploading…' : saving ? 'Saving…' : editTarget ? 'Save Changes' : 'Add Photo'}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  )
}
