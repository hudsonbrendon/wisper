-- Stripe linkage for billing. Written only by the service role (the webhook);
-- clients can read their own row (existing profiles_select_own policy) but
-- column-level privileges (see 0004_lock_profile_columns.sql) block client
-- writes to these columns.
alter table public.profiles
  add column if not exists stripe_customer_id text,
  add column if not exists stripe_subscription_status text,
  add column if not exists current_period_end timestamptz;

create index if not exists profiles_stripe_customer_idx
  on public.profiles (stripe_customer_id);

-- Realtime: let the app receive UPDATE events on its own profile row so the
-- plan flips the instant the webhook writes it. RLS still scopes which rows a
-- client may see, so a user only ever receives their own updates.
alter publication supabase_realtime add table public.profiles;
