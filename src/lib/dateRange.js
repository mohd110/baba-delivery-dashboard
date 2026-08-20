// Shared date-range presets used by every reporting page: Today, Yesterday,
// This Month, and a Custom from–to selection. Kept framework-free so it can be
// unit-reasoned about and reused anywhere.
//
// ── Why the day starts in IST, not in the browser ────────────────────────
// The rider app's earnings totals come from the get_my_earnings_summary RPC
// (rider app migration 009), which pins its day/week/month boundaries to
// Asia/Kolkata precisely so UTC midnight — 5:30am IST — can't roll "today"
// over hours early. This used to use the browser's own midnight, so the same
// rider's daily earnings differed between the two whenever the dashboard was
// opened on a machine that wasn't set to IST. The business is India-only and
// IST has no daylight saving, so a fixed offset is exact.
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000

export const RANGE_PRESETS = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'month', label: 'This Month' },
  { key: 'custom', label: 'Custom' },
]

// The calendar date `d` falls on *in India*, whatever the machine's timezone.
function istParts(d) {
  const shifted = new Date(d.getTime() + IST_OFFSET_MS)
  return { y: shifted.getUTCFullYear(), m: shifted.getUTCMonth(), day: shifted.getUTCDate() }
}

// The instant IST-midnight of `d`'s Indian calendar day (returned as a real
// Date, i.e. the correct UTC instant — comparisons stay timezone-proof).
function startOfDay(d) {
  const { y, m, day } = istParts(d)
  return new Date(Date.UTC(y, m, day, 0, 0, 0, 0) - IST_OFFSET_MS)
}

function endOfDay(d) {
  const { y, m, day } = istParts(d)
  return new Date(Date.UTC(y, m, day, 23, 59, 59, 999) - IST_OFFSET_MS)
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
    // Exactly 24h back: IST has no DST, so this can't land on the wrong day.
    const y = new Date(now.getTime() - 24 * 60 * 60 * 1000)
    return { start: startOfDay(y), end: endOfDay(y) }
  }
  if (preset === 'month') {
    const { y, m } = istParts(now)
    return { start: new Date(Date.UTC(y, m, 1, 0, 0, 0, 0) - IST_OFFSET_MS), end: endOfDay(now) }
  }
  if (preset === 'custom') {
    if (!customStart || !customEnd) return null
    const s = new Date(customStart)
    const e = new Date(customEnd)
    if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return null
    const start = startOfDay(s)
    const end = endOfDay(e)
    if (start > end) return null
    return { start, end }
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
  // Formatted in IST too, so the label can't name a different day than the
  // range it describes.
  const fmt = (d) =>
    d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' })
  return `${fmt(range.start)} – ${fmt(range.end)}`
}
