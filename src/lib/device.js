import { supabase } from './supabase.js'

/* Phone-side plumbing: the service worker, OS notifications, web push and
 * "Add to Home screen". Everything here fails soft — a browser that can't do
 * one of these just doesn't get it, and the in-app bell still rings. */

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY

export function isIos() {
  const ua = navigator.userAgent || ''
  // iPadOS reports itself as a Mac; the touch points give it away.
  return /iphone|ipad|ipod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
}

export function isMobileDevice() {
  return isIos() || /android|mobile/i.test(navigator.userAgent || '')
}

/** Running as the home-screen app rather than a browser tab. */
export function isStandalone() {
  return window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true
}

export function notificationsSupported() {
  return 'Notification' in window && 'serviceWorker' in navigator
}

export function pushSupported() {
  return notificationsSupported() && 'PushManager' in window && !!VAPID_PUBLIC_KEY
}

/* Whether this device has been through the phone setup sheet (PhoneSetup). */
const SETUP_DONE_KEY = 'wb-phone-setup-done'
export function phoneSetupDone() {
  try { return localStorage.getItem(SETUP_DONE_KEY) === '1' } catch { return false }
}
export function markPhoneSetupDone() {
  try { localStorage.setItem(SETUP_DONE_KEY, '1') } catch { /* private mode — asks again next time */ }
}

/* ── Service worker + install prompt ────────────────────────────────────── */

// Chrome fires `beforeinstallprompt` once, often before React has mounted, so
// it's caught here at startup and handed to whoever asks later.
let deferredInstall = null
const installListeners = new Set()
const emitInstall = () => installListeners.forEach((fn) => fn())

export function initDevice() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch((e) => console.warn('Service worker failed:', e))
  }
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    deferredInstall = e
    emitInstall()
  })
  window.addEventListener('appinstalled', () => {
    deferredInstall = null
    emitInstall()
  })
}

export const subscribeInstall = (fn) => { installListeners.add(fn); return () => installListeners.delete(fn) }
export const canPromptInstall = () => !!deferredInstall

/** Shows Chrome's own install dialog. Resolves true if the user accepted. */
export async function promptInstall() {
  const ev = deferredInstall
  if (!ev) return false
  ev.prompt()
  const { outcome } = await ev.userChoice
  deferredInstall = null
  emitInstall()
  return outcome === 'accepted'
}

/* ── Notifications ──────────────────────────────────────────────────────── */

/** Take down any notification with this tag, including ones a push raised. */
export async function closeNotificationsByTag(tag) {
  try {
    const reg = await navigator.serviceWorker?.getRegistration()
    const list = reg ? await reg.getNotifications({ tag }) : []
    list.forEach((n) => n.close())
  } catch { /* ignore */ }
}

/* Raise an OS notification. Desktop Chrome lets the page build one directly;
 * Android Chrome throws on `new Notification()` and only allows it through
 * the service worker — so try the first and fall back to the second.
 * Returns a handle whose close() takes it down again either way. */
export function showDeviceNotification(title, { url = '/orders', onClick, ...options } = {}) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return null
  try {
    const n = new Notification(title, options)
    n.onclick = () => {
      try { window.focus() } catch { /* ignore */ }
      onClick?.()
      n.close()
    }
    return { close: () => { try { n.close() } catch { /* ignore */ } } }
  } catch {
    let closed = false
    navigator.serviceWorker?.getRegistration().then((reg) => {
      if (!reg || closed) return
      return reg.showNotification(title, {
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
        ...options,
        data: { url },
      })
    }).catch(() => { /* nothing more we can do */ })
    return {
      close: () => {
        closed = true
        if (options.tag) closeNotificationsByTag(options.tag)
      },
    }
  }
}

/* ── Web push (orders reaching a closed app / locked phone) ─────────────── */

function urlBase64ToUint8Array(base64) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)))
}

/* Subscribe this device to push and store it against the signed-in login, so
 * api/new-order-push.js can reach it. Safe to call on every load — it reuses
 * the existing subscription. Needs notification permission already granted. */
export async function registerPush() {
  if (!pushSupported() || Notification.permission !== 'granted') return false
  try {
    const reg = await navigator.serviceWorker.ready
    let sub = await reg.pushManager.getSubscription()
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      })
    }
    const { error } = await supabase.rpc('save_dashboard_push', {
      p_subscription: sub.toJSON(),
      p_user_agent: navigator.userAgent.slice(0, 300),
    })
    if (error) {
      console.warn('Could not save push subscription (has add-dashboard-push.sql been run?):', error.message)
      return false
    }
    return true
  } catch (e) {
    console.warn('Push subscription failed:', e)
    return false
  }
}

/** Stop sending this device new orders — called on sign-out. */
export async function unregisterPush() {
  try {
    const reg = await navigator.serviceWorker?.getRegistration()
    const sub = reg && (await reg.pushManager.getSubscription())
    if (sub) await supabase.from('dashboard_push_subscriptions').delete().eq('endpoint', sub.endpoint)
  } catch { /* signing out regardless */ }
}

/** Ask for notification permission (must be called from a tap), then subscribe. */
export async function enableNotifications() {
  if (!('Notification' in window)) return 'unsupported'
  let perm = Notification.permission
  if (perm === 'default') perm = await Notification.requestPermission()
  if (perm === 'granted') await registerPush()
  return perm
}
