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
