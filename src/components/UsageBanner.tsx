import { useAuth } from "../lib/authContext";
import { useUsage } from "../lib/usageContext";
import { WEEKLY_LIMITS, isUnlimited } from "../lib/entitlements";

/// One-line nudge on Home once a free user crosses 80% of either weekly limit.
export default function UsageBanner() {
  const { plan } = useAuth();
  const { usage } = useUsage();
  if (isUnlimited(plan)) return null;

  const wordLimit = WEEKLY_LIMITS.free.dictation_words;
  const meetLimit = WEEKLY_LIMITS.free.meeting;
  const wordsHot = usage.dictation_words >= wordLimit * 0.8;
  const meetsHot = usage.meetings >= meetLimit * 0.8;
  if (!wordsHot && !meetsHot) return null;

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">
      You're near your weekly free limit —{" "}
      {usage.dictation_words.toLocaleString()} / {wordLimit.toLocaleString()} words
      · {usage.meetings} / {meetLimit} meetings. Upgrade to Pro for unlimited use.
    </div>
  );
}
