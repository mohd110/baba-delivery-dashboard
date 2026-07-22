# Order Timeline — Supabase Columns Handoff

For the **customer panel** developer. The order timeline has 6 checkpoints, each
backed by a `timestamptz` column on the **`orders`** table. Render a step as
"done" when its timestamp is non-null, and show the time from that value.

## The 6 timeline steps → columns

| # | Timeline step | Column (`orders.*`) | Type | Who writes it | Status |
|---|---------------|---------------------|------|---------------|--------|
| 1 | **Placed** | `created_at` | `timestamptz` | DB default on insert (customer app) | ✅ exists |
| 2 | **Accepted** | `accepted_at` | `timestamptz` | **Dashboard** — on "Accept Order" | ✅ exists |
| 3 | **Delivery partner arrived** | `rider_arrived_at` | `timestamptz` | **Rider app** — when rider reaches the outlet | ⚠️ add column + rider app must write |
| 4 | **Ready** | `ready_at` | `timestamptz` | **Dashboard** — on "Mark Ready" | ✅ now written by dashboard |
| 5 | **Picked up** | `picked_up_at` | `timestamptz` | **Rider app** — on pickup (status → `out_for_delivery`) | ⚠️ add column + rider app must write |
| 6 | **Delivered** | `delivered_at` | `timestamptz` | **Rider app** — on delivery (status → `delivered`) | ⚠️ add column + rider app must write |

Note the order in the design: **arrived (3) comes before ready (4)** — the rider
can reach the outlet while the food is still cooking.

### What the dashboard already sends
- `created_at` (1) and `accepted_at` (2) were already stamped.
- `ready_at` (4) is **now** stamped by the dashboard on "Mark Ready".

### What still needs the rider app
`rider_arrived_at` (3), `picked_up_at` (5) and `delivered_at` (6) are events that
happen in the **rider app**, not the dashboard, so the rider app must write them
when it changes the order status. The columns just need to exist.

## SQL — add the missing columns (run once in the Supabase SQL editor)

```sql
alter table orders
  add column if not exists accepted_at      timestamptz,  -- (2) safety: dashboard uses it
  add column if not exists ready_at          timestamptz,  -- (4) dashboard writes this
  add column if not exists rider_arrived_at  timestamptz,  -- (3) rider app writes this
  add column if not exists picked_up_at      timestamptz,  -- (5) rider app writes this
  add column if not exists delivered_at      timestamptz;  -- (6) rider app writes this
```

(`created_at` already exists. `accepted_at`/`ready_at` are stamped by the
dashboard with a graceful fallback, so nothing breaks before the migration — but
the timeline stays blank for those steps until the columns exist.)

## Fetch example (customer panel)

```js
const { data } = await supabase
  .from('orders')
  .select(`
    id, status,
    created_at, accepted_at, rider_arrived_at, ready_at, picked_up_at, delivered_at
  `)
  .eq('id', orderId)
  .single()

const timeline = [
  { label: 'Placed',                  at: data.created_at },
  { label: 'Accepted',                at: data.accepted_at },
  { label: 'Delivery partner arrived',at: data.rider_arrived_at },
  { label: 'Ready',                   at: data.ready_at },
  { label: 'Picked up',               at: data.picked_up_at },
  { label: 'Delivered',               at: data.delivered_at },
]
// a step is "complete" when at != null; show new Date(at) as the time.
```

"Delivered in 14 minutes" = `delivered_at − created_at`.

---

## Full `orders` column reference (everything the panel can fetch)

Selected via `select('*')` today. Types are best-effort from usage.

| Column | Type | Meaning |
|--------|------|---------|
| `id` | uuid | Primary key |
| `customer_id` | uuid | The customer who placed the order |
| `rider_id` | uuid | Assigned rider (FK → `profiles`) |
| `status` | text | `pending` · `preparing` · `ready` · `out_for_delivery` · `delivered` · `cancelled` |
| `payment_status` | text | `pending_verification` · `verified` · `failed` |
| `order_type` | text | e.g. `delivery` / `pickup` |
| `total` | numeric | Order grand total |
| `modified_total` | numeric | Adjusted total when some items were marked unavailable |
| `delivery_fee` | numeric | Delivery / packaging charge |
| `discount_amount` | numeric | Discount applied |
| `coupon_code` | text | Reward / coupon code, if any |
| `eta_minutes` | int | Prep time chosen on Accept; drives "Ready in N min" |
| `unavailable_items` | jsonb/array | order_item ids the restaurant flagged out of stock |
| `delivery_address` | jsonb | `{ name, phone, address, notes }` |
| `cancellation_reason` | text | Reason shown to the customer on cancel |
| `customer_notes` | text | Customer instruction (also seen as `notes` / `special_instructions`) |
| `created_at` | timestamptz | (1) Placed |
| `accepted_at` | timestamptz | (2) Accepted |
| `rider_arrived_at` | timestamptz | (3) Delivery partner arrived *(new)* |
| `ready_at` | timestamptz | (4) Ready *(new)* |
| `picked_up_at` | timestamptz | (5) Picked up *(new)* |
| `delivered_at` | timestamptz | (6) Delivered *(new)* |
| `cancelled_at` | timestamptz | When the order was cancelled |
| `late_since` | timestamptz | Dashboard-only: when a prep timer first went overdue (safe to ignore) |

### Related tables
- **`order_items`** — `id`, `order_id`, `product_id`, `quantity`, `price_at_order`, and joined `products(name, photo_url)`.
- **`profiles`** (rider) — joined via `rider_id`; `full_name`, `phone`.
