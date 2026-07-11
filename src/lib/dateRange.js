// Shared date-range presets used by every reporting page: Today, Yesterday,
// This Month, and a Custom from–to selection. Kept framework-free so it can be
// unit-reasoned about and reused anywhere.
export const RANGE_PRESETS = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'month', label: 'This Month' },
  { key: 'custom', label: 'Custom' },
]

function startOfDay(d) {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

function endOfDay(d) {
  const x = new Date(d)
  x.setHours(23, 59, 59, 999)
  return x
}

// Resolve a preset (+ optional custom dates) to an inclusive { start, end }.
// Returns null when the range can't be resolved (e.g. a custom range that
// isn't fully filled in yet) — callers treat null as "no filter / all time".
export function resolveRange(preset, customStart, customEnd) {
  const now = new Date()
  if (preset === 'today') {
    return { start: startOfDay(now), end: endOfDay(now) }
  }
  if (preset === 'yesterday') {
    const y = new Date(now)
    y.setDate(now.getDate() - 1)
    return { start: startOfDay(y), end: endOfDay(y) }
  }
  if (preset === 'month') {
    const first = new Date(now.getFullYear(), now.getMonth(), 1)
    return { start: startOfDay(first), end: endOfDay(now) }
  }
  if (preset === 'custom') {
    if (!customStart || !customEnd) return null
    const s = startOfDay(new Date(customStart))
    const e = endOfDay(new Date(customEnd))
    if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime()) || s > e) return null
    return { start: s, end: e }
  }
  return null
}

// True when an ISO timestamp falls inside the range (or when there is no range).
export function inRange(iso, range) {
  if (!range) return true
  if (!iso) return false
  const t = new Date(iso).getTime()
  return t >= range.start.getTime() && t <= range.end.getTime()
}

// Human-readable label for the current selection, e.g. "This Month" or
// "1 Jul – 11 Jul" for a custom range.
export function rangeLabel(preset, range) {
  if (preset !== 'custom') {
    return RANGE_PRESETS.find((r) => r.key === preset)?.label ?? ''
  }
  if (!range) return 'Custom range'
  const fmt = (d) => d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
  return `${fmt(range.start)} – ${fmt(range.end)}`
}
