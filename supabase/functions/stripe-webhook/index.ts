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
