import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar.jsx'
import OrderNotifications from '../components/OrderNotifications.jsx'

export default function DashboardLayout() {
  return (
    <div className="flex h-screen w-full overflow-hidden bg-canvas">
      <Sidebar />
      <main className="flex flex-1 flex-col overflow-y-auto">
        <Outlet />
      </main>
      {/* Real-time new-order toasts, shown on every dashboard page */}
      <OrderNotifications />
    </div>
  )
}
