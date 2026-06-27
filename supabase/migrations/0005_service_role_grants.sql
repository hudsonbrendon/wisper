-- The Edge Functions use the service role to read/write profiles (link the
-- Stripe customer, flip the plan from the webhook). On Supabase Cloud the
-- service role has these by default; a self-hosted/local stack may not — grant
-- them explicitly so billing works everywhere. (RLS does not apply to the
-- service role; these are table privileges only.)
grant select, insert, update on public.profiles to service_role;
grant select, insert on public.usage_events to service_role;
