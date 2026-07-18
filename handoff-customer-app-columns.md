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

## 4. Unchanged

No existing columns were renamed or dropped. `products.category` slugs are also
unchanged (`biryani`, `fry`, `gravy`, `tandoor`, `kebabs`, `breads`, `dessert`,
`other`, plus new `veg` / `combos`) — only their **display names** changed in the
dashboard, so existing dishes stay categorised.
