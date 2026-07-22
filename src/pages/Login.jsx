import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Lock, Mail, Loader2, Eye, EyeOff } from 'lucide-react'
import { supabase } from '../lib/supabase.js'

export default function Login() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('admin@walibaba.com')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    setLoading(false)
    if (error) {
      setError(error.message)
      return
    }
    navigate('/orders', { replace: true })
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-4">
      <div className="w-full max-w-sm rounded-2xl border border-line bg-white p-8 shadow-[0_8px_24px_rgba(45,52,54,0.08)]">
        {/* brand */}
        <div className="mb-8 flex flex-col items-center text-center">
          <img
            src="/assets/walibaba logo.jpeg"
            onError={(e) => {
              if (!e.currentTarget.dataset.triedFallback) {
                e.currentTarget.dataset.triedFallback = 'true'
                e.currentTarget.src = '/assets/logo.png'
              }
            }}
            alt="Wali Baba Foods"
            className="mb-4 h-24 w-auto object-contain"
          />
          <h1 className="text-2xl font-bold leading-tight tracking-tight text-brand">Wali Baba Foods</h1>
          <p className="mt-1 text-xs font-semibold uppercase tracking-[1.2px] text-ink-soft">
            Delivery Admin
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-ink-soft">Email</label>
            <div className="relative mt-1">
              <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-soft" />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@walibaba.com"
                className="w-full rounded-lg border border-line py-2.5 pl-10 pr-3 text-sm text-ink placeholder:text-ink-soft focus:border-brand focus:outline-none"
                required
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-ink-soft">Password</label>
            <div className="relative mt-1">
              <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-soft" />
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full rounded-lg border border-line py-2.5 pl-10 pr-10 text-sm text-ink placeholder:text-ink-soft focus:border-brand focus:outline-none"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                title={showPassword ? 'Hide password' : 'Show password'}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-soft hover:text-brand transition-colors"
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          {error && (
            <p className="rounded-lg bg-[#ffdad3] px-3 py-2 text-xs font-medium text-brand">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand py-2.5 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-60"
          >
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>

        <p className="mt-6 text-center text-xs text-ink-soft">
          Restaurant staff access only · Since 1999
        </p>
      </div>
    </div>
  )
}
