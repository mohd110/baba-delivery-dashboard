-- ============================================================================
-- Phone push notifications for new orders (dashboard side).
--
-- Run this once in the Supabase SQL editor, AFTER add-outlet-staff.sql.
-- Safe to re-run.
-- ============================================================================
--
-- Each phone/browser that allows notifications on the dashboard stores one
-- row here, filed under the login that's signed in on it. When an order is
-- placed, api/new-order-push.js (on Vercel, called by a Supabase Database
-- Webhook on orders INSERT) reads these rows with the service role and pushes
-- to every login that should hear about that order:
--   * the owner/admins, and staff with no outlet  -> every order
--   * staff tied to an outlet                      -> that outlet's orders only
--   * only logins that can open Active Orders, and are still active.
--
-- Separate from the customer app's push_subscriptions table on purpose:
-- customers and staff are different audiences with different rules.

create table if not exists public.dashboard_push_subscriptions (
  -- The push service URL is unique per browser install, so it's the key: one
  -- phone = one row, whoever last signed in on it.
  endpoint     text primary key,
  user_id      uuid not null references auth.users(id) on delete cascade,
  subscription jsonb not null,
  user_agent   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists dashboard_push_subscriptions_user_idx
  on public.dashboard_push_subscriptions (user_id);

alter table public.dashboard_push_subscriptions enable row level security;

-- A login can see and remove its own devices (sign-out deletes the row).
drop policy if exists "dashboard push: own rows" on public.dashboard_push_subscriptions;
create policy "dashboard push: own rows" on public.dashboard_push_subscriptions
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "dashboard push: delete own" on public.dashboard_push_subscriptions;
create policy "dashboard push: delete own" on public.dashboard_push_subscriptions
  for delete to authenticated using (user_id = auth.uid());

-- Saving goes through this function rather than a plain insert policy: when a
-- phone changes hands (owner signs out, a staffer signs in) the existing row
-- belongs to someone else, and RLS would refuse to re-file it.
create or replace function public.save_dashboard_push(p_subscription jsonb, p_user_agent text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.is_dashboard_staff() then
    raise exception 'Only dashboard logins can register for order notifications';
  end if;
  if p_subscription->>'endpoint' is null then
    raise exception 'Subscription has no endpoint';
  end if;

  insert into public.dashboard_push_subscriptions (endpoint, user_id, subscription, user_agent)
  values (p_subscription->>'endpoint', auth.uid(), p_subscription, p_user_agent)
  on conflict (endpoint) do update
    set user_id      = excluded.user_id,
        subscription = excluded.subscription,
        user_agent   = excluded.user_agent,
        updated_at   = now();
end;
$$;

revoke all on function public.save_dashboard_push(jsonb, text) from public;
grant execute on function public.save_dashboard_push(jsonb, text) to authenticated;
