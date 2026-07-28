-- Wisper is free and open source: remove the paid tier entirely. Drops the
-- Stripe linkage columns, the `plan` column, and the usage metering table and
-- RPC. Accounts (auth.users + public.profiles) are unaffected.

drop function if exists public.current_usage();
drop table if exists public.usage_events;

-- 0001's update policy checks that `plan` is unchanged, so it depends on the
-- column and blocks dropping it. Replace it with a plain own-row check before
-- dropping the column; 0004's column-level grant (full_name, avatar_url only)
-- still governs what a client may actually write.
drop policy if exists "profiles_update_own_no_plan" on public.profiles;
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

alter table public.profiles
  drop column if exists stripe_customer_id,
  drop column if exists stripe_subscription_status,
  drop column if exists current_period_end,
  drop column if exists cancel_at_period_end,
  drop column if exists plan;

-- 0004 revoked blanket UPDATE and re-granted only (full_name, avatar_url),
-- which is still exactly what a client needs — nothing to re-grant here.

-- 0003 published profiles to `supabase_realtime` only so the client saw the
-- plan flip live. No plan, no reason to stream profile rows. `alter publication
-- ... drop table` has no `if exists`, so guard the re-run / never-added case.
do $$
begin
  if exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'profiles'
  ) then
    alter publication supabase_realtime drop table public.profiles;
  end if;
end $$;
