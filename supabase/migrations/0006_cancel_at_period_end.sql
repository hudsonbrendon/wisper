-- Whether the subscription is set to cancel at the end of the current period.
-- The webhook writes it from sub.cancel_at_period_end so the app can show
-- "Cancels on {date}" vs "Renews on {date}". Server-authoritative (service role
-- writes; 0004 column-level grants keep clients out of billing columns).
alter table public.profiles
  add column if not exists cancel_at_period_end boolean not null default false;
