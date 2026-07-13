import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !anonKey) {
  // Surface a clear error in dev if env vars are missing
  console.error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in .env.local')
}

export const supabase = createClient(url, anonKey, {
  auth: {
    // Keep the user signed in across page refreshes / tab restarts.
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storage: typeof window !== 'undefined' ? window.localStorage : undefined,
  },
})

// A throwaway client that never persists or overwrites the main session. Used
// for admin actions that call signUp() (e.g. creating a rider account) which
// would otherwise replace the currently signed-in admin's session.
export function createIsolatedClient() {
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
}
