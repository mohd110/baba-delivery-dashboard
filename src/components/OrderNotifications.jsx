import { useEffect, useState } from 'react'
import { BellRing, X } from 'lucide-react'
import { supabase } from '../lib/supabase.js'

let toastSeq = 0

/* Soft chime when a new order lands (best-effort; ignored if audio is blocked). */
function ding() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext
    if (!Ctx) return
    const ctx = new Ctx()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.type = 'sine'
    osc.frequency.value = 880
    gain.gain.setValueAtTime(0.0001, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.4)
    osc.start()
    osc.stop(ctx.currentTime + 0.42)
    osc.onended = () => ctx.close()
  } catch {
    /* audio not available — silently skip */
  }
}

/* Listens for new orders in real time and shows toast notifications. */
export default function OrderNotifications() {
  const [toasts, setToasts] = useState([])

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

  return (
    <div className="pointer-events-none fixed right-6 top-6 z-50 flex w-80 flex-col gap-3">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="pointer-events-auto flex items-start gap-3 rounded-xl border border-line bg-white p-4 shadow-[0_8px_24px_rgba(0,0,0,0.12)]"
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
          </div>
          <button
            onClick={() => setToasts((list) => list.filter((x) => x.id !== t.id))}
            className="shrink-0 text-ink-soft hover:text-ink"
            aria-label="Dismiss"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}
    </div>
  )
}
