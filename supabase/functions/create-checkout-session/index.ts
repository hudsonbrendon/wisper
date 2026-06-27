import Stripe from "npm:stripe@17.5.0";
import { createClient } from "npm:@supabase/supabase-js@2.45.0";
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
      const { error: updateErr } = await admin
        .from("profiles")
        .update({ stripe_customer_id: customerId })
        .eq("id", user.id);
      if (updateErr) {
        return json({ error: "failed to persist customer" }, 500);
      }
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price, quantity: 1 }],
      client_reference_id: user.id,
      subscription_data: { metadata: { supabase_user_id: user.id } },
      success_url: "https://wisper.chat/?checkout=success",
      cancel_url: "https://wisper.chat/?checkout=cancel",
    });

    if (!session.url) return json({ error: "no checkout url" }, 500);
    return json({ url: session.url });
  } catch (e) {
    console.error("billing function error:", e);
    return json({ error: "internal error" }, 400);
  }
});
