-- Per-user profile, 1:1 with auth.users. `plan` is the monetization seam:
-- default 'free', writable ONLY by the service role (RLS below blocks clients).
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text,
  full_name   text,
  avatar_url  text,
  plan        text not null default 'free',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Auto-create a profile row whenever a new auth user signs up. Runs as the
-- definer (postgres), so it bypasses RLS to seed the row.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Row Level Security: a user may READ only their own profile, and UPDATE only
-- their own name/avatar. `plan` is intentionally NOT updatable by clients — the
-- WITH CHECK clause forbids changing it, so a user can never grant themselves a
-- paid plan. Plan changes happen via the service role (future Stripe webhook).
alter table public.profiles enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
  on public.profiles for select
  using (auth.uid() = id);

drop policy if exists "profiles_update_own_no_plan" on public.profiles;
create policy "profiles_update_own_no_plan"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id and plan = (select p.plan from public.profiles p where p.id = auth.uid()));
