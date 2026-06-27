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
