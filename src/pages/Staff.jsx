import { useCallback, useEffect, useState } from 'react'
import {
  ShieldCheck,
  UserPlus,
  X,
  Check,
  KeyRound,
  Power,
  Loader2,
  Pencil,
  Store,
  AlertTriangle,
} from 'lucide-react'
import Topbar, { TopIcons, SearchBox } from '../layout/Topbar.jsx'
import { supabase, createIsolatedClient } from '../lib/supabase.js'
import { useAuth } from '../lib/AuthContext.jsx'
import { useOutletScope } from '../lib/outletScope.js'
import {
  PERMISSION_GROUPS,
  PERMISSION_BY_KEY,
  PRESETS,
  GRANTABLE_PERMISSIONS,
  sanitizePermissions,
} from '../lib/permissions.js'

/* ── Dashboard logins ─────────────────────────────────────────────────────
 * A dashboard login is a `profiles` row with role = 'restaurant'. Two kinds:
 *
 *   is_admin = true    the owner. Every page, and the only one who can open
 *                      this page at all.
 *   is_admin = false   staff. Sees exactly the pages/actions ticked below,
 *                      which the owner can change at any time.
 *
 * The permission list itself is never hard-coded here — it's generated from
 * src/lib/permissions.js, so adding a permission there makes it appear on this
 * page automatically.
 *
 * Accounts are created the same way riders are (see Riders.jsx): signUp() on a
 * throwaway client, so creating a login doesn't sign the owner out of their own
 * session. The permissions are then written onto the new profile row by the
 * owner's client, because the database only lets an admin set them. */
const PROFILE_COLS =
  'id, full_name, email, phone, role, is_admin, permissions, is_active, restaurant_id'

const EMPTY_FORM = { name: '', email: '', phone: '', password: '', outletId: '' }

const MIGRATION_HINT =
  'Staff logins need add-staff-permissions.sql — run it once in the Supabase SQL editor.'

/* The checkbox list. Same component for "create" and "edit", so the two can
 * never drift apart. */
function PermissionPicker({ selected, onChange, disabled }) {
  const has = (key) => selected.includes(key)
  const toggle = (key) =>
    onChange(has(key) ? selected.filter((k) => k !== key) : [...selected, key])

  const applyPreset = (keys) => onChange([...keys])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-bold uppercase tracking-wide text-ink-soft">Quick set</span>
        {PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            title={p.hint}
            disabled={disabled}
            onClick={() => applyPreset(p.keys)}
            className="rounded-full border border-line px-3 py-1 text-[11px] font-semibold text-ink-soft hover:border-brand hover:text-brand disabled:opacity-50"
          >
            {p.label}
          </button>
        ))}
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange([])}
          className="rounded-full border border-line px-3 py-1 text-[11px] font-semibold text-ink-soft hover:border-brand hover:text-brand disabled:opacity-50"
        >
          Clear all
        </button>
      </div>

      {PERMISSION_GROUPS.map(({ group, items }) => (
        <div key={group}>
          <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-ink-soft">{group}</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {items.map((p) => {
              const Icon = p.icon
              const on = has(p.key)
              return (
                <button
                  key={p.key}
                  type="button"
                  disabled={disabled}
                  onClick={() => toggle(p.key)}
                  className={`flex items-start gap-3 rounded-lg border p-3 text-left transition-colors disabled:opacity-60 ${
                    on ? 'border-brand bg-brand-light/40' : 'border-line hover:bg-canvas'
                  }`}
                >
                  <span
                    className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                      on ? 'border-brand bg-brand text-white' : 'border-line-2 bg-white'
                    }`}
                  >
                    {on && <Check className="h-3 w-3" strokeWidth={3} />}
                  </span>
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5 text-sm font-semibold text-ink">
                      {Icon && <Icon className="h-3.5 w-3.5 shrink-0 text-ink-soft" />}
                      {p.label}
                      {p.type === 'action' && (
                        <span className="rounded bg-line-soft px-1 text-[9px] font-bold uppercase tracking-wide text-ink-soft">
                          action
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 block text-[11px] leading-snug text-ink-soft">{p.hint}</span>
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

function Modal({ title, subtitle, icon: Icon, onClose, children, footer, wide }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div
        className={`flex max-h-[90vh] w-full flex-col overflow-hidden rounded-2xl bg-white shadow-xl ${
          wide ? 'max-w-3xl' : 'max-w-lg'
        }`}
      >
        <div className="flex items-start justify-between gap-3 border-b border-line p-5">
          <div className="flex items-center gap-3">
            <span className="rounded-lg bg-brand-light p-2 text-brand">
              <Icon className="h-5 w-5" />
            </span>
            <div>
              <h3 className="text-base font-bold text-ink">{title}</h3>
              {subtitle && <p className="text-xs text-ink-soft">{subtitle}</p>}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-ink-soft hover:bg-line-soft hover:text-ink"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
        {footer && <div className="flex items-center justify-end gap-3 border-t border-line p-5">{footer}</div>}
      </div>
    </div>
  )
}

function Field({ label, ...props }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-ink-soft">{label}</span>
      <input
        {...props}
        className="w-full rounded-lg border border-line px-3 py-2 text-sm text-ink focus:border-brand focus:outline-none"
      />
    </label>
  )
}

/* Which outlet a login belongs to. Null/'' means every outlet — right for a
 * second owner, wrong for the outlet staff this page mostly creates, so the
 * form makes the choice explicit rather than defaulting to "all". */
function OutletSelect({ value, onChange, outlets, disabled }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-ink-soft">Outlet</span>
      <select
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink focus:border-brand focus:outline-none disabled:opacity-50"
      >
        <option value="">All outlets (no restriction)</option>
        {outlets.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
            {o.isActive ? '' : ' · hidden'}
          </option>
        ))}
      </select>
      <span className="mt-1 block text-[11px] text-ink-soft">
        Orders, alerts, history and reporting are limited to this outlet, and the open/closed switch
        acts on it alone.
      </span>
    </label>
  )
}

export default function Staff() {
  const { user } = useAuth()
  const { outlets } = useOutletScope()
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [needsMigration, setNeedsMigration] = useState(false)
  const [query, setQuery] = useState('')
  const [saving, setSaving] = useState(false)

  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [newPerms, setNewPerms] = useState(PRESETS[0].keys)

  const [editTarget, setEditTarget] = useState(null)
  const [editPerms, setEditPerms] = useState([])
  const [editOutlet, setEditOutlet] = useState('')

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('profiles')
      .select(PROFILE_COLS)
      .eq('role', 'restaurant')
      .order('full_name', { ascending: true })
    if (error) {
      // The permission columns don't exist yet — say so instead of showing an
      // empty page.
      console.error('Failed to load dashboard users:', error.message)
      setNeedsMigration(true)
      setUsers([])
    } else {
      setNeedsMigration(false)
      setUsers(data ?? [])
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
    const channel = supabase
      .channel('staff-page')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'profiles', filter: 'role=eq.restaurant' },
        () => load()
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [load])

  /* Create the login. The isolated client keeps the owner signed in; the
   * handle_new_user trigger turns the auth user into a profiles row, and the
   * owner's own client then stamps the permissions on it (a brand-new user
   * isn't allowed to set its own). */
  const addUser = async (e) => {
    e.preventDefault()
    const name = form.name.trim()
    const email = form.email.trim()
    const phone = form.phone.trim()
    const password = form.password
    if (!name || !email || password.length < 6) {
      alert('Enter a name, an email, and a password of at least 6 characters.')
      return
    }
    if (newPerms.length === 0 && !confirm('This user has no permissions yet and will see an empty dashboard. Create it anyway?')) {
      return
    }

    setSaving(true)
    const client = createIsolatedClient()
    const { data, error } = await client.auth.signUp({
      email,
      password,
      options: { data: { role: 'restaurant', full_name: name, phone } },
    })
    if (error) {
      setSaving(false)
      alert(`Could not create the user: ${error.message}`)
      return
    }

    const newId = data?.user?.id
    const patch = {
      role: 'restaurant',
      full_name: name,
      phone: phone || null,
      email,
      is_admin: false,
      is_active: true,
      permissions: sanitizePermissions(newPerms),
      // Null = every outlet. Only the owner can set this (guarded in
      // add-outlet-staff.sql), which is why it's written from this client.
      restaurant_id: form.outletId || null,
    }
    // The trigger may not have inserted the row yet — retry once after a beat.
    const write = async () => {
      const res = await supabase.from('profiles').update(patch).eq('id', newId).select('id')
      return res.error ? res.error : (res.data?.length ? null : { message: '0 rows updated' })
    }
    let err = newId ? await write() : { message: 'the account was created without an id' }
    if (err) {
      await new Promise((r) => setTimeout(r, 800))
      err = await write()
    }
    setSaving(false)

    if (err) {
      alert(
        `The login was created but its permissions could not be saved (${err.message}).\n\n` +
        `Open the user from this page and save the permissions again. If it keeps failing, ${MIGRATION_HINT}`
      )
    }
    setShowAdd(false)
    setForm(EMPTY_FORM)
    setNewPerms(PRESETS[0].keys)
    setTimeout(load, 600)
  }

  const savePerms = async () => {
    if (!editTarget) return
    setSaving(true)
    const patch = {
      permissions: sanitizePermissions(editPerms),
      restaurant_id: editOutlet || null,
    }
    let { data, error } = await supabase
      .from('profiles')
      .update(patch)
      .eq('id', editTarget.id)
      .select('id')
    if (error && /restaurant_id|column|schema cache/i.test(error.message)) {
      // add-outlet-staff.sql hasn't been run — still save the permissions.
      ;({ data, error } = await supabase
        .from('profiles')
        .update({ permissions: patch.permissions })
        .eq('id', editTarget.id)
        .select('id'))
    }
    setSaving(false)
    if (error) {
      alert(`Could not save permissions: ${error.message}`)
      return
    }
    if (!data || data.length === 0) {
      alert(`Nothing was saved — the database rejected the change. ${MIGRATION_HINT}`)
      return
    }
    setEditTarget(null)
    load()
  }

  const toggleActive = async (u) => {
    if (u.id === user?.id) {
      alert('You cannot deactivate your own login.')
      return
    }
    const next = u.is_active === false
    if (!next && !confirm(`Turn off dashboard access for ${u.full_name || u.email}?`)) return
    const { data, error } = await supabase
      .from('profiles')
      .update({ is_active: next })
      .eq('id', u.id)
      .select('id')
    if (error) {
      alert(`Could not update the login: ${error.message}`)
      return
    }
    if (!data || data.length === 0) {
      alert(`Nothing changed — the database rejected it. ${MIGRATION_HINT}`)
      return
    }
    load()
  }

  // We can't read or set someone else's password from the browser (that needs a
  // service-role key), so send them the standard reset email instead.
  const sendReset = async (u) => {
    if (!u.email) {
      alert('No email address is stored for this login.')
      return
    }
    const { error } = await supabase.auth.resetPasswordForEmail(u.email)
    alert(error ? `Could not send the reset email: ${error.message}` : `Password reset email sent to ${u.email}.`)
  }

  const q = query.trim().toLowerCase()
  const visible = users.filter(
    (u) =>
      !q ||
      (u.full_name || '').toLowerCase().includes(q) ||
      (u.email || '').toLowerCase().includes(q)
  )
  const admins = visible.filter((u) => u.is_admin)
  const staff = visible.filter((u) => !u.is_admin)

  return (
    <>
      <Topbar>
        <h1 className="text-xl font-bold text-ink">Users &amp; Permissions</h1>
        <div className="flex items-center gap-3">
          <SearchBox placeholder="Search users…" value={query} onChange={setQuery} className="w-64" />
          <button
            type="button"
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-bold text-white hover:bg-brand-dark"
          >
            <UserPlus className="h-4 w-4" /> Add User
          </button>
          <TopIcons />
        </div>
      </Topbar>

      <div className="space-y-6 p-4 lg:p-8">
        {needsMigration && (
          <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              <b>Not set up yet.</b> {MIGRATION_HINT} Until then every dashboard login keeps full
              access, exactly as before.
            </p>
          </div>
        )}

        <div className="rounded-xl border border-line bg-white">
          <div className="flex items-center gap-2 border-b border-line p-5">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-light text-brand">
              <ShieldCheck className="h-5 w-5" />
            </span>
            <div>
              <h2 className="text-base font-bold text-ink">Dashboard logins</h2>
              <p className="text-xs text-ink-soft">
                Owners see everything. Staff see only what you tick — change it any time and it
                applies straight away, even if they're already signed in.
              </p>
            </div>
          </div>

          {loading ? (
            <p className="p-8 text-center text-sm text-ink-soft">Loading…</p>
          ) : visible.length === 0 ? (
            <p className="p-8 text-center text-sm text-ink-soft">
              {q ? 'No user matches that search.' : 'No dashboard logins found.'}
            </p>
          ) : (
            <div className="divide-y divide-line">
              {[...admins, ...staff].map((u) => {
                const perms = Array.isArray(u.permissions) ? u.permissions : []
                const inactive = u.is_active === false
                const isSelf = u.id === user?.id
                return (
                  <div key={u.id} className={`flex flex-wrap items-start gap-4 p-5 ${inactive ? 'opacity-60' : ''}`}>
                    <div className="min-w-[220px] flex-1">
                      <p className="flex items-center gap-2 text-sm font-bold text-ink">
                        {u.full_name || '—'}
                        {u.is_admin ? (
                          <span className="rounded-full bg-brand-light px-2 py-px text-[10px] font-bold uppercase tracking-wide text-brand">
                            Owner · Admin
                          </span>
                        ) : (
                          <span className="rounded-full bg-line-soft px-2 py-px text-[10px] font-bold uppercase tracking-wide text-ink-soft">
                            Staff
                          </span>
                        )}
                        {isSelf && <span className="text-[10px] font-semibold text-ink-soft">(you)</span>}
                        {inactive && (
                          <span className="rounded-full bg-red-50 px-2 py-px text-[10px] font-bold uppercase tracking-wide text-red-600">
                            Deactivated
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-ink-soft">{u.email || 'no email on file'}</p>
                      {u.phone && <p className="text-xs text-ink-soft">{u.phone}</p>}
                      {outlets.length > 1 && (
                        <p className="mt-1 flex items-center gap-1 text-[11px] font-semibold text-ink-soft">
                          <Store className="h-3 w-3" />
                          {u.is_admin
                            ? 'All outlets'
                            : outlets.find((o) => o.id === u.restaurant_id)?.label ?? 'All outlets'}
                        </p>
                      )}
                    </div>

                    <div className="min-w-[240px] flex-[2]">
                      {u.is_admin ? (
                        <p className="text-xs text-ink-soft">Full access to every page and action.</p>
                      ) : perms.length === 0 ? (
                        <p className="text-xs text-ink-soft">No permissions yet — this login sees nothing.</p>
                      ) : (
                        <div className="flex flex-wrap gap-1.5">
                          {perms.map((key) => (
                            <span
                              key={key}
                              className="rounded-full bg-line-soft px-2 py-0.5 text-[11px] font-medium text-ink-soft"
                            >
                              {PERMISSION_BY_KEY[key]?.label ?? key}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      {!u.is_admin && (
                        <button
                          type="button"
                          onClick={() => {
                            setEditTarget(u)
                            setEditPerms(sanitizePermissions(perms))
                            setEditOutlet(u.restaurant_id || '')
                          }}
                          className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-ink-soft hover:bg-canvas hover:text-ink"
                        >
                          <Pencil className="h-3.5 w-3.5" /> Access
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => sendReset(u)}
                        title="Send a password reset email"
                        className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-ink-soft hover:bg-canvas hover:text-ink"
                      >
                        <KeyRound className="h-3.5 w-3.5" /> Reset password
                      </button>
                      {!isSelf && (
                        <button
                          type="button"
                          onClick={() => toggleActive(u)}
                          title={inactive ? 'Turn access back on' : 'Turn dashboard access off'}
                          className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold ${
                            inactive
                              ? 'border-line text-pos-dark hover:bg-pos-soft'
                              : 'border-line text-red-600 hover:bg-red-50'
                          }`}
                        >
                          <Power className="h-3.5 w-3.5" /> {inactive ? 'Activate' : 'Deactivate'}
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <p className="text-xs text-ink-soft">
          {GRANTABLE_PERMISSIONS.length} permissions available. New pages and actions appear here
          automatically as they're added to the dashboard.
        </p>
      </div>

      {/* Create a staff login */}
      {showAdd && (
        <Modal
          wide
          icon={UserPlus}
          title="Add a dashboard user"
          subtitle="They sign in with this email and password, and see only what you tick below."
          onClose={() => (saving ? null : setShowAdd(false))}
          footer={
            <>
              <button
                type="button"
                onClick={() => setShowAdd(false)}
                disabled={saving}
                className="rounded-lg border border-line px-4 py-2.5 text-xs font-semibold text-ink-soft hover:bg-canvas disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                form="add-user-form"
                disabled={saving}
                className="flex items-center gap-2 rounded-lg bg-brand px-5 py-2.5 text-xs font-bold text-white hover:bg-brand-dark disabled:opacity-50"
              >
                {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {saving ? 'Creating…' : 'Create user'}
              </button>
            </>
          }
        >
          <form id="add-user-form" onSubmit={addUser} className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Full name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Staff member's name"
                required
              />
              <Field
                label="Phone (optional)"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                placeholder="9876543210"
              />
              <Field
                label="Email (their login)"
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="staff@walibaba.com"
                required
              />
              <Field
                label="Temporary password"
                type="text"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                placeholder="At least 6 characters"
                required
              />
              {outlets.length > 0 && (
                <OutletSelect
                  value={form.outletId}
                  onChange={(id) => setForm({ ...form, outletId: id })}
                  outlets={outlets}
                  disabled={saving}
                />
              )}
            </div>

            <div className="border-t border-line pt-5">
              <p className="mb-1 text-sm font-bold text-ink">What can this user do?</p>
              <p className="mb-4 text-xs text-ink-soft">
                Anything left unticked is hidden from them entirely — the page disappears from their
                sidebar and the button doesn't appear.
              </p>
              <PermissionPicker selected={newPerms} onChange={setNewPerms} disabled={saving} />
            </div>
          </form>
        </Modal>
      )}

      {/* Change an existing staffer's permissions */}
      {editTarget && (
        <Modal
          wide
          icon={ShieldCheck}
          title={`Access · ${editTarget.full_name || editTarget.email}`}
          subtitle="Outlet and permissions. Takes effect immediately, including on tabs they already have open."
          onClose={() => (saving ? null : setEditTarget(null))}
          footer={
            <>
              <button
                type="button"
                onClick={() => setEditTarget(null)}
                disabled={saving}
                className="rounded-lg border border-line px-4 py-2.5 text-xs font-semibold text-ink-soft hover:bg-canvas disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={savePerms}
                disabled={saving}
                className="flex items-center gap-2 rounded-lg bg-brand px-5 py-2.5 text-xs font-bold text-white hover:bg-brand-dark disabled:opacity-50"
              >
                {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {saving ? 'Saving…' : 'Save permissions'}
              </button>
            </>
          }
        >
          {outlets.length > 0 && (
            <div className="mb-5 border-b border-line pb-5">
              <OutletSelect
                value={editOutlet}
                onChange={setEditOutlet}
                outlets={outlets}
                disabled={saving}
              />
            </div>
          )}
          <PermissionPicker selected={editPerms} onChange={setEditPerms} disabled={saving} />
        </Modal>
      )}
    </>
  )
}
