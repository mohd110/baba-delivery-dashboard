import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BellRing, X } from 'lucide-react'
import { supabase } from '../lib/supabase.js'

let toastSeq = 0

/* Louder, longer 3-note chime when a new order lands so it's hard to miss in a
   busy kitchen (best-effort; ignored if audio is blocked). */
function ding() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext
    if (!Ctx) return
    const ctx = new Ctx()
    const now = ctx.currentTime
    const notes = [
      { freq: 783.99, start: 0.0, dur: 0.55 }, // G5
      { freq: 1046.5, start: 0.16, dur: 0.55 }, // C6
      { freq: 1318.51, start: 0.32, dur: 0.95 }, // E6 (sustains so it rings out)
    ]
    notes.forEach(({ freq, start, dur }) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.type = 'sine'
      osc.frequency.value = freq
      const t = now + start
      gain.gain.setValueAtTime(0.0001, t)
      gain.gain.exponentialRampToValueAtTime(0.5, t + 0.03) // louder peak
      gain.gain.exponentialRampToValueAtTime(0.0001, t + dur)
      osc.start(t)
      osc.stop(t + dur + 0.05)
    })
    setTimeout(() => ctx.close(), 1500)
  } catch {
    /* audio not available — silently skip */
  }
}

/* Listens for new orders in real time and shows toast notifications. */
export default function OrderNotifications() {
  const [toasts, setToasts] = useState([])
  const navigate = useNavigate()

  useEffect(() => {
    const dismiss = (id) => setToasts((list) => list.filter((t) => t.id !== id))

    const channel = supabase
      .channel('new-orders')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'orders' },
        (payload) => {
          const o = payload.new || {}
          const addr = o.delivery_address || {}
          const id = ++toastSeq
          const toast = {
            id,
            code: o.id ? `ORD-${String(o.id).slice(0, 4).toUpperCase()}` : 'New order',
            total: typeof o.total === 'number' ? o.total : null,
            name: addr.name || 'New customer',
          }
          setToasts((list) => [toast, ...list].slice(0, 4))
          ding()
          setTimeout(() => dismiss(id), 9000)
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [])

  if (toasts.length === 0) return null

  const open = (id) => {
    setToasts((list) => list.filter((t) => t.id !== id))
    navigate('/orders')
  }

  return (
    <div className="pointer-events-none fixed right-6 top-6 z-50 flex w-80 flex-col gap-3">
      {toasts.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => open(t.id)}
          className="pointer-events-auto flex w-full items-start gap-3 rounded-xl border border-line bg-white p-4 text-left shadow-[0_8px_24px_rgba(0,0,0,0.12)] transition-shadow hover:shadow-[0_10px_28px_rgba(0,0,0,0.18)]"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#ffdad3] text-brand">
            <BellRing className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-ink">New order received</p>
            <p className="mt-0.5 truncate text-xs text-ink-soft">
              {t.code}
              {t.total != null ? ` · ₹${t.total.toLocaleString('en-IN')}` : ''} · {t.name}
            </p>
            <p className="mt-0.5 text-[11px] font-semibold text-[#b45309]">
              Awaiting payment verification · tap to open
            </p>
          </div>
          <span
            role="button"
            tabIndex={-1}
            onClick={(e) => {
              e.stopPropagation()
              setToasts((list) => list.filter((x) => x.id !== t.id))
            }}
            className="shrink-0 text-ink-soft hover:text-ink"
            aria-label="Dismiss"
          >
            <X className="h-4 w-4" />
          </span>
        </button>
      ))}
    </div>
  )
}
