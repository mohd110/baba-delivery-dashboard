import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Plus, X, Upload, ImagePlus, Trash2, Pencil, Image as ImageIcon,
  Eye, EyeOff, ArrowUp, ArrowDown, ExternalLink,
} from 'lucide-react'
import Topbar, { TopIcons } from '../layout/Topbar.jsx'
import { supabase } from '../lib/supabase.js'

// Promo banner images live in this bucket — never inline in the DB row.
const BUCKET = 'banner-photos'

const EMPTY_FORM = { title: '', subtitle: '', link_url: '', is_active: true, photoFile: null, photoPreview: null }

/* Upload a banner image to the bucket and return its public URL. Like the menu
 * uploader, we never fall back to a base64 data-URI — on failure we throw so the
 * caller can surface the error and the row only ever stores a short bucket URL. */
async function uploadBanner(file) {
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
  const path = `banners/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
  const { data, error } = await supabase.storage
    .from(BUCKET).upload(path, file, { cacheControl: '3600', upsert: false, contentType: file.type })
  if (error) throw new Error(error.message || 'Banner upload failed')
  const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(data.path)
  return urlData.publicUrl
}

/* ── Image uploader widget ──────────────────────────── */
function BannerUploader({ value, onChange, uploading }) {
  const ref = useRef(null)
  return (
    <div>
      <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-ink-soft">Banner image</label>
      <div onClick={() => !uploading && ref.current?.click()}
        className={`relative flex h-40 w-full cursor-pointer flex-col items-center justify-center gap-2 overflow-hidden rounded-xl border-2 border-dashed transition-colors ${value ? 'border-brand/40' : 'border-line hover:border-brand/50'} bg-line-soft`}>
        {value ? (
          <>
            <img src={value} alt="preview" className="absolute inset-0 h-full w-full object-cover" />
            <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 hover:opacity-100 transition-opacity">
              <span className="flex items-center gap-1.5 rounded-lg bg-white/90 px-3 py-1.5 text-xs font-bold text-ink">
                <Upload className="h-3.5 w-3.5" /> Change image
              </span>
            </div>
          </>
        ) : (
          <>
            <ImagePlus className="h-6 w-6 text-ink-soft" />
            <span className="text-xs text-ink-soft">{uploading ? 'Uploading…' : 'Click to upload a banner (wide image works best)'}</span>
          </>
        )}
      </div>
      <input ref={ref} type="file" accept="image/*" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onChange(f, URL.createObjectURL(f)); e.target.value = '' }} />
    </div>
  )
}

export default function Banners() {
  const [banners, setBanners] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editTarget, setEditTarget] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [busyId, setBusyId] = useState(null)

  /* ── Load ── */
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

  useEffect(() => {
    load()
    const channel = supabase.channel('banners-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'banners' }, () => load())
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [load])

  /* ── Modal helpers ── */
  const openAdd = () => { setEditTarget(null); setForm(EMPTY_FORM); setShowForm(true) }
  const openEdit = (b) => {
    setEditTarget(b)
    setForm({
      title: b.title || '',
      subtitle: b.subtitle || '',
      link_url: b.link_url || '',
      is_active: b.is_active ?? true,
      photoFile: null,
      photoPreview: b.image_url || null,
    })
    setShowForm(true)
  }
  const closeForm = () => { setShowForm(false); setEditTarget(null); setForm(EMPTY_FORM) }

  /* ── Save (add or edit) ── */
  const save = async (e) => {
    e.preventDefault()
    // A banner must have an image (new banners require an upload).
    if (!editTarget && !form.photoFile) { alert('Please upload a banner image.'); return }
    setSaving(true)

    let image_url = editTarget?.image_url || null
    if (form.photoFile) {
      setUploading(true)
      try { image_url = await uploadBanner(form.photoFile) }
      catch (err) { setUploading(false); setSaving(false); alert(`Could not upload image: ${err.message}`); return }
      setUploading(false)
    }

    const row = {
      image_url,
      title: form.title.trim() || null,
      subtitle: form.subtitle.trim() || null,
      link_url: form.link_url.trim() || null,
      is_active: form.is_active,
    }

    let error
    if (editTarget) {
      ;({ error } = await supabase.from('banners').update(row).eq('id', editTarget.id))
    } else {
      // Place new banners at the end of the current order.
      const nextOrder = banners.reduce((m, b) => Math.max(m, b.sort_order ?? 0), 0) + 1
      ;({ error } = await supabase.from('banners').insert({ ...row, sort_order: nextOrder }))
    }
    setSaving(false)
    if (error) { alert(`Could not save banner: ${error.message}`); return }
    closeForm(); load()
  }

  /* ── Toggle active ── */
  const toggleActive = async (b) => {
    setBusyId(b.id)
    setBanners((prev) => prev.map((x) => x.id === b.id ? { ...x, is_active: !x.is_active } : x))
    const { error } = await supabase.from('banners').update({ is_active: !b.is_active }).eq('id', b.id)
    setBusyId(null)
    if (error) { alert(`Could not update banner: ${error.message}`); load() }
  }

  /* ── Delete ── */
  const remove = async (b) => {
    if (!window.confirm('Delete this banner? This cannot be undone.')) return
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

  const activeCount = banners.filter((b) => b.is_active).length

  return (
    <>
      <Topbar>
        <h1 className="text-xl font-bold text-ink">Promo Banner Management</h1>
        <TopIcons />
      </Topbar>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="mb-5 flex items-center justify-between">
          <div>
            <p className="text-sm text-ink-soft">
              {loading ? 'Loading…' : `${banners.length} banner${banners.length === 1 ? '' : 's'} · ${activeCount} active`}
            </p>
            <p className="text-xs text-ink-soft">Active banners appear in the customer app carousel, in this order.</p>
          </div>
          <button type="button" onClick={openAdd}
            className="flex items-center gap-2 rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold uppercase tracking-wide text-white hover:bg-brand-dark">
            <Plus className="h-4 w-4" /> Add Banner
          </button>
        </div>

        {loading ? (
          <div className="rounded-2xl border border-line bg-white p-12 text-center text-sm text-ink-soft">Loading banners…</div>
        ) : banners.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-line bg-white p-12 text-center">
            <ImageIcon className="h-8 w-8 text-ink-soft" />
            <p className="text-sm font-semibold text-ink">No banners yet</p>
            <p className="max-w-sm text-xs text-ink-soft">Add a promotional banner to feature offers in the customer app.</p>
            <button type="button" onClick={openAdd}
              className="mt-1 flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-xs font-bold text-white hover:bg-brand-dark">
              <Plus className="h-4 w-4" /> Add your first banner
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {banners.map((b, i) => (
              <div key={b.id} className={`overflow-hidden rounded-2xl border bg-white transition-opacity ${b.is_active ? 'border-line' : 'border-line opacity-60'}`}>
                <div className="relative aspect-[16/7] w-full bg-line-2">
                  <img src={b.image_url} alt={b.title || 'banner'} className="h-full w-full object-cover" />
                  <span className={`absolute left-2 top-2 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${b.is_active ? 'bg-pos-soft text-pos-dark' : 'bg-line-2 text-ink-soft'}`}>
                    {b.is_active ? 'Active' : 'Hidden'}
                  </span>
                </div>
                <div className="p-3">
                  <p className="truncate text-sm font-semibold text-ink">{b.title || 'Untitled banner'}</p>
                  {b.subtitle && <p className="truncate text-xs text-ink-soft">{b.subtitle}</p>}
                  {b.link_url && (
                    <a href={b.link_url} target="_blank" rel="noreferrer"
                      className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-brand hover:underline">
                      <ExternalLink className="h-3 w-3" /> {b.link_url}
                    </a>
                  )}
                  <div className="mt-3 flex items-center justify-between">
                    <div className="flex items-center gap-1">
                      <button type="button" disabled={i === 0 || busyId === b.id} onClick={() => move(i, -1)}
                        className="rounded-md border border-line p-1.5 text-ink-soft hover:border-brand hover:text-brand disabled:opacity-30 transition-colors" title="Move up">
                        <ArrowUp className="h-3.5 w-3.5" />
                      </button>
                      <button type="button" disabled={i === banners.length - 1 || busyId === b.id} onClick={() => move(i, 1)}
                        className="rounded-md border border-line p-1.5 text-ink-soft hover:border-brand hover:text-brand disabled:opacity-30 transition-colors" title="Move down">
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
                        className="rounded-md border border-line p-1.5 text-ink-soft hover:border-brand hover:text-brand transition-colors" title="Edit">
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button type="button" onClick={() => remove(b)}
                        className="rounded-md border border-red-200 p-1.5 text-red-400 hover:border-red-400 hover:bg-red-50 hover:text-red-600 transition-colors" title="Delete">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add / Edit modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <form onSubmit={save} className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-line p-5">
              <h3 className="text-base font-bold text-ink">{editTarget ? 'Edit Banner' : 'Add Banner'}</h3>
              <button type="button" onClick={closeForm} className="rounded p-1 text-ink-soft hover:bg-line-soft hover:text-ink transition-colors">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-4 p-5">
              <BannerUploader
                value={form.photoPreview}
                uploading={uploading}
                onChange={(file, preview) => setForm((f) => ({ ...f, photoFile: file, photoPreview: preview }))}
              />
              <div>
                <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-ink-soft">Title (optional)</label>
                <input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                  placeholder="e.g. Flat 20% off this weekend"
                  className="w-full rounded-lg border border-line px-3 py-2 text-sm text-ink placeholder:text-ink-soft focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand/30" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-ink-soft">Subtitle (optional)</label>
                <input value={form.subtitle} onChange={(e) => setForm((f) => ({ ...f, subtitle: e.target.value }))}
                  placeholder="e.g. On all biryanis"
                  className="w-full rounded-lg border border-line px-3 py-2 text-sm text-ink placeholder:text-ink-soft focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand/30" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-ink-soft">Link URL (optional)</label>
                <input value={form.link_url} onChange={(e) => setForm((f) => ({ ...f, link_url: e.target.value }))}
                  placeholder="https://…"
                  className="w-full rounded-lg border border-line px-3 py-2 text-sm text-ink placeholder:text-ink-soft focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand/30" />
              </div>
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
                {uploading ? 'Uploading…' : saving ? 'Saving…' : editTarget ? 'Save Changes' : 'Add Banner'}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  )
}
