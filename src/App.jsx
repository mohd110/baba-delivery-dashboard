import { BrowserRouter, Routes, Route, Navigate, Link } from 'react-router-dom'
import { Lock } from 'lucide-react'
import { AuthProvider, useAuth } from './lib/AuthContext.jsx'
import { firstAllowedPath } from './lib/permissions.js'
import DashboardLayout from './layout/DashboardLayout.jsx'
import Login from './pages/Login.jsx'
import Overview from './pages/Overview.jsx'
import Orders from './pages/Orders.jsx'
import OrderHistory from './pages/OrderHistory.jsx'
import Complaints from './pages/Complaints.jsx'
import Menu from './pages/Menu.jsx'
import Riders from './pages/Riders.jsx'
import Customers from './pages/Customers.jsx'
import Outlets from './pages/Outlets.jsx'
import DeliveryFees from './pages/DeliveryFees.jsx'
import Banners from './pages/Banners.jsx'
import Offers from './pages/Offers.jsx'
import Reports from './pages/Reports.jsx'
import Settings from './pages/Settings.jsx'
import Staff from './pages/Staff.jsx'

function Loading() {
  return (
    <div className="flex h-screen items-center justify-center bg-canvas text-ink-soft">Loading…</div>
  )
}

function Protected({ children }) {
  const { session, loading } = useAuth()
  if (loading) return <Loading />
  if (!session) return <Navigate to="/login" replace />
  return children
}

/* Shown when a staff login opens a page it wasn't granted — by typing the URL
 * or following an old bookmark, since the sidebar never links to it. */
function NoAccess() {
  const { can, permsLoading } = useAuth()
  if (permsLoading) return <Loading />
  const home = firstAllowedPath(can)
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-light text-brand">
        <Lock className="h-6 w-6" />
      </span>
      <h1 className="text-lg font-bold text-ink">You don’t have access to this page</h1>
      <p className="max-w-sm text-sm text-ink-soft">
        Ask the restaurant owner to grant it from Users &amp; Permissions.
      </p>
      {home !== '/no-access' && (
        <Link
          to={home}
          className="mt-2 rounded-lg bg-brand px-4 py-2 text-sm font-bold text-white hover:bg-brand-dark"
        >
          Go to my dashboard
        </Link>
      )}
    </div>
  )
}

/* Route-level permission gate. The permission keys come from
 * src/lib/permissions.js — one entry there covers the sidebar link and this. */
function RequirePerm({ perm, children }) {
  const { can, permsLoading } = useAuth()
  if (permsLoading) return <Loading />
  if (!can(perm)) return <NoAccess />
  return children
}

/* "/" sends everyone to the first page they're actually allowed to open, so a
 * staffer without Active Orders doesn't land on a wall. */
function Home() {
  const { can, permsLoading } = useAuth()
  if (permsLoading) return <Loading />
  return <Navigate to={firstAllowedPath(can)} replace />
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
            <Route path="/" element={<Home />} />
            <Route path="/dashboard" element={<RequirePerm perm="page.overview"><Overview /></RequirePerm>} />
            <Route path="/orders" element={<RequirePerm perm="page.orders"><Orders /></RequirePerm>} />
            <Route path="/order-history" element={<RequirePerm perm="page.order_history"><OrderHistory /></RequirePerm>} />
            <Route path="/complaints" element={<RequirePerm perm="page.complaints"><Complaints /></RequirePerm>} />
            <Route path="/menu" element={<RequirePerm perm="page.menu"><Menu /></RequirePerm>} />
            <Route path="/riders" element={<RequirePerm perm="page.riders"><Riders /></RequirePerm>} />
            <Route path="/customers" element={<RequirePerm perm="page.customers"><Customers /></RequirePerm>} />
            <Route path="/outlets" element={<RequirePerm perm="page.outlets"><Outlets /></RequirePerm>} />
            <Route path="/delivery-fees" element={<RequirePerm perm="page.delivery_fees"><DeliveryFees /></RequirePerm>} />
            <Route path="/banners" element={<RequirePerm perm="page.banners"><Banners /></RequirePerm>} />
            <Route path="/offers" element={<RequirePerm perm="page.offers"><Offers /></RequirePerm>} />
            <Route path="/reports" element={<RequirePerm perm="page.reports"><Reports /></RequirePerm>} />
            <Route path="/settings" element={<RequirePerm perm="page.settings"><Settings /></RequirePerm>} />
            <Route path="/staff" element={<RequirePerm perm="page.staff"><Staff /></RequirePerm>} />
            {/* Where a login with no permissions at all lands — a real route so
                the "/" redirect can't bounce off the catch-all forever. */}
            <Route path="/no-access" element={<NoAccess />} />
            {/* Unknown URL: send them to a page they can actually open. */}
            <Route path="*" element={<Home />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
