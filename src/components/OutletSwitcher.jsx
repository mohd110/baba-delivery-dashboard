import { useEffect, useRef, useState } from 'react'
import { Store, ChevronDown, Check, Lock } from 'lucide-react'
import { useOutletScope } from '../lib/outletScope.js'

/* ── The outlet control in the topbar ─────────────────────────────────────
 * Three different things depending on who's looking:
 *
 *   staff              a locked chip naming their outlet — no menu to open.
 *   admin, 2+ outlets  a dropdown: "All outlets" plus one row per outlet.
 *   admin, 1 outlet    nothing at all, so a single-branch dashboard looks
 *                      exactly as it did before any of this existed.
 *
 * Every page filters off the same `useOutletScope()` this writes to, so the
 * choice follows the admin from Active Orders to Reports without re-picking. */
export default function OutletSwitcher() {
  const { outlets, scopeId, setScope, locked, scopeLabel, scopedOutlet } = useOutletScope()
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    const close = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  // A staffer's outlet is fixed — show it, don't offer a menu.
  if (locked) {
    return (
      <span
        title="You're assigned to this outlet"
        className="flex items-center gap-1.5 rounded-lg border border-line bg-canvas px-3 py-1.5 text-xs font-semibold text-ink-soft"
      >
        <Store className="h-3.5 w-3.5" />
        {scopeLabel}
        <Lock className="h-3 w-3 opacity-60" />
      </span>
    )
  }

  // One outlet (or none loaded yet): nothing to switch between.
  if (outlets.length < 2) return null

  const pick = (id) => {
    setScope(id)
    setOpen(false)
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Choose which outlet this dashboard shows"
        className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
          scopeId
            ? 'border-brand/30 bg-brand-light text-brand'
            : 'border-line text-ink-soft hover:bg-canvas hover:text-ink'
        }`}
      >
        <Store className="h-3.5 w-3.5" />
        {scopeLabel}
        {scopedOutlet && (
          <span
            className={`h-1.5 w-1.5 rounded-full ${scopedOutlet.isOpen ? 'bg-pos' : 'bg-ink-soft'}`}
            title={scopedOutlet.isOpen ? 'Open' : 'Closed'}
          />
        )}
        <ChevronDown className="h-3.5 w-3.5" />
      </button>

      {open && (
        <div className="absolute right-0 z-40 mt-1 w-64 overflow-hidden rounded-xl border border-line bg-white py-1 shadow-[0_8px_24px_rgba(0,0,0,0.12)]">
          <button
            type="button"
            onClick={() => pick(null)}
            className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-canvas"
          >
            <span>
              <span className="block font-semibold text-ink">All outlets</span>
              <span className="block text-[11px] text-ink-soft">
                Orders and alerts from every branch
              </span>
            </span>
            {!scopeId && <Check className="h-4 w-4 shrink-0 text-brand" />}
          </button>

          <div className="my-1 border-t border-line" />

          {outlets.map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => pick(o.id)}
              className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-canvas"
            >
              <span className="min-w-0">
                <span className="flex items-center gap-1.5 font-semibold text-ink">
                  <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${o.isOpen ? 'bg-pos' : 'bg-ink-soft'}`} />
                  <span className="truncate">{o.label}</span>
                  {!o.isActive && (
                    <span className="shrink-0 rounded bg-line-soft px-1 text-[9px] font-bold uppercase text-ink-soft">
                      hidden
                    </span>
                  )}
                </span>
                {o.address && <span className="block truncate text-[11px] text-ink-soft">{o.address}</span>}
              </span>
              {scopeId === o.id && <Check className="h-4 w-4 shrink-0 text-brand" />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
