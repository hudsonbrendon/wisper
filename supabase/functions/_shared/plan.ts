/// A Stripe subscription is "pro" only while actively paid. Past-due/canceled/
/// incomplete all fall back to free — the user loses Pro until they're active
/// again (the webhook re-promotes them on the next active event).
export function planForStatus(status: string): "pro" | "free" {
  return status === "active" || status === "trialing" ? "pro" : "free";
}
