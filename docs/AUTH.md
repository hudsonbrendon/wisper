# Authentication & accounts

Wisper accounts are **optional**: the app is fully functional logged out. Login
exists to enable future per-plan features.

## Stack
- **Supabase** (Postgres + Auth + RLS) — see `supabase/README.md` for setup.
- **Desktop OAuth (PKCE + loopback)** — no client secret on the device.
- **Sessions in the OS keychain** via Rust `secure_*` commands (`keyring` crate).

## Login flow
1. UI calls `signInWithGoogle()` (`src/lib/auth.ts`).
2. Rust `start_oauth_server` binds an ephemeral `127.0.0.1:<port>` and returns the port.
3. `supabase.auth.signInWithOAuth({ provider: "google", redirectTo, skipBrowserRedirect })`
   yields the Google authorize URL; the system browser opens it.
4. Google → Supabase callback → redirect to `http://127.0.0.1:<port>/?code=...`.
5. The loopback emits `oauth://url`; the app extracts `code` and calls
   `exchangeCodeForSession(code)`. Session is persisted to the keychain.

## Plans & gating (the monetization seam)
- Each user has a `profiles.plan` row, default `free`, server-authoritative (RLS
  blocks clients from changing it).
- `src/lib/entitlements.ts` maps `(plan, feature) -> boolean`. **Today every
  feature is allowed.** To gate a feature: set its `free` value to `false` in
  `MATRIX`, then call `useEntitlements().can("feature")` at the UI/command site.
- To charge: add Stripe, and a Supabase Edge Function webhook that writes
  `profiles.plan` with the service role on subscription events.

## Manual smoke test (requires a configured Supabase project + `.env`)
1. `pnpm tauri dev`.
2. Sidebar → Account → "Continue with Google" → complete consent in the browser.
3. App returns to the Account screen showing your email + "free plan".
4. Quit and relaunch → still signed in (session restored from keychain).
5. "Sign out" → returns to the logged-out state; relaunch confirms it's cleared.
