import Stripe from "npm:stripe@17.5.0";
import { createClient } from "npm:@supabase/supabase-js@2.45.0";
import { corsHeaders } from "../_shared/cors.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response("ok", { headers: corsHeaders });
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
      return_url: "https://wisper.chat/?portal=return",
    });

    return json({ url: session.url });
  } catch (e) {
    console.error("billing function error:", e);
    return json({ error: "internal error" }, 400);
  }
});
