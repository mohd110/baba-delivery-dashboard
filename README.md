# React + Vite

## Environment variables

Put these in `.env.local` for local dev, and in the Vercel project settings for
production (Vite only exposes variables prefixed with `VITE_`):

```
VITE_SUPABASE_URL=https://<project>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon key>
VITE_GOOGLE_MAPS_KEY=<same Google Maps key the rider/customer app uses>
```

`VITE_GOOGLE_MAPS_KEY` is the dashboard's copy of the rider app's
`NEXT_PUBLIC_GOOGLE_MAPS_KEY` — same key, same Google Cloud project, so live
tracking costs stay on one bill. The key's **HTTP referrer restrictions must
include this dashboard's domain** (and `localhost` for dev) or Google will
refuse to serve the map. Required APIs: *Maps JavaScript API*.

Without the key the dashboard still works — the map buttons fall back to the
plain "open in Google Maps" links they used before.

## Staff logins & permissions

The restaurant owner can create extra dashboard logins and choose, per user,
which pages and actions they get. Run `add-staff-permissions.sql` once in the
Supabase SQL editor, then use **Users & Permissions** (sidebar → Administration,
or the shield icon on the profile card — owner only).

* Every login that exists when the migration runs becomes an **owner/admin**:
  all pages, and the only role that can manage other logins.
* A **staff** login sees only what's ticked. Unticked pages vanish from their
  sidebar and are refused if they type the URL; unticked actions don't render.
* Permissions can be changed at any time and apply immediately — the staffer's
  open tab picks it up without signing out.

### Which outlet a login belongs to

Run `add-outlet-staff.sql` after the customer app's `022_multi_outlet.sql` and
`023_restaurants_insert.sql`. It adds `profiles.restaurant_id`:

* **null** — every outlet. The owner/super-admin: sees all orders, is alerted
  for all of them, and gets an outlet dropdown in the topbar of Active Orders,
  Order History, Overview, Reporting, Complaints, Settings and Outlets. The
  choice follows them from page to page.
* **an outlet id** — that outlet only, chosen when the login is created. Their
  board, history, reports, complaints, sidebar badges and new-order alarm are
  filtered to it, and the open/closed switch acts on their branch alone. They
  see a locked chip instead of the dropdown.

Outlets live in `public.restaurants` — the same rows the customer app reads — so
an outlet added on the Outlets page (owner only) appears in the customer's
picker immediately. Retire one by unticking "Visible to customers"; never delete
the row, or its orders lose the branch that cooked them.

**The menu is shared across outlets.** `products` carries no `restaurant_id`, so
every branch serves the same dishes at the same prices — per-outlet menus would
be a schema change, not a setting.

`src/lib/permissions.js` is the single registry. Adding an entry there is what
puts a new permission on the Users page, in the sidebar and in the route guard;
`profiles.permissions` is a free-form jsonb array of those keys, so no further
migration is needed. Anything a staff login must not be able to do straight
from the API also needs a guard in `add-staff-permissions.sql` — the ones for
opening/closing the restaurant, re-assigning riders, cancelling orders and
granting permissions are already there.

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.
