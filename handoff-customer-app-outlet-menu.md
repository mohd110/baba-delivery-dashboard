# Handoff — per-outlet dish availability

**From:** dashboard
**Status:** the dashboard side is built. **This is the one change needed on the
customer app.** Until it ships, both outlets show customers the same
availability.
**Nothing is renamed or dropped.** One new table, one new RPC. Your existing
`products` query keeps working exactly as it does today.

---

## 1. What changed, in one paragraph

The menu is still chain-wide: one `products` row per dish, one name, one photo,
one price, at every outlet. `products` still has **no** `restaurant_id`, and no
dish is duplicated.

What is now per-outlet is only whether a dish is **being served right now**.
Kidwai Nagar runs out of mutton at 9pm; Swaroop Nagar still has it. The
restaurant can now switch a dish off at one branch without taking it off the
other branch's menu.

---

## 2. The new table

```sql
create table public.product_outlet_availability (
  product_id        uuid not null references public.products(id)    on delete cascade,
  restaurant_id     uuid not null references public.restaurants(id) on delete cascade,
  is_available      boolean not null default true,
  next_available_at timestamptz,
  updated_at        timestamptz not null default now(),
  primary key (product_id, restaurant_id)
);
```

| Column | Meaning |
|---|---|
| `product_id` | the dish, → `products.id` |
| `restaurant_id` | the outlet this row is about, → `restaurants.id` |
| `is_available` | is this dish being served **at this outlet** |
| `next_available_at` | when it comes back at this outlet ("off for 2 hrs"). `NULL` while available, or when switched off indefinitely |

RLS: **public read** — the anon key can select it, same as `products`. Writes are
dashboard-only. Realtime is enabled if your menu screen is live.

---

## 3. The rule

`products.is_available` is the chain-wide **default**. A row in the new table is
an **override** for one outlet. No row = that outlet follows the default.

```
availability of dish D at outlet X
  = row (D, X) exists ? that row's (is_available, next_available_at)
                      : products' (is_available, next_available_at)
```

> ### ⚠ The row wins, not the value
>
> An override saying `true` keeps a dish **on** at that outlet even while the
> chain-wide default is `false`, and it carries its own `next_available_at`.
>
> So do **not** coalesce the two columns independently:
>
> ```sql
> -- WRONG
> coalesce(a.next_available_at, p.next_available_at)
> ```
>
> That resurrects the chain-wide comeback time for an outlet that is happily
> serving the dish, and your UI shows "back at 9pm" on something available now.

---

## 4. What to change (the easy way)

Don't reimplement §3. There's an RPC that returns the menu **with exactly the
shape of `products`** — same columns, same types, same `sort_order` — already
resolved for one outlet:

```js
// before
const { data } = await supabase.from('products').select('*')

// after
const { data } = await supabase.rpc('menu_for_outlet', { outlet: restaurantId })
```

That's the whole change. `is_available` and `next_available_at` now mean "at this
outlet"; every bit of ordering, filtering, grouping and rendering downstream is
untouched.

* `outlet: null` returns the chain-wide defaults — i.e. today's exact behaviour.
  Safe fallback if the customer hasn't picked an outlet yet.
* The function runs as the caller (it is deliberately not `security definer`), so
  your existing RLS on `products` still applies — you see the same dishes you see
  today.
* `execute` is granted to `anon` and `authenticated`.

### If you'd rather keep your own query

```sql
select p.*,
       coalesce(a.is_available, p.is_available) as is_available,
       case when a.product_id is null then p.next_available_at
            else a.next_available_at end        as next_available_at
  from public.products p
  left join public.product_outlet_availability a
         on a.product_id = p.id
        and a.restaurant_id = :outlet;
```

In PostgREST that's an embedded select plus the resolution in JS:

```js
const { data } = await supabase
  .from('products')
  .select('*, product_outlet_availability(restaurant_id, is_available, next_available_at)')

const menu = data.map((p) => {
  const o = p.product_outlet_availability?.find((r) => r.restaurant_id === restaurantId)
  return o
    ? { ...p, is_available: o.is_available, next_available_at: o.next_available_at }
    : p                                   // no row → the chain-wide default
})
```

---

## 5. Things worth knowing

* **Nothing was back-filled.** The table starts empty, and empty means every
  outlet follows the chain-wide flag — exactly what you do today. You can ship
  your change before, with, or after the restaurant starts using the feature.
* **A new dish is on everywhere.** No row is created when a dish is added.
* **Cart / checkout.** A customer can have a dish in their cart from before a
  branch switched it off. Re-check availability for the chosen outlet at
  checkout, the same way you would for a chain-wide switch-off.
* **Switching outlet.** If a customer changes outlet mid-session, re-resolve the
  menu — a dish available at one branch may be off at the other.
* **Ordering matters until you ship.** After the dashboard migration runs but
  before this change lands, a branch switching a dish off writes an override and
  leaves `products.is_available` alone — so the unchanged customer app keeps
  showing that dish as available at **both** outlets. That's the window this
  change closes. Tell the dashboard team when you're live and they'll sequence
  the migration around it.

---

## 6. How to check it works

Pick a dish, switch it off at one outlet from the dashboard, then:

```sql
-- the raw override
select p.name, p.is_available as chain_wide, a.is_available as at_this_branch
  from public.products p
  left join public.product_outlet_availability a on a.product_id = p.id
 where a.restaurant_id = '<outlet id>';

-- what your app will now see, per outlet
select name, is_available from public.menu_for_outlet('<outlet A>') order by name;
select name, is_available from public.menu_for_outlet('<outlet B>') order by name;
```

The dish should read `false` at the outlet it was switched off at and `true` at
the other one.

---

Created by `add-outlet-menu-availability.sql` in the dashboard repo, which also
contains the SQL for `menu_for_outlet` and the same "how to check it" queries.
