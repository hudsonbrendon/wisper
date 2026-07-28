# Authentication & accounts

Wisper is free and open source — there are no paid plans. A Google account is
used to sign in so history and meetings are scoped to you. Sign-in is required
for dictation and meetings when the app is built with Supabase credentials, and
skipped entirely when it isn't.

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

## Sign-in gate

- The webview pushes the session state to Rust via `setSignedIn()`
  (`src/lib/api.ts` → `set_signed_in` in `src-tauri/src/signin.rs`), stored in
  `AppState.signed_in`.
- `src-tauri/src/lib.rs` checks that flag before injecting a dictation and
  before starting a meeting; when it's false it emits `signin_required` and
  `src/components/SignInModal.tsx` shows the Google prompt.
- Builds without `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` push `true`, so
  a fork with no backend is fully usable.

## Manual smoke test (requires a configured Supabase project + `.env`)

1. `pnpm tauri dev`.
2. Sidebar → Account → "Continue with Google" → complete consent in the browser.
3. App returns to the Account screen showing your name and email.
4. Quit and relaunch → still signed in (session restored from keychain).
5. "Sign out" → returns to the logged-out state; relaunch confirms it's cleared.
