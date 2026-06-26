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
