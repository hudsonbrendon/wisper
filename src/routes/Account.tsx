import { useState } from "react";
import { useAuth } from "../lib/authContext";
import { useUsage } from "../lib/usageContext";
import { WEEKLY_LIMITS, isUnlimited } from "../lib/entitlements";
import { useI18n } from "../lib/i18n";

/// Account screen. Login is OPTIONAL — the app works fully without it. When
/// signed in we show identity + current plan (the monetization surface).
export default function Account() {
  const { user, plan, loading, signIn, signOut } = useAuth();
  const { usage } = useUsage();
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return <div className="text-sm text-stone-500">{t("account.loading")}</div>;
  }

  return (
    <div className="max-w-md">
      <h1 className="mb-1 text-xl font-semibold text-stone-900 dark:text-stone-100">
        {t("account.title")}
      </h1>
      <p className="mb-6 text-sm text-stone-500 dark:text-stone-400">
        {t("account.subtitle")}
      </p>

      {user ? (
        <div className="rounded-xl border border-stone-200 p-4 dark:border-stone-800">
          <div className="text-sm font-medium text-stone-900 dark:text-stone-100">
            {user.email ?? user.id}
          </div>
          <span className="mt-2 inline-block rounded-full bg-stone-200 px-2.5 py-0.5 text-xs font-medium uppercase tracking-wide text-stone-700 dark:bg-stone-800 dark:text-stone-300">
            {t("account.planBadge", { plan })}
          </span>
          {!isUnlimited(plan) && (
            <div className="mt-4 space-y-2 text-xs text-stone-600 dark:text-stone-400">
              <UsageRow
                label={t("account.wordsThisWeek")}
                used={usage.dictation_words}
                limit={WEEKLY_LIMITS.free.dictation_words}
              />
              <UsageRow
                label={t("account.meetingsThisWeek")}
                used={usage.meetings}
                limit={WEEKLY_LIMITS.free.meeting}
              />
            </div>
          )}
          {isUnlimited(plan) && (
            <div className="mt-4 text-xs text-stone-500 dark:text-stone-400">
              {t("account.unlimited")}
            </div>
          )}
          <div className="mt-4">
            <button
              type="button"
              disabled={busy}
              onClick={() => run(signOut)}
              className="rounded-lg border border-stone-300 px-3 py-1.5 text-sm text-stone-700 hover:bg-stone-100 disabled:opacity-50 dark:border-stone-700 dark:text-stone-200 dark:hover:bg-stone-800"
            >
              {t("account.signOut")}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={() => run(signIn)}
          className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-800 disabled:opacity-50 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-stone-200"
        >
          {busy ? t("account.openingBrowser") : t("account.continueGoogle")}
        </button>
      )}

      {error && (
        <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>
      )}
    </div>
  );
}

function UsageRow({ label, used, limit }: { label: string; used: number; limit: number }) {
  const pct = Math.min(100, Math.round((used / limit) * 100));
  return (
    <div>
      <div className="mb-1 flex justify-between">
        <span>{label}</span>
        <span>
          {used.toLocaleString()} / {limit.toLocaleString()}
        </span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-stone-200 dark:bg-stone-800">
        <div
          className="h-1.5 rounded-full bg-teal-500"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
