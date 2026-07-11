import { useEffect, useRef, useState } from 'react'
import { Calendar } from 'lucide-react'
import { RANGE_PRESETS, resolveRange } from '../lib/dateRange.js'

/*
 * Segmented Today / Yesterday / This Month / Custom control shared by every
 * reporting page. Owns its own preset + custom-date state and calls
 * onChange(range, preset) whenever the selection changes (including on mount),
 * where `range` is { start, end } or null for an unfinished custom range.
 */
export default function DateRangeFilter({ defaultPreset = 'today', onChange }) {
  const [preset, setPreset] = useState(defaultPreset)
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')

  // Keep the latest onChange without making it a dependency (parents usually
  // pass an inline arrow, which would otherwise re-fire this effect endlessly).
  const onChangeRef = useRef(onChange)
  useEffect(() => {
    onChangeRef.current = onChange
  })

  useEffect(() => {
    onChangeRef.current(resolveRange(preset, customStart, customEnd), preset)
  }, [preset, customStart, customEnd])

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-1 rounded-lg border border-line bg-white p-1">
        {RANGE_PRESETS.map((r) => (
          <button
            key={r.key}
            type="button"
            onClick={() => setPreset(r.key)}
            className={`rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors ${
              preset === r.key ? 'bg-brand text-white' : 'text-ink-soft hover:text-ink'
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>

      {preset === 'custom' && (
        <div className="flex items-center gap-1.5 rounded-lg border border-line bg-white px-2.5 py-1.5">
          <Calendar className="h-3.5 w-3.5 shrink-0 text-ink-soft" />
          <input
            type="date"
            value={customStart}
            max={customEnd || undefined}
            onChange={(e) => setCustomStart(e.target.value)}
            className="bg-transparent text-xs text-ink focus:outline-none"
          />
          <span className="text-xs text-ink-soft">to</span>
          <input
            type="date"
            value={customEnd}
            min={customStart || undefined}
            onChange={(e) => setCustomEnd(e.target.value)}
            className="bg-transparent text-xs text-ink focus:outline-none"
          />
        </div>
      )}
    </div>
  )
}
