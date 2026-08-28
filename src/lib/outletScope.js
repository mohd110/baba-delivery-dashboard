import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { useAuth } from './AuthContext.jsx'
import { useRestaurant } from './restaurant.js'

/* ── Which outlet am I looking at? ────────────────────────────────────────
 * One answer, shared by every page, from two very different sources:
 *
 *   staff (profiles.restaurant_id set)  locked to that outlet. Their order
 *                                       board, history, reports, complaints,
 *                                       badges and new-order alarm are all
 *                                       filtered to it, and they can't switch.
 *   owner/admin (restaurant_id null)    picks from the dropdown in the topbar.
 *                                       Defaults to ALL outlets, which is what
 *                                       "the super admin gets notified for both
 *                                       outlets" means in practice.
 *
 * `scopeId === null` means all outlets — every consumer treats that as "don't
 * filter". Pages therefore only ever need one extra line:
 *
 *     const { scopeId } = useOutletScope()
 *     … if (scopeId) query = query.eq('restaurant_id', scopeId)
 *
 * The outlet LIST is not fetched here: useRestaurant() already keeps one shared
 * `restaurants` subscription for the whole dashboard, so this reuses it rather
 * than opening a second one. */

// The admin's choice is a per-device preference, like the auto-schedule flag.
const SCOPE_KEY = 'wbf.outletScope'

const readStored = () => {
  try {
    return window.localStorage.getItem(SCOPE_KEY) || null
  } catch {
    return null
  }
}

/* A tiny store rather than component state: the switcher in the topbar and the
 * page below it are siblings, and both have to see the change. */
let stored = typeof window === 'undefined' ? null : readStored()
const listeners = new Set()

const subscribe = (fn) => {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
const getSnapshot = () => stored

function setStored(id) {
  stored = id || null
  try {
    if (stored) window.localStorage.setItem(SCOPE_KEY, stored)
    else window.localStorage.removeItem(SCOPE_KEY)
  } catch {
    /* private mode — the choice just won't survive a reload */
  }
  listeners.forEach((fn) => fn())
}

export function useOutletScope() {
  const { outletId, isAdmin } = useAuth()
  const { rows, loading } = useRestaurant()
  const chosen = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  // Outlets the switcher offers. Retired ones (is_active = false) stay listed
  // for an admin — their orders and history don't disappear with them — but are
  // marked, so "where did last month's orders go?" never comes up.
  const outlets = rows
    .map((r) => ({
      id: r.id,
      label: (r.area_name || '').trim() || r.name || 'Outlet',
      address: r.address || '',
      isOpen: !!r.is_open,
      isActive: r.is_active !== false,
      sortOrder: r.sort_order ?? 0,
    }))
    // Same order the customer's picker uses: sort_order, ties broken on label.
    .sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label))

  const locked = !!outletId
  // A staffer's outlet always wins over anything stored on the device. An
  // admin's stored choice is dropped if that outlet has since been deleted.
  const scopeId = locked ? outletId : (chosen && outlets.some((o) => o.id === chosen) ? chosen : null)

  // Clear a stale stored id once, rather than re-checking it on every render.
  // Depends on the boolean, not on `outlets` — that array is rebuilt each render
  // and would re-run this every time.
  const chosenExists = !!chosen && outlets.some((o) => o.id === chosen)
  const haveOutlets = outlets.length > 0
  useEffect(() => {
    if (!locked && chosen && !loading && haveOutlets && !chosenExists) setStored(null)
  }, [locked, chosen, loading, haveOutlets, chosenExists])

  const setScope = useCallback(
    (id) => {
      if (locked) return // staff can't switch; the database wouldn't let them either
      setStored(id)
    },
    [locked]
  )

  const scopedOutlet = scopeId ? outlets.find((o) => o.id === scopeId) ?? null : null

  /* Client-side twin of `.eq('restaurant_id', scopeId)`, for realtime payloads
   * and joined rows that can't be filtered in the query. Stable per scope, so
   * passing it into a subscription effect doesn't re-open the channel on every
   * render. */
  const matches = useCallback(
    (restaurantId) => !scopeId || restaurantId === scopeId,
    [scopeId]
  )

  return {
    outlets,
    loading,
    scopeId,
    setScope,
    locked,
    isAdmin,
    scopedOutlet,
    // Label for headings and toasts: "Swaroop Nagar" / "All outlets".
    scopeLabel: scopedOutlet ? scopedOutlet.label : 'All outlets',
    matches,
  }
}

/* ── Which branch is this order from? ─────────────────────────────────────
 * An admin on "All outlets" is looking at two kitchens at once, and nothing
 * else on an order row says which one it belongs to — the dishes don't (the
 * menu is shared chain-wide), and neither do the customer or the rider. Every
 * order surface therefore names the branch, but only for a login that can
 * actually see more than one:
 *
 *   staff (locked to an outlet)  never — the topbar already says where they
 *                                are, and repeating it on every row is noise.
 *   admin, one outlet            never — nothing to disambiguate.
 *   admin, 2+ outlets            always, including while a single outlet is
 *                                picked, so the answer doesn't come and go as
 *                                they use the switcher.
 *
 * `show` is the one place that rule lives. Anything that just wants a chip
 * renders <OutletTag/>, which returns null when it doesn't apply; callers that
 * need the raw string (a CSV column, a conditional table column) read `show`
 * and `labelOf` from here. */
export function useOutletTag() {
  const { outlets, locked, isAdmin } = useOutletScope()
  const show = isAdmin && !locked && outlets.length > 1

  /* Null id = an order placed before the outlet column existed (or a branch
   * that was deleted rather than retired): still worth a chip, because
   * "unknown" is itself information when every other order names its branch.
   * Retired outlets stay in `outlets`, so their orders keep their real name. */
  const labelOf = (restaurantId) => {
    if (!restaurantId) return 'No branch'
    return outlets.find((o) => o.id === restaurantId)?.label ?? 'Unknown branch'
  }

  // `outlets` comes back too, so a caller that wants to say "all 3 branches"
  // doesn't have to call useOutletScope() a second time for the count.
  return { show, labelOf, outlets }
}

/* For non-React callers (realtime handlers set up outside a component). */
export function currentScopeId() {
  return stored
}
