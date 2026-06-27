# Monetization — Phase 1 (metering & limits)

Free tier: **2,000 dictation words/week + 2 meetings/week**. Pro: unlimited.
Billing (Stripe) is Phase 2 — the upgrade buttons are inert here.

## How it works

- `usage_events` (Supabase, append-only, RLS) is the source of truth; `current_usage()`
  sums the current UTC week (Monday 00:00 — implicit reset, no cron).
- The React webview (always alive) loads usage, records consumption (with a localStorage
  offline queue), and pushes `{loggedIn, pro, remainingWords, remainingMeetings}` to Rust
  via `set_entitlements`.
- Rust enforces: it skips text injection / blocks meeting start when over limit or logged
  out, emitting `quota_blocked` (`reason: auth | quota`) and `usage_consumed`.
- A free account is required (mandatory onboarding login step).

## Local smoke test (requires the local Supabase stack + .env, see supabase/README.md)

1. Apply `supabase/migrations/0002_usage_events.sql` (`supabase stop && supabase start` re-applies).
2. `pnpm tauri dev`, complete onboarding (sign in with Google).
3. Dictate until you cross 2,000 words this week → the next dictation is blocked and the
   upgrade modal appears. (To test fast, insert rows directly:
   `insert into usage_events (user_id, metric, amount) values ('<your-uid>', 'dictation_words', 1999);`)
4. Start 2 meetings, then a 3rd → blocked before recording with the upgrade modal.
5. In the SQL editor: `select metric, sum(amount) from usage_events group by metric;` matches the app.
6. Sign out → try to dictate → blocked with the sign-in prompt (`reason: auth`).
