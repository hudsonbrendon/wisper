# Monetization Phase 1 — Metering, Weekly Limits & Account Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce the free-tier weekly limits (2,000 dictation words/week + 2 meetings/week) with server-authoritative usage tracking and cache-first enforcement, gate the app behind a free account, and surface usage + an (inert) upgrade prompt — without any Stripe/billing (Phase 2).

**Architecture:** A new append-only `usage_events` table in Supabase is the source of truth; a `current_usage()` SQL function returns the current UTC-week totals. The always-alive React webview is the Supabase bridge: it loads usage, records consumption (with an offline queue), and pushes a compact entitlements snapshot (`{loggedIn, pro, remainingWords, remainingMeetings}`) to the Rust backend via a `set_entitlements` command. Rust enforces at dictation time (it owns text injection) and meeting start, emitting `usage_consumed` / `quota_blocked` events. The frontend reacts to `quota_blocked` with a sign-in prompt (reason `auth`) or an upgrade modal (reason `quota`).

**Tech Stack:** Tauri 2, Rust 2021, React 19 + TypeScript, Vite, Vitest, `@supabase/supabase-js`, Supabase Postgres + RLS.

## Global Constraints

- **Free limits (verbatim):** `dictation_words = 2000`/week, `meeting = 2`/week. **Pro = unlimited.** Source: spec.
- **Weekly reset:** fixed window, **Monday 00:00 UTC** (no per-user timezone). The reset is implicit via the `current_usage()` query filter; there is no cron job.
- **Account required:** a session is required to dictate/record meetings. Logged-out → blocked (reason `auth`).
- **Server is the source of truth** for usage; the app enforces from a local cache for instant UX and reconciles on sync.
- **Limit-reached behavior:** block the _next_ action. A dictation already transcribed is still injected if quota was `> 0` before it; the next one is blocked. Meetings block before the 3rd recording starts.
- **No Stripe in this plan.** The upgrade modal's buttons are inert (Phase 2 wires checkout). Do not add Stripe deps, Edge Functions, or `profiles` Stripe columns here.
- **`plan` stays server-authoritative.** This plan never writes `plan` from the client. It only reads `plan` (via the existing `fetchPlan`) and writes `usage_events`.
- **New UI strings are literal English** (do NOT edit the large `src/lib/i18n.tsx`), consistent with the existing `Account.tsx`.
- **Tests:** Vitest (`pnpm test`) for frontend with `vi.mock` for `@supabase/supabase-js` / `@tauri-apps/api/core` (see `src/lib/auth.test.ts`); inline `#[cfg(test)]` for Rust (`cargo test` from `src-tauri/`). Package manager is `pnpm`.
- **Fail-open at launch:** the Rust entitlements cache defaults to unlimited so a brief startup gap never blocks a real user; the frontend tightens it on mount. When Supabase is not configured, the frontend pushes unlimited (metering disabled) so non-configured builds keep working.

## File Structure

**Supabase:**

- `supabase/migrations/0002_usage_events.sql` (new) — `usage_events` table, RLS, `current_usage()`.

**Rust (`src-tauri/src/`):**

- `entitlements.rs` (new) — `Entitlements` struct, pure decision fns, `set_entitlements` command.
- `lib.rs` (modify) — `mod entitlements;`, `AppState` field + init, dictation guard in `stop_and_insert`, meeting guard in `start_meeting`, register command.
- `commands.rs` (modify) — `AppState` struct field.

**Frontend (`src/`):**

- `lib/entitlements.ts` (modify) — weekly limits + `remainingFor` / `isUnlimited` / `Metric`.
- `lib/usage.ts` (new) — Supabase bridge: `loadUsage`, `recordUsage`, `flushQueue`.
- `lib/usageContext.tsx` (new) — `UsageProvider` + `useUsage`: loads usage, pushes entitlements to Rust, listens to `usage_consumed`, exposes usage + `blocked`.
- `lib/api.ts` (modify) — `setEntitlements` binding.
- `components/UpgradeModal.tsx` (new) — modal shell (inert buttons).
- `components/UsageBanner.tsx` (new) — Home near-limit banner.
- `routes/Account.tsx` (modify) — usage indicator.
- `routes/Onboarding.tsx` (modify) — mandatory login step.
- `routes/Dashboard.tsx` (modify) — mount `UpgradeModal` + `UsageBanner`.
- `App.tsx` (modify) — wrap Dashboard in `UsageProvider` (inside `AuthProvider`).

---

## Task 1: Usage schema — `usage_events` + RLS + `current_usage()`

**Files:**

- Create: `supabase/migrations/0002_usage_events.sql`

**Interfaces:**

- Consumes: `auth.users`, `auth.uid()` (Supabase auth, already present from the accounts feature).
- Produces: table `public.usage_events(id, user_id, metric, amount, created_at)`; RPC `public.current_usage()` returning JSON `{ "dictation_words": <int>, "meetings": <int> }` for the calling user over the current UTC week.

- [ ] **Step 1: Write the migration SQL**

Create `supabase/migrations/0002_usage_events.sql`:

```sql
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
```

- [ ] **Step 2: Apply the migration**

Apply `0002_usage_events.sql` in the Supabase SQL Editor (or `supabase db push` / on the local stack, `supabase stop && supabase start` re-applies migrations).

- [ ] **Step 3: Verify table, RLS, and function**

In the SQL Editor run:

```sql
select tablename from pg_tables where tablename = 'usage_events';
select policyname from pg_policies where tablename = 'usage_events';
select proname from pg_proc where proname = 'current_usage';
```

Expected: `usage_events` returned; two policies (`usage_select_own`, `usage_insert_own`); `current_usage` returned. (No update/delete policy — that's intentional.)

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0002_usage_events.sql
git commit -m "feat(usage): add usage_events table, RLS, and current_usage() function"
```

---

## Task 2: Entitlements limits (`entitlements.ts`)

**Files:**

- Modify: `src/lib/entitlements.ts`
- Create: `src/lib/entitlements.limits.test.ts`

**Interfaces:**

- Consumes: nothing new.
- Produces (added to `src/lib/entitlements.ts`):
  - `export type Metric = "dictation_words" | "meeting"`
  - `export const WEEKLY_LIMITS: Record<Plan, Record<Metric, number>>` (free 2000/2; pro = `Infinity`)
  - `export function isUnlimited(plan: Plan): boolean`
  - `export function remainingFor(plan: Plan, metric: Metric, used: number): number` (returns `Infinity` for pro)
  - existing `Plan`, `DEFAULT_PLAN`, `canUseFeature` unchanged.

- [ ] **Step 1: Write the failing test**

Create `src/lib/entitlements.limits.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { WEEKLY_LIMITS, isUnlimited, remainingFor } from "./entitlements";

describe("weekly limits", () => {
  it("free is capped at 2000 words and 2 meetings", () => {
    expect(WEEKLY_LIMITS.free.dictation_words).toBe(2000);
    expect(WEEKLY_LIMITS.free.meeting).toBe(2);
  });

  it("pro is unlimited on both metrics", () => {
    expect(WEEKLY_LIMITS.pro.dictation_words).toBe(Infinity);
    expect(WEEKLY_LIMITS.pro.meeting).toBe(Infinity);
    expect(isUnlimited("pro")).toBe(true);
    expect(isUnlimited("free")).toBe(false);
  });

  it("remainingFor subtracts used from the free limit, clamped at 0", () => {
    expect(remainingFor("free", "dictation_words", 0)).toBe(2000);
    expect(remainingFor("free", "dictation_words", 1500)).toBe(500);
    expect(remainingFor("free", "dictation_words", 2500)).toBe(0);
    expect(remainingFor("free", "meeting", 2)).toBe(0);
  });

  it("remainingFor is Infinity for pro regardless of usage", () => {
    expect(remainingFor("pro", "dictation_words", 99999)).toBe(Infinity);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/lib/entitlements.limits.test.ts`
Expected: FAIL — `WEEKLY_LIMITS` / `isUnlimited` / `remainingFor` not exported.

- [ ] **Step 3: Implement**

Append to `src/lib/entitlements.ts` (below the existing `canUseFeature`):

```ts
/// The two metered metrics. `dictation_words` accrues by word count per
/// dictation; `meeting` accrues by 1 per started meeting.
export type Metric = "dictation_words" | "meeting";

/// Free-tier weekly caps; Pro is unlimited. The reset window (Monday 00:00 UTC)
/// is enforced server-side by current_usage(); these are just the ceilings.
export const WEEKLY_LIMITS: Record<Plan, Record<Metric, number>> = {
  free: { dictation_words: 2000, meeting: 2 },
  pro: { dictation_words: Infinity, meeting: Infinity },
};

export function isUnlimited(plan: Plan): boolean {
  return WEEKLY_LIMITS[plan].dictation_words === Infinity;
}

/// How much of a metric remains this week. Pro → Infinity. Clamped at 0.
export function remainingFor(plan: Plan, metric: Metric, used: number): number {
  const limit = WEEKLY_LIMITS[plan][metric];
  if (limit === Infinity) return Infinity;
  return Math.max(0, limit - used);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/lib/entitlements.limits.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/entitlements.ts src/lib/entitlements.limits.test.ts
git commit -m "feat(usage): add weekly limits and remaining helpers to entitlements"
```

---

## Task 3: Usage bridge (`usage.ts`)

**Files:**

- Create: `src/lib/usage.ts`
- Create: `src/lib/usage.test.ts`

**Interfaces:**

- Consumes: `getSupabase`, `isSupabaseConfigured` (from `./supabase`); `Metric` (from `./entitlements`).
- Produces:
  - `export interface Usage { dictation_words: number; meetings: number }`
  - `export async function loadUsage(): Promise<Usage>` — flushes the offline queue, then calls the `current_usage` RPC.
  - `export async function recordUsage(userId: string, metric: Metric, amount: number): Promise<void>` — inserts into `usage_events`; on failure enqueues to `localStorage`.
  - `export async function flushQueue(): Promise<void>` — replays queued inserts; stops on the first failure.

- [ ] **Step 1: Write the failing test**

Create `src/lib/usage.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./supabase", () => ({
  getSupabase: vi.fn(),
  isSupabaseConfigured: vi.fn(() => true),
}));

import { getSupabase } from "./supabase";
import { loadUsage, recordUsage, flushQueue } from "./usage";

const QUEUE_KEY = "wisper.usage.queue";

function mockClient(over: Record<string, unknown> = {}) {
  return {
    rpc: vi.fn().mockResolvedValue({
      data: { dictation_words: 12, meetings: 1 },
      error: null,
    }),
    from: vi.fn(() => ({ insert: vi.fn().mockResolvedValue({ error: null }) })),
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

describe("loadUsage", () => {
  it("returns the current_usage RPC result", async () => {
    const c = mockClient();
    vi.mocked(getSupabase).mockReturnValue(c as never);
    const u = await loadUsage();
    expect(c.rpc).toHaveBeenCalledWith("current_usage");
    expect(u).toEqual({ dictation_words: 12, meetings: 1 });
  });
});

describe("recordUsage", () => {
  it("inserts an event with the user's id", async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    vi.mocked(getSupabase).mockReturnValue(
      mockClient({ from: vi.fn(() => ({ insert })) }) as never,
    );
    await recordUsage("u1", "dictation_words", 42);
    expect(insert).toHaveBeenCalledWith({
      user_id: "u1",
      metric: "dictation_words",
      amount: 42,
    });
    expect(JSON.parse(localStorage.getItem(QUEUE_KEY) ?? "[]")).toEqual([]);
  });

  it("enqueues to localStorage when the insert fails", async () => {
    const insert = vi.fn().mockResolvedValue({ error: { message: "offline" } });
    vi.mocked(getSupabase).mockReturnValue(
      mockClient({ from: vi.fn(() => ({ insert })) }) as never,
    );
    await recordUsage("u1", "meeting", 1);
    expect(JSON.parse(localStorage.getItem(QUEUE_KEY) ?? "[]")).toEqual([
      { user_id: "u1", metric: "meeting", amount: 1 },
    ]);
  });
});

describe("flushQueue", () => {
  it("replays queued events and clears the queue on success", async () => {
    localStorage.setItem(
      QUEUE_KEY,
      JSON.stringify([{ user_id: "u1", metric: "meeting", amount: 1 }]),
    );
    const insert = vi.fn().mockResolvedValue({ error: null });
    vi.mocked(getSupabase).mockReturnValue(
      mockClient({ from: vi.fn(() => ({ insert })) }) as never,
    );
    await flushQueue();
    expect(insert).toHaveBeenCalledWith({
      user_id: "u1",
      metric: "meeting",
      amount: 1,
    });
    expect(JSON.parse(localStorage.getItem(QUEUE_KEY) ?? "[]")).toEqual([]);
  });

  it("keeps unsent events when an insert fails", async () => {
    localStorage.setItem(
      QUEUE_KEY,
      JSON.stringify([{ user_id: "u1", metric: "meeting", amount: 1 }]),
    );
    const insert = vi.fn().mockResolvedValue({ error: { message: "offline" } });
    vi.mocked(getSupabase).mockReturnValue(
      mockClient({ from: vi.fn(() => ({ insert })) }) as never,
    );
    await flushQueue();
    expect(JSON.parse(localStorage.getItem(QUEUE_KEY) ?? "[]")).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/lib/usage.test.ts`
Expected: FAIL — module `./usage` not found.

- [ ] **Step 3: Implement**

Create `src/lib/usage.ts`:

```ts
import { getSupabase, isSupabaseConfigured } from "./supabase";
import type { Metric } from "./entitlements";

export interface Usage {
  dictation_words: number;
  meetings: number;
}

interface QueuedEvent {
  user_id: string;
  metric: Metric;
  amount: number;
}

const QUEUE_KEY = "wisper.usage.queue";
const EMPTY: Usage = { dictation_words: 0, meetings: 0 };

function readQueue(): QueuedEvent[] {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) ?? "[]") as QueuedEvent[];
  } catch {
    return [];
  }
}

function writeQueue(q: QueuedEvent[]): void {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
}

/// Insert one usage event into Supabase. Returns true on success.
async function insertEvent(e: QueuedEvent): Promise<boolean> {
  const { error } = await getSupabase().from("usage_events").insert(e);
  return !error;
}

/// Replay queued events oldest-first; stop at the first failure so order and
/// at-least-once delivery are preserved.
export async function flushQueue(): Promise<void> {
  if (!isSupabaseConfigured()) return;
  let queue = readQueue();
  while (queue.length > 0) {
    const ok = await insertEvent(queue[0]);
    if (!ok) break;
    queue = queue.slice(1);
    writeQueue(queue);
  }
}

/// Current-week totals from the server. Flushes any queued events first so the
/// returned numbers already include offline activity that just synced.
export async function loadUsage(): Promise<Usage> {
  if (!isSupabaseConfigured()) return EMPTY;
  await flushQueue();
  const { data, error } = await getSupabase().rpc("current_usage");
  if (error || !data) return EMPTY;
  return {
    dictation_words: Number(data.dictation_words ?? 0),
    meetings: Number(data.meetings ?? 0),
  };
}

/// Record consumption. On failure (offline) the event is queued locally and
/// retried by the next flushQueue/loadUsage.
export async function recordUsage(
  userId: string,
  metric: Metric,
  amount: number,
): Promise<void> {
  const event: QueuedEvent = { user_id: userId, metric, amount };
  if (!isSupabaseConfigured() || !(await insertEvent(event))) {
    writeQueue([...readQueue(), event]);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/lib/usage.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/usage.ts src/lib/usage.test.ts
git commit -m "feat(usage): add Supabase usage bridge with offline queue"
```

---

## Task 4: Rust enforcement (`entitlements.rs` + guards)

**Files:**

- Create: `src-tauri/src/entitlements.rs`
- Create: (tests inline in `entitlements.rs`)
- Modify: `src-tauri/src/commands.rs` (AppState field)
- Modify: `src-tauri/src/lib.rs` (module, init, guards, command registration)
- Modify: `src/lib/api.ts` (TS binding)

**Interfaces:**

- Consumes: the dictation flow in `lib.rs::stop_and_insert` (word count at the line `let words = text.split_whitespace().count();`) and `lib.rs::start_meeting` (after the existing `no_model` / `already_recording` checks).
- Produces:
  - Rust: `entitlements::Entitlements { logged_in: bool, pro: bool, remaining_words: i64, remaining_meetings: i64 }` (serde `camelCase`), `entitlements::DictationDecision`, `decide_dictation(&Entitlements)`, `decide_meeting(&Entitlements)`, command `set_entitlements`.
  - Events: `quota_blocked` with payload `{ reason: "auth" | "quota", metric: "dictation" | "meeting" }`; `usage_consumed` with `{ metric: "dictation_words", amount: <n> }`.
  - TS: `setEntitlements(ent)` in `api.ts`.

- [ ] **Step 1: Write the failing test (pure decision fns)**

Create `src-tauri/src/entitlements.rs`:

```rust
//! Cached, frontend-pushed entitlements + the pure enforcement decisions used
//! by the dictation and meeting guards. The React webview owns Supabase and
//! pushes a snapshot here via `set_entitlements`; Rust enforces from it.

use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Entitlements {
    pub logged_in: bool,
    pub pro: bool,
    pub remaining_words: i64,
    pub remaining_meetings: i64,
}

impl Default for Entitlements {
    /// Fail-open: until the frontend pushes the real snapshot (right after
    /// launch), do not block a real user.
    fn default() -> Self {
        Entitlements {
            logged_in: true,
            pro: true,
            remaining_words: i64::MAX,
            remaining_meetings: i64::MAX,
        }
    }
}

#[derive(Debug, PartialEq, Eq)]
pub enum Decision {
    Allow,
    BlockAuth,
    BlockQuota,
}

pub fn decide_dictation(e: &Entitlements) -> Decision {
    if !e.logged_in {
        Decision::BlockAuth
    } else if e.pro || e.remaining_words > 0 {
        Decision::Allow
    } else {
        Decision::BlockQuota
    }
}

pub fn decide_meeting(e: &Entitlements) -> Decision {
    if !e.logged_in {
        Decision::BlockAuth
    } else if e.pro || e.remaining_meetings > 0 {
        Decision::Allow
    } else {
        Decision::BlockQuota
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ent(logged_in: bool, pro: bool, words: i64, meetings: i64) -> Entitlements {
        Entitlements { logged_in, pro, remaining_words: words, remaining_meetings: meetings }
    }

    #[test]
    fn logged_out_blocks_with_auth() {
        assert_eq!(decide_dictation(&ent(false, false, 100, 100)), Decision::BlockAuth);
        assert_eq!(decide_meeting(&ent(false, false, 100, 100)), Decision::BlockAuth);
    }

    #[test]
    fn pro_always_allows() {
        assert_eq!(decide_dictation(&ent(true, true, 0, 0)), Decision::Allow);
        assert_eq!(decide_meeting(&ent(true, true, 0, 0)), Decision::Allow);
    }

    #[test]
    fn free_allows_while_remaining_positive_then_blocks() {
        // > 0 allows (the in-progress dictation finishes even if it crosses 0).
        assert_eq!(decide_dictation(&ent(true, false, 1, 1)), Decision::Allow);
        // <= 0 blocks the next one.
        assert_eq!(decide_dictation(&ent(true, false, 0, 1)), Decision::BlockQuota);
        assert_eq!(decide_meeting(&ent(true, false, 1, 0)), Decision::BlockQuota);
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src-tauri && cargo test entitlements`
Expected: FAIL — module not declared in the crate.

- [ ] **Step 3: Declare the module**

In `src-tauri/src/lib.rs`, add alongside the other `mod` declarations near the top:

```rust
mod entitlements;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src-tauri && cargo test entitlements`
Expected: PASS (3 tests).

- [ ] **Step 5: Add the `set_entitlements` command**

Append to `src-tauri/src/entitlements.rs`:

```rust
use crate::commands::AppState;

/// Frontend pushes the latest snapshot here whenever plan/usage changes.
#[tauri::command]
pub fn set_entitlements(state: tauri::State<AppState>, ent: Entitlements) {
    *state.entitlements.lock().unwrap() = ent;
}
```

- [ ] **Step 6: Add the AppState field**

In `src-tauri/src/commands.rs`, add to the `AppState` struct (after the `hotkey` field):

```rust
    /// Latest entitlements/quota snapshot pushed by the frontend. Enforced by
    /// the dictation and meeting guards.
    pub entitlements: Mutex<crate::entitlements::Entitlements>,
```

In `src-tauri/src/lib.rs`, in the `app.manage(AppState { ... })` initializer, add:

```rust
                entitlements: Mutex::new(crate::entitlements::Entitlements::default()),
```

- [ ] **Step 7: Add the dictation guard**

In `src-tauri/src/lib.rs`, in `stop_and_insert`, locate the injection call:

```rust
            match inject::insert(&text_inj, method) {
```

Immediately BEFORE that `match`, insert the guard (the `words` and `app`/`app_inj` bindings are already in scope from earlier in the function):

```rust
            // Quota gate: a logged-out user is blocked (sign-in prompt); a free
            // user over the weekly word cap is blocked (upgrade prompt). The
            // already-transcribed text is dropped — we do not inject it.
            {
                let st = app.state::<AppState>();
                let decision = {
                    let ent = st.entitlements.lock().unwrap();
                    crate::entitlements::decide_dictation(&ent)
                };
                use crate::entitlements::Decision;
                match decision {
                    Decision::BlockAuth => {
                        let _ = app.emit(
                            "quota_blocked",
                            serde_json::json!({ "reason": "auth", "metric": "dictation" }),
                        );
                        return;
                    }
                    Decision::BlockQuota => {
                        let _ = app.emit(
                            "quota_blocked",
                            serde_json::json!({ "reason": "quota", "metric": "dictation" }),
                        );
                        return;
                    }
                    Decision::Allow => {
                        // Decrement the local cache so the NEXT dictation is
                        // blocked once the cap is reached; the frontend records
                        // the event to Supabase and re-pushes the true total.
                        let mut ent = st.entitlements.lock().unwrap();
                        if !ent.pro {
                            ent.remaining_words -= words as i64;
                        }
                    }
                }
            }
```

And immediately AFTER the injection `match` block (after the closing brace of the `match inject::insert(...) { ... }`), emit the consumption event:

```rust
            let _ = app.emit(
                "usage_consumed",
                serde_json::json!({ "metric": "dictation_words", "amount": words }),
            );
```

> Note: `return;` here matches the function's existing early-return style (`stop_and_insert` returns `()`). If the surrounding function returns a `Result`, use `return Ok(());` instead — match the existing signature.

- [ ] **Step 8: Add the meeting guard**

In `src-tauri/src/lib.rs`, in `start_meeting`, after the existing checks:

```rust
    if st.meeting.lock().unwrap().is_some() {
        return Err("already_recording".to_string());
    }
```

insert:

```rust
    // Quota gate: block before recording starts. The frontend pre-checks too
    // (to show the right prompt), but this is the real enforcement.
    {
        use crate::entitlements::Decision;
        let decision = {
            let ent = st.entitlements.lock().unwrap();
            crate::entitlements::decide_meeting(&ent)
        };
        match decision {
            Decision::BlockAuth => return Err("auth_required".to_string()),
            Decision::BlockQuota => return Err("quota_exhausted".to_string()),
            Decision::Allow => {}
        }
    }
```

- [ ] **Step 9: Register the command**

In `src-tauri/src/lib.rs`, in `tauri::generate_handler![ ... ]`, add before `set_ui_language,`:

```rust
            entitlements::set_entitlements,
```

- [ ] **Step 10: Add the TS binding**

In `src/lib/api.ts`, add near the other `invoke` bindings:

```ts
export interface EntitlementsSnapshot {
  loggedIn: boolean;
  pro: boolean;
  remainingWords: number;
  remainingMeetings: number;
}

export const setEntitlements = (ent: EntitlementsSnapshot) =>
  invoke<void>("set_entitlements", { ent });
```

- [ ] **Step 11: Build + test**

Run: `cd src-tauri && cargo test entitlements && cargo build`
Expected: tests PASS; build succeeds.

- [ ] **Step 12: Commit**

```bash
git add src-tauri/src/entitlements.rs src-tauri/src/commands.rs src-tauri/src/lib.rs src/lib/api.ts
git commit -m "feat(usage): enforce dictation/meeting quotas in the Rust backend"
```

---

## Task 5: Usage context + entitlements push (`usageContext.tsx`)

**Files:**

- Create: `src/lib/usageContext.tsx`
- Create: `src/lib/usageContext.test.tsx`
- Modify: `src/App.tsx` (mount `UsageProvider` inside `AuthProvider`)

**Interfaces:**

- Consumes: `useAuth` (from `./authContext`), `loadUsage`/`recordUsage` (from `./usage`), `remainingFor`/`isUnlimited` (from `./entitlements`), `isSupabaseConfigured` (from `./supabase`), `setEntitlements` + `onEvent` (from `./api`).
- Produces:
  - `export function UsageProvider({ children })`
  - `export function useUsage(): { usage: Usage; refresh: () => Promise<void>; blocked: BlockedState | null; clearBlocked: () => void }` where `BlockedState = { reason: "auth" | "quota"; metric: "dictation" | "meeting" }`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/usageContext.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

vi.mock("./authContext", () => ({ useAuth: vi.fn() }));
vi.mock("./usage", () => ({ loadUsage: vi.fn(), recordUsage: vi.fn() }));
vi.mock("./supabase", () => ({ isSupabaseConfigured: vi.fn(() => true) }));
vi.mock("./api", () => ({
  setEntitlements: vi.fn(),
  onEvent: vi.fn(() => Promise.resolve(() => {})),
}));

import { useAuth } from "./authContext";
import { loadUsage } from "./usage";
import { setEntitlements } from "./api";
import { UsageProvider, useUsage } from "./usageContext";

function Probe() {
  const { usage } = useUsage();
  return <span data-testid="words">{usage.dictation_words}</span>;
}

beforeEach(() => vi.clearAllMocks());

describe("UsageProvider", () => {
  it("loads usage for a free user and pushes remaining to Rust", async () => {
    vi.mocked(useAuth).mockReturnValue({
      user: { id: "u1" },
      plan: "free",
      loading: false,
    } as never);
    vi.mocked(loadUsage).mockResolvedValue({
      dictation_words: 500,
      meetings: 1,
    });

    render(
      <UsageProvider>
        <Probe />
      </UsageProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("words").textContent).toBe("500"),
    );
    expect(setEntitlements).toHaveBeenCalledWith({
      loggedIn: true,
      pro: false,
      remainingWords: 1500, // 2000 - 500
      remainingMeetings: 1, // 2 - 1
    });
  });

  it("pushes a logged-out snapshot when there is no user", async () => {
    vi.mocked(useAuth).mockReturnValue({
      user: null,
      plan: "free",
      loading: false,
    } as never);

    render(
      <UsageProvider>
        <Probe />
      </UsageProvider>,
    );

    await waitFor(() =>
      expect(setEntitlements).toHaveBeenCalledWith({
        loggedIn: false,
        pro: false,
        remainingWords: 0,
        remainingMeetings: 0,
      }),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/lib/usageContext.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/lib/usageContext.tsx`:

```tsx
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useAuth } from "./authContext";
import { loadUsage, recordUsage, type Usage } from "./usage";
import { isUnlimited, remainingFor } from "./entitlements";
import { isSupabaseConfigured } from "./supabase";
import { setEntitlements, onEvent } from "./api";

export interface BlockedState {
  reason: "auth" | "quota";
  metric: "dictation" | "meeting";
}

interface UsageState {
  usage: Usage;
  refresh: () => Promise<void>;
  blocked: BlockedState | null;
  clearBlocked: () => void;
}

const EMPTY: Usage = { dictation_words: 0, meetings: 0 };
const UsageContext = createContext<UsageState | null>(null);

export function UsageProvider({ children }: { children: ReactNode }) {
  const { user, plan } = useAuth();
  const [usage, setUsage] = useState<Usage>(EMPTY);
  const [blocked, setBlocked] = useState<BlockedState | null>(null);
  const userIdRef = useRef<string | null>(null);
  userIdRef.current = user?.id ?? null;

  // Compute remaining and push the snapshot to Rust.
  const push = useCallback(
    (u: Usage) => {
      if (!isSupabaseConfigured()) {
        // No backend → metering disabled so the app stays usable.
        setEntitlements({
          loggedIn: true,
          pro: true,
          remainingWords: 0,
          remainingMeetings: 0,
        });
        return;
      }
      if (!user) {
        setEntitlements({
          loggedIn: false,
          pro: false,
          remainingWords: 0,
          remainingMeetings: 0,
        });
        return;
      }
      const pro = isUnlimited(plan);
      setEntitlements({
        loggedIn: true,
        pro,
        remainingWords: pro
          ? 0
          : remainingFor(plan, "dictation_words", u.dictation_words),
        remainingMeetings: pro ? 0 : remainingFor(plan, "meeting", u.meetings),
      });
    },
    [user, plan],
  );

  const refresh = useCallback(async () => {
    if (!user || !isSupabaseConfigured()) {
      setUsage(EMPTY);
      push(EMPTY);
      return;
    }
    const u = await loadUsage();
    setUsage(u);
    push(u);
  }, [user, push]);

  // Re-load + re-push whenever identity or plan changes.
  useEffect(() => {
    void refresh();
  }, [refresh, plan]);

  // React to Rust events: record consumption to the server then re-sync; surface blocks.
  useEffect(() => {
    const consumed = onEvent<{ metric: "dictation_words"; amount: number }>(
      "usage_consumed",
      async (p) => {
        const uid = userIdRef.current;
        if (uid) await recordUsage(uid, p.metric, p.amount);
        await refresh();
      },
    );
    const blockedSub = onEvent<BlockedState>("quota_blocked", (p) =>
      setBlocked(p),
    );
    return () => {
      consumed.then((f) => f());
      blockedSub.then((f) => f());
    };
  }, [refresh]);

  return (
    <UsageContext.Provider
      value={{ usage, refresh, blocked, clearBlocked: () => setBlocked(null) }}
    >
      {children}
    </UsageContext.Provider>
  );
}

export function useUsage(): UsageState {
  const ctx = useContext(UsageContext);
  if (!ctx) throw new Error("useUsage must be used within a UsageProvider");
  return ctx;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/lib/usageContext.test.tsx`
Expected: PASS.

- [ ] **Step 5: Mount the provider**

In `src/App.tsx`, import and wrap the `Dashboard` branch (inside `AuthProvider`):

```tsx
import { AuthProvider } from "./lib/authContext";
import { UsageProvider } from "./lib/usageContext";
```

Change the Dashboard branch to:

```tsx
<AuthProvider>
  <UsageProvider>
    <Dashboard />
  </UsageProvider>
</AuthProvider>
```

- [ ] **Step 6: Run the full suite + typecheck**

Run: `pnpm test && pnpm typecheck`
Expected: all PASS; tsc clean. (If `App.test.tsx` / `Dashboard.test.tsx` now render `UsageProvider` and hit real code, add `vi.mock("./lib/usageContext", () => ({ UsageProvider: ({ children }: { children: React.ReactNode }) => children, useUsage: () => ({ usage: { dictation_words: 0, meetings: 0 }, refresh: vi.fn(), blocked: null, clearBlocked: vi.fn() }) }))` to those test files, mirroring the existing `authContext` mock there.)

- [ ] **Step 7: Commit**

```bash
git add src/lib/usageContext.tsx src/lib/usageContext.test.tsx src/App.tsx src/App.test.tsx src/routes/Dashboard.test.tsx
git commit -m "feat(usage): add UsageProvider that syncs usage and pushes entitlements"
```

---

## Task 6: Upgrade modal + block wiring (`UpgradeModal.tsx`)

**Files:**

- Create: `src/components/UpgradeModal.tsx`
- Create: `src/components/UpgradeModal.test.tsx`
- Modify: `src/routes/Dashboard.tsx` (mount the modal)

**Interfaces:**

- Consumes: `useUsage` (`blocked`, `clearBlocked`).
- Produces: `export default function UpgradeModal()` — renders nothing when not blocked; on `reason: "quota"` shows the upgrade modal (inert Monthly/Annual buttons); on `reason: "auth"` shows a sign-in prompt wired to `useAuth().signIn`.

- [ ] **Step 1: Write the failing test**

Create `src/components/UpgradeModal.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const clearBlocked = vi.fn();
const signIn = vi.fn();
vi.mock("../lib/usageContext", () => ({ useUsage: vi.fn() }));
vi.mock("../lib/authContext", () => ({ useAuth: vi.fn(() => ({ signIn })) }));

import { useUsage } from "../lib/usageContext";
import UpgradeModal from "./UpgradeModal";

beforeEach(() => vi.clearAllMocks());

describe("UpgradeModal", () => {
  it("renders nothing when not blocked", () => {
    vi.mocked(useUsage).mockReturnValue({
      blocked: null,
      clearBlocked,
    } as never);
    const { container } = render(<UpgradeModal />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the upgrade prompt with inert plan buttons on a quota block", () => {
    vi.mocked(useUsage).mockReturnValue({
      blocked: { reason: "quota", metric: "dictation" },
      clearBlocked,
    } as never);
    render(<UpgradeModal />);
    expect(screen.getByText(/weekly limit reached/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /\$8\s*\/\s*month/i }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: /\$72\s*\/\s*year/i }),
    ).toBeDisabled();
  });

  it("shows a sign-in prompt on an auth block and wires the button", async () => {
    vi.mocked(useUsage).mockReturnValue({
      blocked: { reason: "auth", metric: "dictation" },
      clearBlocked,
    } as never);
    render(<UpgradeModal />);
    await userEvent.click(
      screen.getByRole("button", { name: /continue with google/i }),
    );
    expect(signIn).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/components/UpgradeModal.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/components/UpgradeModal.tsx`:

```tsx
import { useUsage } from "../lib/usageContext";
import { useAuth } from "../lib/authContext";

/// Shown when the Rust backend blocks an action. `quota` → upgrade prompt
/// (buttons inert until Phase 2 wires Stripe); `auth` → sign-in prompt.
export default function UpgradeModal() {
  const { blocked, clearBlocked } = useUsage();
  const { signIn } = useAuth();
  if (!blocked) return null;

  const isAuth = blocked.reason === "auth";

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-stone-950/50 p-6">
      <div className="w-full max-w-sm rounded-2xl border border-stone-200 bg-white p-6 dark:border-stone-800 dark:bg-stone-900">
        {isAuth ? (
          <>
            <h2 className="text-lg font-semibold text-stone-900 dark:text-stone-100">
              Sign in to continue
            </h2>
            <p className="mt-2 text-sm text-stone-500 dark:text-stone-400">
              Wisper needs a free account to use dictation and meetings. Your
              audio still stays on your device.
            </p>
            <button
              type="button"
              onClick={() => {
                clearBlocked();
                void signIn().catch(() => {});
              }}
              className="mt-5 w-full rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-800 dark:bg-stone-100 dark:text-stone-900"
            >
              Continue with Google
            </button>
          </>
        ) : (
          <>
            <h2 className="text-lg font-semibold text-stone-900 dark:text-stone-100">
              Weekly limit reached
            </h2>
            <p className="mt-2 text-sm text-stone-500 dark:text-stone-400">
              You've hit this week's free {blocked.metric} limit. Upgrade to Pro
              for unlimited dictation and meetings.
            </p>
            <div className="mt-5 flex gap-3">
              <button
                type="button"
                disabled
                title="Coming soon"
                className="flex-1 rounded-lg border border-stone-300 px-3 py-2 text-sm font-medium text-stone-500 disabled:opacity-60 dark:border-stone-700"
              >
                $8 / month
              </button>
              <button
                type="button"
                disabled
                title="Coming soon"
                className="flex-1 rounded-lg border border-stone-300 px-3 py-2 text-sm font-medium text-stone-500 disabled:opacity-60 dark:border-stone-700"
              >
                $72 / year
              </button>
            </div>
            <p className="mt-2 text-center text-xs text-stone-400">
              Checkout coming soon
            </p>
          </>
        )}
        <button
          type="button"
          onClick={clearBlocked}
          className="mt-4 w-full rounded-lg px-3 py-2 text-sm text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-800"
        >
          Not now
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/components/UpgradeModal.test.tsx`
Expected: PASS.

- [ ] **Step 5: Mount the modal**

In `src/routes/Dashboard.tsx`, import and render it once (it self-hides when not blocked). Add the import:

```tsx
import UpgradeModal from "../components/UpgradeModal";
```

And add `<UpgradeModal />` just before the closing `</div>` of the outer flex container (sibling to the `{onboarded === false && ...}` line):

```tsx
<UpgradeModal />
```

- [ ] **Step 6: Run the suite**

Run: `pnpm test src/components/UpgradeModal.test.tsx src/routes/Dashboard.test.tsx`
Expected: PASS (mock `../lib/usageContext` in `Dashboard.test.tsx` per Task 5 Step 6 if not already).

- [ ] **Step 7: Commit**

```bash
git add src/components/UpgradeModal.tsx src/components/UpgradeModal.test.tsx src/routes/Dashboard.tsx
git commit -m "feat(usage): add upgrade/sign-in modal driven by quota_blocked"
```

---

## Task 7: Usage indicator (Account panel + Home banner)

**Files:**

- Modify: `src/routes/Account.tsx`
- Create: `src/components/UsageBanner.tsx`
- Create: `src/components/UsageBanner.test.tsx`
- Modify: `src/routes/Dashboard.tsx` (render the banner)
- Modify: `src/routes/Account.test.tsx` (mock `useUsage`)

**Interfaces:**

- Consumes: `useUsage` (`usage`), `useAuth` (`plan`), `WEEKLY_LIMITS`/`isUnlimited` (from `./entitlements`).
- Produces: a usage section in `Account` (free shows `used / limit` for both metrics; pro shows "Unlimited"); `UsageBanner` shows a one-line nudge on Home when any free metric is ≥ 80% used.

- [ ] **Step 1: Write the failing test for the banner**

Create `src/components/UsageBanner.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("../lib/usageContext", () => ({ useUsage: vi.fn() }));
vi.mock("../lib/authContext", () => ({ useAuth: vi.fn() }));

import { useUsage } from "../lib/usageContext";
import { useAuth } from "../lib/authContext";
import UsageBanner from "./UsageBanner";

beforeEach(() => vi.clearAllMocks());

describe("UsageBanner", () => {
  it("renders nothing for a pro user", () => {
    vi.mocked(useAuth).mockReturnValue({ plan: "pro" } as never);
    vi.mocked(useUsage).mockReturnValue({
      usage: { dictation_words: 1999, meetings: 2 },
    } as never);
    const { container } = render(<UsageBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing for a free user below 80%", () => {
    vi.mocked(useAuth).mockReturnValue({ plan: "free" } as never);
    vi.mocked(useUsage).mockReturnValue({
      usage: { dictation_words: 100, meetings: 0 },
    } as never);
    const { container } = render(<UsageBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it("warns when a free metric is at/over 80%", () => {
    vi.mocked(useAuth).mockReturnValue({ plan: "free" } as never);
    vi.mocked(useUsage).mockReturnValue({
      usage: { dictation_words: 1800, meetings: 0 },
    } as never);
    render(<UsageBanner />);
    expect(screen.getByText(/1,?800\s*\/\s*2,?000 words/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/components/UsageBanner.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the banner**

Create `src/components/UsageBanner.tsx`:

```tsx
import { useAuth } from "../lib/authContext";
import { useUsage } from "../lib/usageContext";
import { WEEKLY_LIMITS, isUnlimited } from "../lib/entitlements";

/// One-line nudge on Home once a free user crosses 80% of either weekly limit.
export default function UsageBanner() {
  const { plan } = useAuth();
  const { usage } = useUsage();
  if (isUnlimited(plan)) return null;

  const wordLimit = WEEKLY_LIMITS.free.dictation_words;
  const meetLimit = WEEKLY_LIMITS.free.meeting;
  const wordsHot = usage.dictation_words >= wordLimit * 0.8;
  const meetsHot = usage.meetings >= meetLimit * 0.8;
  if (!wordsHot && !meetsHot) return null;

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">
      You're near your weekly free limit —{" "}
      {usage.dictation_words.toLocaleString()} / {wordLimit.toLocaleString()}{" "}
      words · {usage.meetings} / {meetLimit} meetings. Upgrade to Pro for
      unlimited use.
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/components/UsageBanner.test.tsx`
Expected: PASS.

- [ ] **Step 5: Render the banner on Home**

In `src/routes/Dashboard.tsx`, import it:

```tsx
import UsageBanner from "../components/UsageBanner";
```

Render it inside the `{view === "home" && ...}` area — change that line to:

```tsx
{
  view === "home" && (
    <>
      <div className="mb-4 empty:mb-0">
        <UsageBanner />
      </div>
      <Home />
    </>
  );
}
```

- [ ] **Step 6: Add the usage section to Account**

In `src/routes/Account.tsx`, add imports at the top:

```tsx
import { useUsage } from "../lib/usageContext";
import { WEEKLY_LIMITS, isUnlimited } from "../lib/entitlements";
```

Inside the component, after `const { user, plan, loading, signIn, signOut } = useAuth();`, add:

```tsx
const { usage } = useUsage();
```

Then, inside the logged-in `<div className="rounded-xl border ...">` block, after the plan badge `<span>...</span>`, add a usage section:

```tsx
{
  !isUnlimited(plan) && (
    <div className="mt-4 space-y-2 text-xs text-stone-600 dark:text-stone-400">
      <UsageRow
        label="Words this week"
        used={usage.dictation_words}
        limit={WEEKLY_LIMITS.free.dictation_words}
      />
      <UsageRow
        label="Meetings this week"
        used={usage.meetings}
        limit={WEEKLY_LIMITS.free.meeting}
      />
    </div>
  );
}
{
  isUnlimited(plan) && (
    <div className="mt-4 text-xs text-stone-500 dark:text-stone-400">
      Unlimited dictation and meetings.
    </div>
  );
}
```

And add a small `UsageRow` helper at the bottom of the file (after the `Account` component):

```tsx
function UsageRow({
  label,
  used,
  limit,
}: {
  label: string;
  used: number;
  limit: number;
}) {
  const pct = Math.min(100, Math.round((used / limit) * 100));
  return (
    <div>
      <div className="mb-1 flex justify-between">
        <span>{label}</span>
        <span>
          {used.toLocaleString()} / {limit.toLocaleString()}
        </span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-stone-200 dark:bg-stone-800">
        <div
          className="h-1.5 rounded-full bg-teal-500"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Fix the Account test isolation**

In `src/routes/Account.test.tsx`, add a `useUsage` mock so the existing tests still render (mirror the `useAuth` mock already there):

```tsx
vi.mock("../lib/usageContext", () => ({
  useUsage: () => ({
    usage: { dictation_words: 0, meetings: 0 },
    refresh: vi.fn(),
    blocked: null,
    clearBlocked: vi.fn(),
  }),
}));
```

- [ ] **Step 8: Run the suite + typecheck**

Run: `pnpm test src/routes/Account.test.tsx src/components/UsageBanner.test.tsx && pnpm typecheck`
Expected: PASS; tsc clean.

- [ ] **Step 9: Commit**

```bash
git add src/routes/Account.tsx src/routes/Account.test.tsx src/components/UsageBanner.tsx src/components/UsageBanner.test.tsx src/routes/Dashboard.tsx
git commit -m "feat(usage): show weekly usage in Account and a near-limit Home banner"
```

---

## Task 8: Onboarding login gate

**Files:**

- Modify: `src/routes/Onboarding.tsx`
- Create: `src/routes/Onboarding.login.test.tsx`

**Interfaces:**

- Consumes: `useAuth` (`user`, `loading`, `signIn`).
- Produces: a mandatory `"login"` step inserted as the second step (after `welcome`); the footer "Next" button is disabled on that step until `user` is set.

- [ ] **Step 1: Write the failing test**

Create `src/routes/Onboarding.login.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../lib/api", () => ({
  getConfig: vi.fn(() => Promise.resolve({ hotkey: "F5", onboarded: false })),
  saveConfig: vi.fn(() => Promise.resolve()),
  listModels: vi.fn(() => Promise.resolve([])),
  downloadModel: vi.fn(),
  onEvent: vi.fn(() => Promise.resolve(() => {})),
}));
vi.mock("../lib/i18n", () => ({ useI18n: () => ({ t: (k: string) => k }) }));
vi.mock("../lib/authContext", () => ({ useAuth: vi.fn() }));
const signIn = vi.fn();

import { useAuth } from "../lib/authContext";
import Onboarding from "./Onboarding";

beforeEach(() => vi.clearAllMocks());

describe("Onboarding login gate", () => {
  it("blocks Next on the login step until signed in, and signs in on click", async () => {
    vi.mocked(useAuth).mockReturnValue({
      user: null,
      loading: false,
      signIn,
    } as never);
    render(<Onboarding onDone={vi.fn()} />);

    // Advance from welcome to the login step.
    await userEvent.click(
      screen.getByRole("button", { name: "onboarding.next" }),
    );

    expect(
      screen.getByRole("button", { name: /continue with google/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "onboarding.next" }),
    ).toBeDisabled();

    await userEvent.click(
      screen.getByRole("button", { name: /continue with google/i }),
    );
    expect(signIn).toHaveBeenCalledTimes(1);
  });

  it("allows Next on the login step once signed in", async () => {
    vi.mocked(useAuth).mockReturnValue({
      user: { id: "u1" },
      loading: false,
      signIn,
    } as never);
    render(<Onboarding onDone={vi.fn()} />);
    await userEvent.click(
      screen.getByRole("button", { name: "onboarding.next" }),
    );
    expect(
      screen.getByRole("button", { name: "onboarding.next" }),
    ).toBeEnabled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/routes/Onboarding.login.test.tsx`
Expected: FAIL — there is no login step / Next is not gated.

- [ ] **Step 3: Implement the login step**

In `src/routes/Onboarding.tsx`:

Add the import:

```tsx
import { useAuth } from "../lib/authContext";
```

Change the step list (add `"login"` after `"welcome"`):

```tsx
type StepId = "welcome" | "login" | "hotkey" | "model" | "practice" | "done";
const STEPS: StepId[] = [
  "welcome",
  "login",
  "hotkey",
  "model",
  "practice",
  "done",
];
```

Inside the `Onboarding` component, read auth and gate Next:

```tsx
const { user, loading: authLoading, signIn } = useAuth();
```

Render the login step (add alongside the other `{step === ... && ...}` blocks in the content area):

```tsx
{
  step === "login" && (
    <LoginStep user={!!user} loading={authLoading} signIn={signIn} />
  );
}
```

Disable the footer "Next" button while on the login step and not signed in. Change the footer Next button to:

```tsx
<button
  type="button"
  onClick={next}
  disabled={step === "login" && !user}
  className="rounded-lg bg-teal-600 px-5 py-2 text-sm font-medium text-white hover:bg-teal-500 disabled:opacity-40"
>
  {step === "done" ? t("onboarding.finish") : t("onboarding.next")}
</button>
```

Also gate the "Skip" link so onboarding can't be skipped past the login step without an account — change the skip condition from `step !== "done"` to also require a user on the login step:

```tsx
          {step !== "done" && step !== "login" && (
```

Add the `LoginStep` component at the bottom of the file:

```tsx
function LoginStep({
  user,
  loading,
  signIn,
}: {
  user: boolean;
  loading: boolean;
  signIn: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex h-full flex-col items-center justify-center text-center">
      <h2 className="text-xl font-semibold text-stone-900 dark:text-stone-100">
        Create your free account
      </h2>
      <p className="mt-2 max-w-md text-sm text-stone-500 dark:text-stone-400">
        Wisper needs a free account to use dictation and meetings. Your audio
        and transcripts stay 100% on your device — the account is just for
        sign-in.
      </p>
      {user ? (
        <div className="mt-6 flex items-center gap-2 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          ✓ Signed in
        </div>
      ) : (
        <button
          type="button"
          disabled={busy || loading}
          onClick={async () => {
            setBusy(true);
            try {
              await signIn();
            } catch {
              /* surfaced by the auth layer */
            } finally {
              setBusy(false);
            }
          }}
          className="mt-6 rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-800 disabled:opacity-50 dark:bg-stone-100 dark:text-stone-900"
        >
          {busy ? "Opening browser…" : "Continue with Google"}
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/routes/Onboarding.login.test.tsx`
Expected: PASS.

- [ ] **Step 5: Run the full suite + typecheck**

Run: `pnpm test && pnpm typecheck`
Expected: all PASS; tsc clean.

- [ ] **Step 6: Commit**

```bash
git add src/routes/Onboarding.tsx src/routes/Onboarding.login.test.tsx
git commit -m "feat(usage): require a free account via a mandatory onboarding login step"
```

---

## Task 9: Local E2E docs

**Files:**

- Create: `docs/MONETIZATION.md`

**Interfaces:**

- Consumes: everything above.
- Produces: a doc covering the metering model and a local end-to-end smoke test.

- [ ] **Step 1: Write the doc**

Create `docs/MONETIZATION.md`:

```markdown
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
```

- [ ] **Step 2: Commit**

```bash
git add docs/MONETIZATION.md
git commit -m "docs(usage): document Phase 1 metering and local smoke test"
```

---

## Self-Review

**Spec coverage (Phase 1 scope):**

- `usage_events` + RLS + weekly function → Task 1. ✅
- Cache-first enforcement, Rust gates dictation/meeting, React bridge → Tasks 4 + 5. ✅
- Offline queue → Task 3. ✅
- Per-plan limits / remaining → Task 2. ✅
- Onboarding login gate + session check (the Rust `auth` block + sign-in modal) → Tasks 8 + 4 + 6. ✅
- Usage indicator (Account + Home banner) → Task 7. ✅
- Upgrade modal shell (inert buttons) → Task 6. ✅
- Weekly reset Monday 00:00 UTC → Task 1's `current_usage()`. ✅
- Docs / local E2E → Task 9. ✅
- **Deferred to Phase 2 (correctly absent):** Stripe Edge Functions, `profiles` Stripe columns, Realtime plan propagation, real checkout/portal.

**Type consistency:** `Metric = "dictation_words" | "meeting"` is defined in Task 2 and used in Tasks 3/4/5. The entitlements snapshot shape `{ loggedIn, pro, remainingWords, remainingMeetings }` matches between Rust (`#[serde(rename_all="camelCase")]` in Task 4) and TS (`EntitlementsSnapshot` in Task 4, produced by `UsageProvider` in Task 5 and asserted in its test). Events `quota_blocked` (`{reason, metric}`) and `usage_consumed` (`{metric, amount}`) match between Rust emit (Task 4) and the `onEvent` listeners (Task 5/6). `useUsage()` shape (`usage`, `refresh`, `blocked`, `clearBlocked`) is consistent across Tasks 5/6/7.

**Placeholder scan:** No TBD/placeholder steps; every code step ships complete code. The only intentional "inert"/"coming soon" is the Phase-2 Stripe seam in the modal, which is the deliverable, not a gap.

**Ordering note for executors:** Task 4 adds `commands::AppState.entitlements` and references `crate::entitlements`; do Task 4's module declaration (Step 3) before the AppState field (Step 6) so the crate compiles. `src/lib/usage.ts` (Task 3) and `entitlements.ts` limits (Task 2) must exist before `usageContext.tsx` (Task 5). The plan's task order already satisfies this.
