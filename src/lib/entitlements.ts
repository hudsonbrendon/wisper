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

/// The two metered metrics. `dictation_words` accrues by word count per
/// dictation; `meeting` accrues by 1 per started meeting.
export type Metric = "dictation_words" | "meeting";

/// Free-tier weekly caps; Pro is unlimited. The reset window (Monday 00:00 UTC)
/// is enforced server-side by current_usage(); these are just the ceilings.
export const WEEKLY_LIMITS: Record<Plan, Record<Metric, number>> = {
  free: { dictation_words: 2000, meeting: 2 },
  pro: { dictation_words: Infinity, meeting: Infinity },
};

export function isUnlimited(plan: Plan): boolean {
  return WEEKLY_LIMITS[plan].dictation_words === Infinity;
}

/// How much of a metric remains this week. Pro → Infinity. Clamped at 0.
export function remainingFor(plan: Plan, metric: Metric, used: number): number {
  const limit = WEEKLY_LIMITS[plan][metric];
  if (limit === Infinity) return Infinity;
  return Math.max(0, limit - used);
}
