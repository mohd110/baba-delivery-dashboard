import webpush from 'web-push'
import { createClient } from '@supabase/supabase-js'

/* Sends a phone notification to the dashboard staff when an order is placed,
 * so it reaches them with the app closed or the phone locked.
 *
 * Called by a Supabase Database Webhook on `orders` INSERT (see
 * add-dashboard-push.sql and PHONE_NOTIFICATIONS_SETUP.md).
 *
 * Environment (Vercel -> Project -> Settings -> Environment Variables):
 *   VITE_SUPABASE_URL          already set for the dashboard
 *   SUPABASE_SERVICE_ROLE_KEY  reads every login's subscriptions
 *   VITE_VAPID_PUBLIC_KEY      also used by the page to subscribe
 *   VAPID_PRIVATE_KEY
 *   VAPID_SUBJECT              e.g. mailto:you@example.com
 *   PUSH_WEBHOOK_SECRET        must match the webhook's x-webhook-secret header */

const money = (n) => (typeof n === 'number' ? ` · ₹${n.toLocaleString('en-IN')}` : '')

// Mirrors orderCode() in src/lib/format.js.
function orderCode(o) {
  if (o.order_number != null && o.order_number !== '') {
    return String(o.order_number).replace(/[^a-z0-9]/gi, '').toUpperCase()
  }
  return String(o.id || '').replace(/[^a-z0-9]/gi, '').slice(0, 10).toUpperCase() || 'New order'
}

/* Who hears about this order: the same rules the open dashboard applies
 * (AuthContext + OrderNotifications). A profile without the newer columns is
 * treated as an admin, just as the dashboard does. */
function wantsOrder(profile, order) {
  if (!profile || profile.is_active === false) return false
  if (profile.is_admin !== false) return true
  const perms = Array.isArray(profile.permissions) ? profile.permissions : []
  if (!perms.includes('page.orders')) return false
  return !profile.restaurant_id || profile.restaurant_id === order.restaurant_id
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })

  const secret = process.env.PUSH_WEBHOOK_SECRET
  if (!secret || req.headers['x-webhook-secret'] !== secret) {
    return res.status(401).json({ error: 'Bad webhook secret' })
  }

  const { VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, VITE_VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } =
    process.env
  if (!VITE_SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !VITE_VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    return res.status(500).json({ error: 'Push is not configured on the server' })
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {}
  const order = body.record || {}
  if (body.type !== 'INSERT' || body.table !== 'orders' || !order.id) {
    return res.status(200).json({ skipped: 'not a new order' })
  }
  // Only orders waiting to be accepted, the same filter the in-app bell uses.
  if (order.status && order.status !== 'pending') {
    return res.status(200).json({ skipped: `status ${order.status}` })
  }

  webpush.setVapidDetails(VAPID_SUBJECT || 'mailto:admin@example.com', VITE_VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)
  const db = createClient(VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

  const { data: subs, error } = await db
    .from('dashboard_push_subscriptions')
    .select('endpoint, user_id, subscription')
  if (error) return res.status(500).json({ error: error.message })
  if (!subs?.length) return res.status(200).json({ sent: 0 })

  // select('*') so a database missing the newer profile columns still works.
  const userIds = [...new Set(subs.map((s) => s.user_id))]
  const { data: profiles } = await db.from('profiles').select('*').in('id', userIds)
  const byId = new Map((profiles || []).map((p) => [p.id, p]))

  const addr = order.delivery_address || {}
  const payload = JSON.stringify({
    title: '🔔 New order received',
    body: `${orderCode(order)}${money(order.total)} · ${addr.name || 'New customer'}\nAwaiting acceptance — tap to open.`,
    // Same tag the open dashboard uses, so the two never stack.
    tag: `new-order-${order.id}`,
    url: `/orders?order=${order.id}`,
  })

  const targets = subs.filter((s) => wantsOrder(byId.get(s.user_id), order))
  const results = await Promise.allSettled(
    targets.map((s) => webpush.sendNotification(s.subscription, payload, { TTL: 600, urgency: 'high' }))
  )

  // A 404/410 means the phone unsubscribed or the app was uninstalled.
  const dead = targets
    .filter((_, i) => [404, 410].includes(results[i].reason?.statusCode))
    .map((s) => s.endpoint)
  if (dead.length) await db.from('dashboard_push_subscriptions').delete().in('endpoint', dead)

  const sent = results.filter((r) => r.status === 'fulfilled').length
  return res.status(200).json({ sent, failed: results.length - sent, removed: dead.length })
}
