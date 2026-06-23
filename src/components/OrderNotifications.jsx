import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BellRing, X } from 'lucide-react'
import { supabase } from '../lib/supabase.js'

let toastSeq = 0

/* ── Loud, irritating new-order alarm (rings for 1 minute) ─────────────
 * Two-tone siren: alternates between a 660 Hz and an 880 Hz harsh square
 * wave (ambulance / fire-truck style), swapping every 0.4s at near-max
 * volume so staff can't miss an incoming order.
 * Best-effort: silently skipped if the browser blocks audio. Call
 * stopAlarm() to silence it early. */
const ALARM_DURATION_MS = 60_000
let alarmCtx = null
let alarmInterval = null
let alarmTimeout = null

function stopAlarm() {
  if (alarmInterval) {
    clearInterval(alarmInterval)
    alarmInterval = null
  }
  if (alarmTimeout) {
    clearTimeout(alarmTimeout)
    alarmTimeout = null
  }
  if (alarmCtx) {
    try {
      alarmCtx.close()
    } catch {
      /* already closed */
    }
    alarmCtx = null
  }
}

function startAlarm() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext
    if (!Ctx) return
    stopAlarm() // restart cleanly if another order arrives mid-alarm
    const ctx = new Ctx()
    alarmCtx = ctx
    ctx.resume?.()

    const tone = (freq, t0, dur) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.type = 'square' // harsh, buzzy, piercing
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0.0001, t0)
      gain.gain.exponentialRampToValueAtTime(0.85, t0 + 0.008) // very loud
      gain.gain.setValueAtTime(0.85, t0 + dur - 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
      osc.start(t0)
      osc.stop(t0 + dur)
    }

    // One "ring" = a two-tone siren cycle: 660 Hz then 880 Hz, each held for
    // 0.4s back-to-back with no gap (ambulance / fire-truck wail). The cycle
    // repeats continuously so it nags until silenced.
    const STEP = 0.4
    const ring = () => {
      if (!alarmCtx) return
      const now = ctx.currentTime
      tone(660, now, STEP)
      tone(880, now + STEP, STEP)
    }

    ring()
    alarmInterval = setInterval(ring, STEP * 2 * 1000) // seamless 0.8s loop
    alarmTimeout = setTimeout(stopAlarm, ALARM_DURATION_MS)
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
          startAlarm()
          // Keep the toast visible for the full alarm so staff can silence it.
          setTimeout(() => dismiss(id), ALARM_DURATION_MS)
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
      stopAlarm()
    }
  }, [])

  if (toasts.length === 0) return null

  const open = (id) => {
    stopAlarm()
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
              stopAlarm()
              setToasts((list) => list.filter((x) => x.id !== t.id))
            }}
            className="shrink-0 text-ink-soft hover:text-ink"
            aria-label="Dismiss and silence alarm"
          >
            <X className="h-4 w-4" />
          </span>
        </button>
      ))}
    </div>
  )
}
