# Handoff — New DB fields for the customer app

**From:** dashboard
**What this covers:** columns / tables the dashboard now writes that the customer
app should read. Nothing here removes or renames existing columns.

---

## 1. Restaurant "closed reason" — `public.restaurants`

Two new columns:

| Column | Type | Meaning |
|---|---|---|
| `closed_reason` | `text` | The staff-chosen reason shown when the outlet is switched **off manually** during opening hours. e.g. `"Nearing closing time"`, `"Raw material / Items out of stock — ran out of mutton"`. **`NULL` when the outlet is open.** |
| `closed_note` | `text` | Optional free-text detail the manager typed. (It's also appended onto `closed_reason`, so you usually only need `closed_reason`.) `NULL` when open. |

SQL that created them:

```sql
alter table public.restaurants
  add column if not exists closed_reason text,
  add column if not exists closed_note   text;
```

### How to use it
You already derive open/closed from `opening_time`, `closing_time`, `is_open`
(see your own open/closed handoff — **clock wins, then the switch**):

- Reason **`manual`** (`is_open = false` *during* opening hours): show
  `closed_reason` as the banner message if it's present; fall back to your
  default "Temporarily Closed" wording if it's `NULL`.
- Reason **`hours`** (outside opening hours): **ignore** `closed_reason` — that's
  just the normal schedule, use your "Opens at HH:MM" message.

The dashboard sets `closed_reason` when staff go offline and clears it back to
`NULL` when they re-open, so a non-null value always means a live manual close.

---

## 2. Promo banners — new table `public.banners`

For the customer-app promo carousel. Managed from the dashboard's **Banners** page.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK |
| `image_url` | `text` | **Public URL** in the `banner-photos` bucket. Never base64. |
| `title` | `text` | nullable |
| `subtitle` | `text` | nullable |
| `link_url` | `text` | nullable — optional tap target for the banner |
| `is_active` | `boolean` | **only show `true`** |
| `sort_order` | `integer` | carousel order, ascending |
| `created_at` | `timestamptz` | |

Query for the carousel:

```sql
select image_url, title, subtitle, link_url
from public.banners
where is_active = true
order by sort_order asc, created_at desc;
```

RLS: public read is enabled, so the anon key can select. Realtime is enabled on
the table if you want live updates.

---

## 3. Storage buckets — all images are plain public URLs

| Bucket | Used by | Contents |
|---|---|---|
| `menu-photos` | `products.photo_url` | Dish photos. Now saved as square JPEGs (the dashboard bakes the manager's crop/zoom on upload), so you can display them at any aspect without further processing. |
| `banner-photos` | `banners.image_url` | Promo banner images. |

Both buckets are public. **Every image/photo column now holds a short public
bucket URL — there is no base64 stored in the database anywhere.** If you still
have old rows with a `data:` URL in `products.photo_url` from before this change,
they can be nulled out safely (the app falls back to a placeholder):

```sql
update public.products set photo_url = null where photo_url like 'data:%';
```

---

## 4. Per-outlet dish availability — new table `public.product_outlet_availability`

**This is the one item in this document that needs a code change on your side.**
Until you make it, both outlets keep showing the same availability.

The menu itself is still chain-wide: one `products` row per dish, one name, one
photo, one price, at every outlet. `products` still has **no** `restaurant_id`
and no dish is duplicated. What is now per-outlet is only whether a dish is
**being served right now** — Kidwai Nagar runs out of mutton, Swaroop Nagar
hasn't.

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

### The rule

`products.is_available` is the chain-wide **default**. A row in this table is an
**override** for one outlet. No row = that outlet follows the default.

> **The row wins, not the value.** An override saying `true` keeps a dish on at
> that outlet even while the chain-wide default is `false`, and it carries its
> own `next_available_at`. Do **not** `coalesce()` the two columns independently
> — `coalesce(a.next_available_at, p.next_available_at)` is wrong, because it
> resurrects the chain-wide comeback time for an outlet that is happily serving
> the dish.

```
availability of dish D at outlet X
  = row (D, X) exists ? that row's (is_available, next_available_at)
                      : products' (is_available, next_available_at)
```

### The easy way to read it

Don't reimplement that rule — there's an RPC that returns the menu with exactly
the shape of `products`, already resolved for one outlet:

```js
// was: supabase.from('products').select('*')
const { data } = await supabase.rpc('menu_for_outlet', { outlet: restaurantId })
```

Same columns, same types, same `sort_order`, so ordering/filtering/rendering code
downstream is untouched — `is_available` and `next_available_at` just now mean
"at this outlet". Passing `null` returns the chain-wide defaults (today's
behaviour), which is a safe fallback if no outlet is chosen yet.

If you'd rather keep your own query, join it yourself:

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

### Notes

* **Nothing was back-filled.** The table starts empty, and an empty table means
  every outlet follows the chain-wide flag — i.e. exactly what you do today. You
  can ship your change before or after the restaurant starts using the feature.
* **A new dish is on everywhere** until someone turns it off at a branch; no row
  is created when a dish is added.
* RLS: public read (the anon key can select it), writes are dashboard-only.
  Realtime is enabled, so you can subscribe if your menu screen is live.
* The customer must have picked an outlet before you can resolve availability.
  If your flow shows a menu before that, use the chain-wide default (`outlet:
  null`) and re-resolve once they choose.

Created by `add-outlet-menu-availability.sql` in the dashboard repo, which also
contains the SQL for `menu_for_outlet` and a "how to check it worked" query.

---

## 5. Unchanged

No existing columns were renamed or dropped. `products.category` slugs are also
unchanged (`biryani`, `fry`, `gravy`, `tandoor`, `kebabs`, `breads`, `dessert`,
`other`, plus new `veg` / `combos`) — only their **display names** changed in the
dashboard, so existing dishes stay categorised.
