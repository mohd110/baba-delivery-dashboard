import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BellRing } from 'lucide-react'
import { supabase } from '../lib/supabase.js'
import { orderCode } from '../lib/format.js'
import { boldLast4 } from './OrderIdLabel.jsx'

let toastSeq = 0

/* ── New-order alarm ────────────────────────────────────────────────────
 * Plays a custom audio clip on loop so staff can't miss an incoming order.
 * It keeps looping until the order is accepted — nothing dismisses it early
 * (not clicking, not a close button). Best-effort: silently skipped if the
 * browser blocks autoplay (no user interaction yet). */
const ALARM_SRC = '/assets/new-order.mp3'
let alarmAudio = null

function stopAlarm() {
  if (alarmAudio) {
    try {
      alarmAudio.pause()
      alarmAudio.currentTime = 0
    } catch {
      /* already stopped */
    }
    alarmAudio = null
  }
}

function startAlarm() {
  try {
    stopAlarm() // restart cleanly if another order arrives mid-alarm
    const audio = new Audio(ALARM_SRC)
    audio.loop = true
    audio.volume = 1
    alarmAudio = audio
    const played = audio.play()
    if (played && typeof played.catch === 'function') {
      played.catch(() => { /* autoplay blocked until the page is interacted with */ })
    }
  } catch {
    /* audio not available — silently skip */
  }
}

/* Listens for new orders in real time and shows toast notifications. */
export default function OrderNotifications() {
  const [toasts, setToasts] = useState([])
  const navigate = useNavigate()

  useEffect(() => {
    // Drop every toast for an order that is no longer awaiting acceptance,
    // silencing the alarm once the last one clears.
    const dismissByOrderId = (orderId) => {
      if (!orderId) return
      setToasts((list) => {
        const next = list.filter((t) => t.orderId !== orderId)
        if (next.length !== list.length && next.length === 0) stopAlarm()
        return next
      })
    }

    const channel = supabase
      .channel('new-orders')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'orders' },
        (payload) => {
          const o = payload.new || {}
          // Only alert for orders still awaiting acceptance.
          if (o.status && o.status !== 'pending') return
          const addr = o.delivery_address || {}
          const id = ++toastSeq
          const toast = {
            id,
            orderId: o.id || null,
            code: orderCode(o),
            total: typeof o.total === 'number' ? o.total : null,
            name: addr.name || 'New customer',
          }
          setToasts((list) => [toast, ...list].slice(0, 4))
          startAlarm()
          // The toast and the alarm both stay until the order is accepted —
          // handled by the UPDATE listener below. Nothing here dismisses them.
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'orders' },
        (payload) => {
          const o = payload.new || {}
          // Once an order leaves 'pending' (accepted, cancelled, etc.) clear
          // its notification and stop the alarm automatically.
          if (o.status && o.status !== 'pending') dismissByOrderId(o.id)
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
      stopAlarm()
    }
  }, [])

  if (toasts.length === 0) return null

  // Clicking a toast jumps to that order so staff can accept it. It does NOT
  // silence the alarm or dismiss the toast — only accepting the order does.
  const open = (toast) => {
    navigate(toast.orderId ? `/orders?order=${toast.orderId}` : '/orders')
  }

  return (
    <div className="pointer-events-none fixed right-6 top-6 z-50 flex w-80 flex-col gap-3">
      {toasts.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => open(t)}
          className="pointer-events-auto flex w-full items-start gap-3 rounded-xl border border-line bg-white p-4 text-left shadow-[0_8px_24px_rgba(0,0,0,0.12)] transition-shadow hover:shadow-[0_10px_28px_rgba(0,0,0,0.18)]"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#ffdad3] text-brand">
            <BellRing className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-ink">New order received</p>
            <p className="mt-0.5 truncate text-xs text-ink-soft">
              {boldLast4(t.code)}
              {t.total != null ? ` · ₹${t.total.toLocaleString('en-IN')}` : ''} · {t.name}
            </p>
            <p className="mt-0.5 text-[11px] font-semibold text-[#b45309]">
              Awaiting acceptance · tap to open &amp; accept
            </p>
          </div>
        </button>
      ))}
    </div>
  )
}
