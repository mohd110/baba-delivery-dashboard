import { useEffect } from 'react'
import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar.jsx'
import OrderNotifications from '../components/OrderNotifications.jsx'
import { useRestaurant, isAutoScheduleOn, isWithinOpenHours } from '../lib/restaurant.js'

// When auto open/close is enabled in Settings, keep the restaurant's is_open
// flag in sync with its trading hours. Runs on every dashboard page (this
// layout is always mounted) and re-checks each minute.
function ScheduleEnforcer() {
  const { rows, isOpen, openTime, closeTime, setOpen } = useRestaurant()

  useEffect(() => {
    if (rows.length === 0) return
    const tick = () => {
      if (!isAutoScheduleOn()) return
      const shouldOpen = isWithinOpenHours(new Date(), openTime, closeTime)
      if (shouldOpen !== isOpen) setOpen(shouldOpen)
    }
    tick()
    const id = setInterval(tick, 60 * 1000)
    return () => clearInterval(id)
  }, [rows.length, isOpen, openTime, closeTime, setOpen])

  return null
}

export default function DashboardLayout() {
  return (
    <div className="flex h-screen w-full overflow-hidden bg-canvas">
      <Sidebar />
      <main className="flex flex-1 flex-col overflow-y-auto">
        <Outlet />
      </main>
      {/* Real-time new-order toasts, shown on every dashboard page */}
      <OrderNotifications />
      {/* Applies the auto open/close schedule when enabled */}
      <ScheduleEnforcer />
    </div>
  )
}
