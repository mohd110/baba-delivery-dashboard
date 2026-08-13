import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { supabase } from './supabase.js'
import { canWith } from './permissions.js'

/* Absolute session lifetime: 3 hours from sign-in, then auto sign-out. */
const SESSION_MAX_MS = 3 * 60 * 60 * 1000
const LOGIN_AT_KEY = 'wb-login-at'

/* The columns arrive in two migrations, so loadProfile steps down through them
 * rather than failing outright on a database that hasn't had both run:
 *   full  → add-outlet-staff.sql has been run (per-outlet logins)
 *   perms → only add-staff-permissions.sql (permissions, but no outlet)
 *   min   → neither; every login is treated as an unrestricted admin */
const PROFILE_COLS_MIN = 'id, full_name, role'
const PROFILE_COLS_PERMS = `${PROFILE_COLS_MIN}, email, is_admin, permissions, is_active`
const PROFILE_COLS = `${PROFILE_COLS_PERMS}, restaurant_id`

const AuthContext = createContext({
  session: null,
  user: null,
  loading: true,
  signOut: () => {},
  profile: null,
  isAdmin: true,
  outletId: null,
  permissions: [],
  permsLoading: true,
  can: () => true,
})

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)
  const timerRef = useRef(null)
  // The signed-in user's own profiles row, tagged with the id it was fetched
  // for. Keeping the id alongside the row is what lets `profile` and
  // `permsLoading` be derived below rather than juggled in the effect — a stale
  // row from a previous user can never be read as the current one's.
  const [loaded, setLoaded] = useState({ userId: null, profile: null })

  useEffect(() => {
    const clearTimer = () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
    }

    const forceSignOut = () => {
      clearTimer()
      localStorage.removeItem(LOGIN_AT_KEY)
      supabase.auth.signOut()
    }

    // Schedule the 3-hour auto-logout (or sign out now if the window already passed).
    const armExpiry = (active) => {
      clearTimer()
      if (!active) return
      let loginAt = Number(localStorage.getItem(LOGIN_AT_KEY))
      if (!loginAt) {
        loginAt = Date.now()
        localStorage.setItem(LOGIN_AT_KEY, String(loginAt))
      }
      const remaining = loginAt + SESSION_MAX_MS - Date.now()
      if (remaining <= 0) {
        forceSignOut()
        return
      }
      timerRef.current = setTimeout(forceSignOut, remaining)
    }

    supabase.auth.getSession().then(({ data }) => {
      const s = data.session ?? null
      setSession(s)
      armExpiry(!!s)
      setLoading(false)
    })

    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s ?? null)
      if (event === 'SIGNED_OUT') {
        localStorage.removeItem(LOGIN_AT_KEY)
        clearTimer()
      } else {
        // SIGNED_IN starts a fresh window (loginAt was cleared on the prior sign-out);
        // refresh / token-refresh events keep the existing window.
        armExpiry(!!s)
      }
    })

    return () => {
      sub.subscription.unsubscribe()
      clearTimer()
    }
  }, [])

  const signOut = useCallback(() => {
    localStorage.removeItem(LOGIN_AT_KEY)
    return supabase.auth.signOut()
  }, [])

  /* ── Permissions ────────────────────────────────────────────────────────
   * What this login may see and do lives on its own `profiles` row, which is
   * also the row the Users & Permissions page writes. Subscribed to, so an
   * admin revoking a permission takes effect on the staffer's open tab without
   * them having to sign out and back in. */
  const userId = session?.user?.id ?? null

  useEffect(() => {
    let cancelled = false
    if (!userId) return

    const loadProfile = async () => {
      const read = (cols) =>
        supabase.from('profiles').select(cols).eq('id', userId).maybeSingle()

      let { data, error } = await read(PROFILE_COLS)
      if (error) {
        // No restaurant_id column — add-outlet-staff.sql hasn't been run. The
        // login keeps its permissions and simply isn't scoped to an outlet.
        ;({ data, error } = await read(PROFILE_COLS_PERMS))
      }
      if (error) {
        // No permission columns either. Fall back to the plain row and treat
        // the login as an admin (below): the dashboard then behaves exactly as
        // it did before permissions existed, rather than locking the owner out
        // of their own dashboard over a migration.
        console.warn('Permission columns unavailable — treating this login as an admin:', error.message)
        ;({ data } = await read(PROFILE_COLS_MIN))
      }
      if (cancelled) return
      setLoaded({ userId, profile: data ?? null })
    }

    loadProfile()

    const channel = supabase
      .channel(`my-profile-${userId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'profiles', filter: `id=eq.${userId}` },
        (payload) => {
          if (!cancelled && payload.new) {
            setLoaded((prev) => ({ userId, profile: { ...(prev.profile ?? {}), ...payload.new } }))
          }
        }
      )
      .subscribe()

    return () => {
      cancelled = true
      supabase.removeChannel(channel)
    }
  }, [userId])

  // Signed out: nothing to load. Signed in: still loading until the row we hold
  // is this user's.
  const permsLoading = !!userId && loaded.userId !== userId
  const profile = loaded.userId === userId ? loaded.profile : null

  // A login that hasn't been restricted is an admin. Only an explicit
  // `is_admin === false` — i.e. a staff row the migration has actually written
  // — narrows anything down.
  const isAdmin = !profile || profile.is_admin !== false
  const permissions = Array.isArray(profile?.permissions) ? profile.permissions : []
  // The outlet this login is tied to; null means every outlet (all admins, and
  // any staffer the owner left unassigned).
  const outletId = (!isAdmin && profile?.restaurant_id) || null

  // `permissions` is a fresh array on every render, so key the callback on its
  // contents — otherwise every consumer of `can` re-renders continuously.
  const permsKey = permissions.join(',')
  const can = useCallback(
    (key) => canWith(isAdmin, permsKey ? permsKey.split(',') : [], key),
    [isAdmin, permsKey]
  )

  // Deactivating a login in the Users page takes effect immediately, even on a
  // tab that's already open. (The database enforces it too — is_dashboard_staff
  // requires is_active — this just avoids leaving a dead dashboard on screen.)
  const kickedRef = useRef(false)
  useEffect(() => {
    if (profile?.is_active === false && !kickedRef.current) {
      kickedRef.current = true
      alert('Your dashboard access has been turned off. Please contact the restaurant owner.')
      signOut()
    }
  }, [profile?.is_active, signOut])

  return (
    <AuthContext.Provider
      value={{
        session,
        user: session?.user ?? null,
        loading,
        signOut,
        profile,
        isAdmin,
        outletId,
        permissions,
        permsLoading,
        can,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  return useContext(AuthContext)
}
