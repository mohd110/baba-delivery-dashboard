import {
  ShoppingBag,
  History,
  BookOpen,
  BarChart3,
  AlertTriangle,
  LayoutGrid,
  Store,
  Bike,
  Users,
  Image as ImageIcon,
  Settings as SettingsIcon,
  Truck,
  TicketPercent,
  ShieldCheck,
  DoorOpen,
  UserCog,
  XCircle,
} from 'lucide-react'

/* ── Dashboard permissions ────────────────────────────────────────────────
 * ONE registry drives the whole thing: the sidebar links, the route guards,
 * the action buttons, and the checkbox list an admin sees when creating or
 * editing a staff login. Nothing else hard-codes a permission list.
 *
 * To add a permission:
 *   1. add an entry below (a `page` entry also needs its <Route> in App.jsx),
 *   2. for an `action`, call `can('action.…')` wherever it should bite,
 *   3. for anything a staffer must not be able to do straight from the API,
 *      add the matching guard in add-staff-permissions.sql.
 * No database migration is needed for a new key — `profiles.permissions` is a
 * free-form jsonb array of these strings.
 *
 * Fields:
 *   key    stored in profiles.permissions; also the SQL guard's string
 *   type   'page'   — unlocks a route (and its sidebar link)
 *          'action' — unlocks a control on a page the user can already see
 *   path   route the page permission unlocks
 *   nav    'main' | 'admin' | null — which sidebar block the link belongs to
 *          (null = reachable by URL / from another page, but not listed)
 *   admin  true = the permission is owner-only and can't be granted to staff
 */
const PAGES = [
  { key: 'page.orders',        label: 'Active Orders',       path: '/orders',        icon: ShoppingBag,   nav: 'main',  group: 'Orders', hint: 'The live order board: accept, prepare and complete orders.' },
  { key: 'page.order_history', label: 'Order History',       path: '/order-history', icon: History,       nav: 'main',  group: 'Orders', hint: 'Past orders, with search and export.' },
  { key: 'page.complaints',    label: 'Customer Complaints', path: '/complaints',    icon: AlertTriangle, nav: 'main',  group: 'Customers', hint: 'Complaints raised by customers, and their resolution.' },
  { key: 'page.menu',          label: 'Menu',                path: '/menu',          icon: BookOpen,      nav: 'main',  group: 'Catalogue', hint: 'Dishes, prices, photos and availability.' },
  { key: 'page.reports',       label: 'Reporting',           path: '/reports',       icon: BarChart3,     nav: 'main',  group: 'Business', hint: 'Sales, rider and performance reports.' },
  { key: 'page.overview',      label: 'Overview',            path: '/dashboard',     icon: LayoutGrid,    nav: 'admin', group: 'Business', hint: 'The at-a-glance dashboard: today’s revenue and order counts.' },
  { key: 'page.outlets',       label: 'Outlets',             path: '/outlets',       icon: Store,         nav: 'admin', group: 'Catalogue', hint: 'Outlet details and per-outlet open/closed state.' },
  { key: 'page.riders',        label: 'Riders',              path: '/riders',        icon: Bike,          nav: 'admin', group: 'Riders', hint: 'The rider roster, KYC details and rider earnings.' },
  { key: 'page.customers',     label: 'Customers',           path: '/customers',     icon: Users,         nav: 'admin', group: 'Customers', hint: 'Customer list, addresses and order counts.' },
  { key: 'page.banners',       label: 'Hero Slideshow',      path: '/banners',       icon: ImageIcon,     nav: 'admin', group: 'Catalogue', hint: 'The promotional banners on the customer app home screen.' },
  { key: 'page.offers',        label: 'Offers & Coupons',    path: '/offers',        icon: TicketPercent, nav: 'admin', group: 'Business', hint: 'Discount codes customers apply at checkout, and what each one has cost.' },
  { key: 'page.delivery_fees', label: 'Delivery Fees',       path: '/delivery-fees', icon: Truck,         nav: null,    group: 'Catalogue', hint: 'Distance-based delivery charges.' },
  { key: 'page.settings',      label: 'Settings',            path: '/settings',      icon: SettingsIcon,  nav: 'admin', group: 'Admin', hint: 'Business hours and the auto open/close schedule.' },
  {
    key: 'page.staff', label: 'Users & Permissions', path: '/staff', icon: ShieldCheck, nav: 'admin', group: 'Admin',
    admin: true,
    hint: 'Create dashboard logins and decide what each one can see. Owner only.',
  },
].map((p) => ({ ...p, type: 'page' }))

const ACTIONS = [
  { key: 'action.restaurant_toggle', label: 'Restaurant Open / Closed', icon: DoorOpen, group: 'Orders', hint: 'Switch the restaurant on and off from the Active Orders topbar.' },
  { key: 'action.assign_rider',      label: 'Assign / Change Rider',    icon: UserCog,  group: 'Orders', hint: 'Pick or swap the rider on a delivery.' },
  { key: 'action.cancel_order',      label: 'Cancel an Order',          icon: XCircle,  group: 'Orders', hint: 'Cancel an order with a reason. Leave off for staff who should only prepare orders.' },
].map((a) => ({ ...a, type: 'action' }))

export const PERMISSIONS = [...PAGES, ...ACTIONS]

export const PERMISSION_BY_KEY = Object.fromEntries(PERMISSIONS.map((p) => [p.key, p]))

/** Everything a staff login can be granted (owner-only permissions excluded). */
export const GRANTABLE_PERMISSIONS = PERMISSIONS.filter((p) => !p.admin)

/** Order the checkbox groups appear in on the Users page. */
const GROUP_ORDER = ['Orders', 'Customers', 'Business', 'Catalogue', 'Riders', 'Admin']

/** [{ group, items }] for rendering the permission picker. */
export const PERMISSION_GROUPS = GROUP_ORDER.map((group) => ({
  group,
  items: GRANTABLE_PERMISSIONS.filter((p) => p.group === group),
})).filter((g) => g.items.length > 0)

/** Sidebar blocks, in the order they're listed. */
export const NAV_MAIN = PAGES.filter((p) => p.nav === 'main')
export const NAV_ADMIN = PAGES.filter((p) => p.nav === 'admin')

/* Ready-made permission sets, so the common cases are one click rather than
 * fourteen. Admins can tick/untick anything afterwards. */
export const PRESETS = [
  {
    id: 'operations',
    label: 'Operations staff',
    hint: 'Runs the day: takes orders, assigns riders, answers complaints, opens and closes the restaurant.',
    keys: [
      'page.orders',
      'page.order_history',
      'page.overview',
      'page.reports',
      'page.complaints',
      'action.restaurant_toggle',
      'action.assign_rider',
    ],
  },
  {
    id: 'kitchen',
    label: 'Kitchen only',
    hint: 'Sees the live order board and nothing else.',
    keys: ['page.orders', 'action.restaurant_toggle'],
  },
  {
    id: 'support',
    label: 'Customer support',
    hint: 'Handles complaints and looks up past orders and customers.',
    keys: ['page.complaints', 'page.order_history', 'page.customers'],
  },
  {
    id: 'all',
    label: 'Everything except user management',
    hint: 'Every page and action, but cannot create logins or change permissions.',
    keys: GRANTABLE_PERMISSIONS.map((p) => p.key),
  },
]

/**
 * Does a login hold `key`?
 *
 * `isAdmin` short-circuits everything — the owner never has a permission list.
 * A missing/unreadable profile also resolves to true: see AuthContext, where
 * that means "the permissions migration hasn't been run yet", and the dashboard
 * must keep working exactly as it did before rather than locking its owner out.
 */
export function canWith(isAdmin, permissions, key) {
  if (isAdmin) return true
  if (!key) return true
  return Array.isArray(permissions) && permissions.includes(key)
}

/** Where to land someone who just signed in (or hit "/"). */
export function firstAllowedPath(can) {
  const page = PAGES.find((p) => p.path && can(p.key))
  return page ? page.path : '/no-access'
}

/** Drops unknown keys — e.g. a permission that was renamed in a later release. */
export function sanitizePermissions(keys) {
  if (!Array.isArray(keys)) return []
  const grantable = new Set(GRANTABLE_PERMISSIONS.map((p) => p.key))
  return keys.filter((k) => grantable.has(k))
}
