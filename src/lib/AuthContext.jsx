import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { supabase } from './supabase.js'

/* Absolute session lifetime: 3 hours from sign-in, then auto sign-out. */
const SESSION_MAX_MS = 3 * 60 * 60 * 1000
const LOGIN_AT_KEY = 'wb-login-at'

const AuthContext = createContext({ session: null, user: null, loading: true, signOut: () => {} })

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)
  const timerRef = useRef(null)

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

  const signOut = () => {
    localStorage.removeItem(LOGIN_AT_KEY)
    return supabase.auth.signOut()
  }

  return (
    <AuthContext.Provider value={{ session, user: session?.user ?? null, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  return useContext(AuthContext)
}
