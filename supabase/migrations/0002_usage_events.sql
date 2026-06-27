-- Append-only usage log. Weekly limits are computed by summing rows since the
-- start of the current UTC week (Monday 00:00) — no counter to reset, no cron.
create table if not exists public.usage_events (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  metric      text not null check (metric in ('dictation_words', 'meeting')),
  amount      integer not null check (amount >= 0),
  created_at  timestamptz not null default now()
);

create index if not exists usage_events_user_week_idx
  on public.usage_events (user_id, created_at);

-- RLS: a user may read and insert only their own events. No update/delete
-- policy exists, so the log is append-only — a client cannot zero its counter.
alter table public.usage_events enable row level security;

drop policy if exists "usage_select_own" on public.usage_events;
create policy "usage_select_own"
  on public.usage_events for select
  using (auth.uid() = user_id);

drop policy if exists "usage_insert_own" on public.usage_events;
create policy "usage_insert_own"
  on public.usage_events for insert
  with check (auth.uid() = user_id);

-- Base table privileges for the authenticated role. RLS (above) still scopes
-- access to own rows; this GRANT is what lets the role touch the table at all.
-- Append-only: select + insert only (no update/delete), matching the policies.
grant select, insert on public.usage_events to authenticated;

-- Current-week totals for the calling user. `date_trunc('week', ...)` starts on
-- Monday; the trailing `at time zone 'utc'` turns the truncated wall-time back
-- into a timestamptz boundary so the comparison against created_at is correct.
create or replace function public.current_usage()
returns json
language sql
security invoker
stable
as $$
  select json_build_object(
    'dictation_words',
      coalesce(sum(amount) filter (where metric = 'dictation_words'), 0),
    'meetings',
      coalesce(sum(amount) filter (where metric = 'meeting'), 0)
  )
  from public.usage_events
  where user_id = auth.uid()
    and created_at >= (date_trunc('week', (now() at time zone 'utc')) at time zone 'utc');
$$;
