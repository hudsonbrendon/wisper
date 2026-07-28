# Open Source Again — Remove the Paid Tier Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Strip every paid/billing/quota mechanism out of Wisper (Stripe, plans, weekly limits, usage metering) while keeping Google sign-in and user accounts intact, then make `99labdev/wisper` a public repository again.

**Architecture:** Today the money path is a chain: Supabase `profiles.plan` + `usage_events` → `src/lib/entitlements.ts` (limits) → `src/lib/usageContext.tsx` (pushes a quota snapshot into Rust) → `src-tauri/src/entitlements.rs` (`decide_dictation` / `decide_meeting`) → `quota_blocked` events → `UpgradeModal` / `UsageBanner` / Stripe checkout in `Account.tsx`. After this plan the chain collapses to a single boolean: the webview pushes "is someone signed in" to Rust (`set_signed_in`), Rust blocks dictation/meetings while signed out and emits `signin_required`, and one `SignInModal` handles it. Everything Stripe-shaped (Edge Functions, billing columns, metering table, price strings in 15 locales) is deleted.

**Tech Stack:** Tauri 2 (Rust) + React 19 + TypeScript + Vite + Vitest + Tailwind, Supabase (Postgres/Auth/RLS + Edge Functions on Deno), pnpm.

## Global Constraints

- **Sign-in stays required** for dictation and meetings when Supabase is configured (`VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` present). This preserves today's behavior minus the money. If the owner wants optional sign-in instead, only Task 1 and the Task 6 README edit change (see "Open question" below).
- **When Supabase is NOT configured the app must stay fully usable** (a fork with no `.env`): the frontend pushes `signedIn: true` in that case, exactly like the current `usageContext` does.
- No new npm/cargo dependencies.
- Keep the existing comment style: `///` doc comments on exported items, `//` for inline reasoning.
- Every task ends green on `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`; Rust tasks also on `cargo fmt --check`, `cargo clippy -- -D warnings`, `cargo test` (run from `src-tauri/`).
- Do NOT rewrite git history and do NOT force-push. The repo goes public with its history intact (Task 7 verifies no secrets were ever committed).
- Conventional Commits, one commit per task.

## Open question (answer before Task 1 — default assumed)

`README.md:66,79` claims "no account required", which is already false today. Default in this plan: **keep sign-in required**, fix the README wording. Alternative: make sign-in optional (Task 1 becomes a pure deletion of the gate, README stays as-is).

## File Structure

**Deleted**

- `src/lib/billing.ts`, `src/lib/billing.test.ts` — Stripe checkout/portal client.
- `src/lib/entitlements.ts`, `src/lib/entitlements.test.ts`, `src/lib/entitlements.limits.test.ts` — plan matrix + weekly limits.
- `src/lib/usage.ts`, `src/lib/usage.test.ts` — usage event queue/metering.
- `src/lib/usageContext.tsx`, `src/lib/usageContext.test.tsx` — quota snapshot provider.
- `src/components/UsageBanner.tsx`, `src/components/UsageBanner.test.tsx` — 80%-of-limit nudge.
- `src/components/UpgradeModal.tsx`, `src/components/UpgradeModal.test.tsx` — replaced by `SignInModal`.
- `src/lib/i18n.billing.test.ts` — guards billing copy that no longer exists.
- `supabase/functions/` (whole directory: `create-checkout-session/`, `create-portal-session/`, `stripe-webhook/`, `_shared/`, `deno.json`, `deno.lock`, `node_modules/`).
- `docs/STRIPE.md`, `docs/MONETIZATION.md`, `docs/superpowers/plans/2026-06-26-monetization-phase1-metering-limits.md`, `docs/superpowers/plans/2026-06-26-monetization-phase2-stripe-checkout.md`, `docs/superpowers/specs/2026-06-26-monetization-subscription-limits-design.md`.
- `src-tauri/src/entitlements.rs` — replaced by `src-tauri/src/signin.rs`.

**Created**

- `src-tauri/src/signin.rs` — one Tauri command storing the signed-in flag.
- `src/components/SignInModal.tsx` + `src/components/SignInModal.test.tsx` — modal shown on the `signin_required` event.
- `supabase/migrations/0007_drop_billing.sql` — drops billing columns, `plan`, `usage_events`, `current_usage()`.
- `scripts/strip-paid-i18n.mjs` — one-off key remover, deleted in the same task after it runs.

**Modified**

- `src-tauri/src/lib.rs` — dictation + meeting gates, module list, `AppState` init, `invoke_handler`.
- `src-tauri/src/commands.rs` — `AppState.entitlements` → `AppState.signed_in`.
- `src/lib/api.ts` — `setEntitlements`/`EntitlementsSnapshot` → `setSignedIn`.
- `src/lib/auth.ts` — drop `fetchPlan` / `subscribePlan`.
- `src/lib/authContext.tsx` — drop `plan`/`useEntitlements`, push the signed-in flag to Rust.
- `src/App.tsx` — drop `UsageProvider`.
- `src/routes/Dashboard.tsx` — drop `UsageBanner`, swap `UpgradeModal` → `SignInModal`.
- `src/routes/Account.tsx` — identity + sign-out only.
- `src/routes/Meetings.tsx` — drop the `quota_exhausted` branch.
- `src/lib/i18n.tsx` — delete paid keys, reword `account.subtitle`.
- `src/lib/i18n.test.tsx` — add the "no paid keys" guard.
- `src/App.test.tsx`, `src/routes/Dashboard.test.tsx`, `src/routes/Account.test.tsx` — drop plan/usage mocks.
- `docs/AUTH.md`, `supabase/README.md`, `README.md`.

---

### Task 1: Rust — replace quota enforcement with a sign-in gate

**Files:**

- Create: `src-tauri/src/signin.rs`
- Delete: `src-tauri/src/entitlements.rs`
- Modify: `src-tauri/src/commands.rs:29-33`, `src-tauri/src/lib.rs:4` (mod list), `src-tauri/src/lib.rs:219-277` (dictation gate), `src-tauri/src/lib.rs:311-410` (meeting gate), `src-tauri/src/lib.rs:1285-1295` (`AppState` init), `src-tauri/src/lib.rs:1440-1450` (`invoke_handler`)

**Interfaces:**

- Consumes: nothing from earlier tasks.
- Produces: Tauri command `set_signed_in(signed_in: bool)` (invoked from JS as `invoke("set_signed_in", { signedIn })`); event `signin_required` with payload `{ "metric": "dictation" | "meeting" }`; `start_meeting` still returns `Err("auth_required")` when blocked.

- [ ] **Step 1: Create the new module**

Create `src-tauri/src/signin.rs`:

```rust
//! Sign-in gate. The React webview owns Supabase auth and pushes the current
//! session state here; Rust blocks dictation and meetings while signed out.
//! Wisper has no paid plans, so this flag is the whole gate.

use crate::commands::AppState;

/// Frontend pushes the session state here on every auth change. It also pushes
/// `true` when Supabase isn't configured, so a build without credentials stays
/// fully usable.
#[tauri::command]
pub fn set_signed_in(state: tauri::State<AppState>, signed_in: bool) {
    *state.signed_in.lock().unwrap() = signed_in;
}
```

Delete `src-tauri/src/entitlements.rs`.

- [ ] **Step 2: Swap the state field**

In `src-tauri/src/commands.rs`, replace the `entitlements` field (around lines 31-33) with:

```rust
    /// Whether someone is signed in, pushed by the frontend on every auth
    /// change. Starts `true` so the first dictation after launch is never
    /// blocked before the webview has reported in.
    pub signed_in: Mutex<bool>,
```

In `src-tauri/src/lib.rs`: change `mod entitlements;` to `mod signin;`; change the `AppState` construction line `entitlements: Mutex::new(crate::entitlements::Entitlements::default()),` to `signed_in: Mutex::new(true),`; and in the `invoke_handler!` list change `entitlements::set_entitlements,` to `signin::set_signed_in,`.

- [ ] **Step 3: Replace the dictation gate**

In `src-tauri/src/lib.rs`, inside the `run_on_main_thread` closure, replace the whole `// Quota gate:` block (from `let st = app_inj.state::<AppState>();` through the closing brace of `match decision`) with:

```rust
                    // Sign-in gate: a logged-out user is blocked and prompted to
                    // sign in. The already-transcribed text is dropped — we do
                    // not inject it.
                    if !*app_inj.state::<AppState>().signed_in.lock().unwrap() {
                        let _ = app_inj.emit(
                            "signin_required",
                            serde_json::json!({ "metric": "dictation" }),
                        );
                        transition(&app_inj, SmEvent::InjectionDone);
                        return_key_to_target(&app_inj);
                        return;
                    }
```

In the same closure, drop the `usage_consumed` emit (there is no metering anymore), leaving:

```rust
                    match inject::insert(&text_inj, method) {
                        Ok(()) => {}
                        Err(e) => {
                            eprintln!("inject failed: {e}");
                            let _ = app_inj.emit("error", serde_json::json!({ "message": e }));
                        }
                    }
```

- [ ] **Step 4: Replace the meeting gate**

In `start_meeting`, replace the `// Quota gate:` block with:

```rust
    // Sign-in gate: block before recording starts.
    if !*st.signed_in.lock().unwrap() {
        let _ = app.emit("signin_required", serde_json::json!({ "metric": "meeting" }));
        return Err("auth_required".to_string());
    }
```

Further down in `start_meeting`, delete the block that decrements `remaining_meetings` and the `usage_consumed` emit that follows it (from the comment `// Count this meeting toward the weekly quota.` through its closing `);`).

- [ ] **Step 5: Verify Rust is green**

Run from `src-tauri/`:

```bash
cargo fmt --check && cargo clippy -- -D warnings && cargo test
```

Expected: PASS. (`entitlements.rs` took its unit tests with it; the new gate is a single boolean read with no branch worth a test.)

- [ ] **Step 6: Commit**

```bash
git add -A src-tauri/src
git commit -m "refactor(rust): replace quota enforcement with a sign-in gate"
```

---

### Task 2: Frontend data layer — delete billing/usage/entitlements

**Files:**

- Delete: `src/lib/billing.ts`, `src/lib/billing.test.ts`, `src/lib/entitlements.ts`, `src/lib/entitlements.test.ts`, `src/lib/entitlements.limits.test.ts`, `src/lib/usage.ts`, `src/lib/usage.test.ts`, `src/lib/usageContext.tsx`, `src/lib/usageContext.test.tsx`
- Modify: `src/lib/api.ts:175-184`, `src/lib/auth.ts:1-6,101-140`, `src/lib/authContext.tsx` (whole file), `src/App.tsx`
- Test: `src/lib/authContext.test.tsx`

**Interfaces:**

- Consumes: Tauri command `set_signed_in` from Task 1.
- Produces: `setSignedIn(signedIn: boolean): Promise<void>` in `src/lib/api.ts`; `useAuth(): { user: User | null; loading: boolean; signIn: () => Promise<void>; signOut: () => Promise<void> }` in `src/lib/authContext.tsx` — no `plan`, and `useEntitlements` is gone.

- [ ] **Step 1: Write the failing test**

In `src/lib/authContext.test.tsx`, add `setSignedIn` to the existing `vi.mock("./api", ...)` factory (alongside `setActiveUser`), import it, delete the cases that assert on `plan`/`fetchPlan`/`subscribePlan`, and add:

```tsx
it("pushes the signed-in state to the backend on auth changes", async () => {
  vi.mocked(getSession).mockResolvedValue({
    user: { id: "u1" },
  } as unknown as Session);

  render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );

  await waitFor(() => expect(setSignedIn).toHaveBeenCalledWith(true));
});
```

(`Probe` is the tiny consumer component the file already defines; if it renders `plan`, change it to render `user?.id ?? "none"`.)

- [ ] **Step 2: Run it to verify it fails**

```bash
pnpm vitest run src/lib/authContext.test.tsx
```

Expected: FAIL — `setSignedIn` is not exported from `./api`.

- [ ] **Step 3: Replace `setEntitlements` with `setSignedIn`**

In `src/lib/api.ts`, delete the `EntitlementsSnapshot` interface and `setEntitlements`, and add:

```ts
/// Tell the backend whether someone is signed in. Dictation and meetings are
/// blocked while signed out; there are no plans or quotas.
export const setSignedIn = (signedIn: boolean) =>
  invoke<void>("set_signed_in", { signedIn });
```

- [ ] **Step 4: Trim `auth.ts`**

In `src/lib/auth.ts`, delete `fetchPlan`, `subscribePlan`, and the import `import { DEFAULT_PLAN, type Plan } from "./entitlements";`. Everything else (`extractCode`, `signInWithGoogle`, `signOut`, `getSession`, `onAuthChange`) is unchanged.

- [ ] **Step 5: Rewrite `authContext.tsx`**

Replace the whole file with:

```tsx
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { User } from "@supabase/supabase-js";
import {
  getSession,
  onAuthChange,
  signInWithGoogle,
  signOut as signOutFn,
} from "./auth";
import { isSupabaseConfigured } from "./supabase";
import { setActiveUser, setSignedIn } from "./api";

interface AuthState {
  user: User | null;
  loading: boolean;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    let seq = 0;

    const apply = async (u: User | null) => {
      const mine = ++seq;
      // Scope the local data dir to this account (or _guest) BEFORE the UI reads
      // history/meetings, so a logout→login never surfaces the old account's
      // data. Failures must not block auth, so swallow them.
      await setActiveUser(u?.id ?? null).catch(() => {});
      // Without Supabase credentials there is nobody to sign in as, so the gate
      // stays open — a fork with no .env is fully usable.
      await setSignedIn(!isSupabaseConfigured() || !!u).catch(() => {});
      if (!active || seq !== mine) return;
      setUser(u);
    };

    getSession()
      .then((session) => apply(session?.user ?? null))
      .finally(() => active && setLoading(false));

    const unsub = onAuthChange((session) => {
      void apply(session?.user ?? null);
    });

    return () => {
      active = false;
      unsub();
    };
  }, []);

  const value: AuthState = {
    user,
    loading,
    signIn: signInWithGoogle,
    signOut: signOutFn,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
```

- [ ] **Step 6: Delete the dead modules and unwire the provider**

```bash
git rm src/lib/billing.ts src/lib/billing.test.ts \
       src/lib/entitlements.ts src/lib/entitlements.test.ts src/lib/entitlements.limits.test.ts \
       src/lib/usage.ts src/lib/usage.test.ts \
       src/lib/usageContext.tsx src/lib/usageContext.test.tsx
```

In `src/App.tsx`, remove `import { UsageProvider } from "./lib/usageContext";` and unwrap the `<UsageProvider>` element, keeping its children in place.

- [ ] **Step 7: Run the lib tests**

```bash
pnpm vitest run src/lib
```

Expected: PASS. Failures in `App.test.tsx` and route tests are expected at this point and are fixed in Task 3.

- [ ] **Step 8: Commit**

```bash
git add -A src/lib src/App.tsx
git commit -m "refactor(auth): drop plans, usage metering and the Stripe client"
```

---

### Task 3: UI — SignInModal, simplified Account, Dashboard cleanup

**Files:**

- Create: `src/components/SignInModal.tsx`, `src/components/SignInModal.test.tsx`
- Delete: `src/components/UpgradeModal.tsx`, `src/components/UpgradeModal.test.tsx`, `src/components/UsageBanner.tsx`, `src/components/UsageBanner.test.tsx`
- Modify: `src/routes/Dashboard.tsx:14-15,76-82,106`, `src/routes/Account.tsx`, `src/routes/Meetings.tsx:60-66`
- Test: `src/routes/Account.test.tsx`, `src/routes/Dashboard.test.tsx`, `src/App.test.tsx`

**Interfaces:**

- Consumes: `signin_required` event (Task 1), `useAuth()` without `plan` (Task 2), `onEvent` from `src/lib/api.ts`.
- Produces: default export `SignInModal` (no props).

- [ ] **Step 1: Write the failing test**

Create `src/components/SignInModal.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const handlers: Record<string, (p: unknown) => void> = {};
vi.mock("../lib/api", () => ({
  onEvent: (name: string, handler: (p: unknown) => void) => {
    handlers[name] = handler;
    return Promise.resolve(() => {});
  },
}));

const signIn = vi.fn().mockResolvedValue(undefined);
vi.mock("../lib/authContext", () => ({ useAuth: () => ({ signIn }) }));
vi.mock("../lib/i18n", () => ({ useI18n: () => ({ t: (k: string) => k }) }));

import SignInModal from "./SignInModal";

beforeEach(() => {
  signIn.mockClear();
});

describe("SignInModal", () => {
  it("stays hidden until the backend asks for sign-in", () => {
    render(<SignInModal />);
    expect(screen.queryByText("upgrade.signInTitle")).toBeNull();
  });

  it("opens on signin_required and starts the Google sign-in", async () => {
    render(<SignInModal />);
    await waitFor(() => expect(handlers["signin_required"]).toBeDefined());
    handlers["signin_required"]({ metric: "dictation" });
    await screen.findByText("upgrade.signInTitle");

    await userEvent.click(screen.getByText("account.continueGoogle"));
    expect(signIn).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
pnpm vitest run src/components/SignInModal.test.tsx
```

Expected: FAIL — `Failed to resolve import "./SignInModal"`.

- [ ] **Step 3: Create the component**

Create `src/components/SignInModal.tsx`:

```tsx
import { useEffect, useState } from "react";
import { useAuth } from "../lib/authContext";
import { useI18n } from "../lib/i18n";
import { onEvent } from "../lib/api";
import { GoogleG } from "./BrandLogos";

/// Shown when the backend blocked a dictation or meeting because nobody is
/// signed in. Wisper is free — signing in is the only requirement.
export default function SignInModal() {
  const [open, setOpen] = useState(false);
  const { signIn } = useAuth();
  const { t } = useI18n();

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    onEvent("signin_required", () => setOpen(true)).then((f) => {
      unlisten = f;
    });
    return () => unlisten?.();
  }, []);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-stone-950/50 p-6">
      <div className="w-full max-w-sm rounded-2xl border border-stone-200 bg-white p-6 dark:border-stone-800 dark:bg-stone-900">
        <h2 className="text-lg font-semibold text-stone-900 dark:text-stone-100">
          {t("upgrade.signInTitle")}
        </h2>
        <p className="mt-2 text-sm text-stone-500 dark:text-stone-400">
          {t("upgrade.signInBody")}
        </p>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            void signIn().catch(() => {});
          }}
          className="mt-5 inline-flex w-full items-center justify-center gap-3 rounded-lg bg-stone-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-stone-800 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-stone-200"
        >
          <GoogleG className="h-5 w-5" />
          {t("account.continueGoogle")}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="mt-4 w-full rounded-lg px-3 py-2 text-sm text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-800"
        >
          {t("upgrade.notNow")}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm vitest run src/components/SignInModal.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Delete the paid components and rewire Dashboard**

```bash
git rm src/components/UpgradeModal.tsx src/components/UpgradeModal.test.tsx \
       src/components/UsageBanner.tsx src/components/UsageBanner.test.tsx
```

In `src/routes/Dashboard.tsx`: delete the `UsageBanner` and `UpgradeModal` imports, add `import SignInModal from "../components/SignInModal";`, replace `<UpgradeModal />` with `<SignInModal />`, and simplify the home branch to:

```tsx
{
  view === "home" && <Home />;
}
```

- [ ] **Step 6: Simplify `Meetings.tsx`**

Replace the quota comment + branch (around lines 63-65) with:

```tsx
// The sign-in prompt is already surfaced by SignInModal (driven by the
// signin_required event); don't also show the raw error string.
if (msg === "auth_required") return;
```

- [ ] **Step 7: Simplify `Account.tsx`**

1. Delete these imports: `useUsage`, `WEEKLY_LIMITS`/`isUnlimited`, the whole `../lib/billing` import block, and `openUrl` from `@tauri-apps/plugin-opener`. Drop `useEffect` from the React import if nothing else uses it.
2. Delete the `billingInterval` and `billing` state, the `userId`/`isPro` billing `useEffect`, and the `free`/`planName` consts.
3. In the signed-out hero, keep only the local-audio benefit row:

```tsx
<ul className="mt-9 w-full max-w-sm space-y-4 text-left">
  <Benefit text={t("account.benefit.local")} />
</ul>
```

4. In the signed-in view, delete the plan badge `<span>` (the `account.planBadge` element), the entire usage grid / unlimited card block (`{free ? (...) : (...)}`), and both Wisper Pro cards (`{free && (...)}` and `{!free && (...)}`). What remains: header, identity card (avatar, name, email, sign-out button), the error line, and the sign-out confirm dialog.
5. Delete the now-unused `MetricCard` helper at the bottom of the file. Keep `Benefit`, `Card`, and `Avatar`.
6. Update the file's doc comment to:

```tsx
/// Account screen: Google sign-in when signed out, and the signed-in identity
/// card with a sign-out button. Wisper is free — there is no plan or billing.
```

- [ ] **Step 8: Update the affected route/app tests**

- `src/routes/Account.test.tsx`: delete `vi.mock("../lib/usageContext", ...)`, `vi.mock("../lib/billing", ...)` and their imports; delete `plan:` from every `useAuth` mock return; delete these cases — "free plan shows weekly usage rows", "pro plan shows Unlimited", "free: annual is default and Upgrade starts an annual checkout", "pro: Manage subscription opens the billing portal", "pro: a live billing update flips the cancellation date to a renewal date" — plus any other case asserting on `billing.*` or the plan badge. Keep the sign-in, sign-out, and identity cases (drop the plan-badge assertion from the identity case).
- `src/routes/Dashboard.test.tsx` and `src/App.test.tsx`: delete the `usageContext` mock blocks and remove `plan: "free"` from the `useAuth` mocks.

- [ ] **Step 9: Run the full suite**

```bash
pnpm typecheck && pnpm test
```

Expected: PASS. (`src/lib/i18n.billing.test.ts` still passes here — its keys are removed in Task 4.)

- [ ] **Step 10: Commit**

```bash
git add -A src
git commit -m "feat(ui): replace the upgrade flow with a sign-in prompt"
```

---

### Task 4: i18n — strip paid copy from all 15 locales

**Files:**

- Create (temporary): `scripts/strip-paid-i18n.mjs`
- Delete: `src/lib/i18n.billing.test.ts`
- Modify: `src/lib/i18n.tsx`, `src/lib/i18n.test.tsx`

**Interfaces:**

- Consumes: `DICTS` and `LANGS`, already exported from `src/lib/i18n.tsx`.
- Produces: a dictionary with no `billing.*`, no paid `upgrade.*`, and no `usage.banner` keys. Keys that MUST survive (used by `SignInModal`): `upgrade.signInTitle`, `upgrade.signInBody`, `upgrade.notNow`, `account.continueGoogle`.

- [ ] **Step 1: Write the failing guard test**

Append to `src/lib/i18n.test.tsx` (add `DICTS, LANGS` to the existing import from `./i18n`):

```tsx
describe("no paid-tier copy", () => {
  const GONE = [
    "usage.banner",
    "upgrade.limitTitle",
    "upgrade.limitBodyDictation",
    "upgrade.limitBodyMeeting",
    "upgrade.perMonth",
    "upgrade.perYear",
    "upgrade.comingSoon",
    "account.planBadge",
    "account.plan.free",
    "account.plan.pro",
    "account.wordsThisWeek",
    "account.meetingsThisWeek",
    "account.unlimited",
    "account.benefit.usage",
    "account.benefit.plan",
  ];

  it("has no billing keys in any language", () => {
    for (const lang of LANGS) {
      const offenders = Object.keys(DICTS[lang]).filter((k) =>
        k.startsWith("billing."),
      );
      expect(offenders, lang).toEqual([]);
    }
  });

  it("has no plan or quota keys in any language", () => {
    for (const lang of LANGS) {
      for (const key of GONE) {
        expect(DICTS[lang][key], `${lang}/${key}`).toBeUndefined();
      }
    }
  });

  it("keeps the sign-in prompt copy in English", () => {
    expect(DICTS["en"]["upgrade.signInTitle"]).toBeTruthy();
    expect(DICTS["en"]["upgrade.signInBody"]).toBeTruthy();
    expect(DICTS["en"]["upgrade.notNow"]).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
pnpm vitest run src/lib/i18n.test.tsx
```

Expected: FAIL — billing keys are present in every language.

- [ ] **Step 3: Write the one-off strip script**

Create `scripts/strip-paid-i18n.mjs`:

```js
// One-off: delete every paid-tier key from src/lib/i18n.tsx across all locales.
// Handles single-line entries and entries whose value wraps to the next line
// (a wrapped entry starts at `"key":` and ends at the first line ending with a
// comma). Delete this script after it runs.
import { readFileSync, writeFileSync } from "node:fs";

const EXACT = new Set([
  "usage.banner",
  "upgrade.limitTitle",
  "upgrade.limitBodyDictation",
  "upgrade.limitBodyMeeting",
  "upgrade.perMonth",
  "upgrade.perYear",
  "upgrade.comingSoon",
  "account.planBadge",
  "account.plan.free",
  "account.plan.pro",
  "account.wordsThisWeek",
  "account.meetingsThisWeek",
  "account.unlimited",
  "account.benefit.usage",
  "account.benefit.plan",
]);

const drop = (key) => EXACT.has(key) || key.startsWith("billing.");

const path = "src/lib/i18n.tsx";
const out = [];
let skipping = false;

for (const line of readFileSync(path, "utf8").split("\n")) {
  if (skipping) {
    if (/,\s*$/.test(line)) skipping = false;
    continue;
  }
  const m = line.match(/^\s*"([^"]+)":/);
  if (m && drop(m[1])) {
    skipping = !/,\s*$/.test(line);
    continue;
  }
  out.push(line);
}

writeFileSync(path, out.join("\n"));
console.log("stripped");
```

- [ ] **Step 4: Run the script, then remove it**

```bash
node scripts/strip-paid-i18n.mjs
git rm -f --ignore-unmatch src/lib/i18n.billing.test.ts
rm scripts/strip-paid-i18n.mjs
rmdir scripts 2>/dev/null || true
pnpm format
```

Sanity check that nothing else was eaten:

```bash
grep -c '"nav.home"' src/lib/i18n.tsx   # expect 15 (one per locale)
grep -c '"billing\.' src/lib/i18n.tsx   # expect 0
```

- [ ] **Step 5: Reword `account.subtitle`**

`account.subtitle` still says "plan and billing". Five locales define it — replace each value (the rest fall back to English):

| locale | new value                   |
| ------ | --------------------------- |
| en     | `"Manage your account."`    |
| pt     | `"Gerencie sua conta."`     |
| es     | `"Gestiona tu cuenta."`     |
| pl     | `"Zarządzaj swoim kontem."` |
| tr     | `"Hesabını yönet."`         |

Then check the neighbours with `grep -n "account.signInSubtitle\|onboarding.login.body" src/lib/i18n.tsx` — their current wording ("free account", "audio stays on your device") is still accurate, so leave them.

- [ ] **Step 6: Run the suite**

```bash
pnpm format:check && pnpm lint && pnpm typecheck && pnpm test
```

Expected: PASS, including the new guard cases.

- [ ] **Step 7: Commit**

```bash
git add -A src
git commit -m "chore(i18n): remove plan, price and quota copy"
```

---

### Task 5: Supabase — delete the Stripe functions and the billing schema

**Files:**

- Delete: `supabase/functions/` (entire directory)
- Create: `supabase/migrations/0007_drop_billing.sql`
- Modify: `supabase/README.md`

**Interfaces:**

- Consumes: nothing — no frontend code references `profiles.plan`, `usage_events`, or `current_usage()` after Task 2.
- Produces: a `profiles` table with only `id, email, full_name, avatar_url, created_at, updated_at`.

⚠️ **Destructive on production.** Running `0007` against the live self-hosted Supabase (`https://supabase.wisper.chat`) permanently deletes the `usage_events` table and the billing columns. Confirm with the repo owner before applying it there; applying it locally/in CI is safe.

- [ ] **Step 1: Delete the Edge Functions**

```bash
git rm -r supabase/functions
```

- [ ] **Step 2: Write the migration**

Create `supabase/migrations/0007_drop_billing.sql`:

```sql
-- Wisper is free and open source: remove the paid tier entirely. Drops the
-- Stripe linkage columns, the `plan` column, and the usage metering table and
-- RPC. Accounts (auth.users + public.profiles) are unaffected.

drop function if exists public.current_usage();
drop table if exists public.usage_events;

alter table public.profiles
  drop column if exists stripe_customer_id,
  drop column if exists stripe_subscription_status,
  drop column if exists current_period_end,
  drop column if exists cancel_at_period_end,
  drop column if exists plan;

-- 0004 revoked blanket UPDATE and re-granted only (full_name, avatar_url),
-- which is still exactly what a client needs — nothing to re-grant here.
```

- [ ] **Step 3: Apply it locally and verify**

```bash
supabase db reset   # replays 0001..0007 against the local stack
```

Then in the local SQL editor / `psql`:

```sql
select column_name from information_schema.columns
where table_schema = 'public' and table_name = 'profiles';
select to_regclass('public.usage_events');
```

Expected: the first returns `id, email, full_name, avatar_url, created_at, updated_at` (no `plan`, no `stripe_*`); the second returns `null`.

If the Supabase CLI isn't installed locally, say so in the commit body and hand the file to the owner to run in the SQL editor — do not skip the file.

- [ ] **Step 4: Update `supabase/README.md`**

Replace the "Verifying RLS" section with:

```md
## Verifying RLS

After a test sign-in, in the SQL editor run `select id, email from public.profiles;`
— you should see exactly one row per user. As a signed-in client, updating another
user's row must FAIL (RLS scopes access to your own row).
```

Also remove every sentence mentioning Stripe, plans, Edge Functions, or the service-role webhook, and change the setup step that says to apply `migrations/0001_profiles.sql` so it applies **all** files in `migrations/` (or `supabase db push`).

- [ ] **Step 5: Commit**

```bash
git add -A supabase
git commit -m "chore(supabase): drop the Stripe functions and billing schema"
```

---

### Task 6: Docs — remove the monetization docs and fix the claims

**Files:**

- Delete: `docs/STRIPE.md`, `docs/MONETIZATION.md`, `docs/superpowers/plans/2026-06-26-monetization-phase1-metering-limits.md`, `docs/superpowers/plans/2026-06-26-monetization-phase2-stripe-checkout.md`, `docs/superpowers/specs/2026-06-26-monetization-subscription-limits-design.md`
- Modify: `docs/AUTH.md`, `README.md`

**Interfaces:**

- Consumes: the final behavior from Tasks 1-5.
- Produces: documentation matching the shipped app (no plans; sign-in required when Supabase is configured).

- [ ] **Step 1: Delete the monetization docs**

```bash
git rm docs/STRIPE.md docs/MONETIZATION.md \
       docs/superpowers/plans/2026-06-26-monetization-phase1-metering-limits.md \
       docs/superpowers/plans/2026-06-26-monetization-phase2-stripe-checkout.md \
       docs/superpowers/specs/2026-06-26-monetization-subscription-limits-design.md
```

Check nothing links to them:

```bash
grep -rn "MONETIZATION\|STRIPE.md\|monetization" --include="*.md" . | grep -v node_modules | grep -v "\.claude/"
```

Expected: no hits other than this plan file.

- [ ] **Step 2: Rewrite the intro and gating section of `docs/AUTH.md`**

Replace the opening lines with:

```md
# Authentication & accounts

Wisper is free and open source — there are no paid plans. A Google account is
used to sign in so history and meetings are scoped to you. Sign-in is required
for dictation and meetings when the app is built with Supabase credentials, and
skipped entirely when it isn't.
```

Replace the whole `## Plans & gating (the monetization seam)` section with:

```md
## Sign-in gate

- The webview pushes the session state to Rust via `setSignedIn()`
  (`src/lib/api.ts` → `set_signed_in` in `src-tauri/src/signin.rs`), stored in
  `AppState.signed_in`.
- `src-tauri/src/lib.rs` checks that flag before injecting a dictation and
  before starting a meeting; when it's false it emits `signin_required` and
  `src/components/SignInModal.tsx` shows the Google prompt.
- Builds without `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` push `true`, so
  a fork with no backend is fully usable.
```

In the manual smoke test, change step 3 to: `App returns to the Account screen showing your name and email.`

- [ ] **Step 3: Fix the README claims**

In `README.md`:

- Around line 66: change "no cloud, no account, no telemetry, no subscription" to `**no cloud, no telemetry, no subscription**`, and add: `A free Google sign-in identifies you; your audio never leaves your computer.`
- Around line 79, comparison table: change the `**Account required**` value from `No` to `Free account`.
- Around line 255: `**No account, no telemetry, no network calls** for transcription.` → `**No telemetry, no network calls** for transcription.`
- Add one line under the intro: `Wisper is free — every feature is in this repository and there is nothing to upgrade to.`
- Sweep for leftovers: `grep -n -i "upgrade\|subscription\|per month\|wisper pro" README.md` and remove any remaining pitch for a paid tier.

- [ ] **Step 4: Verify formatting**

```bash
pnpm format:check
```

Expected: PASS (Prettier formats Markdown too; run `pnpm format` if it complains).

- [ ] **Step 5: Commit**

```bash
git add -A docs README.md
git commit -m "docs: drop the monetization docs and correct the account claims"
```

---

### Task 7: Pre-public sweep and flip the repo to public

**Files:**

- Modify: none by default — the sweep may surface something that must be removed or rotated first.

**Interfaces:**

- Consumes: the finished state of Tasks 1-6.
- Produces: `99labdev/wisper` public on GitHub.

⚠️ **Effectively irreversible.** Making a repository public exposes its entire history. Do not run Step 4 without explicit confirmation from the repo owner.

- [ ] **Step 1: Confirm no secrets are tracked in the working tree**

```bash
git ls-files | grep -Ei '(^|/)\.env($|\.)' || echo "OK: nothing but .env.example"
git ls-files | xargs grep -l -E 'sk_(live|test)_|SUPABASE_SERVICE|STRIPE_SECRET' 2>/dev/null
```

Expected: the first prints only `.env.example` (or the OK line); the second prints nothing.

- [ ] **Step 2: Confirm no secrets were ever committed**

```bash
git log --all --diff-filter=A --name-only --format= | sort -u | grep -Ei '(^|/)\.env$|secret|credential' || echo "OK: no secret-looking file was ever added"
git log --all -p -S 'sk_live_' --oneline | head
git log --all -p -S 'service_role' --oneline | head
```

Expected: the first prints the OK line; the `sk_live_` search prints nothing. `service_role` hits are acceptable only when they are the role _name_ in SQL/docs — inspect each one. The Supabase **anon** key is publishable by design; an actual **service-role** key or Stripe secret in history is a blocker → rotate it in Supabase/Stripe before continuing.

- [ ] **Step 3: Confirm the tree is clean and everything is green**

```bash
git status --porcelain            # expect: empty
pnpm format:check && pnpm lint && pnpm typecheck && pnpm test
cd src-tauri && cargo fmt --check && cargo clippy -- -D warnings && cargo test && cd ..
```

Expected: all PASS.

- [ ] **Step 4: Push, merge, then flip visibility (owner confirmation required)**

```bash
git push -u origin HEAD
gh pr create --fill --base main
# after review + merge:
gh repo edit 99labdev/wisper --visibility public --accept-visibility-change-consequences
gh repo view 99labdev/wisper --json visibility
```

Expected: `{"visibility":"PUBLIC"}`.

- [ ] **Step 5: Report the follow-ups (do not implement here)**

- `.github/workflows/release.yml` still stages a private release and mirrors it to the public `99labdev/wisper-releases`. Public repos get free macOS runner minutes, so the mirror could be dropped and releases published straight from this repo — a deliberate change, out of scope.
- The marketing site (`99labdev/wisper.chat`, separate repo) still advertises pricing/Pro and needs its own pass.
- If a Stripe account/product exists for Wisper, archive the products and delete the webhook endpoint so it stops receiving events.
