-- Track when an order was cancelled.
-- Run this once in the Supabase SQL editor.
--
-- cancelled_at is stamped to now() whenever an order is cancelled — whether
-- by the manager manually or by the dashboard's 10-minute auto-cancel rule.
-- It lets you measure how long orders waited before being cancelled, filter
-- the order history by cancellation window, and build cancellation-rate reports.
--
-- Orders cancelled before this column existed will have cancelled_at = NULL.
-- Both the dashboard and the customer app should treat NULL as "unknown".
--
-- CUSTOMER APP: you can show the cancellation time on the order detail screen,
-- e.g.  order.cancelled_at ? `Cancelled at ${new Date(order.cancelled_at).toLocaleTimeString()}` : ''
--
-- OPTIONAL — database-level safety net (recommended):
-- The trigger below automatically sets cancelled_at whenever status is flipped
-- to 'cancelled' by ANY client (dashboard, customer app, edge function, etc.),
-- so the timestamp is always consistent even if a client forgets to send it.
--
-- If you don't want the trigger, skip lines 24-35 and rely solely on the
-- dashboard writing cancelled_at in the UPDATE payload (already implemented).

alter table public.orders
  add column if not exists cancelled_at timestamptz;

-- Auto-stamp trigger (optional but recommended):
create or replace function public.stamp_cancelled_at()
returns trigger language plpgsql as $$
begin
  if new.status = 'cancelled' and old.status <> 'cancelled' then
    new.cancelled_at = coalesce(new.cancelled_at, now());
  end if;
  return new;
end;
$$;

drop trigger if exists trg_stamp_cancelled_at on public.orders;
create trigger trg_stamp_cancelled_at
  before update on public.orders
  for each row execute function public.stamp_cancelled_at();
