import { useEffect, useRef, useState } from 'react'
import { Calendar } from 'lucide-react'
import { RANGE_PRESETS, resolveRange } from '../lib/dateRange.js'

/*
 * Segmented Today / Yesterday / This Month / Custom control shared by every
 * reporting page. Owns its own preset + custom-date state and calls
 * onChange(range, preset) whenever the selection changes (including on mount),
 * where `range` is { start, end } or null for an unfinished custom range.
 *
 * The custom start/end pickers live in a floating popover anchored to the
 * control so opening them never reflows the surrounding page layout.
 */
export default function DateRangeFilter({ defaultPreset = 'today', onChange }) {
  const [preset, setPreset] = useState(defaultPreset)
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [showCustom, setShowCustom] = useState(false)
  const wrapRef = useRef(null)

  // Keep the latest onChange without making it a dependency (parents usually
  // pass an inline arrow, which would otherwise re-fire this effect endlessly).
  const onChangeRef = useRef(onChange)
  useEffect(() => {
    onChangeRef.current = onChange
  })

  useEffect(() => {
    onChangeRef.current(resolveRange(preset, customStart, customEnd), preset)
  }, [preset, customStart, customEnd])

  // Close the popover on an outside click or Escape.
  useEffect(() => {
    if (!showCustom) return
    const onDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setShowCustom(false)
    }
    const onKey = (e) => {
      if (e.key === 'Escape') setShowCustom(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [showCustom])

  const handlePreset = (key) => {
    setPreset(key)
    // Clicking Custom (or re-clicking it) toggles the picker popover.
    setShowCustom(key === 'custom')
  }

  const customLabel =
    customStart && customEnd
      ? `${customStart} → ${customEnd}`
      : customStart
        ? `From ${customStart}`
        : 'Pick dates'

  return (
    <div ref={wrapRef} className="relative flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-1 rounded-lg border border-line bg-white p-1">
        {RANGE_PRESETS.map((r) => (
          <button
            key={r.key}
            type="button"
            onClick={() => handlePreset(r.key)}
            className={`rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors ${
              preset === r.key ? 'bg-brand text-white' : 'text-ink-soft hover:text-ink'
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>

      {preset === 'custom' && (
        <button
          type="button"
          onClick={() => setShowCustom((s) => !s)}
          className="flex items-center gap-1.5 rounded-lg border border-line bg-white px-2.5 py-1.5 text-xs font-semibold text-ink-soft hover:text-ink"
        >
          <Calendar className="h-3.5 w-3.5 shrink-0 text-ink-soft" />
          {customLabel}
        </button>
      )}

      {preset === 'custom' && showCustom && (
        <div className="absolute left-0 top-full z-40 mt-2 w-64 rounded-xl border border-line bg-white p-4 shadow-xl">
          <div className="space-y-3">
            <label className="block">
              <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-ink-soft">
                Start date
              </span>
              <input
                type="date"
                value={customStart}
                max={customEnd || undefined}
                onChange={(e) => setCustomStart(e.target.value)}
                className="w-full rounded-lg border border-line px-2.5 py-1.5 text-xs text-ink focus:border-brand focus:outline-none"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-ink-soft">
                End date
              </span>
              <input
                type="date"
                value={customEnd}
                min={customStart || undefined}
                onChange={(e) => setCustomEnd(e.target.value)}
                className="w-full rounded-lg border border-line px-2.5 py-1.5 text-xs text-ink focus:border-brand focus:outline-none"
              />
            </label>
            <button
              type="button"
              onClick={() => setShowCustom(false)}
              className="w-full rounded-lg bg-brand px-3 py-1.5 text-xs font-bold text-white hover:bg-brand-dark"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
