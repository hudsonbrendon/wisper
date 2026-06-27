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
  const opts =
    Object.keys(body).length > 0 ? { body } : ({} as Record<string, unknown>);
  const { data, error } = await getSupabase().functions.invoke(fn, opts as never);
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

export interface BillingInfo {
  status: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
}

/// Read the signed-in user's billing details (subscription status, period end,
/// and whether it's set to cancel) so the Account screen can show the renewal
/// or cancellation date. Returns null when unconfigured or on any read miss.
export async function getBillingInfo(
  userId: string,
): Promise<BillingInfo | null> {
  if (!isSupabaseConfigured()) return null;
  const { data, error } = await getSupabase()
    .from("profiles")
    .select("stripe_subscription_status, current_period_end, cancel_at_period_end")
    .eq("id", userId)
    .single();
  if (error || !data) return null;
  return {
    status: (data.stripe_subscription_status as string | null) ?? null,
    currentPeriodEnd: (data.current_period_end as string | null) ?? null,
    cancelAtPeriodEnd: Boolean(data.cancel_at_period_end),
  };
}
