# Stripe billing (Phase 2) — local end-to-end

Stripe account `acct_1TmjWnLxa6vDjBaw` (TEST). Product `prod_UmIJxGWvHoowXC`;
prices `price_1Tmjij…` ($8/mo) and `price_1Tmjik…` ($72/yr). Keys + price IDs are
in the gitignored `supabase/.env`.

## One-time

1. Apply migrations (local stack): `supabase stop && supabase start` (re-applies
   `0001`–`0003`) or `docker exec -i supabase_db_wisper psql -U postgres -d postgres < supabase/migrations/0003_billing.sql`.
2. Stripe CLI login (once): `stripe login`.

## Run the loop

1. Serve the Edge Functions with the env file:
   ```
   supabase functions serve --no-verify-jwt --env-file supabase/.env
   ```
   (The app passes the user JWT; the functions identify the user from it. `--no-verify-jwt`
   lets the function read the header itself.)
2. Forward Stripe webhooks to the local webhook function and capture the signing secret:
   ```
   stripe listen --forward-to http://127.0.0.1:54321/functions/v1/stripe-webhook
   ```
   Copy the printed `whsec_…` into `supabase/.env` as `STRIPE_WEBHOOK_SECRET`, then
   restart `supabase functions serve`.
3. Run the app (`pnpm tauri dev` or the installed build), open **Account → Plans and
   Billing**, pick Annual (default) → **Upgrade**. Complete checkout with the Stripe
   test card `4242 4242 4242 4242`, any future expiry/CVC.
4. Stripe fires `checkout.session.completed` + `customer.subscription.created` →
   the webhook sets `profiles.plan = 'pro'` → Realtime flips the app to Pro
   (the limits lift, the Pro card with **Manage subscription** appears).
5. Verify: `docker exec supabase_db_wisper psql -U postgres -d postgres -tAc "select email, plan, stripe_subscription_status from public.profiles;"` → `pro`.
6. **Manage subscription** → cancels in the portal → `customer.subscription.deleted`/
   `updated` → plan returns to `free`.
