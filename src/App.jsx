import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './lib/AuthContext.jsx'
import DashboardLayout from './layout/DashboardLayout.jsx'
import Login from './pages/Login.jsx'
import Overview from './pages/Overview.jsx'
import Orders from './pages/Orders.jsx'
import Menu from './pages/Menu.jsx'
import Riders from './pages/Riders.jsx'
import Customers from './pages/Customers.jsx'
import Outlets from './pages/Outlets.jsx'
import DeliveryFees from './pages/DeliveryFees.jsx'
import Banners from './pages/Banners.jsx'
import Reports from './pages/Reports.jsx'
import Settings from './pages/Settings.jsx'

function Protected({ children }) {
  const { session, loading } = useAuth()
  if (loading) {
    return <div className="flex h-screen items-center justify-center bg-canvas text-ink-soft">Loading…</div>
  }
  if (!session) return <Navigate to="/login" replace />
  return children
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            element={
              <Protected>
                <DashboardLayout />
              </Protected>
            }
          >
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<Overview />} />
            <Route path="/orders" element={<Orders />} />
            <Route path="/menu" element={<Menu />} />
            <Route path="/riders" element={<Riders />} />
            <Route path="/customers" element={<Customers />} />
            <Route path="/outlets" element={<Outlets />} />
            <Route path="/delivery-fees" element={<DeliveryFees />} />
            <Route path="/banners" element={<Banners />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/settings" element={<Settings />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
