import { NavLink } from 'react-router-dom'
import {
  LayoutGrid,
  Store,
  BookOpen,
  ShoppingBag,
  Bike,
  Users,
  Image as ImageIcon,
  BarChart3,
  Settings as SettingsIcon,
  LogOut,
} from 'lucide-react'
import { useAuth } from '../lib/AuthContext.jsx'

const mainNav = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutGrid },
  { to: '/outlets', label: 'Outlets', icon: Store },
  { to: '/menu', label: 'Menu', icon: BookOpen },
  { to: '/orders', label: 'Orders', icon: ShoppingBag },
  { to: '/riders', label: 'Riders', icon: Bike },
  { to: '/customers', label: 'Customers', icon: Users },
]

const secondaryNav = [
  { to: '/banners', label: 'Banners', icon: ImageIcon },
  { to: '/reports', label: 'Reports', icon: BarChart3 },
  { to: '/settings', label: 'Settings', icon: SettingsIcon },
]

function NavItem({ to, label, icon: Icon }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `flex w-[243px] items-center gap-3 rounded-lg px-4 py-3 text-sm transition-colors ${
          isActive
            ? 'bg-brand font-semibold text-white'
            : 'font-normal text-ink-soft hover:bg-line-soft'
        }`
      }
    >
      <Icon className="h-[18px] w-[18px] shrink-0" strokeWidth={2} />
      <span className="whitespace-nowrap leading-5">{label}</span>
    </NavLink>
  )
}

export default function Sidebar() {
  const { user, signOut } = useAuth()
  const email = user?.email ?? ''
  const name = user?.user_metadata?.full_name || email.split('@')[0] || 'Restaurant Admin'
  return (
    <aside className="flex h-full w-[260px] shrink-0 flex-col justify-between border-r border-line bg-white py-6 shadow-[1px_0_1px_rgba(0,0,0,0.05)]">
      {/* Logo */}
      <div className="flex flex-col gap-1 px-6 pb-10">
        <p className="text-[34px] font-bold leading-[42px] tracking-[-0.9px] text-brand [word-break:break-word]">
          Wali Baba Foods
        </p>
        <p className="text-xs font-semibold uppercase leading-4 tracking-[1.2px] text-ink-soft">
          Restaurant Admin
        </p>
      </div>

      {/* Nav */}
      <nav className="flex flex-1 flex-col items-center gap-1 px-2 pt-1">
        {mainNav.map((item) => (
          <NavItem key={item.to} {...item} />
        ))}

        <div className="mt-6 w-[227px] border-t border-line pt-5">
          <div className="flex flex-col items-center gap-1">
            {secondaryNav.map((item) => (
              <NavItem key={item.to} {...item} />
            ))}
          </div>
        </div>
      </nav>

      {/* Profile */}
      <div className="px-6 pt-6">
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
