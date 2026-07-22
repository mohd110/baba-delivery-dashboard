// Browser-side image compressor. Resizes a picked photo to a sane maximum
// dimension and re-encodes it as WebP (JPEG fallback on ancient browsers) so a
// 10–30 MB camera photo becomes ~150–250 KB *before* it ever reaches Supabase
// Storage. This is 95%+ of the egress win described in the image-optimization
// handoff. Pure canvas API — no dependencies.
//
// Pair every `.upload()` that stores one of these files with a long
// `cacheControl` (e.g. '31536000' — one year) so repeat views don't re-download.

const MAX_DIM = 1200
const QUALITY = 0.8

// Human-readable byte size, for before→after logging / admin display.
export function formatBytes(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${Math.round(bytes / 1024)} KB`
}

// Can this browser's canvas actually encode WebP? (Safari <14 could not.)
let _webpSupport = null
export function supportsWebp() {
  if (_webpSupport != null) return _webpSupport
  try {
    const c = document.createElement('canvas')
    c.width = c.height = 1
    _webpSupport = c.toDataURL('image/webp').startsWith('data:image/webp')
  } catch {
    _webpSupport = false
  }
  return _webpSupport
}

function loadImageEl(src) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Could not load image'))
    img.src = src
  })
}

/* Resize (aspect-preserving) to at most `maxDim` on the longest side and
 * re-encode as WebP. Returns a new File; on any failure or if it wouldn't help,
 * returns the original file untouched so an upload never breaks. */
export async function compressImage(file, { maxDim = MAX_DIM, quality = QUALITY } = {}) {
  if (!file || !file.type?.startsWith('image/')) return file
  const url = URL.createObjectURL(file)
  try {
    const img = await loadImageEl(url)
    const w = img.naturalWidth
    const h = img.naturalHeight
    if (!w || !h) return file
    const scale = Math.min(1, maxDim / Math.max(w, h))
    const outW = Math.round(w * scale)
    const outH = Math.round(h * scale)
    const canvas = document.createElement('canvas')
    canvas.width = outW
    canvas.height = outH
    const ctx = canvas.getContext('2d')
    // White matte so photos with transparency don't go black under JPEG.
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, outW, outH)
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(img, 0, 0, outW, outH)
    const webp = supportsWebp()
    const type = webp ? 'image/webp' : 'image/jpeg'
    const ext = webp ? 'webp' : 'jpg'
    const blob = await new Promise((res) => canvas.toBlob(res, type, quality))
    if (!blob) return file
    // If we didn't resize and the re-encode came out no smaller, keep the
    // original — no point uploading a same-or-bigger file.
    if (scale === 1 && blob.size >= file.size) return file
    const base = (file.name || 'photo').replace(/\.\w+$/, '')
    return new File([blob], `${base}.${ext}`, { type })
  } catch {
    return file
  } finally {
    URL.revokeObjectURL(url)
  }
}
