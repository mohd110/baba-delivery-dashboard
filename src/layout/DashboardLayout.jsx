import { useEffect } from 'react'
import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar.jsx'
import OrderNotifications from '../components/OrderNotifications.jsx'
import {
  useRestaurant,
  isAutoScheduleOn,
  isWithinOpenHours,
  DEFAULT_OPEN,
  DEFAULT_CLOSE,
} from '../lib/restaurant.js'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../lib/AuthContext.jsx'

// When auto open/close is enabled in Settings, keep each outlet's is_open flag
// in sync with ITS OWN trading hours. Runs on every dashboard page (this layout
// is always mounted) and re-checks each minute.
//
// Per-outlet on purpose: this used to read one outlet's hours and apply the
// result to every row, which with two branches would auto-close one of them on
// the other's schedule.
function ScheduleEnforcer({ outletId }) {
  const { rows: allRows, reload } = useRestaurant()
  // Outlet-scoped staff may only write their own outlet — the database rejects
  // anything else, so don't even try for the others.
  const rows = outletId ? allRows.filter((r) => r.id === outletId) : allRows

  useEffect(() => {
    if (rows.length === 0) return
    const tick = async () => {
      if (!isAutoScheduleOn()) return
      const now = new Date()
      const due = rows.filter((r) => {
        const shouldOpen = isWithinOpenHours(now, r.opening_time || DEFAULT_OPEN, r.closing_time || DEFAULT_CLOSE)
        return shouldOpen !== !!r.is_open
      })
      if (due.length === 0) return
      // One statement per target state rather than per outlet.
      for (const next of [true, false]) {
        const ids = due.filter((r) => !r.is_open === next).map((r) => r.id)
        if (ids.length === 0) continue
        const patch = next
          ? { is_open: true, closed_reason: null, closed_note: null }
          : { is_open: false, closed_reason: 'Outside opening hours', closed_note: null }
        let { error } = await supabase.from('restaurants').update(patch).in('id', ids)
        if (error && /closed_reason|closed_note|column|schema cache/i.test(error.message)) {
          ;({ error } = await supabase.from('restaurants').update({ is_open: next }).in('id', ids))
        }
        if (error) console.error('Auto open/close failed:', error.message)
      }
      reload()
    }
    tick()
    const id = setInterval(tick, 60 * 1000)
    return () => clearInterval(id)
  }, [rows, reload])

  return null
}

export default function DashboardLayout() {
  const { can, outletId } = useAuth()
  return (
    <div className="flex h-screen w-full overflow-hidden bg-canvas">
      <Sidebar />
      <main className="flex flex-1 flex-col overflow-y-auto">
        <Outlet />
      </main>
      {/* Real-time new-order toasts, shown on every dashboard page — but only
          to logins that can actually open an order from them. */}
      {can('page.orders') && <OrderNotifications />}
      {/* Applies the auto open/close schedule when enabled. Only a login that's
          allowed to open/close the restaurant may write that flag (the database
          rejects it otherwise), so it doesn't run for anyone else. */}
      {can('action.restaurant_toggle') && <ScheduleEnforcer outletId={outletId} />}
    </div>
  )
}
