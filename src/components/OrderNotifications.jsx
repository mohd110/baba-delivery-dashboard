import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useNavigate } from 'react-router-dom'
import { BellRing, BellOff } from 'lucide-react'
import { supabase } from '../lib/supabase.js'
import { orderCode } from '../lib/format.js'
import { useOutletScope, useOutletTag } from '../lib/outletScope.js'
import { boldLast4 } from './OrderIdLabel.jsx'
import { closeNotificationsByTag, isMobileDevice, showDeviceNotification } from '../lib/device.js'

let toastSeq = 0

/* ── New-order alarm ────────────────────────────────────────────────────
 * Plays a custom audio clip on loop so staff can't miss an incoming order.
 * It keeps looping until the order is accepted — nothing dismisses it early
 * (not clicking, not a close button).
 *
 * This has to work with Chrome MINIMISED, which is the whole point of it. Two
 * different things are needed for that, and they fail in different ways:
 *
 *   the sound   keeps playing on its own — browsers throttle background timers
 *               but never a playing <audio>. The one thing that stops it is the
 *               autoplay policy: play() is refused until the tab has had a user
 *               gesture. So a refusal is remembered, retried on the next click
 *               or keypress, and shown in the UI rather than swallowed — a
 *               silently blocked alarm reads as "the dashboard missed the
 *               order".
 *   the popup   a page that isn't on screen can't show anyone anything. Only an
 *               OS-level Notification can, so every new order raises one (see
 *               notifyNewOrderDesktop) — that is what reaches a minimised
 *               window or another desktop. */
const ALARM_SRC = '/assets/new-order.mp3'
let alarmAudio = null
// True when the browser refused to play: the alarm SHOULD be sounding and isn't.
let alarmBlocked = false
const blockedListeners = new Set()
const setBlocked = (v) => {
  if (alarmBlocked === v) return
  alarmBlocked = v
  blockedListeners.forEach((fn) => fn())
}
// useSyncExternalStore contract, so the toast can render the "enable sound"
// prompt the moment a play() is refused.
const subscribeBlocked = (fn) => { blockedListeners.add(fn); return () => blockedListeners.delete(fn) }
const getBlocked = () => alarmBlocked

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
  setBlocked(false)
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
      played
        .then(() => setBlocked(false))
        .catch(() => {
          // Autoplay refused (no user gesture in this tab yet). Keep the element
          // around: the retry below just calls play() on it again.
          setBlocked(true)
          armUnblock()
        })
    }
  } catch {
    /* audio not available — silently skip */
  }
}

/* One-shot listener that retries the refused alarm on the first user gesture.
 * Registered only while an alarm is actually blocked, and torn down as soon as
 * it succeeds, so the common case costs nothing. */
let unblockArmed = false
function armUnblock() {
  if (unblockArmed || typeof window === 'undefined') return
  unblockArmed = true
  const retry = () => {
    if (!alarmAudio) { disarm(); return }
    const played = alarmAudio.play()
    if (played && typeof played.catch === 'function') {
      played.then(() => { setBlocked(false); disarm() }).catch(() => { /* still blocked */ })
    } else {
      setBlocked(false)
      disarm()
    }
  }
  const disarm = () => {
    unblockArmed = false
    window.removeEventListener('pointerdown', retry)
    window.removeEventListener('keydown', retry)
  }
  window.addEventListener('pointerdown', retry)
  window.addEventListener('keydown', retry)
}

/* ── The OS-level notification ──────────────────────────────────────────
 * The only part of this that a minimised Chrome can show. `requireInteraction`
 * keeps it on screen until someone deals with it, rather than fading after a
 * few seconds while the kitchen is busy. Kept per order so accepting one can
 * take its notification back down. */
const desktopNotes = new Map()

function notifyNewOrderDesktop(toast, onOpen) {
  try {
    const money = toast.total != null ? ` · ₹${toast.total.toLocaleString('en-IN')}` : ''
    // Same tag as the server push (api/new-order-push.js), so a phone that
    // gets both shows one notification, not two.
    const n = showDeviceNotification('🔔 New order received', {
      body: `${toast.code}${money} · ${toast.name}
Awaiting acceptance — click to open.`,
      tag: `new-order-${toast.orderId || toast.id}`,
      requireInteraction: true,
      // Our own bell is already looping, so don't stack the OS chime on top of
      // it — unless the bell was refused, in which case the chime is the only
      // sound there is.
      silent: !alarmBlocked,
      url: toast.orderId ? `/orders?order=${toast.orderId}` : '/orders',
      onClick: onOpen,
    })
    if (n && toast.orderId) desktopNotes.set(toast.orderId, n)
  } catch {
    /* notifications unavailable — the in-app toast and the bell still fire */
  }
}

function closeDesktopNote(orderId) {
  if (!orderId) return
  // A push may have raised one while the app was closed — not in the map, but
  // it carries the same tag.
  closeNotificationsByTag(`new-order-${orderId}`)
  const n = desktopNotes.get(orderId)
  if (!n) return
  try { n.close() } catch { /* already gone */ }
  desktopNotes.delete(orderId)
}

/* Listens for new orders in real time and shows toast notifications. */
export default function OrderNotifications() {
  const [toasts, setToasts] = useState([])
  const navigate = useNavigate()
  // Read from the realtime handler and from notification onclick callbacks that
  // outlive the render they were created in.
  const navigateRef = useRef(navigate)
  useEffect(() => { navigateRef.current = navigate }, [navigate])

  /* Who gets alerted for what: a staffer only hears their own outlet's orders,
   * while an admin on "All outlets" hears every branch — which is the point of
   * the super-admin view. Held in a ref so switching outlet doesn't tear down
   * the subscription (and miss an order in the gap). */
  const { matches } = useOutletScope()
  const matchesRef = useRef(matches)
  useEffect(() => { matchesRef.current = matches }, [matches])
  // Which branch an order came from, on the same rule every other order
  // surface uses: named for an admin who can see more than one, silent for a
  // staffer already locked to theirs.
  const { show: showBranch, labelOf: branchLabel } = useOutletTag()

  // True while the browser is refusing to play the bell.
  const soundBlocked = useSyncExternalStore(subscribeBlocked, getBlocked, getBlocked)
  // Permission for the OS-level popup — the only alert a minimised Chrome can
  // show. Tracked in state so the prompt below appears/disappears live.
  // "Not now" hides the permission nudge for this tab only — it is deliberately
  // not persisted, so a fresh session asks again rather than staying silent
  // forever after one dismissal.
  const [promptDismissed, setPromptDismissed] = useState(false)
  const [notifyPerm, setNotifyPerm] = useState(
    () => (typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : 'unsupported')
  )

  /* Ask once, on mount. This component is mounted on every dashboard page, so
   * the ask happens wherever staff happen to land rather than only on Active
   * Orders. Chrome may defer the prompt until the page has had a gesture, which
   * is why `enableAlerts` below also exists as an explicit button. */
  useEffect(() => {
    if (notifyPerm !== 'default') return
    // Phones get asked from the setup sheet (PhoneSetup) instead: mobile
    // browsers ignore or quietly block a prompt that no tap asked for.
    if (isMobileDevice()) return
    try {
      const r = Notification.requestPermission()
      if (r && typeof r.then === 'function') r.then(setNotifyPerm).catch(() => {})
    } catch { /* ignore */ }
  }, [notifyPerm])

  /* The manual path: a click is a user gesture, so it both satisfies Chrome's
   * autoplay policy (unblocking the bell) and is the reliable moment to ask for
   * notification permission. */
  const enableAlerts = useCallback(() => {
    try {
      if ('Notification' in window && Notification.permission === 'default') {
        const r = Notification.requestPermission()
        if (r && typeof r.then === 'function') r.then(setNotifyPerm).catch(() => {})
      }
    } catch { /* ignore */ }
    if (alarmAudio) {
      const played = alarmAudio.play()
      if (played && typeof played.catch === 'function') {
        played.then(() => setBlocked(false)).catch(() => {})
      }
    } else {
      // Nothing waiting to play — prime the autoplay policy with a silent
      // play/pause so the NEXT order's bell isn't the one that gets refused.
      try {
        const probe = new Audio(ALARM_SRC)
        probe.volume = 0
        const played = probe.play()
        if (played && typeof played.then === 'function') {
          played.then(() => { probe.pause(); setBlocked(false) }).catch(() => {})
        }
      } catch { /* ignore */ }
    }
  }, [])

  useEffect(() => {
    // Drop every toast for an order that is no longer awaiting acceptance,
    // silencing the alarm once the last one clears.
    const dismissByOrderId = (orderId) => {
      if (!orderId) return
      // Take the OS popup down too — an accepted order that leaves a "new order"
      // notification sitting on the desktop is worse than no notification.
      closeDesktopNote(orderId)
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
          // Only alert for orders still awaiting acceptance…
          if (o.status && o.status !== 'pending') return
          // …at an outlet this login is watching.
          if (!matchesRef.current(o.restaurant_id)) return
          const addr = o.delivery_address || {}
          const id = ++toastSeq
          const toast = {
            id,
            orderId: o.id || null,
            code: orderCode(o),
            total: typeof o.total === 'number' ? o.total : null,
            name: addr.name || 'New customer',
            outletId: o.restaurant_id || null,
          }
          setToasts((list) => [toast, ...list].slice(0, 4))
          startAlarm()
          // …and the OS popup, which is the only one of the three that reaches
          // a minimised window. `navigate` is stable, so reading it here rather
          // than adding it to the effect's deps keeps the channel from being
          // torn down and re-subscribed (which would miss orders in the gap).
          notifyNewOrderDesktop(toast, () =>
            navigateRef.current(toast.orderId ? `/orders?order=${toast.orderId}` : '/orders')
          )
          // The toast, the alarm and the popup all stay until the order is
          // accepted — handled by the UPDATE listener below. Nothing here
          // dismisses them.
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
      // Don't leave popups on the desktop pointing at a page that's gone.
      desktopNotes.forEach((n) => { try { n.close() } catch { /* ignore */ } })
      desktopNotes.clear()
    }
  }, [])

  /* Is anything standing between an incoming order and the person who has to
   * cook it? Either half being missing is worth saying out loud: without the
   * OS popup a minimised Chrome shows nothing at all, and a refused bell is
   * indistinguishable from a dashboard that never got the order. */
  const needsPermission = notifyPerm === 'default' || notifyPerm === 'denied'
  // An actively-refused bell always shows, even if the prompt was dismissed —
  // that one is a live failure, not a suggestion.
  const showAlertPrompt = soundBlocked || (needsPermission && !promptDismissed)

  if (toasts.length === 0 && !showAlertPrompt) return null

  // Clicking a toast jumps to that order so staff can accept it. It does NOT
  // silence the alarm or dismiss the toast — only accepting the order does.
  const open = (toast) => {
    navigate(toast.orderId ? `/orders?order=${toast.orderId}` : '/orders')
  }

  return (
    <div className="pointer-events-none fixed inset-x-3 top-3 z-50 flex flex-col gap-3 sm:inset-x-auto sm:right-6 sm:top-6 sm:w-80">
      {showAlertPrompt && (
        <div className="pointer-events-auto rounded-xl border border-amber-200 bg-amber-50 p-3 shadow-[0_8px_24px_rgba(0,0,0,0.10)]">
          <p className="flex items-center gap-1.5 text-xs font-bold text-[#92400e]">
            <BellOff className="h-3.5 w-3.5 shrink-0" />
            {soundBlocked
              ? 'New-order bell is muted by Chrome'
              : notifyPerm === 'denied'
                ? 'Desktop alerts are blocked'
                : 'Turn on desktop alerts'}
          </p>
          <p className="mt-1 text-[11px] leading-snug text-[#92400e]/90">
            {soundBlocked
              ? 'Chrome won’t play sound until you interact with this tab. Click below — the bell is waiting.'
              : notifyPerm === 'denied'
                ? 'Chrome is blocking notifications for this site, so nothing will show while the window is minimised. Re-allow them in the padlock menu in the address bar → Notifications.'
                : 'Without these, a minimised or background window shows nothing when an order arrives.'}
          </p>
          {notifyPerm !== 'denied' || soundBlocked ? (
            <button
              type="button"
              onClick={enableAlerts}
              className="mt-2 w-full rounded-lg bg-[#b45309] px-3 py-1.5 text-[11px] font-bold text-white hover:bg-[#92400e]"
            >
              {soundBlocked ? 'Enable sound' : 'Enable alerts'}
            </button>
          ) : null}
          {!soundBlocked && (
            <button
              type="button"
              onClick={() => setPromptDismissed(true)}
              className="mt-1.5 w-full text-[10px] font-semibold text-[#92400e]/70 hover:text-[#92400e]"
            >
              Not now
            </button>
          )}
        </div>
      )}
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
            <p className="flex items-center gap-1.5 text-sm font-bold text-ink">
              New order received
              {showBranch && (
                <span className="rounded-full bg-line-soft px-1.5 py-px text-[10px] font-bold uppercase tracking-wide text-ink-soft">
                  {branchLabel(t.outletId)}
                </span>
              )}
            </p>
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
