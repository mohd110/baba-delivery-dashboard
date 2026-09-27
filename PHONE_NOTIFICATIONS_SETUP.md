# Phone notifications for new orders: one-time setup

While the dashboard is open, it already rings and shows a notification for each new order.
To reach a phone when the app is **closed or the screen is locked**, the server has to send a
push notification. That needs the four steps below, done once.

## 1. Run the SQL

In the Supabase SQL editor, run `add-dashboard-push.sql`. This creates the
`dashboard_push_subscriptions` table and the `save_dashboard_push` function.

## 2. Add environment variables in Vercel

Go to Vercel → the dashboard project → Settings → Environment Variables. Add every line from
`push-keys.env.local`, which is in the project folder and is not committed to git:

| Name | Where it comes from |
|---|---|
| `VITE_VAPID_PUBLIC_KEY` | `push-keys.env.local` |
| `VAPID_PRIVATE_KEY` | `push-keys.env.local` (keep this secret) |
| `VAPID_SUBJECT` | `push-keys.env.local` |
| `PUSH_WEBHOOK_SECRET` | `push-keys.env.local` |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API → `service_role` key |

`VITE_SUPABASE_URL` should already be set. Redeploy after adding the variables. Once they are
in Vercel, delete `push-keys.env.local`.

## 3. Create the database webhook

In Supabase, go to Database → Webhooks → Create a new hook:

- **Table:** `orders`, **Events:** `Insert`
- **Type:** HTTP Request, **Method:** `POST`
- **URL:** `https://<your-dashboard-domain>/api/new-order-push`
- **HTTP headers:** add `x-webhook-secret` = the `PUSH_WEBHOOK_SECRET` value

## 4. On each phone

Sign in to the dashboard. The **Set up this phone** sheet appears. Tap **Allow notifications**,
then add the app to the home screen. You can reopen the sheet any time from the 📱 icon in the
phone header.

- **Android (Chrome):** works in the browser and in the home-screen app.
- **iPhone:** notifications only work from the home-screen app, on iOS 16.4 or later. Add the
  app to the home screen first, open it from there, and allow notifications there.

## Who gets notified

- Admins, and staff with no outlet: every new order.
- Staff tied to an outlet: only that outlet's orders.
- Only logins with the Active Orders permission that are still active.
- Signing out stops notifications on that phone.

## Checking it works

Place a test order. In Supabase → Database → Webhooks → the hook's logs, the response should
look like `{"sent":1,...}`. If you see `401`, the secret doesn't match. If you see `500 Push is
not configured`, one of the Vercel variables is missing.
