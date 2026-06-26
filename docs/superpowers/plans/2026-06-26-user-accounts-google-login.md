# User Accounts + Google Login Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Wisper users optionally sign in with Google through a Supabase-backed account, and lay the data + code seams (a per-user `plan` and a feature-gating helper) needed to monetize later — without limiting any feature today.

**Architecture:** The Tauri desktop app authenticates via a standard desktop OAuth 2.0 PKCE flow: a Rust command starts an ephemeral `127.0.0.1` loopback server, the app opens the system browser to Supabase's Google OAuth URL, and the loopback captures the returned `code`, which `@supabase/supabase-js` exchanges for a session. Sessions persist in the OS keychain (via the Rust `keyring` crate exposed as Tauri commands) rather than webview `localStorage`. A `profiles` table in Supabase Postgres holds each user's `plan` (default `free`), guarded by Row Level Security so clients can never escalate their own plan. A pure TypeScript `entitlements` module maps `(plan, feature) -> boolean` — wired everywhere but currently allowing every feature, so future limits are a one-line matrix change.

**Tech Stack:** Tauri 2, Rust 2021, React 19 + TypeScript, Vite, Vitest, Supabase (Postgres + Auth + RLS), `@supabase/supabase-js`, `tauri-plugin-oauth` (Rust), `keyring` (Rust), `@tauri-apps/plugin-opener` (already present).

## Global Constraints

- **The app MUST remain fully functional when logged out.** Login is additive and optional — local dictation, meetings, history, settings all work with no account. Never gate existing behavior behind auth.
- **Clients MUST NOT be able to change their own `plan`.** Plan is server-authoritative (RLS denies it); only the Supabase service role / future Stripe webhook may write it.
- **No feature is limited in this plan.** The entitlements matrix returns `true` for every `(plan, feature)` pair. This plan builds the seam, not the paywall.
- **Secrets:** `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are the only client config. The anon key is publishable (RLS enforces safety). Never put the Supabase service-role key in the app.
- **Frontend tests:** Vitest, files co-located as `*.test.ts`/`*.test.tsx`, run with `pnpm test`. Mock Tauri/Supabase modules with `vi.mock` (see `src/lib/updater.test.ts` for the established pattern).
- **Rust tests:** inline `#[cfg(test)]` modules, run with `cargo test` from `src-tauri/`.
- **Package manager is `pnpm`.** Tauri CLI commands are `pnpm tauri ...`.

---

## File Structure

**Supabase (new, version-controlled):**
- `supabase/migrations/0001_profiles.sql` — `profiles` table, new-user trigger, RLS policies.
- `supabase/README.md` — how to apply migrations + configure Google provider.

**Rust (`src-tauri/src/`):**
- `secure_store.rs` (new) — keychain-backed `secure_get` / `secure_set` / `secure_delete` commands.
- `oauth.rs` (new) — `start_oauth_server` loopback command.
- `lib.rs` (modify) — declare modules, register the three+one commands.
- `Cargo.toml` (modify) — add `keyring`, `tauri-plugin-oauth`.
- `capabilities/default.json` (modify) — allow `opener:allow-open-url`.

**Frontend (`src/`):**
- `lib/supabase.ts` (new) — Supabase client (PKCE + injectable storage).
- `lib/secureStorage.ts` (new) — storage adapter bridging Supabase ↔ Rust keychain commands.
- `lib/auth.ts` (new) — `signInWithGoogle` / `signOut` / `getSession` / `onAuthChange` / `fetchPlan`.
- `lib/entitlements.ts` (new) — `Plan`, `Feature`, `canUseFeature`, `DEFAULT_PLAN`.
- `lib/authContext.tsx` (new) — `AuthProvider` + `useAuth` + `useEntitlements`.
- `routes/Account.tsx` (new) — login / profile / logout / plan badge UI.
- `components/Sidebar.tsx` (modify) — add an "account" nav item.
- `routes/Dashboard.tsx` (modify) — route the `account` view.
- `App.tsx` (modify) — wrap the main window in `AuthProvider`.
- `vite-env.d.ts` (new) — type the `VITE_SUPABASE_*` env vars.
- `.env.example` (new), `.env` (new, gitignored).
- `docs/AUTH.md` (new) — end-to-end setup + flow docs.

---

## Task 1: Supabase schema — `profiles` table, new-user trigger, RLS

**Files:**
- Create: `supabase/migrations/0001_profiles.sql`
- Create: `supabase/README.md`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: a `public.profiles` table with columns `id uuid` (PK, FK → `auth.users`), `email text`, `full_name text`, `avatar_url text`, `plan text` (default `'free'`), `created_at timestamptz`, `updated_at timestamptz`. Later TS tasks read `plan` and (optionally) `full_name`/`avatar_url` for the signed-in user.

This task's "test" is applying the migration against a real Supabase project and verifying the trigger + RLS behave. SQL is verified by execution, not by a unit test framework.

- [ ] **Step 1: Write the migration SQL**

Create `supabase/migrations/0001_profiles.sql`:

```sql
-- Per-user profile, 1:1 with auth.users. `plan` is the monetization seam:
-- default 'free', writable ONLY by the service role (RLS below blocks clients).
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text,
  full_name   text,
  avatar_url  text,
  plan        text not null default 'free',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Auto-create a profile row whenever a new auth user signs up. Runs as the
-- definer (postgres), so it bypasses RLS to seed the row.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Row Level Security: a user may READ only their own profile, and UPDATE only
-- their own name/avatar. `plan` is intentionally NOT updatable by clients — the
-- WITH CHECK clause forbids changing it, so a user can never grant themselves a
-- paid plan. Plan changes happen via the service role (future Stripe webhook).
alter table public.profiles enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
  on public.profiles for select
  using (auth.uid() = id);

drop policy if exists "profiles_update_own_no_plan" on public.profiles;
create policy "profiles_update_own_no_plan"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id and plan = (select p.plan from public.profiles p where p.id = auth.uid()));
```

- [ ] **Step 2: Write the Supabase setup README**

Create `supabase/README.md`:

```markdown
# Supabase backend

## One-time project setup
1. Create a project at https://supabase.com (free tier is fine).
2. Authentication → Providers → Google: enable it. Create an OAuth client in
   Google Cloud Console (type "Web application"). Set the **Authorized redirect URI**
   to your Supabase callback: `https://<project-ref>.supabase.co/auth/v1/callback`.
   Paste the Google client ID + secret into the Supabase Google provider form.
3. Authentication → URL Configuration → **Redirect URLs**: add `http://127.0.0.1:*`
   (the desktop app uses an ephemeral loopback port — the wildcard allows any port).
4. Apply the schema: paste `migrations/0001_profiles.sql` into the SQL Editor and run it,
   OR use the Supabase CLI: `supabase db push`.

## Client config
Copy the project URL and the **anon/public** key into the app's `.env`:
```
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon-key>
```
The anon key is publishable; RLS enforces data safety. Never ship the service-role key.

## Verifying RLS
After a test sign-in, in the SQL editor run `select id, email, plan from public.profiles;`
— you should see exactly one row per user with `plan = 'free'`. As a signed-in client,
`update profiles set plan = 'pro'` must FAIL (RLS denies the plan change).
```

- [ ] **Step 3: Apply the migration and verify the trigger + RLS**

Apply `0001_profiles.sql` in the Supabase SQL Editor. Then in the SQL Editor run:

```sql
select tablename from pg_tables where schemaname = 'public' and tablename = 'profiles';
select tgname from pg_trigger where tgname = 'on_auth_user_created';
select polname from pg_policies where tablename = 'profiles';
```

Expected: `profiles` row returned; `on_auth_user_created` returned; two policies
(`profiles_select_own`, `profiles_update_own_no_plan`) returned.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0001_profiles.sql supabase/README.md
git commit -m "feat(auth): add Supabase profiles schema with plan column and RLS"
```

---

## Task 2: Supabase client with PKCE + injectable storage

**Files:**
- Create: `src/lib/supabase.ts`
- Create: `src/lib/supabase.test.ts`
- Create: `src/vite-env.d.ts`
- Create: `.env.example`
- Modify: `.gitignore` (ensure `.env` is ignored)

**Interfaces:**
- Consumes: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` from `import.meta.env`.
- Produces: `export const supabase: SupabaseClient` and `export function createSupabase(storage: SupabaseAuthStorage): SupabaseClient`, where `SupabaseAuthStorage` is `{ getItem(key: string): Promise<string | null>; setItem(key: string, value: string): Promise<void>; removeItem(key: string): Promise<void> }`. Later tasks import `supabase` to call `auth.*` and `from("profiles")`.

- [ ] **Step 1: Add the dependency**

Run:
```bash
pnpm add @supabase/supabase-js
```
Expected: `@supabase/supabase-js` appears under `dependencies` in `package.json`.

- [ ] **Step 2: Type the env vars**

Create `src/vite-env.d.ts`:

```ts
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
```

- [ ] **Step 3: Create `.env.example` and ensure `.env` is gitignored**

Create `.env.example`:

```
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-public-key
```

Confirm `.gitignore` contains a line matching `.env` (the file `.env` must never be
committed). If absent, add a line:

```
.env
```

- [ ] **Step 4: Write the failing test**

Create `src/lib/supabase.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn((url: string, key: string, opts: unknown) => ({
    url,
    key,
    opts,
  })),
}));

import { createClient } from "@supabase/supabase-js";
import { createSupabase } from "./supabase";

describe("createSupabase", () => {
  it("configures the client for desktop PKCE with the injected storage", () => {
    const storage = {
      getItem: vi.fn(),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    };
    createSupabase(storage);

    const opts = vi.mocked(createClient).mock.calls[0][2] as {
      auth: Record<string, unknown>;
    };
    expect(opts.auth.flowType).toBe("pkce");
    expect(opts.auth.storage).toBe(storage);
    expect(opts.auth.persistSession).toBe(true);
    expect(opts.auth.autoRefreshToken).toBe(true);
    // We capture the OAuth code ourselves from the loopback, so the client must
    // not try to parse a session out of the (nonexistent) page URL.
    expect(opts.auth.detectSessionInUrl).toBe(false);
  });
});
```

- [ ] **Step 5: Run test to verify it fails**

Run: `pnpm test src/lib/supabase.test.ts`
Expected: FAIL — `createSupabase` is not exported / module not found.

- [ ] **Step 6: Write the implementation**

Create `src/lib/supabase.ts`:

```ts
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { secureStorage } from "./secureStorage";

/// Async key/value store Supabase uses to persist the session. We back it with
/// the OS keychain (see secureStorage) instead of webview localStorage so the
/// refresh token never sits in plaintext in the WebView storage.
export interface SupabaseAuthStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export function createSupabase(
  storage: SupabaseAuthStorage,
): SupabaseClient {
  return createClient(
    import.meta.env.VITE_SUPABASE_URL,
    import.meta.env.VITE_SUPABASE_ANON_KEY,
    {
      auth: {
        flowType: "pkce",
        storage,
        persistSession: true,
        autoRefreshToken: true,
        // The desktop loopback hands us the OAuth `code` directly; we never load
        // a redirect URL into this webview, so disable URL session detection.
        detectSessionInUrl: false,
      },
    },
  );
}

export const supabase = createSupabase(secureStorage);
```

- [ ] **Step 7: Run test to verify it passes**

Run: `pnpm test src/lib/supabase.test.ts`
Expected: PASS.

> Note: `src/lib/secureStorage.ts` is created in Task 4. Until then, importing
> `supabase` at runtime would fail, but the unit test mocks `createClient` and
> calls only `createSupabase`, so it passes. Do not import `supabase` from app
> code before Task 4 is complete.

- [ ] **Step 8: Commit**

```bash
git add src/lib/supabase.ts src/lib/supabase.test.ts src/vite-env.d.ts .env.example .gitignore
git commit -m "feat(auth): add Supabase client configured for desktop PKCE"
```

---

## Task 3: Rust keychain commands (`secure_store`)

**Files:**
- Create: `src-tauri/src/secure_store.rs`
- Modify: `src-tauri/Cargo.toml` (add `keyring`)
- Modify: `src-tauri/src/lib.rs` (declare module + register commands)

**Interfaces:**
- Consumes: nothing.
- Produces: three Tauri commands invokable from JS — `secure_set(key: string, value: string) -> void`, `secure_get(key: string) -> string | null`, `secure_delete(key: string) -> void`. Keyed under the keychain service `"wisper-auth"`. Task 4's TS adapter calls these.

- [ ] **Step 1: Add the dependency**

In `src-tauri/Cargo.toml`, under `[dependencies]`, add after the `tauri-plugin-opener` line:

```toml
# OS keychain (macOS Keychain / Windows Credential Manager / Linux Secret
# Service) for the Supabase session token, so the refresh token is never stored
# in plaintext webview localStorage.
keyring = { version = "3", features = ["apple-native", "windows-native", "sync-secret-service"] }
```

- [ ] **Step 2: Write the failing test (pure mapping helper)**

Create `src-tauri/src/secure_store.rs` with only the helper + test first:

```rust
//! OS-keychain-backed secure storage for the Supabase auth session.

use keyring::{Entry, Error as KeyringError};

const SERVICE: &str = "wisper-auth";

/// Map a keyring `get_password` result into our command's Option result: a
/// missing entry is a normal "no session yet", not an error.
fn map_get(res: Result<String, KeyringError>) -> Result<Option<String>, String> {
    match res {
        Ok(v) => Ok(Some(v)),
        Err(KeyringError::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_entry_maps_to_none() {
        assert_eq!(map_get(Err(KeyringError::NoEntry)), Ok(None));
    }

    #[test]
    fn present_entry_maps_to_some() {
        assert_eq!(map_get(Ok("token".into())), Ok(Some("token".into())));
    }
}
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd src-tauri && cargo test secure_store`
Expected: FAIL — module not declared in `lib.rs` yet (compile error: file not part of crate).

- [ ] **Step 4: Declare the module so the test compiles**

In `src-tauri/src/lib.rs`, add a module declaration alongside the other `mod`
statements near the top of the file (find the existing `mod config;` /
`mod commands;` lines and add):

```rust
mod secure_store;
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd src-tauri && cargo test secure_store`
Expected: PASS (2 tests).

- [ ] **Step 6: Add the command functions**

Append to `src-tauri/src/secure_store.rs` (above the `#[cfg(test)]` module):

```rust
fn entry(key: &str) -> Result<Entry, String> {
    Entry::new(SERVICE, key).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn secure_set(key: String, value: String) -> Result<(), String> {
    entry(&key)?.set_password(&value).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn secure_get(key: String) -> Result<Option<String>, String> {
    map_get(entry(&key)?.get_password())
}

#[tauri::command]
pub fn secure_delete(key: String) -> Result<(), String> {
    match entry(&key)?.delete_credential() {
        Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}
```

- [ ] **Step 7: Register the commands**

In `src-tauri/src/lib.rs`, inside `tauri::generate_handler![ ... ]` (the list ending
with `set_ui_language,`), add these three lines before `set_ui_language,`:

```rust
            secure_store::secure_set,
            secure_store::secure_get,
            secure_store::secure_delete,
```

- [ ] **Step 8: Verify it builds and tests pass**

Run: `cd src-tauri && cargo test secure_store && cargo build`
Expected: tests PASS; build succeeds.

- [ ] **Step 9: Commit**

```bash
git add src-tauri/src/secure_store.rs src-tauri/src/lib.rs src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "feat(auth): add OS-keychain secure storage commands"
```

---

## Task 4: TypeScript secure-storage adapter

**Files:**
- Create: `src/lib/secureStorage.ts`
- Create: `src/lib/secureStorage.test.ts`

**Interfaces:**
- Consumes: Rust commands `secure_get` / `secure_set` / `secure_delete` (Task 3) via `invoke`.
- Produces: `export const secureStorage: SupabaseAuthStorage` (matching the interface from Task 2). Imported by `src/lib/supabase.ts`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/secureStorage.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { invoke } from "@tauri-apps/api/core";
import { secureStorage } from "./secureStorage";

const mockInvoke = vi.mocked(invoke);

beforeEach(() => vi.clearAllMocks());

describe("secureStorage", () => {
  it("getItem reads via secure_get", async () => {
    mockInvoke.mockResolvedValueOnce("token-value");
    const v = await secureStorage.getItem("sb-key");
    expect(mockInvoke).toHaveBeenCalledWith("secure_get", { key: "sb-key" });
    expect(v).toBe("token-value");
  });

  it("getItem returns null when the backend has no entry", async () => {
    mockInvoke.mockResolvedValueOnce(null);
    expect(await secureStorage.getItem("sb-key")).toBeNull();
  });

  it("setItem writes via secure_set", async () => {
    mockInvoke.mockResolvedValueOnce(undefined);
    await secureStorage.setItem("sb-key", "val");
    expect(mockInvoke).toHaveBeenCalledWith("secure_set", {
      key: "sb-key",
      value: "val",
    });
  });

  it("removeItem deletes via secure_delete", async () => {
    mockInvoke.mockResolvedValueOnce(undefined);
    await secureStorage.removeItem("sb-key");
    expect(mockInvoke).toHaveBeenCalledWith("secure_delete", { key: "sb-key" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/lib/secureStorage.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `src/lib/secureStorage.ts`:

```ts
import { invoke } from "@tauri-apps/api/core";
import type { SupabaseAuthStorage } from "./supabase";

/// Supabase auth storage backed by the OS keychain (Rust `secure_*` commands).
/// Keeps the refresh token out of webview localStorage.
export const secureStorage: SupabaseAuthStorage = {
  getItem: (key) => invoke<string | null>("secure_get", { key }),
  setItem: (key, value) => invoke<void>("secure_set", { key, value }),
  removeItem: (key) => invoke<void>("secure_delete", { key }),
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/lib/secureStorage.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/secureStorage.ts src/lib/secureStorage.test.ts
git commit -m "feat(auth): bridge Supabase session storage to OS keychain"
```

---

## Task 5: Rust loopback OAuth server (`oauth.rs`)

**Files:**
- Create: `src-tauri/src/oauth.rs`
- Modify: `src-tauri/Cargo.toml` (add `tauri-plugin-oauth`)
- Modify: `src-tauri/src/lib.rs` (declare module + register command)
- Modify: `src-tauri/capabilities/default.json` (allow `opener:allow-open-url`)

**Interfaces:**
- Consumes: nothing.
- Produces: Tauri command `start_oauth_server() -> number` (the bound loopback port). When the browser hits `http://127.0.0.1:<port>/...`, the backend emits a Tauri event `"oauth://url"` whose payload is the full callback URL string. Task 6 listens for that event.

- [ ] **Step 1: Add the dependency**

In `src-tauri/Cargo.toml`, under `[dependencies]`, add:

```toml
# Ephemeral 127.0.0.1 loopback server for the desktop OAuth redirect. We use its
# free `start` function (no plugin registration needed) and emit the captured
# callback URL to the frontend as an event.
tauri-plugin-oauth = "2"
```

- [ ] **Step 2: Write the implementation**

Create `src-tauri/src/oauth.rs`:

```rust
//! Desktop OAuth loopback: starts an ephemeral 127.0.0.1 server, and forwards
//! the redirect URL (with the `?code=...`) to the frontend via an event.

use tauri::{Emitter, Window};

/// Start a one-shot loopback server and return its port. The frontend builds
/// the Supabase OAuth URL with `redirectTo = http://127.0.0.1:<port>`, opens the
/// system browser, and waits for the `oauth://url` event carrying the callback
/// URL. The server shuts down automatically after the first request.
#[tauri::command]
pub async fn start_oauth_server(window: Window) -> Result<u16, String> {
    tauri_plugin_oauth::start(move |url| {
        // Best-effort: if the window is gone the login was abandoned.
        let _ = window.emit("oauth://url", url);
    })
    .map_err(|e| e.to_string())
}
```

- [ ] **Step 3: Declare the module and register the command**

In `src-tauri/src/lib.rs`, add the module declaration near the other `mod` lines:

```rust
mod oauth;
```

Then inside `tauri::generate_handler![ ... ]`, add before `set_ui_language,`:

```rust
            oauth::start_oauth_server,
```

- [ ] **Step 4: Allow opening URLs in the system browser**

In `src-tauri/capabilities/default.json`, add `"opener:allow-open-url"` to the
`permissions` array (after the existing `"opener:default"` line):

```json
    "opener:default",
    "opener:allow-open-url",
```

- [ ] **Step 5: Verify it builds**

Run: `cd src-tauri && cargo build`
Expected: build succeeds (downloads `tauri-plugin-oauth` and `keyring` on first run).

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/oauth.rs src-tauri/src/lib.rs src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/capabilities/default.json
git commit -m "feat(auth): add loopback OAuth server command"
```

---

## Task 6: Auth orchestration (`auth.ts`)

**Files:**
- Create: `src/lib/auth.ts`
- Create: `src/lib/auth.test.ts`

**Interfaces:**
- Consumes: `supabase` (Task 2), Rust command `start_oauth_server` (Task 5), the `oauth://url` event, `openUrl` from `@tauri-apps/plugin-opener`.
- Produces:
  - `export function extractCode(callbackUrl: string): string | null`
  - `export async function signInWithGoogle(): Promise<void>`
  - `export async function signOut(): Promise<void>`
  - `export async function getSession(): Promise<Session | null>`
  - `export function onAuthChange(cb: (session: Session | null) => void): () => void` (returns an unsubscribe fn)
  - `export async function fetchPlan(userId: string): Promise<Plan>` (reads `profiles.plan`, falls back to `DEFAULT_PLAN`)
  - Types `Session` and `Plan` re-exported for consumers. `Plan` comes from `entitlements.ts` (Task 7) — **implement Task 7 before this task's `fetchPlan`**, or stub the import; the ordering below assumes Task 7 exists.

- [ ] **Step 1: Write the failing test**

Create `src/lib/auth.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ once: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
vi.mock("./supabase", () => ({
  supabase: {
    auth: {
      signInWithOAuth: vi.fn(),
      exchangeCodeForSession: vi.fn(),
      signOut: vi.fn(),
      getSession: vi.fn(),
    },
    from: vi.fn(),
  },
}));

import { invoke } from "@tauri-apps/api/core";
import { once } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { supabase } from "./supabase";
import {
  extractCode,
  signInWithGoogle,
  signOut,
  fetchPlan,
} from "./auth";

const mockInvoke = vi.mocked(invoke);
const mockOnce = vi.mocked(once);
const mockOpenUrl = vi.mocked(openUrl);

beforeEach(() => vi.clearAllMocks());

describe("extractCode", () => {
  it("pulls the code query param from a callback URL", () => {
    expect(extractCode("http://127.0.0.1:5123/?code=abc123&x=1")).toBe(
      "abc123",
    );
  });
  it("returns null when there is no code", () => {
    expect(extractCode("http://127.0.0.1:5123/?error=denied")).toBeNull();
  });
});

describe("signInWithGoogle", () => {
  it("runs the loopback PKCE flow and exchanges the code for a session", async () => {
    mockInvoke.mockResolvedValueOnce(5123); // start_oauth_server -> port
    // once() resolves with the callback URL when the browser redirects.
    mockOnce.mockImplementationOnce(
      (_event: string, handler: (e: { payload: string }) => void) => {
        handler({ payload: "http://127.0.0.1:5123/?code=abc123" });
        return Promise.resolve(() => {});
      },
    );
    vi.mocked(supabase.auth.signInWithOAuth).mockResolvedValueOnce({
      data: { url: "https://supabase.co/auth/v1/authorize?x=1", provider: "google" },
      error: null,
    } as never);
    vi.mocked(supabase.auth.exchangeCodeForSession).mockResolvedValueOnce({
      data: { session: { user: { id: "u1" } } },
      error: null,
    } as never);

    await signInWithGoogle();

    expect(mockInvoke).toHaveBeenCalledWith("start_oauth_server");
    expect(supabase.auth.signInWithOAuth).toHaveBeenCalledWith({
      provider: "google",
      options: {
        redirectTo: "http://127.0.0.1:5123",
        skipBrowserRedirect: true,
      },
    });
    expect(mockOpenUrl).toHaveBeenCalledWith(
      "https://supabase.co/auth/v1/authorize?x=1",
    );
    expect(supabase.auth.exchangeCodeForSession).toHaveBeenCalledWith("abc123");
  });
});

describe("signOut", () => {
  it("delegates to supabase signOut", async () => {
    vi.mocked(supabase.auth.signOut).mockResolvedValueOnce({ error: null } as never);
    await signOut();
    expect(supabase.auth.signOut).toHaveBeenCalledTimes(1);
  });
});

describe("fetchPlan", () => {
  it("returns the plan from the profiles row", async () => {
    const single = vi.fn().mockResolvedValueOnce({
      data: { plan: "pro" },
      error: null,
    });
    const eq = vi.fn(() => ({ single }));
    const select = vi.fn(() => ({ eq }));
    vi.mocked(supabase.from).mockReturnValueOnce({ select } as never);

    expect(await fetchPlan("u1")).toBe("pro");
    expect(supabase.from).toHaveBeenCalledWith("profiles");
  });

  it("falls back to 'free' when the row or column is missing", async () => {
    const single = vi.fn().mockResolvedValueOnce({ data: null, error: null });
    const eq = vi.fn(() => ({ single }));
    const select = vi.fn(() => ({ eq }));
    vi.mocked(supabase.from).mockReturnValueOnce({ select } as never);

    expect(await fetchPlan("u1")).toBe("free");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/lib/auth.test.ts`
Expected: FAIL — module `./auth` not found.

- [ ] **Step 3: Write the implementation**

Create `src/lib/auth.ts`:

```ts
import { invoke } from "@tauri-apps/api/core";
import { once } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import { DEFAULT_PLAN, type Plan } from "./entitlements";

export type { Session };

/// Parse the OAuth `code` out of the loopback callback URL.
export function extractCode(callbackUrl: string): string | null {
  return new URL(callbackUrl).searchParams.get("code");
}

/// Full desktop PKCE login: start the loopback, open the system browser at the
/// Supabase Google URL, wait for the redirect, then exchange the code.
export async function signInWithGoogle(): Promise<void> {
  const port = await invoke<number>("start_oauth_server");
  const redirectTo = `http://127.0.0.1:${port}`;

  // Subscribe BEFORE opening the browser so we never miss the redirect.
  const callback = new Promise<string>((resolve, reject) => {
    once<string>("oauth://url", (event) => resolve(event.payload)).catch(
      reject,
    );
  });

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo, skipBrowserRedirect: true },
  });
  if (error) throw error;

  await openUrl(data.url);

  const callbackUrl = await callback;
  const code = extractCode(callbackUrl);
  if (!code) throw new Error("OAuth callback returned no authorization code");

  const { error: exchangeError } =
    await supabase.auth.exchangeCodeForSession(code);
  if (exchangeError) throw exchangeError;
}

export async function signOut(): Promise<void> {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function getSession(): Promise<Session | null> {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

/// Subscribe to login/logout. Returns an unsubscribe function.
export function onAuthChange(
  cb: (session: Session | null) => void,
): () => void {
  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    cb(session);
  });
  return () => data.subscription.unsubscribe();
}

/// Read the signed-in user's plan from `profiles`. Any miss → free.
export async function fetchPlan(userId: string): Promise<Plan> {
  const { data, error } = await supabase
    .from("profiles")
    .select("plan")
    .eq("id", userId)
    .single();
  if (error || !data?.plan) return DEFAULT_PLAN;
  return data.plan as Plan;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/lib/auth.test.ts`
Expected: PASS.

> If this task is implemented before Task 7, create `src/lib/entitlements.ts`
> first (it has no dependencies) — `auth.ts` imports `DEFAULT_PLAN` and `Plan`
> from it.

- [ ] **Step 5: Commit**

```bash
git add src/lib/auth.ts src/lib/auth.test.ts
git commit -m "feat(auth): add Google OAuth loopback orchestration"
```

---

## Task 7: Entitlements model (`entitlements.ts`)

**Files:**
- Create: `src/lib/entitlements.ts`
- Create: `src/lib/entitlements.test.ts`

**Interfaces:**
- Consumes: nothing (pure module).
- Produces:
  - `export type Plan = "free" | "pro"`
  - `export type Feature = "meetings" | "summaries" | "unlimited_history"`
  - `export const DEFAULT_PLAN: Plan = "free"`
  - `export function canUseFeature(plan: Plan, feature: Feature): boolean`
  Imported by `auth.ts` (Task 6) and `authContext.tsx` (Task 8).

- [ ] **Step 1: Write the failing test**

Create `src/lib/entitlements.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  canUseFeature,
  DEFAULT_PLAN,
  type Feature,
  type Plan,
} from "./entitlements";

const PLANS: Plan[] = ["free", "pro"];
const FEATURES: Feature[] = ["meetings", "summaries", "unlimited_history"];

describe("entitlements", () => {
  it("defaults new/anonymous users to the free plan", () => {
    expect(DEFAULT_PLAN).toBe("free");
  });

  // Monetization seam: TODAY every feature is allowed on every plan. When a
  // feature gets gated, flip its `free` entry to false and update this test.
  it("allows every feature on every plan (no limits yet)", () => {
    for (const plan of PLANS) {
      for (const feature of FEATURES) {
        expect(canUseFeature(plan, feature)).toBe(true);
      }
    }
  });

  it("denies unknown features safely", () => {
    expect(canUseFeature("free", "nope" as Feature)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/lib/entitlements.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `src/lib/entitlements.ts`:

```ts
/// The monetization seam. `plan` lives on each user's Supabase profile (server
/// authoritative). `canUseFeature` is the single chokepoint every gated feature
/// will call. TODAY nothing is limited — every entry is `true`. To gate a
/// feature later, set its `free` value to `false` (and add a `pro` upsell path).

export type Plan = "free" | "pro";

export type Feature = "meetings" | "summaries" | "unlimited_history";

export const DEFAULT_PLAN: Plan = "free";

const MATRIX: Record<Plan, Record<Feature, boolean>> = {
  free: { meetings: true, summaries: true, unlimited_history: true },
  pro: { meetings: true, summaries: true, unlimited_history: true },
};

export function canUseFeature(plan: Plan, feature: Feature): boolean {
  return MATRIX[plan]?.[feature] ?? false;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/lib/entitlements.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/entitlements.ts src/lib/entitlements.test.ts
git commit -m "feat(auth): add entitlements seam for future plan-based gating"
```

---

## Task 8: Auth context + hooks (`authContext.tsx`)

**Files:**
- Create: `src/lib/authContext.tsx`
- Create: `src/lib/authContext.test.tsx`

**Interfaces:**
- Consumes: `getSession`, `onAuthChange`, `fetchPlan`, `signInWithGoogle`, `signOut` (Task 6); `canUseFeature`, `DEFAULT_PLAN`, `Plan`, `Feature` (Task 7).
- Produces:
  - `export function AuthProvider({ children }: { children: ReactNode }): JSX.Element`
  - `export function useAuth(): AuthState` where `AuthState = { user: User | null; plan: Plan; loading: boolean; signIn: () => Promise<void>; signOut: () => Promise<void> }`
  - `export function useEntitlements(): { can: (feature: Feature) => boolean }`
  Consumed by `Account.tsx` (Task 9) and `App.tsx`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/authContext.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

vi.mock("./auth", () => ({
  getSession: vi.fn(),
  onAuthChange: vi.fn(() => () => {}),
  fetchPlan: vi.fn(),
  signInWithGoogle: vi.fn(),
  signOut: vi.fn(),
}));

import { getSession, fetchPlan } from "./auth";
import { AuthProvider, useAuth, useEntitlements } from "./authContext";

function Probe() {
  const { user, plan, loading } = useAuth();
  const { can } = useEntitlements();
  return (
    <div>
      <span data-testid="loading">{String(loading)}</span>
      <span data-testid="user">{user?.id ?? "none"}</span>
      <span data-testid="plan">{plan}</span>
      <span data-testid="meetings">{String(can("meetings"))}</span>
    </div>
  );
}

beforeEach(() => vi.clearAllMocks());

describe("AuthProvider", () => {
  it("exposes the logged-out default state (free plan, no user)", async () => {
    vi.mocked(getSession).mockResolvedValueOnce(null);
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("loading").textContent).toBe("false"),
    );
    expect(screen.getByTestId("user").textContent).toBe("none");
    expect(screen.getByTestId("plan").textContent).toBe("free");
    expect(screen.getByTestId("meetings").textContent).toBe("true");
  });

  it("loads the user and their plan when a session exists", async () => {
    vi.mocked(getSession).mockResolvedValueOnce({
      user: { id: "u1" },
    } as never);
    vi.mocked(fetchPlan).mockResolvedValueOnce("pro");
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("user").textContent).toBe("u1"),
    );
    expect(screen.getByTestId("plan").textContent).toBe("pro");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/lib/authContext.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `src/lib/authContext.tsx`:

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
  fetchPlan,
  signInWithGoogle,
  signOut as signOutFn,
} from "./auth";
import {
  canUseFeature,
  DEFAULT_PLAN,
  type Feature,
  type Plan,
} from "./entitlements";

interface AuthState {
  user: User | null;
  plan: Plan;
  loading: boolean;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [plan, setPlan] = useState<Plan>(DEFAULT_PLAN);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    const apply = async (u: User | null) => {
      if (!active) return;
      setUser(u);
      setPlan(u ? await fetchPlan(u.id) : DEFAULT_PLAN);
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
    plan,
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

/// Feature gate bound to the current user's plan. `can(feature)` is what UI
/// calls to decide whether to show/enable a feature. Today: always true.
export function useEntitlements(): { can: (feature: Feature) => boolean } {
  const { plan } = useAuth();
  return { can: (feature: Feature) => canUseFeature(plan, feature) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/lib/authContext.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/authContext.tsx src/lib/authContext.test.tsx
git commit -m "feat(auth): add AuthProvider, useAuth, useEntitlements"
```

---

## Task 9: Account UI + navigation + provider mount

**Files:**
- Create: `src/routes/Account.tsx`
- Create: `src/routes/Account.test.tsx`
- Modify: `src/components/Sidebar.tsx` (add `account` to `View` + a nav button)
- Modify: `src/routes/Dashboard.tsx` (render the `account` view)
- Modify: `src/App.tsx` (wrap the main window in `AuthProvider`)

**Interfaces:**
- Consumes: `useAuth` (Task 8).
- Produces: an `Account` screen reachable from the sidebar; logged-out shows a "Continue with Google" button, logged-in shows email + plan badge + "Sign out".

- [ ] **Step 1: Write the failing test for the Account component**

Create `src/routes/Account.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const signIn = vi.fn();
const signOut = vi.fn();

vi.mock("../lib/authContext", () => ({
  useAuth: vi.fn(),
}));

import { useAuth } from "../lib/authContext";
import Account from "./Account";

const mockUseAuth = vi.mocked(useAuth);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Account", () => {
  it("shows a Google sign-in button when logged out", async () => {
    mockUseAuth.mockReturnValue({
      user: null,
      plan: "free",
      loading: false,
      signIn,
      signOut,
    });
    render(<Account />);
    const btn = screen.getByRole("button", { name: /continue with google/i });
    await userEvent.click(btn);
    expect(signIn).toHaveBeenCalledTimes(1);
  });

  it("shows the email, plan badge, and sign-out when logged in", async () => {
    mockUseAuth.mockReturnValue({
      user: { id: "u1", email: "a@b.com" } as never,
      plan: "free",
      loading: false,
      signIn,
      signOut,
    });
    render(<Account />);
    expect(screen.getByText("a@b.com")).toBeInTheDocument();
    expect(screen.getByText(/free/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /sign out/i }));
    expect(signOut).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/routes/Account.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the Account component**

Create `src/routes/Account.tsx`:

```tsx
import { useState } from "react";
import { useAuth } from "../lib/authContext";

/// Account screen. Login is OPTIONAL — the app works fully without it. When
/// signed in we show identity + current plan (the monetization surface).
export default function Account() {
  const { user, plan, loading, signIn, signOut } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return <div className="text-sm text-stone-500">Loading…</div>;
  }

  return (
    <div className="max-w-md">
      <h1 className="mb-1 text-xl font-semibold text-stone-900 dark:text-stone-100">
        Account
      </h1>
      <p className="mb-6 text-sm text-stone-500 dark:text-stone-400">
        Sign in to sync your account. Wisper keeps working without one.
      </p>

      {user ? (
        <div className="rounded-xl border border-stone-200 p-4 dark:border-stone-800">
          <div className="text-sm font-medium text-stone-900 dark:text-stone-100">
            {user.email ?? user.id}
          </div>
          <span className="mt-2 inline-block rounded-full bg-stone-200 px-2.5 py-0.5 text-xs font-medium uppercase tracking-wide text-stone-700 dark:bg-stone-800 dark:text-stone-300">
            {plan} plan
          </span>
          <div className="mt-4">
            <button
              type="button"
              disabled={busy}
              onClick={() => run(signOut)}
              className="rounded-lg border border-stone-300 px-3 py-1.5 text-sm text-stone-700 hover:bg-stone-100 disabled:opacity-50 dark:border-stone-700 dark:text-stone-200 dark:hover:bg-stone-800"
            >
              Sign out
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={() => run(signIn)}
          className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-800 disabled:opacity-50 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-stone-200"
        >
          {busy ? "Opening browser…" : "Continue with Google"}
        </button>
      )}

      {error && (
        <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run the Account test to verify it passes**

Run: `pnpm test src/routes/Account.test.tsx`
Expected: PASS.

- [ ] **Step 5: Add the `account` view to the Sidebar**

In `src/components/Sidebar.tsx`, extend the `View` union (add `"account"`):

```ts
export type View =
  | "home"
  | "insights"
  | "meetings"
  | "dictionary"
  | "snippets"
  | "account"
  | "settings";
```

Add an icon to the `icons` record (place it after the `snippets` entry, before `settings`):

```tsx
  account: (
    <>
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </>
  ),
```

Add a nav button in the bottom group, just before the `settings` `NavButton`:

```tsx
        <NavButton
          icon="account"
          label="Account"
          active={view === "account"}
          onClick={() => onNavigate("account")}
        />
```

- [ ] **Step 6: Route the `account` view in Dashboard**

In `src/routes/Dashboard.tsx`, add the import near the other route imports:

```tsx
import Account from "./Account";
```

Add the render line alongside the other `view === ...` lines (after the `settings` line):

```tsx
          {view === "account" && <Account />}
```

- [ ] **Step 7: Wrap the main window in AuthProvider**

In `src/App.tsx`, import the provider and wrap the `Dashboard` branch (auth is only
needed in the main window, not the overlay/bubble):

```tsx
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useState } from "react";
import Dashboard from "./routes/Dashboard";
import MeetingBubble from "./routes/MeetingBubble";
import Overlay from "./routes/Overlay";
import { I18nProvider } from "./lib/i18n";
import { AuthProvider } from "./lib/authContext";

export default function App() {
  const [label] = useState(() => getCurrentWindow().label);

  return (
    <I18nProvider>
      {label === "overlay" ? (
        <Overlay />
      ) : label === "meeting-bubble" ? (
        <MeetingBubble />
      ) : (
        <AuthProvider>
          <Dashboard />
        </AuthProvider>
      )}
    </I18nProvider>
  );
}
```

- [ ] **Step 8: Run the full frontend test suite + typecheck**

Run: `pnpm test && pnpm typecheck`
Expected: all tests PASS; `tsc --noEmit` reports no errors.

> If `src/App.test.tsx` renders `Dashboard` and now hits real auth code, mock
> `./lib/authContext` (or `./lib/auth`) there the same way as in
> `authContext.test.tsx`, so the existing App test stays isolated from Supabase.

- [ ] **Step 9: Commit**

```bash
git add src/routes/Account.tsx src/routes/Account.test.tsx src/components/Sidebar.tsx src/routes/Dashboard.tsx src/App.tsx
git commit -m "feat(auth): add Account screen, nav entry, and AuthProvider mount"
```

---

## Task 10: End-to-end docs + manual verification

**Files:**
- Create: `docs/AUTH.md`

**Interfaces:**
- Consumes: everything above.
- Produces: a single doc describing setup + the live login flow + how to extend gating.

- [ ] **Step 1: Write the auth documentation**

Create `docs/AUTH.md`:

```markdown
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
```

- [ ] **Step 2: Run a live smoke test**

With a configured Supabase project and a populated `.env`, run:

Run: `pnpm tauri dev`
Then follow `docs/AUTH.md` "Manual smoke test" steps 2–5.
Expected: browser opens, consent completes, Account shows email + "free plan",
session survives a relaunch, sign-out clears it.

- [ ] **Step 3: Commit**

```bash
git add docs/AUTH.md
git commit -m "docs(auth): document accounts, OAuth flow, and the gating seam"
```

---

## Self-Review

**Spec coverage:**
- "Usuário consiga fazer login / login com Google" → Tasks 5, 6, 9 (loopback PKCE + Google + Account UI). ✅
- "Exista um back-end para gerenciar isso" → Task 1 (Supabase Postgres + Auth + RLS). ✅
- "Background pronto para monetizar / limitar features com base no plano" → Task 1 (`plan` column + RLS), Task 7 (entitlements matrix), Task 8 (`useEntitlements`). ✅
- "Por hora não vou monetizar" → entitlements matrix returns `true` for all; no feature gated. ✅
- "Possibilitar que o usuário criasse contas" → Supabase trigger auto-creates a `profiles` row on first Google sign-in (Task 1). ✅

**Type consistency:** `Plan` / `Feature` / `DEFAULT_PLAN` / `canUseFeature` defined in Task 7 and consumed unchanged in Tasks 6 and 8. `SupabaseAuthStorage` defined in Task 2, implemented in Task 4. `View` union extended consistently in Task 9. `start_oauth_server` (no args) / `secure_get|set|delete` signatures match between Rust (Tasks 3, 5) and TS callers (Tasks 4, 6). Event name `"oauth://url"` matches between `oauth.rs` (Task 5) and `auth.ts` (Task 6).

**Ordering note for executors:** Task 7 (`entitlements.ts`) has no dependencies and is imported by Tasks 6 and 8 — if executing strictly in number order, that's fine (6 is reached after... no: 6 precedes 7). **Implement Task 7 before Task 6's `fetchPlan` step**, or create `entitlements.ts` at the start of Task 6. Both tasks flag this inline. Similarly, `supabase.ts` (Task 2) imports `secureStorage` from Task 4 at module load — only the Task 2 unit test runs before Task 4 (it mocks `createClient` and never imports the live `supabase` singleton), so app code must not import `supabase` until Task 4 lands.

**Placeholder scan:** No TBD/TODO-as-work, no "add error handling" hand-waves — every code step ships complete code. The single intentional "TODO"-style marker is the documented monetization seam comment, which is the deliverable, not a gap.
