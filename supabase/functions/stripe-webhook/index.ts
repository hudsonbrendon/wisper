import Stripe from "https://esm.sh/stripe@17.5.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { planForStatus } from "../_shared/plan.ts";

Deno.serve(async (req) => {
  const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
    httpClient: Stripe.createFetchHttpClient(),
    apiVersion: "2024-12-18.acacia",
  });
  const sig = req.headers.get("stripe-signature");
  if (!sig) return new Response("Missing stripe-signature", { status: 400 });
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
    console.error("Webhook signature verification failed:", e);
    return new Response("Invalid signature", { status: 400 });
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
    const { data, error } = await admin
      .from("profiles")
      .update({
        plan: planForStatus(sub.status),
        stripe_subscription_status: sub.status,
        current_period_end: new Date(
          sub.current_period_end * 1000,
        ).toISOString(),
      })
      .eq("stripe_customer_id", sub.customer as string)
      .select();
    if (error) throw error;
    if (!data || data.length === 0) {
      return new Response("no profile linked to customer; retry", { status: 409 });
    }
  } else if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    // Ensure the customer is linked to the user even if the customer row was
    // created by Stripe rather than our function (defensive).
    if (session.client_reference_id && session.customer) {
      const { error } = await admin
        .from("profiles")
        .update({ stripe_customer_id: session.customer as string })
        .eq("id", session.client_reference_id);
      if (error) throw error;
    }
  }

  return new Response("ok", { status: 200 });
});
