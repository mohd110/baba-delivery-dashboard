-- Prep/ready timer anchor: record when the kitchen accepted an order.
-- Run this once in the Supabase SQL editor.
--
-- The ready countdown must start when the restaurant ACCEPTS the order (and
-- picks a prep time), not when the order was received. Otherwise time an order
-- spends waiting in the "New" tab eats into the prep clock. The dashboard stamps
-- accepted_at = now() on accept and counts eta_minutes forward from it.
--
-- Orders accepted before this column existed have accepted_at = NULL; both the
-- dashboard and the customer app should fall back to created_at in that case.
--
-- CUSTOMER APP: anchor the "Ready in X min" ETA on accepted_at + eta_minutes
-- (fall back to created_at when accepted_at is NULL), so the customer's ETA and
-- the dashboard countdown always agree, e.g.
--   const anchor = order.accepted_at ?? order.created_at
--   const readyBy = new Date(anchor).getTime() + order.eta_minutes * 60000

alter table public.orders
  add column if not exists accepted_at timestamptz;
