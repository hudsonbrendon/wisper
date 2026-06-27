-- The webhook flips plan by matching profiles.stripe_customer_id. The Phase-1
-- RLS only pins `plan`, so without column-level privileges a client could set
-- its own stripe_customer_id to a paying customer's id and get flipped to Pro.
-- Restrict client UPDATEs to non-billing columns; plan + all stripe_* columns
-- are written only by the webhook (service role).
revoke update on public.profiles from authenticated;
grant update (full_name, avatar_url) on public.profiles to authenticated;
-- Ensure read access (RLS still scopes to the owner's row).
grant select on public.profiles to authenticated;
