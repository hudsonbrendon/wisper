# Monetization — Subscription Limits (Stripe) Design

**Date:** 2026-06-26
**Status:** Approved (design) — pending implementation plan
**Builds on:** User accounts + Google login (PR #42 / `feat/user-accounts-google-login`). That feature already provides Supabase auth, `profiles.plan` (server-authoritative via RLS), the `entitlements` seam, and `useEntitlements`. This design "turns on" that seam and plugs in Stripe.

## Goal

Introduce a paid **Pro** subscription that lifts two weekly free-tier limits, billed through Stripe. Keep all audio/transcription processing 100% local — the account exists only for identity, usage metering, and billing.

## Locked Decisions

- **Gating model:** metered usage (not pure feature-tiering), two weekly metrics.
- **Free limits:** 2,000 dictation words/week + 2 meeting transcriptions/week.
- **Pro:** unlimited on both metrics.
- **Pricing:** $8/month and $72/year (2 months free). No lifetime option.
- **Account required:** a free Google account is mandatory to use dictation + meetings. Login is gated in onboarding; logged-out = cannot use those features.
- **Source of truth:** server-authoritative usage (Supabase). The desktop app enforces from a local cache for instant UX and reconciles with the server.
- **Weekly reset:** fixed weekly window, **Monday 00:00 UTC** (no per-user timezone stored; may be localized later).
- **Limit-reached behavior:** block the _next_ action (a dictation already in progress finishes and is injected; the next one is blocked). Meetings block before the 3rd recording starts. Both surface an upgrade prompt.

## Architecture Overview

```
┌─────────────── Wisper desktop (Tauri) ───────────────┐        ┌──────── Supabase ────────┐
│  React webview (always alive, hidden in tray)         │        │  Postgres                │
│   - supabase-js: auth, load usage, record usage,      │◀──────▶│   profiles (plan, stripe)│
│     Realtime on profiles row, Stripe checkout/portal  │  REST  │   usage_events (append)  │
│   - pushes {plan, remaining_words, remaining_meetings}│  +RT   │  Edge Functions (Deno)   │
│     to Rust via set_entitlements                      │        │   create-checkout-session│
│                                                       │        │   create-portal-session  │
│  Rust backend                                         │        │   stripe-webhook ────────┼──▶ writes plan
│   - cached quota; enforces on dictation (inject)      │        └──────────────────────────┘
│   - emits usage_consumed / quota_blocked              │                    ▲
└───────────────────────────────────────────────────────┘                    │ webhook (signed)
                                                                       ┌──────┴──────┐
                                                                       │   Stripe    │
                                                                       └─────────────┘
```

The React webview is the single bridge to Supabase (reuses the existing `supabase-js` layer — no second Supabase client in Rust). Rust holds an enforcement cache and gates dictation because injection lives in Rust.

---

## Section 1 — Usage Data Model & Weekly Reset

### `usage_events` (new table, append-only)

| column       | type                                    | notes                                  |
| ------------ | --------------------------------------- | -------------------------------------- |
| `id`         | uuid pk default gen_random_uuid()       |                                        |
| `user_id`    | uuid → auth.users(id) on delete cascade |                                        |
| `metric`     | text                                    | `'dictation_words'` \| `'meeting'`     |
| `amount`     | int                                     | words for a dictation; `1` per meeting |
| `created_at` | timestamptz default now()               |                                        |

- Index on `(user_id, created_at)` for the weekly-sum query.
- **RLS:** a user may `select` and `insert` only rows where `user_id = auth.uid()`. **No** `update`/`delete` policy (append-only — a client cannot zero its counter).
- **Weekly usage = sum** of events with `created_at >= date_trunc('week', now() at time zone 'utc')` (Postgres `week` truncation starts Monday). Reset is **implicit** — no cron job; the window is just a query filter.

### `current_usage()` function (Postgres, `security invoker`)

Returns the calling user's current-week totals: `{ dictation_words int, meetings int }`. Used by the app to compute remaining quota. Runs as the caller, so RLS already scopes it to their own rows.

### `profiles` additions (extends the table from PR #42)

Add columns: `stripe_customer_id text`, `stripe_subscription_status text`, `current_period_end timestamptz`. `plan` stays the existing server-authoritative column (`'free'` default, RLS blocks client writes); only the webhook (service role) flips it.

---

## Section 2 — Enforcement Flow (cache-first, offline-tolerant)

**Principle:** dictation must feel instant — no network round-trip per action. The app decides from a local cache; the server reconciles behind the scenes.

**Responsibility split:**

- **React webview** (always alive, even hidden in tray) is the Supabase bridge: loads plan + weekly usage, records usage, subscribes to Realtime, and runs Stripe checkout/portal.
- **Rust** holds a cached counter and enforces at dictation time (because text injection is Rust-side).

**Dictation:**

1. On launch, periodically, and after each consume, the React side loads `plan` + `current_usage()` from Supabase, computes remaining, and pushes to Rust: `set_entitlements({ plan, remaining_words, remaining_meetings })`.
2. When transcription finishes (Rust), count the words. If `plan == free` and `remaining_words <= 0`: **do not inject**; emit `quota_blocked("dictation")` (React shows the upgrade modal). Otherwise inject, decrement the local cache, emit `usage_consumed({ metric: "dictation_words", amount: N })`.
3. React receives `usage_consumed` → inserts into `usage_events`. The "finish current, block next" rule is automatic: we check `> 0` before (allow), the counter goes to ≤ 0, and the next dictation hits the block.

**Meetings** (started from React): before invoking `start_meeting`, React checks `remaining_meetings`; if `plan == free` and `<= 0` → upgrade modal, do not start. Otherwise start, and record the `meeting` event at **start** (so a started-then-cancelled meeting still counts — no gaming).

**Offline:**

- The Rust cache keeps enforcing from the last known remaining → offline also blocks once remaining hits 0.
- `usage_events` inserts that fail (no network) go to a **local queue** and flush when back online; the server then reconciles the true total (if exceeded, remaining goes negative → blocked).
- Grace: stale cache + no network → allow, but everything is counted later. Not unlimited-offline-forever.

**Pro path:** `plan == pro` → skip all metering everywhere (Rust check and React pre-checks short-circuit to allow).

**Spoofing caveat (accepted):** the client reports its own word counts, so it is theoretically under-reportable. For a free-tier limit this is acceptable; server-side audio verification is not worth the complexity. `plan == pro` itself is tamper-proof (server-set via RLS + webhook).

---

## Section 3 — Stripe Integration

The Stripe secret never enters the app. All server-side logic lives in **Supabase Edge Functions** (Deno), which hold the service role and are the **only** writer of `profiles.plan`.

**Edge Functions:**

1. `create-checkout-session` — called authenticated from the app (`supabase.functions.invoke`). Creates a Stripe Checkout Session for the chosen Pro price (monthly or annual), creating/reusing the user's `stripe_customer_id`. Returns the Checkout URL; the app opens it via `openUrl` (system browser).
2. `create-portal-session` — creates a Stripe Customer Portal session for the user's customer; returns URL; app opens in browser (manage/cancel).
3. `stripe-webhook` — receives Stripe events with **signature verification**. On `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted` → updates `profiles.plan` (`'pro'` when active, `'free'` when canceled/expired) plus `stripe_subscription_status` / `current_period_end`. **Idempotent.** This is the source of truth for plan.

**Plan-change propagation:** the React app subscribes to its own `profiles` row via **Supabase Realtime**. When the webhook flips `plan` to `'pro'`, the app unlocks instantly (dismisses the upgrade modal, lifts limits) — no polling.

**User flow:**

- Upgrade modal (limit reached) or Account screen → **Monthly $8 / Annual $72** buttons → checkout in browser → pay → Realtime updates → Pro unlocked.
- After payment the browser lands on a simple hosted `success_url` page ("Payment complete — return to Wisper"); the app does not depend on it.
- Pro users see **"Manage subscription"** on the Account screen → Customer Portal.

**Stripe config:** one Product "Wisper Pro" with two Prices (monthly $8, annual $72). Secrets (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`) live in Edge Function secrets, never in the app bundle.

---

## Section 4 — App UX Changes

**1. Onboarding login gate** (`src/routes/Onboarding.tsx`): a mandatory "Sign in with Google" step early in the wizard (before hotkey config). Onboarding cannot complete without a session. To cover users who onboarded before accounts existed (they log out on update), the dictation/meeting paths also check "is there a session?" — no session → blocked with a sign-in prompt. Dual gate: onboarding (first run) + session check (use time).

**2. Upgrade modal** (`src/components/UpgradeModal.tsx`, new): triggered by the `quota_blocked` event (dictation) or the meeting pre-check. Shows the reached metric, the Pro pitch, and Monthly $8 / Annual $72 buttons → checkout. Reused from the Account screen.

**3. Usage indicator:** Account screen shows the plan badge + weekly usage bars ("1,240 / 2,000 words · 1 / 2 meetings"). Home shows a discreet banner only when near the limit (≥ 80%). The overlay/pill briefly shows a "limit reached" state when it blocks.

**4. Account screen** (`src/routes/Account.tsx`, extend the existing one): Free → "Free" badge + weekly usage + Upgrade (monthly/annual). Pro → "Pro" badge + Manage subscription (portal) + "renews on {date}".

**5. Entitlements layer** (`src/lib/entitlements.ts` + `authContext`): extend from plan→feature boolean to include **per-plan limits**: free `{ dictation_words: 2000, meetings: 2 }`, pro = unlimited. A usage lib (`src/lib/usage.ts`) computes remaining; `useEntitlements` exposes `remaining` plus the quota checks.

**6. Rust** (`src-tauri/src/commands.rs` + `AppState`): a `set_entitlements` command (caches plan + remaining), the quota check before injecting, and the `usage_consumed` / `quota_blocked` events. One new field in `AppState` plus the command.

---

## Section 5 — Testing

**Frontend (Vitest, mocking `supabase-js` + `invoke`):**

- `usage.ts`: `loadUsage` (server response → remaining), `recordUsage` (insert + cache update + offline queue), `flushQueue`, week-boundary math.
- `entitlements.ts`: per-plan limits, remaining computation, checks (free under/at/over limit; pro unlimited).
- `UpgradeModal`: renders on `quota_blocked`, correct metric, buttons invoke checkout.
- `Account`: free shows usage bars + upgrade; pro shows manage + renewal.
- Onboarding login gate: cannot proceed without a session.
- Realtime: when the `profiles` row flips to `pro`, the context unlocks (mock the subscription).

**Rust (cargo test, pure functions):** the quota-cache logic — `set_entitlements` stores; the check (free remaining > 0 allows, ≤ 0 blocks, pro always allows); word counting; the "finish current, block next" boundary (allow when > 0 even if N crosses 0).

**Edge Functions (Deno test, mocking Stripe + admin client):** `stripe-webhook` (signature verification, idempotency, each event → correct `plan` write); `create-checkout-session` / `create-portal-session` (correct price/customer, returns URL).

**SQL/RLS (verification + script, as in the auth feature's Task 1):** `usage_events` RLS (insert/select own; no update/delete; no cross-user read); the weekly-usage function (insert events across the week boundary, assert sums).

**Local E2E (documented):** local Supabase + Stripe **test mode** + `stripe listen` forwarding the webhook to the local Edge Function. Manual smoke: hit the dictation limit → modal → test-card checkout → webhook flips plan → Realtime unlocks. Documented in `docs/MONETIZATION.md`.

Emphasis: the metering logic (usage lib, entitlements, Rust cache) gets thorough unit tests (the core risk); Stripe/Edge Functions get unit tests plus the documented manual E2E.

---

## Implementation Sequencing

The two halves are separable and should likely be sequenced as two plans (or two phases of one):

1. **Metering + limits + account gate** — `usage_events`, weekly usage, the cache-first enforcement (Rust + React), the onboarding login gate, the usage indicator, and the upgrade modal _shell_ (button can be inert until phase 2). At the end of phase 1, free limits are enforced and everyone is on `free`.
2. **Stripe billing** — the three Edge Functions, the `profiles` Stripe columns, Realtime plan propagation, and wiring the upgrade modal buttons to checkout. At the end of phase 2, users can pay to reach `pro` and the limits lift.

Phase 1 delivers working, testable software on its own (limits enforced); phase 2 turns on payment.

## Out of Scope (YAGNI for now)

- Lifetime license, team/seat plans, student discounts.
- Per-user timezone for the weekly reset (UTC week for v1).
- Server-side audio/word verification (accepted spoofing caveat).
- Usage analytics/dashboards beyond the in-app weekly indicator.
- Proration UI, dunning emails, tax handling beyond Stripe defaults.

## Open Items to Confirm During Planning

- Exact Realtime vs focus-poll fallback if Realtime is unavailable in a given build.
- Where the local offline `usage_events` queue is persisted (Rust config dir vs webview storage) — leaning Rust config dir for durability.
- The hosted `success_url` page location (marketing site vs a minimal Supabase-hosted page).
