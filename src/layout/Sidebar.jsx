import { NavLink } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { LogOut, ChevronDown, ChevronUp, ShieldCheck, X } from 'lucide-react'
import { useAuth } from '../lib/AuthContext.jsx'
import { supabase } from '../lib/supabase.js'
import { NAV_MAIN, NAV_ADMIN } from '../lib/permissions.js'
import { useOutletScope } from '../lib/outletScope.js'

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

function AdminNavItem({ to, label, icon: Icon }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `flex items-center gap-3 rounded-lg px-3 py-2 text-xs transition-colors ${
          isActive ? 'bg-line-soft font-semibold text-brand' : 'text-ink-soft hover:bg-line-soft hover:text-ink'
        }`
      }
    >
      <Icon className="h-3.5 w-3.5" /> {label}
    </NavLink>
  )
}

/* On a desktop the sidebar is always there. On a phone it's a drawer: `open`
 * slides it in over the page, and `onClose` is called by the backdrop, the
 * close button and any link inside it. */
export default function Sidebar({ open = false, onClose = () => {} }) {
  const { user, signOut, can, isAdmin } = useAuth()
  // Badges count the outlet you're looking at, not the whole chain.
  const { scopeId, scopeLabel, outlets } = useOutletScope()
  const [activeCount, setActiveCount] = useState(0)
  const [complaintCount, setComplaintCount] = useState(0)
  const [showAdmin, setShowAdmin] = useState(false)
  const email = user?.email ?? ''
  const name = user?.user_metadata?.full_name || email.split('@')[0] || 'Restaurant Admin'

  /* Both blocks are driven by the permission registry, so a login only ever
   * sees links to pages it can actually open. */
  const mainNav = NAV_MAIN.filter((item) => can(item.key))
  const adminNav = NAV_ADMIN.filter((item) => can(item.key))
  // Badge counts belong to specific links — don't query for a link that's hidden.
  const showOrderBadge = can('page.orders')
  const showComplaintBadge = can('page.complaints')

  useEffect(() => {
    const fetchCounts = async () => {
      // Active orders count: status not delivered/cancelled
      if (showOrderBadge) {
        let q = supabase
          .from('orders')
          .select('id', { count: 'exact', head: true })
          .not('status', 'in', '("delivered","cancelled")')
        if (scopeId) q = q.eq('restaurant_id', scopeId)
        const { count: ordCount, error: ordErr } = await q
        if (!ordErr) setActiveCount(ordCount ?? 0)
      }

      // Active complaints: rows in the complaints table that aren't resolved/closed.
      // Scoped through the order they were raised against.
      if (showComplaintBadge) {
        let q = supabase
          .from('complaints')
          .select(scopeId ? 'id, orders!inner(restaurant_id)' : 'id', { count: 'exact', head: true })
          .not('status', 'in', '("resolved","closed","cancelled")')
        if (scopeId) q = q.eq('orders.restaurant_id', scopeId)
        let { count: compCount, error: compErr } = await q
        if (compErr && scopeId) {
          // No usable orders relation — fall back to the chain-wide count
          // rather than showing no badge at all.
          ;({ count: compCount, error: compErr } = await supabase
            .from('complaints')
            .select('id', { count: 'exact', head: true })
            .not('status', 'in', '("resolved","closed","cancelled")'))
        }
        if (!compErr) setComplaintCount(compCount ?? 0)
      }
    }

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
  }, [showOrderBadge, showComplaintBadge, scopeId])

  const badgeFor = (key) => {
    if (key === 'page.orders') return activeCount
    if (key === 'page.complaints') return complaintCount
    return 0
  }

  return (
    <>
      {/* Phone-only backdrop behind the open drawer. */}
      {open && (
        <div className="fixed inset-0 z-40 bg-black/40 lg:hidden" onClick={onClose} aria-hidden="true" />
      )}
      <aside
        // Any tap on a link inside navigates away, so it should also put the drawer away.
        onClick={(e) => { if (e.target.closest('a')) onClose() }}
        className={`fixed inset-y-0 left-0 z-50 flex h-full w-[260px] shrink-0 flex-col justify-between border-r border-line bg-white py-6 shadow-[1px_0_1px_rgba(0,0,0,0.05)] transition-transform duration-200 lg:static lg:z-auto lg:translate-x-0 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <button
          type="button"
          onClick={onClose}
          title="Close menu"
          className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-lg text-ink-soft hover:bg-line-soft lg:hidden"
        >
          <X className="h-5 w-5" />
        </button>
        {/* Logo */}
        <div className="flex items-center gap-3 px-6 pb-6">
          <img
            src="/assets/wali-baba-logo.png"
            onError={(e) => {
              if (!e.currentTarget.dataset.triedFallback) {
                e.currentTarget.dataset.triedFallback = 'true'
                e.currentTarget.src = '/assets/walibaba logo.jpeg'
              }
            }}
            alt="Wali Baba Foods"
            className="h-20 w-20 shrink-0 object-contain"
          />
          <div className="flex flex-col overflow-hidden">
            <p className="text-[20px] font-bold leading-[24px] tracking-tight text-brand [word-break:break-word]">
              Wali Baba Foods
            </p>
            <p className="text-[10px] font-semibold uppercase leading-4 tracking-[1.2px] text-ink-soft">
              Delivery Admin
            </p>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex flex-1 flex-col items-center gap-1 overflow-y-auto px-2 pt-1">
          <div className="space-y-1">
            {mainNav.map((item) => (
              <NavItem
                key={item.key}
                to={item.path}
                label={item.label}
                icon={item.icon}
                badge={badgeFor(item.key)}
              />
            ))}
          </div>

          {/* Collapsible Administrative Section */}
          {adminNav.length > 0 && (
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
                  {adminNav.map((item) => (
                    <AdminNavItem key={item.key} to={item.path} label={item.label} icon={item.icon} />
                  ))}
                </div>
              )}
            </div>
          )}
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
              <span className="mt-0.5 w-fit rounded-full bg-white px-1.5 py-px text-[9px] font-bold uppercase tracking-wide text-ink-soft">
                {isAdmin ? 'Owner · Admin' : 'Staff'}
                {outlets.length > 1 && ` · ${scopeLabel}`}
              </span>
            </div>
            <div className="ml-auto flex shrink-0 flex-col items-center gap-2">
              <button
                onClick={signOut}
                title="Sign out"
                className="text-ink-soft hover:text-brand"
              >
                <LogOut className="h-4 w-4" />
              </button>
              {/* Straight to user management from the profile card — the owner
                  manages staff logins far more often than anything else here. */}
              {can('page.staff') && (
                <NavLink to="/staff" title="Users & permissions" className="text-ink-soft hover:text-brand">
                  <ShieldCheck className="h-4 w-4" />
                </NavLink>
              )}
            </div>
          </div>
        </div>
      </aside>
    </>
  )
}
