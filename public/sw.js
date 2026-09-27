/* Service worker for the admin dashboard. Three jobs:
 *   1. make the dashboard installable (Chrome wants a SW with a fetch handler),
 *   2. show new-order notifications pushed by the server while the app is
 *      closed or the phone is locked (see api/new-order-push.js),
 *   3. show notifications the open page asks for — on Android a page can't
 *      construct `new Notification()` itself, only a service worker can. */

// Take over as soon as a new build is deployed rather than waiting for every
// tab to close.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

// Network-first for page loads, so an installed app never pins an old build.
self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.mode === 'navigate') {
    event.respondWith(fetch(req, { cache: 'no-store' }).catch(() => fetch(req)))
  }
})

self.addEventListener('push', (event) => {
  let data = {}
  try { data = event.data ? event.data.json() : {} } catch { data = { body: event.data?.text() } }

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      // A dashboard that's open on screen already rings its own bell and
      // raises its own popup for this order — don't double up.
      if (windows.some((w) => w.visibilityState === 'visible')) return
      return self.registration.showNotification(data.title || '🔔 New order received', {
        body: data.body || 'A new order is waiting to be accepted.',
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
        // Same tag the open page uses, so the two replace rather than stack.
        tag: data.tag || `new-order-${Date.now()}`,
        renotify: true,
        requireInteraction: true,
        vibrate: [500, 150, 500, 150, 500],
        data: { url: data.url || '/orders' },
      })
    })
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = event.notification.data?.url || '/orders'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      const win = windows[0]
      if (win) {
        // Let the running app route there itself (no full reload).
        win.postMessage({ type: 'open-url', url })
        return win.focus()
      }
      return self.clients.openWindow(url)
    })
  )
})
