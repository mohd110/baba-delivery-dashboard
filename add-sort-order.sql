-- Manual menu ordering: add a sort_order column to products.
-- Lower sort_order shows first. Run this once in the Supabase SQL editor.
--
-- After running it, open the dashboard Menu page once: it back-fills sort_order
-- for every existing dish (in the canonical category/DISH_ORDER sequence). From
-- then on, the ▲/▼ arrows in the Actions column reorder dishes and persist the
-- new sort_order to this column.
--
-- CUSTOMER APP: order the menu by this same column so it matches the dashboard,
-- e.g. supabase.from('products').select('*')
--        .order('sort_order', { ascending: true, nullsFirst: false })
-- (keep whatever category grouping the customer app already applies).

alter table public.products
  add column if not exists sort_order integer;

create index if not exists products_sort_order_idx
  on public.products (sort_order);
