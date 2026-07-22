import { NavLink } from 'react-router-dom'
import { useState, useEffect } from 'react'
import {
  ShoppingBag,
  History,
  BarChart3,
  AlertTriangle,
  LayoutGrid,
  Store,
  BookOpen,
  Bike,
  Users,
  Image as ImageIcon,
  Settings as SettingsIcon,
  LogOut,
  ChevronDown,
  ChevronUp,
} from 'lucide-react'
import { useAuth } from '../lib/AuthContext.jsx'
import { supabase } from '../lib/supabase.js'

function NavItem({ to, label, icon: Icon, badge }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `flex w-[243px] items-center justify-between rounded-lg px-4 py-3 text-sm transition-all duration-200 ${
          isActive
            ? 'bg-brand font-semibold text-white shadow-md shadow-brand/10'
            : 'font-normal text-ink-soft hover:bg-line-soft hover:text-ink'
        }`
      }
    >
      <div className="flex items-center gap-3">
        <Icon className="h-[18px] w-[18px] shrink-0" strokeWidth={2} />
        <span className="whitespace-nowrap leading-5">{label}</span>
      </div>
      {badge > 0 && (
        <span className={`flex h-5 min-w-[20px] items-center justify-center rounded-full px-1.5 text-[10px] font-bold ring-2 ring-white bg-brand text-white`}>
          {badge}
        </span>
      )}
    </NavLink>
  )
}

export default function Sidebar() {
  const { user, signOut } = useAuth()
  const [activeCount, setActiveCount] = useState(0)
  const [complaintCount, setComplaintCount] = useState(0)
  const [showAdmin, setShowAdmin] = useState(false)
  const email = user?.email ?? ''
  const name = user?.user_metadata?.full_name || email.split('@')[0] || 'Restaurant Admin'

  const fetchCounts = async () => {
    // Active orders count: status not delivered/cancelled
    const { count: ordCount, error: ordErr } = await supabase
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .not('status', 'in', '("delivered","cancelled")')
    if (!ordErr) setActiveCount(ordCount ?? 0)

    // Active complaints: rows in the complaints table that aren't resolved/closed.
    const { count: compCount, error: compErr } = await supabase
      .from('complaints')
      .select('id', { count: 'exact', head: true })
      .not('status', 'in', '("resolved","closed","cancelled")')
    if (!compErr) setComplaintCount(compCount ?? 0)
  }

  useEffect(() => {
    fetchCounts()
    // Subscribe to order updates to refresh badges in real-time
    const channel = supabase
      .channel('sidebar-badges')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => fetchCounts())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'complaints' }, () => fetchCounts())
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [])

  return (
    <aside className="flex h-full w-[260px] shrink-0 flex-col justify-between border-r border-line bg-white py-6 shadow-[1px_0_1px_rgba(0,0,0,0.05)]">
      {/* Logo */}
      <div className="flex items-center gap-3 px-6 pb-6">
        <img
          src="/assets/walibaba logo.jpeg"
          onError={(e) => {
            if (!e.currentTarget.dataset.triedFallback) {
              e.currentTarget.dataset.triedFallback = 'true'
              e.currentTarget.src = '/assets/logo.png'
            }
          }}
          alt="Wali Baba Foods"
          className="h-14 w-12 shrink-0 object-contain"
        />
        <div className="flex flex-col overflow-hidden">
          <p className="text-[20px] font-bold leading-[24px] tracking-tight text-brand [word-break:break-word]">
            Wali Baba Foods
          </p>
          <p className="text-[10px] font-semibold uppercase leading-4 tracking-[1.2px] text-ink-soft">
            Restaurant Admin
          </p>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex flex-1 flex-col items-center gap-1 overflow-y-auto px-2 pt-1">
        <div className="space-y-1">
          <NavItem to="/orders" label="Active Orders" icon={ShoppingBag} badge={activeCount} />
          <NavItem to="/order-history" label="Order History" icon={History} />
          <NavItem to="/menu" label="Menu" icon={BookOpen} />
          <NavItem to="/reports" label="Reporting" icon={BarChart3} />
          <NavItem to="/complaints" label="Customer Complaints" icon={AlertTriangle} badge={complaintCount} />
        </div>

        {/* Collapsible Administrative Section */}
        <div className="mt-4 w-[243px] border-t border-line pt-4">
          <button
            onClick={() => setShowAdmin(!showAdmin)}
            className="flex w-full items-center justify-between px-3 py-2 text-xs font-semibold uppercase tracking-wider text-ink-soft hover:text-ink transition-colors"
          >
            <span>Administration</span>
            {showAdmin ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>

          {showAdmin && (
            <div className="mt-2 space-y-1 pl-1 transition-all duration-300">
              <NavLink
                to="/dashboard"
                className={({ isActive }) =>
                  `flex items-center gap-3 rounded-lg px-3 py-2 text-xs transition-colors ${
                    isActive ? 'bg-line-soft font-semibold text-brand' : 'text-ink-soft hover:bg-line-soft hover:text-ink'
                  }`
                }
              >
                <LayoutGrid className="h-3.5 w-3.5" /> Overview
              </NavLink>
              <NavLink
                to="/outlets"
                className={({ isActive }) =>
                  `flex items-center gap-3 rounded-lg px-3 py-2 text-xs transition-colors ${
                    isActive ? 'bg-line-soft font-semibold text-brand' : 'text-ink-soft hover:bg-line-soft hover:text-ink'
                  }`
                }
              >
                <Store className="h-3.5 w-3.5" /> Outlets
              </NavLink>
              <NavLink
                to="/riders"
                className={({ isActive }) =>
                  `flex items-center gap-3 rounded-lg px-3 py-2 text-xs transition-colors ${
                    isActive ? 'bg-line-soft font-semibold text-brand' : 'text-ink-soft hover:bg-line-soft hover:text-ink'
                  }`
                }
              >
                <Bike className="h-3.5 w-3.5" /> Riders
              </NavLink>
              <NavLink
                to="/customers"
                className={({ isActive }) =>
                  `flex items-center gap-3 rounded-lg px-3 py-2 text-xs transition-colors ${
                    isActive ? 'bg-line-soft font-semibold text-brand' : 'text-ink-soft hover:bg-line-soft hover:text-ink'
                  }`
                }
              >
                <Users className="h-3.5 w-3.5" /> Customers
              </NavLink>
              <NavLink
                to="/banners"
                className={({ isActive }) =>
                  `flex items-center gap-3 rounded-lg px-3 py-2 text-xs transition-colors ${
                    isActive ? 'bg-line-soft font-semibold text-brand' : 'text-ink-soft hover:bg-line-soft hover:text-ink'
                  }`
                }
              >
                <ImageIcon className="h-3.5 w-3.5" /> Hero Slideshow
              </NavLink>
              <NavLink
                to="/settings"
                className={({ isActive }) =>
                  `flex items-center gap-3 rounded-lg px-3 py-2 text-xs transition-colors ${
                    isActive ? 'bg-line-soft font-semibold text-brand' : 'text-ink-soft hover:bg-line-soft hover:text-ink'
                  }`
                }
              >
                <SettingsIcon className="h-3.5 w-3.5" /> Settings
              </NavLink>
            </div>
          )}
        </div>
      </nav>

      {/* Profile */}
      <div className="px-6 pt-4">
        <div className="flex items-center gap-3 rounded-xl bg-line-soft p-4">
          <img
            src="/assets/profile.png"
            alt=""
            className="h-10 w-10 shrink-0 rounded-full bg-line-2 object-cover"
          />
          <div className="flex flex-col overflow-hidden">
            <p className="truncate text-sm font-bold text-ink">{name}</p>
            <p className="truncate text-xs text-ink-soft">{email}</p>
          </div>
          <button
            onClick={signOut}
            title="Sign out"
            className="ml-auto shrink-0 text-ink-soft hover:text-brand"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </aside>
  )
}
