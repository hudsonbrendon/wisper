# Monetization Phase 2 — Stripe Checkout & Billing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let free users upgrade to Wisper Pro via Stripe Checkout (monthly $8 / annual $72), reflect the plan instantly via Supabase Realtime, and let Pro users manage/cancel through the Stripe Customer Portal — all wired into the Account screen's "Plans and Billing" UI.

**Architecture:** Three Supabase Edge Functions (Deno) hold the Stripe secret and are the only writer of `profiles.plan`: `create-checkout-session` and `create-portal-session` return hosted Stripe URLs the desktop app opens in the system browser; `stripe-webhook` verifies Stripe's signature and updates the plan on subscription events (service role). The React app subscribes to its own `profiles` row via Realtime so the plan flips the instant the webhook writes it. The Account UI gains a monthly/annual toggle (annual default), checkout buttons, an "Explore features" link, and (for Pro) plan info + "Manage subscription".

**Tech Stack:** Supabase Edge Functions (Deno + `esm.sh/stripe`), Postgres + RLS + Realtime, React 19 + TS, Vitest, `@supabase/supabase-js`, `@tauri-apps/plugin-opener`, Stripe CLI (`stripe listen`).

## Global Constraints

- **Pricing (verbatim):** monthly **$8 USD** (`STRIPE_PRICE_MONTHLY` = `price_1TmjijLxa6vDjBawXqWseqfl`), annual **$72 USD** (`STRIPE_PRICE_ANNUAL` = `price_1TmjikLxa6vDjBawov6vMEBS`). Product `prod_UmIJxGWvHoowXC`. Stripe account `acct_1TmjWnLxa6vDjBaw` (TEST mode).
- **Secrets live only in `supabase/.env`** (gitignored): `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_PRICE_MONTHLY`, `STRIPE_PRICE_ANNUAL`, `STRIPE_PRODUCT`, plus `STRIPE_WEBHOOK_SECRET` (added from `stripe listen`). **Never commit any key.** The Stripe secret key NEVER reaches the app bundle — only the Edge Functions read it.
- **`profiles.plan` stays server-authoritative.** Only the webhook (service role) writes it; clients still cannot (RLS from Phase 1). This plan does not loosen that.
- **Plan mapping:** a subscription `status` of `active` or `trialing` ⇒ `plan = 'pro'`; anything else ⇒ `'free'`.
- **Annual is the default toggle selection.** The "save" copy is derived: monthly $8 × 12 = $96/yr vs annual $72/yr ⇒ save $24/yr.
- **"Explore features"** opens `https://whisper.chat` in the system browser. The website's Pricing page is OUT OF SCOPE (separate repo).
- **New UI strings are real i18n keys translated to all 15 languages** (en, pt, es, fr, de, it, nl, ru, pl, tr, ja, ko, zh, ar, hi) — follow the established `Dict` pattern in `src/lib/i18n.tsx`; `{var}` interpolation; do not hardcode user-facing English.
- **Tests:** Vitest (`pnpm test`) for frontend with `vi.mock` for `@supabase/supabase-js`/Tauri; `deno test` for the Edge Functions' pure helper; the full checkout↔webhook↔Realtime loop is validated by the documented local e2e (`supabase functions serve` + `stripe listen`). Package manager `pnpm`; `deno` and `stripe` CLIs are installed.
- **No Stripe in the app bundle / no new app deps.** Billing calls go through `supabase.functions.invoke`.

## File Structure

**Supabase:**
- `supabase/migrations/0003_billing.sql` (new) — `profiles` stripe columns + add `profiles` to the realtime publication.
- `supabase/functions/_shared/cors.ts` (new) — shared CORS headers.
- `supabase/functions/_shared/plan.ts` (new) — `planForStatus` pure helper.
- `supabase/functions/_shared/plan.test.ts` (new) — Deno test for the helper.
- `supabase/functions/create-checkout-session/index.ts` (new)
- `supabase/functions/create-portal-session/index.ts` (new)
- `supabase/functions/stripe-webhook/index.ts` (new)

**Frontend (`src/`):**
- `lib/billing.ts` (new) — `startCheckout(interval)`, `openBillingPortal()`.
- `lib/billing.test.ts` (new)
- `lib/auth.ts` (modify) — add `subscribePlan(userId, cb)` (Realtime).
- `lib/authContext.tsx` (modify) — subscribe to plan changes; expose `subscriptionStatus`/`currentPeriodEnd`? (no — keep minimal: re-fetch plan on Realtime). 
- `lib/auth.test.ts` (modify) — test `subscribePlan`.
- `lib/i18n.tsx` (modify) — billing keys × 15 languages.
- `routes/Account.tsx` (modify) — "Plans and Billing" UI (toggle, checkout, explore, portal).
- `routes/Account.test.tsx` (modify) — billing UI tests.
- `docs/STRIPE.md` (new) — Phase 2 local e2e.

---

## Task 1: Billing schema — `profiles` stripe columns + Realtime

**Files:**
- Create: `supabase/migrations/0003_billing.sql`

**Interfaces:**
- Consumes: the `public.profiles` table (Phase 1 / accounts feature).
- Produces: columns `stripe_customer_id text`, `stripe_subscription_status text`, `current_period_end timestamptz` on `profiles`; `profiles` added to the `supabase_realtime` publication (so clients receive UPDATE events on plan changes). `stripe_customer_id` readable by its owner (existing select RLS already covers all columns).

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0003_billing.sql`:

```sql
-- Stripe linkage for billing. Written only by the service role (the webhook);
-- clients can read their own row (existing profiles_select_own policy) but the
-- existing RLS already blocks client writes to these columns.
alter table public.profiles
  add column if not exists stripe_customer_id text,
  add column if not exists stripe_subscription_status text,
  add column if not exists current_period_end timestamptz;

create index if not exists profiles_stripe_customer_idx
  on public.profiles (stripe_customer_id);

-- Realtime: let the app receive UPDATE events on its own profile row so the
-- plan flips the instant the webhook writes it. RLS still scopes which rows a
-- client may see, so a user only ever receives their own updates.
alter publication supabase_realtime add table public.profiles;
```

- [ ] **Step 2: Apply to the local DB**

Run: `docker exec -i supabase_db_wisper psql -U postgres -d postgres < supabase/migrations/0003_billing.sql`
Expected: `ALTER TABLE`, `CREATE INDEX`, `ALTER PUBLICATION` with no error. (If `alter publication ... add table` errors with "already member", that's fine — it's idempotent enough for a fresh DB; on re-run wrap is unneeded.)

- [ ] **Step 3: Verify columns + publication**

Run:
```bash
docker exec supabase_db_wisper psql -U postgres -d postgres -tAc "select column_name from information_schema.columns where table_name='profiles' and column_name in ('stripe_customer_id','stripe_subscription_status','current_period_end') order by 1;"
docker exec supabase_db_wisper psql -U postgres -d postgres -tAc "select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='profiles';"
```
Expected: three columns listed; the publication query returns `1`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0003_billing.sql
git commit -m "feat(billing): add stripe columns to profiles and enable realtime"
```

---

## Task 2: Edge Function shared helpers + plan mapping (Deno-tested)

**Files:**
- Create: `supabase/functions/_shared/cors.ts`
- Create: `supabase/functions/_shared/plan.ts`
- Create: `supabase/functions/_shared/plan.test.ts`

**Interfaces:**
- Produces: `export const corsHeaders` (CORS headers object); `export function planForStatus(status: string): "pro" | "free"`. Consumed by all three Edge Functions.

- [ ] **Step 1: Write the failing Deno test**

Create `supabase/functions/_shared/plan.test.ts`:

```ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { planForStatus } from "./plan.ts";

Deno.test("active and trialing map to pro", () => {
  assertEquals(planForStatus("active"), "pro");
  assertEquals(planForStatus("trialing"), "pro");
});

Deno.test("everything else maps to free", () => {
  assertEquals(planForStatus("canceled"), "free");
  assertEquals(planForStatus("past_due"), "free");
  assertEquals(planForStatus("unpaid"), "free");
  assertEquals(planForStatus("incomplete"), "free");
  assertEquals(planForStatus(""), "free");
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `deno test supabase/functions/_shared/plan.test.ts`
Expected: FAIL — `Module not found "./plan.ts"`.

- [ ] **Step 3: Implement the helpers**

Create `supabase/functions/_shared/plan.ts`:

```ts
/// A Stripe subscription is "pro" only while actively paid. Past-due/canceled/
/// incomplete all fall back to free — the user loses Pro until they're active
/// again (the webhook re-promotes them on the next active event).
export function planForStatus(status: string): "pro" | "free" {
  return status === "active" || status === "trialing" ? "pro" : "free";
}
```

Create `supabase/functions/_shared/cors.ts`:

```ts
export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
```

- [ ] **Step 4: Run it to verify it passes**

Run: `deno test supabase/functions/_shared/plan.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/
git commit -m "feat(billing): add edge-function shared cors + plan mapping helper"
```

---

## Task 3: Edge Function — `create-checkout-session`

**Files:**
- Create: `supabase/functions/create-checkout-session/index.ts`

**Interfaces:**
- Consumes: `corsHeaders` (Task 2); env `STRIPE_SECRET_KEY`, `STRIPE_PRICE_MONTHLY`, `STRIPE_PRICE_ANNUAL`, and the auto-injected `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.
- Produces: an HTTP function. Request body `{ "interval": "month" | "year" }` + `Authorization: Bearer <user JWT>`. Response `{ "url": "<stripe checkout url>" }`. Side effect: creates/stores `profiles.stripe_customer_id` for the user.

- [ ] **Step 1: Implement**

Create `supabase/functions/create-checkout-session/index.ts`:

```ts
import Stripe from "https://esm.sh/stripe@17.5.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "../_shared/cors.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
      httpClient: Stripe.createFetchHttpClient(),
      apiVersion: "2024-12-18.acacia",
    });
    const url = Deno.env.get("SUPABASE_URL")!;
    const authHeader = req.headers.get("Authorization") ?? "";

    // Identify the caller from their JWT.
    const userClient = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user },
    } = await userClient.auth.getUser();
    if (!user) return json({ error: "unauthorized" }, 401);

    const { interval } = await req.json();
    const price =
      interval === "year"
        ? Deno.env.get("STRIPE_PRICE_ANNUAL")!
        : Deno.env.get("STRIPE_PRICE_MONTHLY")!;

    const admin = createClient(
      url,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Reuse the customer if we already created one; else create + store it.
    const { data: profile } = await admin
      .from("profiles")
      .select("stripe_customer_id")
      .eq("id", user.id)
      .single();
    let customerId = profile?.stripe_customer_id as string | null;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email ?? undefined,
        metadata: { supabase_user_id: user.id },
      });
      customerId = customer.id;
      await admin
        .from("profiles")
        .update({ stripe_customer_id: customerId })
        .eq("id", user.id);
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price, quantity: 1 }],
      client_reference_id: user.id,
      subscription_data: { metadata: { supabase_user_id: user.id } },
      success_url: "https://whisper.chat/?checkout=success",
      cancel_url: "https://whisper.chat/?checkout=cancel",
    });

    return json({ url: session.url });
  } catch (e) {
    return json({ error: String(e) }, 400);
  }
});
```

- [ ] **Step 2: Type-check the function**

Run: `deno check supabase/functions/create-checkout-session/index.ts`
Expected: no type errors. (Network access to `esm.sh` is required for the first run to download types.)

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/create-checkout-session/
git commit -m "feat(billing): add create-checkout-session edge function"
```

---

## Task 4: Edge Function — `create-portal-session`

**Files:**
- Create: `supabase/functions/create-portal-session/index.ts`

**Interfaces:**
- Consumes: `corsHeaders`; env `STRIPE_SECRET_KEY` + injected Supabase vars.
- Produces: HTTP function; `Authorization: Bearer <user JWT>`; response `{ "url": "<portal url>" }`. Errors `{ error }` with 400/401 if the user has no `stripe_customer_id`.

- [ ] **Step 1: Implement**

Create `supabase/functions/create-portal-session/index.ts`:

```ts
import Stripe from "https://esm.sh/stripe@17.5.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "../_shared/cors.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
      httpClient: Stripe.createFetchHttpClient(),
      apiVersion: "2024-12-18.acacia",
    });
    const url = Deno.env.get("SUPABASE_URL")!;
    const authHeader = req.headers.get("Authorization") ?? "";

    const userClient = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user },
    } = await userClient.auth.getUser();
    if (!user) return json({ error: "unauthorized" }, 401);

    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: profile } = await admin
      .from("profiles")
      .select("stripe_customer_id")
      .eq("id", user.id)
      .single();
    const customerId = profile?.stripe_customer_id as string | null;
    if (!customerId) return json({ error: "no_customer" }, 400);

    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: "https://whisper.chat/?portal=return",
    });

    return json({ url: session.url });
  } catch (e) {
    return json({ error: String(e) }, 400);
  }
});
```

- [ ] **Step 2: Type-check**

Run: `deno check supabase/functions/create-portal-session/index.ts`
Expected: no type errors.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/create-portal-session/
git commit -m "feat(billing): add create-portal-session edge function"
```

---

## Task 5: Edge Function — `stripe-webhook`

**Files:**
- Create: `supabase/functions/stripe-webhook/index.ts`

**Interfaces:**
- Consumes: `corsHeaders`, `planForStatus` (Task 2); env `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` + injected Supabase vars.
- Produces: HTTP function that verifies the Stripe signature and, on `customer.subscription.*` events, updates `profiles` (matched by `stripe_customer_id`) with `plan` (via `planForStatus`), `stripe_subscription_status`, and `current_period_end`. On `checkout.session.completed`, links the customer to the user by `client_reference_id`. Returns `200 "ok"` (or `400` on bad signature). Idempotent (re-delivering the same event yields the same row state).

- [ ] **Step 1: Implement**

Create `supabase/functions/stripe-webhook/index.ts`:

```ts
import Stripe from "https://esm.sh/stripe@17.5.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { planForStatus } from "../_shared/plan.ts";

Deno.serve(async (req) => {
  const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
    httpClient: Stripe.createFetchHttpClient(),
    apiVersion: "2024-12-18.acacia",
  });
  const sig = req.headers.get("stripe-signature") ?? "";
  const body = await req.text();

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      body,
      sig,
      Deno.env.get("STRIPE_WEBHOOK_SECRET")!,
      undefined,
      Stripe.createSubtleCryptoProvider(),
    );
  } catch (e) {
    return new Response(`Webhook signature verification failed: ${e}`, {
      status: 400,
    });
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  if (
    event.type === "customer.subscription.created" ||
    event.type === "customer.subscription.updated" ||
    event.type === "customer.subscription.deleted"
  ) {
    const sub = event.data.object as Stripe.Subscription;
    await admin
      .from("profiles")
      .update({
        plan: planForStatus(sub.status),
        stripe_subscription_status: sub.status,
        current_period_end: new Date(
          sub.current_period_end * 1000,
        ).toISOString(),
      })
      .eq("stripe_customer_id", sub.customer as string);
  } else if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    // Ensure the customer is linked to the user even if the customer row was
    // created by Stripe rather than our function (defensive).
    if (session.client_reference_id && session.customer) {
      await admin
        .from("profiles")
        .update({ stripe_customer_id: session.customer as string })
        .eq("id", session.client_reference_id);
    }
  }

  return new Response("ok", { status: 200 });
});
```

- [ ] **Step 2: Type-check**

Run: `deno check supabase/functions/stripe-webhook/index.ts`
Expected: no type errors.

- [ ] **Step 3: Re-run the helper test (regression)**

Run: `deno test supabase/functions/_shared/plan.test.ts`
Expected: PASS (2 tests) — confirms the helper the webhook depends on is intact.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/stripe-webhook/
git commit -m "feat(billing): add stripe-webhook edge function"
```

---

## Task 6: Frontend billing lib + Realtime `subscribePlan`

**Files:**
- Create: `src/lib/billing.ts`
- Create: `src/lib/billing.test.ts`
- Modify: `src/lib/auth.ts` (add `subscribePlan`)
- Modify: `src/lib/auth.test.ts` (test `subscribePlan`)

**Interfaces:**
- Consumes: `getSupabase`, `isSupabaseConfigured` (from `./supabase`); `openUrl` (`@tauri-apps/plugin-opener`); `Plan` (`./entitlements`).
- Produces:
  - `billing.ts`: `export type Interval = "month" | "year"`; `export async function startCheckout(interval: Interval): Promise<void>`; `export async function openBillingPortal(): Promise<void>`.
  - `auth.ts`: `export function subscribePlan(userId: string, cb: (plan: Plan) => void): () => void` — subscribes to the user's `profiles` row via Realtime and calls `cb` with the new plan on UPDATE; returns an unsubscribe fn (no-op when Supabase is unconfigured).

- [ ] **Step 1: Write the failing billing test**

Create `src/lib/billing.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./supabase", () => ({
  getSupabase: vi.fn(),
  isSupabaseConfigured: vi.fn(() => true),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

import { getSupabase } from "./supabase";
import { openUrl } from "@tauri-apps/plugin-opener";
import { startCheckout, openBillingPortal } from "./billing";

const mockOpen = vi.mocked(openUrl);

beforeEach(() => vi.clearAllMocks());

describe("startCheckout", () => {
  it("invokes the checkout function with the interval and opens the URL", async () => {
    const invoke = vi
      .fn()
      .mockResolvedValue({ data: { url: "https://stripe/checkout" }, error: null });
    vi.mocked(getSupabase).mockReturnValue({ functions: { invoke } } as never);
    await startCheckout("year");
    expect(invoke).toHaveBeenCalledWith("create-checkout-session", {
      body: { interval: "year" },
    });
    expect(mockOpen).toHaveBeenCalledWith("https://stripe/checkout");
  });

  it("throws when the function returns an error", async () => {
    const invoke = vi.fn().mockResolvedValue({ data: null, error: { message: "x" } });
    vi.mocked(getSupabase).mockReturnValue({ functions: { invoke } } as never);
    await expect(startCheckout("month")).rejects.toBeTruthy();
    expect(mockOpen).not.toHaveBeenCalled();
  });
});

describe("openBillingPortal", () => {
  it("invokes the portal function and opens the URL", async () => {
    const invoke = vi
      .fn()
      .mockResolvedValue({ data: { url: "https://stripe/portal" }, error: null });
    vi.mocked(getSupabase).mockReturnValue({ functions: { invoke } } as never);
    await openBillingPortal();
    expect(invoke).toHaveBeenCalledWith("create-portal-session", {});
    expect(mockOpen).toHaveBeenCalledWith("https://stripe/portal");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test src/lib/billing.test.ts`
Expected: FAIL — module `./billing` not found.

- [ ] **Step 3: Implement `billing.ts`**

Create `src/lib/billing.ts`:

```ts
import { openUrl } from "@tauri-apps/plugin-opener";
import { getSupabase, isSupabaseConfigured } from "./supabase";

export type Interval = "month" | "year";

async function invokeUrl(
  fn: string,
  body: Record<string, unknown>,
): Promise<string> {
  if (!isSupabaseConfigured()) {
    throw new Error("Billing is unavailable: Supabase is not configured.");
  }
  const { data, error } = await getSupabase().functions.invoke(fn, { body });
  if (error) throw error;
  const url = (data as { url?: string } | null)?.url;
  if (!url) throw new Error(`${fn} returned no URL`);
  return url;
}

/// Start a Stripe Checkout for the chosen billing interval and open it in the
/// system browser. The plan flips to Pro via Realtime once Stripe's webhook
/// confirms the subscription.
export async function startCheckout(interval: Interval): Promise<void> {
  await openUrl(await invokeUrl("create-checkout-session", { interval }));
}

/// Open the Stripe Customer Portal so a Pro user can manage/cancel.
export async function openBillingPortal(): Promise<void> {
  await openUrl(await invokeUrl("create-portal-session", {}));
}
```

> Note: `functions.invoke(fn, {})` passes no body; `create-portal-session` ignores the body. The test asserts the exact call shape `("create-portal-session", {})`.

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm test src/lib/billing.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Write the failing `subscribePlan` test**

Add to `src/lib/auth.test.ts` a new block. The file already mocks `./supabase` with `getSupabase`/`isSupabaseConfigured`. Append:

```ts
describe("subscribePlan", () => {
  it("subscribes to the user's profile row and forwards plan updates", () => {
    const cb = vi.fn();
    let handler: (p: { new: { plan: string } }) => void = () => {};
    const channel = {
      on: vi.fn((_evt: string, _cfg: unknown, h: typeof handler) => {
        handler = h;
        return channel;
      }),
      subscribe: vi.fn(() => channel),
    };
    const removeChannel = vi.fn();
    vi.mocked(getSupabase).mockReturnValue({
      channel: vi.fn(() => channel),
      removeChannel,
    } as never);

    const off = subscribePlan("u1", cb);
    // The realtime payload delivers the new row; only valid plans forward.
    handler({ new: { plan: "pro" } });
    expect(cb).toHaveBeenCalledWith("pro");
    handler({ new: { plan: "garbage" } });
    expect(cb).toHaveBeenCalledTimes(1); // unchanged

    off();
    expect(removeChannel).toHaveBeenCalledWith(channel);
  });
});
```

Add `subscribePlan` to the existing import from `./auth` at the top of the test file (it currently imports `extractCode, signInWithGoogle, signOut, fetchPlan, onAuthChange` — add `subscribePlan`).

- [ ] **Step 6: Run it to verify it fails**

Run: `pnpm test src/lib/auth.test.ts -t subscribePlan`
Expected: FAIL — `subscribePlan` is not exported.

- [ ] **Step 7: Implement `subscribePlan` in `auth.ts`**

Add to `src/lib/auth.ts` (after `onAuthChange`):

```ts
/// Subscribe to the signed-in user's plan via Realtime. The webhook writes
/// `profiles.plan`; this delivers the new value so the UI updates instantly.
/// Returns an unsubscribe function (no-op when Supabase is unconfigured).
export function subscribePlan(
  userId: string,
  cb: (plan: Plan) => void,
): () => void {
  if (!isSupabaseConfigured()) return () => {};
  const client = getSupabase();
  const channel = client
    .channel(`profile-plan-${userId}`)
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "profiles",
        filter: `id=eq.${userId}`,
      },
      (payload: { new: { plan?: string } }) => {
        const p = payload.new?.plan;
        if (p === "pro" || p === "free") cb(p);
      },
    )
    .subscribe();
  return () => {
    client.removeChannel(channel);
  };
}
```

- [ ] **Step 8: Run it to verify it passes**

Run: `pnpm test src/lib/auth.test.ts src/lib/billing.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/lib/billing.ts src/lib/billing.test.ts src/lib/auth.ts src/lib/auth.test.ts
git commit -m "feat(billing): add billing lib and realtime subscribePlan"
```

---

## Task 7: Realtime plan propagation in `authContext`

**Files:**
- Modify: `src/lib/authContext.tsx`
- Modify: `src/lib/authContext.test.tsx`

**Interfaces:**
- Consumes: `subscribePlan` (Task 6).
- Produces: when `user` is set, `AuthProvider` subscribes to plan changes and updates its `plan` state live; unsubscribes on user change/unmount. No public API change (consumers still read `plan` from `useAuth`).

- [ ] **Step 1: Write the failing test**

Add to `src/lib/authContext.test.tsx`. The file mocks `./auth`; extend that mock to include `subscribePlan`, then add a test that a delivered plan update re-renders. First update the existing `vi.mock("./auth", ...)` to add `subscribePlan: vi.fn(() => () => {})`. Then add:

```ts
it("updates the plan live when subscribePlan delivers a change", async () => {
  vi.mocked(getSession).mockResolvedValueOnce({ user: { id: "u1" } } as never);
  vi.mocked(fetchPlan).mockResolvedValueOnce("free");
  let deliver: (p: "pro" | "free") => void = () => {};
  vi.mocked(subscribePlan).mockImplementation((_id, cb) => {
    deliver = cb;
    return () => {};
  });

  render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );
  await waitFor(() => expect(screen.getByTestId("plan").textContent).toBe("free"));

  await act(async () => deliver("pro"));
  expect(screen.getByTestId("plan").textContent).toBe("pro");
});
```

Add `subscribePlan` to the `./auth` import in the test, and `act` to the `@testing-library/react` import. The `Probe` component already renders `plan` (from the Phase-1 tests in this file).

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test src/lib/authContext.test.tsx -t "updates the plan live"`
Expected: FAIL — `subscribePlan` not used by the provider (plan stays "free").

- [ ] **Step 3: Implement the subscription effect**

In `src/lib/authContext.tsx`, add `subscribePlan` to the import from `./auth`, then add a new effect inside `AuthProvider` (after the existing event-listener effect):

```tsx
  // Live plan updates: when the Stripe webhook flips profiles.plan, Realtime
  // delivers it here so Pro unlocks instantly without a reload.
  useEffect(() => {
    if (!user) return;
    const off = subscribePlan(user.id, (p) => setPlan(p));
    return off;
  }, [user]);
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm test src/lib/authContext.test.tsx`
Expected: PASS (all, including the new test).

- [ ] **Step 5: Commit**

```bash
git add src/lib/authContext.tsx src/lib/authContext.test.tsx
git commit -m "feat(billing): propagate plan changes into AuthProvider via realtime"
```

---

## Task 8: Billing i18n strings (all 15 languages)

**Files:**
- Modify: `src/lib/i18n.tsx`
- Create: `src/lib/i18n.billing.test.ts`

**Interfaces:**
- Produces these keys in every language dict (en values canonical; interpolation `{var}` preserved in all languages):
  - `billing.heading` = "Plans and Billing"
  - `billing.monthly` = "Monthly"
  - `billing.annual` = "Annual"
  - `billing.perMonth` = "$8/mo"
  - `billing.perYear` = "$72/yr"
  - `billing.saveAnnual` = "Save $24 with annual billing"
  - `billing.upgradeMonthly` = "Upgrade — $8/mo"
  - `billing.upgradeAnnual` = "Upgrade — $72/yr"
  - `billing.exploreFeatures` = "Explore features"
  - `billing.manageSubscription` = "Manage subscription"
  - `billing.cancelsOn` = "Cancels on {date}"
  - `billing.renewsOn` = "Renews on {date}"
  - `billing.opening` = "Opening…"
  - `billing.freeFeatures` = "2,000 words & 2 meetings per week"
  - `billing.proFeatures` = "Unlimited dictation & meetings"

- [ ] **Step 1: Write the failing parity test**

Create `src/lib/i18n.billing.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { DICTS, LANGS } from "./i18n";

const KEYS = [
  "billing.heading",
  "billing.monthly",
  "billing.annual",
  "billing.perMonth",
  "billing.perYear",
  "billing.saveAnnual",
  "billing.upgradeMonthly",
  "billing.upgradeAnnual",
  "billing.exploreFeatures",
  "billing.manageSubscription",
  "billing.cancelsOn",
  "billing.renewsOn",
  "billing.opening",
  "billing.freeFeatures",
  "billing.proFeatures",
];

describe("billing i18n", () => {
  it("defines every billing key in all languages", () => {
    for (const lang of LANGS) {
      for (const key of KEYS) {
        expect(DICTS[lang][key], `${lang}/${key}`).toBeTruthy();
      }
    }
  });

  it("preserves the {date} placeholder in cancelsOn/renewsOn everywhere", () => {
    for (const lang of LANGS) {
      expect(DICTS[lang]["billing.cancelsOn"]).toContain("{date}");
      expect(DICTS[lang]["billing.renewsOn"]).toContain("{date}");
    }
  });
});
```

> This test imports `DICTS` and `LANGS` from `i18n.tsx`. If they are not currently exported, Step 3 adds the exports (they are module-level constants already).

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test src/lib/i18n.billing.test.ts`
Expected: FAIL — either `DICTS`/`LANGS` not exported, or keys missing.

- [ ] **Step 3: Export `DICTS`/`LANGS` and add the keys**

In `src/lib/i18n.tsx`: ensure `export const DICTS = {...}` and a `export const LANGS = Object.keys(DICTS)` exist (add `export` to the existing `DICTS` const; add `LANGS` next to it if absent).

Then add the 15 keys to **every** language dict (append near the other `account.*`/`upgrade.*` keys). Use the canonical English above for `en`, and these for `pt` (verbatim); translate the remaining 13 languages naturally, **keeping `{date}` and the `$8`/`$72`/`$24` tokens unchanged**:

```
pt:
"billing.heading": "Planos e cobrança"
"billing.monthly": "Mensal"
"billing.annual": "Anual"
"billing.perMonth": "$8/mês"
"billing.perYear": "$72/ano"
"billing.saveAnnual": "Economize $24 com cobrança anual"
"billing.upgradeMonthly": "Assinar — $8/mês"
"billing.upgradeAnnual": "Assinar — $72/ano"
"billing.exploreFeatures": "Explorar recursos"
"billing.manageSubscription": "Gerenciar assinatura"
"billing.cancelsOn": "Cancela em {date}"
"billing.renewsOn": "Renova em {date}"
"billing.opening": "Abrindo…"
"billing.freeFeatures": "2.000 palavras e 2 reuniões por semana"
"billing.proFeatures": "Ditado e reuniões ilimitados"
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm test src/lib/i18n.billing.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/i18n.tsx src/lib/i18n.billing.test.ts
git commit -m "i18n(billing): add Plans and Billing strings in all 15 languages"
```

---

## Task 9: Account "Plans and Billing" UI

**Files:**
- Modify: `src/routes/Account.tsx`
- Modify: `src/routes/Account.test.tsx`

**Interfaces:**
- Consumes: `useAuth` (`plan`, `user`), `startCheckout`/`openBillingPortal` (`./lib/billing`), `openUrl` (`@tauri-apps/plugin-opener`), i18n `billing.*` keys (Task 8). The Pro `current_period_end`/`stripe_subscription_status` come from the `profiles` row — read via a small `useUsage`-style fetch is overkill; instead read them off `user`? They are NOT on `user`. **Decision:** expose `subscriptionStatus`/`currentPeriodEnd` is out of scope; the Pro card shows plan info using `billing.proFeatures` and the portal button. (Date display is a follow-up once the profile row is surfaced — keep this task to the toggle/checkout/explore/portal.)
- Produces: the Wisper Pro card (free) becomes a billing panel with a Monthly/Annual **toggle (annual selected by default)**, the "save" line, an **Upgrade** button calling `startCheckout(interval)`, and an **Explore features** button opening `https://whisper.chat`. The Pro state shows `billing.proFeatures` + **Manage subscription** (`openBillingPortal`) + **Explore features**.

- [ ] **Step 1: Write the failing tests**

In `src/routes/Account.test.tsx`, add mocks + tests. Add near the top:

```ts
vi.mock("../lib/billing", () => ({
  startCheckout: vi.fn(),
  openBillingPortal: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
```

Then add tests (import `startCheckout, openBillingPortal` from `../lib/billing` and `openUrl` from `@tauri-apps/plugin-opener`):

```ts
it("free: annual is default and Upgrade starts an annual checkout", async () => {
  mockUseAuth.mockReturnValue({
    user: { id: "u1", email: "a@b.com" } as never,
    plan: "free",
    loading: false,
    signIn,
    signOut,
  });
  render(<I18nProvider><Account /></I18nProvider>);
  // Annual toggle is pre-selected → the upgrade button reflects the annual price.
  const upgrade = screen.getByRole("button", { name: /\$72\s*\/\s*yr/i });
  await userEvent.click(upgrade);
  expect(vi.mocked(startCheckout)).toHaveBeenCalledWith("year");
});

it("free: switching to monthly checks out monthly", async () => {
  mockUseAuth.mockReturnValue({
    user: { id: "u1", email: "a@b.com" } as never,
    plan: "free",
    loading: false,
    signIn,
    signOut,
  });
  render(<I18nProvider><Account /></I18nProvider>);
  await userEvent.click(screen.getByRole("button", { name: /^monthly$/i }));
  await userEvent.click(screen.getByRole("button", { name: /\$8\s*\/\s*mo/i }));
  expect(vi.mocked(startCheckout)).toHaveBeenCalledWith("month");
});

it("free: Explore features opens whisper.chat", async () => {
  mockUseAuth.mockReturnValue({
    user: { id: "u1", email: "a@b.com" } as never,
    plan: "free",
    loading: false,
    signIn,
    signOut,
  });
  render(<I18nProvider><Account /></I18nProvider>);
  await userEvent.click(screen.getByRole("button", { name: /explore features/i }));
  expect(vi.mocked(openUrl)).toHaveBeenCalledWith("https://whisper.chat");
});

it("pro: Manage subscription opens the billing portal", async () => {
  mockUseAuth.mockReturnValue({
    user: { id: "u1", email: "a@b.com" } as never,
    plan: "pro",
    loading: false,
    signIn,
    signOut,
  });
  render(<I18nProvider><Account /></I18nProvider>);
  await userEvent.click(
    screen.getByRole("button", { name: /manage subscription/i }),
  );
  expect(vi.mocked(openBillingPortal)).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm test src/routes/Account.test.tsx`
Expected: FAIL — the toggle/upgrade/explore/manage controls don't exist yet.

- [ ] **Step 3: Implement the billing panel**

In `src/routes/Account.tsx`: add imports

```tsx
import { startCheckout, openBillingPortal } from "../lib/billing";
import { openUrl } from "@tauri-apps/plugin-opener";
```

Add an `interval` state (default `"year"`) inside the component:

```tsx
  const [interval, setInterval] = useState<"month" | "year">("year");
```

Replace the existing **Wisper Pro upsell** `Card` (the `{free && (...)}` block) with this billing panel:

```tsx
          {free && (
            <Card className="border-teal-200 bg-gradient-to-br from-teal-50 to-stone-50 dark:border-teal-900/40 dark:from-teal-950/30 dark:to-stone-900">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <div className="text-lg font-semibold text-stone-900 dark:text-stone-100">
                    Wisper Pro
                  </div>
                  <p className="mt-1 text-sm text-stone-600 dark:text-stone-400">
                    {t("billing.proFeatures")}
                  </p>
                </div>
                {/* Monthly / Annual toggle — annual default */}
                <div className="inline-flex rounded-lg border border-stone-300 p-0.5 text-sm dark:border-stone-700">
                  <button
                    type="button"
                    onClick={() => setInterval("month")}
                    className={
                      "rounded-md px-3 py-1.5 " +
                      (interval === "month"
                        ? "bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900"
                        : "text-stone-600 dark:text-stone-300")
                    }
                  >
                    {t("billing.monthly")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setInterval("year")}
                    className={
                      "rounded-md px-3 py-1.5 " +
                      (interval === "year"
                        ? "bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900"
                        : "text-stone-600 dark:text-stone-300")
                    }
                  >
                    {t("billing.annual")}
                  </button>
                </div>
              </div>
              {interval === "year" && (
                <p className="mt-2 text-xs font-medium text-teal-700 dark:text-teal-400">
                  {t("billing.saveAnnual")}
                </p>
              )}
              <div className="mt-4 flex flex-wrap gap-3">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => run(() => startCheckout(interval))}
                  className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-800 disabled:opacity-50 dark:bg-stone-100 dark:text-stone-900"
                >
                  {busy
                    ? t("billing.opening")
                    : interval === "year"
                      ? t("billing.upgradeAnnual")
                      : t("billing.upgradeMonthly")}
                </button>
                <button
                  type="button"
                  onClick={() => void openUrl("https://whisper.chat")}
                  className="rounded-lg border border-stone-300 px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-100 dark:border-stone-700 dark:text-stone-200 dark:hover:bg-stone-800"
                >
                  {t("billing.exploreFeatures")}
                </button>
              </div>
            </Card>
          )}
```

And add a **Pro billing card** right after the `{free && (...)}` block (so Pro users get management):

```tsx
          {!free && (
            <Card className="sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-lg font-semibold text-stone-900 dark:text-stone-100">
                  Wisper Pro
                </div>
                <p className="mt-1 text-sm text-stone-600 dark:text-stone-400">
                  {t("billing.proFeatures")}
                </p>
              </div>
              <div className="mt-4 flex flex-wrap gap-3 sm:mt-0">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => run(openBillingPortal)}
                  className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-800 disabled:opacity-50 dark:bg-stone-100 dark:text-stone-900"
                >
                  {busy ? t("billing.opening") : t("billing.manageSubscription")}
                </button>
                <button
                  type="button"
                  onClick={() => void openUrl("https://whisper.chat")}
                  className="rounded-lg border border-stone-300 px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-100 dark:border-stone-700 dark:text-stone-200 dark:hover:bg-stone-800"
                >
                  {t("billing.exploreFeatures")}
                </button>
              </div>
            </Card>
          )}
```

> The Phase-1 unlimited "∞" card already renders for Pro in the usage area; this adds the management controls below it. Both may show — acceptable.

- [ ] **Step 4: Run them to verify they pass**

Run: `pnpm test src/routes/Account.test.tsx`
Expected: PASS (existing + 4 new).

- [ ] **Step 5: Full suite + typecheck**

Run: `pnpm test && pnpm typecheck`
Expected: all PASS; tsc clean.

- [ ] **Step 6: Commit**

```bash
git add src/routes/Account.tsx src/routes/Account.test.tsx
git commit -m "feat(billing): wire Plans and Billing UI (toggle, checkout, portal, explore)"
```

---

## Task 10: Local end-to-end docs (`stripe listen`)

**Files:**
- Create: `docs/STRIPE.md`

**Interfaces:**
- Consumes: everything above.
- Produces: the runbook for testing the checkout loop locally.

- [ ] **Step 1: Write the doc**

Create `docs/STRIPE.md`:

````markdown
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
````

- [ ] **Step 2: Commit**

```bash
git add docs/STRIPE.md
git commit -m "docs(billing): add Stripe Phase 2 local e2e runbook"
```

---

## Self-Review

**Spec coverage (Phase 2):**
- Edge Functions create-checkout / create-portal / stripe-webhook → Tasks 3, 4, 5. ✅
- `profiles` stripe columns + Realtime → Task 1. ✅
- Realtime plan propagation → Tasks 6 (`subscribePlan`) + 7 (authContext). ✅
- Plans and Billing UI: monthly/annual toggle (annual default), save line, checkout, Explore features, Manage subscription → Task 9. ✅
- i18n for billing in 15 languages → Task 8. ✅
- Local e2e runbook → Task 10. ✅
- Plan mapping (active/trialing→pro) → Task 2 helper, used in Task 5. ✅
- **Deferred (noted):** the Pro card's "Cancels on {date}" date display needs the `profiles.current_period_end` surfaced to the client — keys exist (`billing.cancelsOn`/`renewsOn`) but wiring the date is a follow-up (the column + webhook write it; surfacing it to `useAuth` is a small later task). The website Pricing page is out of scope.

**Type/contract consistency:** `Interval = "month" | "year"` is used in `billing.ts` (Task 6) and the Account UI (Task 9) and matches the Edge Function's `interval` body param (Task 3). `subscribePlan(userId, cb)` signature matches between `auth.ts` (Task 6), its test, and `authContext` (Task 7). The webhook matches profiles by `stripe_customer_id`, which `create-checkout-session` populates (Tasks 3, 5). The function names invoked by the app (`create-checkout-session`, `create-portal-session`) match the function directory names (Tasks 3, 4). Env var names (`STRIPE_PRICE_MONTHLY/ANNUAL`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`) match `supabase/.env` and the global constraints.

**Placeholder scan:** No TBD/placeholder code steps. The one explicitly deferred item (the `{date}` display) is called out in Self-Review with its keys already created, not left as a silent gap.

**Ordering note for executors:** Task 2 (`plan.ts`) precedes Task 5 (webhook) which imports it. Task 6 (`subscribePlan`, `billing.ts`) precedes Tasks 7 and 9 which consume them. Task 8 (i18n keys) precedes Task 9 (UI that uses them). The Edge Functions (Tasks 3–5) need no app code and can be built any time after Task 2. The `STRIPE_WEBHOOK_SECRET` is only needed at local-e2e time (Task 10), not for the unit tests.
