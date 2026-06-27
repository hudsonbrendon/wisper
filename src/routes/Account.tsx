import { useState, useEffect } from "react";
import { useAuth } from "../lib/authContext";
import { useUsage } from "../lib/usageContext";
import { WEEKLY_LIMITS, isUnlimited } from "../lib/entitlements";
import { useI18n } from "../lib/i18n";
import {
  startCheckout,
  openBillingPortal,
  getBillingInfo,
  subscribeBilling,
  type BillingInfo,
} from "../lib/billing";
import { openUrl } from "@tauri-apps/plugin-opener";
import { WisperBrand, GoogleG } from "../components/BrandLogos";

/// Account screen: a full-width identity/plan card, weekly usage metrics side
/// by side, and a Wisper Pro upsell for free users (the upgrade button starts
/// a Stripe checkout session; Pro users get a button to open the billing portal).
export default function Account() {
  const { user, plan, loading, signIn, signOut } = useAuth();
  const { usage } = useUsage();
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [billingInterval, setBillingInterval] = useState<"month" | "year">("year");
  const [billing, setBilling] = useState<BillingInfo | null>(null);
  const [confirmSignOut, setConfirmSignOut] = useState(false);

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

  // Pro: load the renewal/cancellation date for the management card. Re-runs
  // when the plan flips (Realtime), so it appears the moment a checkout lands.
  const userId = user?.id ?? null;
  const isPro = plan === "pro";
  useEffect(() => {
    if (!userId || !isPro) {
      setBilling(null);
      return;
    }
    let active = true;
    void getBillingInfo(userId).then((b) => {
      if (active) setBilling(b);
    });
    // Cancel/un-cancel keeps the plan at "pro", so the plan effect never
    // re-fires — subscribe so the renewal/cancellation date updates live.
    const unsub = subscribeBilling(userId, (b) => {
      if (active) setBilling(b);
    });
    return () => {
      active = false;
      unsub();
    };
  }, [userId, isPro]);

  if (loading) {
    return <div className="text-sm text-stone-500">{t("account.loading")}</div>;
  }

  // Signed out: a centered hero that fills the screen — app glyph, headline,
  // what an account gives you, and a Google button with the white "G" logo.
  if (!user) {
    return (
      <div className="flex min-h-[78vh] flex-col items-center justify-center px-6 text-center">
        <WisperBrand className="mb-7" />
        <h1 className="text-3xl font-semibold tracking-tight text-stone-900 dark:text-stone-100">
          {t("account.signInHeadline")}
        </h1>
        <p className="mt-3 max-w-md text-base text-stone-500 dark:text-stone-400">
          {t("account.signInSubtitle")}
        </p>

        <ul className="mt-9 w-full max-w-sm space-y-4 text-left">
          <Benefit text={t("account.benefit.local")} />
          <Benefit text={t("account.benefit.usage")} />
          <Benefit text={t("account.benefit.plan")} />
        </ul>

        <button
          type="button"
          disabled={busy}
          onClick={() => run(signIn)}
          className="mt-10 inline-flex w-full max-w-sm items-center justify-center gap-3 rounded-xl border border-white/10 bg-stone-900 px-5 py-3.5 text-sm font-medium text-white shadow-sm transition hover:bg-stone-800 disabled:opacity-50"
        >
          <GoogleG className="h-5 w-5" />
          {busy ? t("account.openingBrowser") : t("account.continueGoogle")}
        </button>

        {error && (
          <p className="mt-4 text-sm text-red-600 dark:text-red-400">{error}</p>
        )}
      </div>
    );
  }

  const free = !isUnlimited(plan);
  const planName = t(plan === "pro" ? "account.plan.pro" : "account.plan.free");

  // Google populates the Supabase session's user_metadata with the profile
  // name and photo; fall back to the email/initial when absent.
  const meta = (user?.user_metadata ?? {}) as Record<string, unknown>;
  const fullName =
    (meta.full_name as string) || (meta.name as string) || "";
  const avatarUrl =
    (meta.avatar_url as string) || (meta.picture as string) || "";
  const email = user?.email ?? user?.id ?? "";
  const displayName = fullName || email;

  return (
    <div className="mx-auto max-w-5xl">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-stone-900 dark:text-stone-100">
          {t("account.title")}
        </h1>
        <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">
          {t("account.subtitle")}
        </p>
      </header>

      <div className="space-y-4">
          {/* Identity + plan — full width */}
          <Card className="sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <Avatar url={avatarUrl} fallback={displayName} />
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-stone-900 dark:text-stone-100">
                  {displayName}
                </div>
                {fullName && (
                  <div className="truncate text-xs text-stone-500 dark:text-stone-400">
                    {email}
                  </div>
                )}
                <span className="mt-1 inline-block rounded-full bg-stone-200 px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-wide text-stone-700 dark:bg-stone-800 dark:text-stone-300">
                  {t("account.planBadge", { plan: planName })}
                </span>
              </div>
            </div>
            <div className="mt-4 sm:mt-0">
              <button
                type="button"
                disabled={busy}
                onClick={() => setConfirmSignOut(true)}
                className="rounded-lg border border-stone-300 px-4 py-2 text-sm text-stone-700 hover:bg-stone-100 disabled:opacity-50 dark:border-stone-700 dark:text-stone-200 dark:hover:bg-stone-800"
              >
                {t("account.signOut")}
              </button>
            </div>
          </Card>

          {/* Usage — words and meetings side by side (6 / 6) */}
          {free ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <MetricCard
                label={t("account.wordsThisWeek")}
                used={usage.dictation_words}
                limit={WEEKLY_LIMITS.free.dictation_words}
              />
              <MetricCard
                label={t("account.meetingsThisWeek")}
                used={usage.meetings}
                limit={WEEKLY_LIMITS.free.meeting}
              />
            </div>
          ) : (
            <Card className="items-center justify-center py-8 text-center">
              <div className="text-3xl">∞</div>
              <div className="mt-2 text-sm text-stone-600 dark:text-stone-300">
                {t("account.unlimited")}
              </div>
            </Card>
          )}

          {free && (
            <Card className="border-stone-200 bg-stone-50 dark:border-stone-800 dark:bg-stone-900">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <div className="text-lg font-semibold text-stone-900 dark:text-stone-100">
                    Wisper Pro
                  </div>
                  <p className="mt-1 text-sm text-stone-600 dark:text-stone-400">
                    {t("billing.proFeatures")}
                  </p>
                </div>
                {/* Monthly / Annual toggle — annual default */}
                <div className="inline-flex rounded-lg border border-stone-300 p-0.5 text-sm dark:border-stone-700">
                  <button
                    type="button"
                    onClick={() => setBillingInterval("month")}
                    className={
                      "rounded-md px-3 py-1.5 " +
                      (billingInterval === "month"
                        ? "bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900"
                        : "text-stone-600 dark:text-stone-300")
                    }
                  >
                    {t("billing.monthly")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setBillingInterval("year")}
                    className={
                      "rounded-md px-3 py-1.5 " +
                      (billingInterval === "year"
                        ? "bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900"
                        : "text-stone-600 dark:text-stone-300")
                    }
                  >
                    {t("billing.annual")}
                  </button>
                </div>
              </div>
              {billingInterval === "year" && (
                <p className="mt-2 text-xs font-medium text-stone-600 dark:text-stone-300">
                  {t("billing.saveAnnual")}
                </p>
              )}
              <div className="mt-4 flex flex-wrap gap-3">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => run(() => startCheckout(billingInterval))}
                  className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-800 disabled:opacity-50 dark:bg-stone-100 dark:text-stone-900"
                >
                  {busy
                    ? t("billing.opening")
                    : billingInterval === "year"
                      ? t("billing.upgradeAnnual")
                      : t("billing.upgradeMonthly")}
                </button>
                <button
                  type="button"
                  onClick={() => void openUrl("https://wisper.chat")}
                  className="rounded-lg border border-stone-300 px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-100 dark:border-stone-700 dark:text-stone-200 dark:hover:bg-stone-800"
                >
                  {t("billing.exploreFeatures")}
                </button>
              </div>
            </Card>
          )}

          {!free && (
            <Card className="sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-lg font-semibold text-stone-900 dark:text-stone-100">
                  Wisper Pro
                </div>
                <p className="mt-1 text-sm text-stone-600 dark:text-stone-400">
                  {t("billing.proFeatures")}
                </p>
                {billing?.currentPeriodEnd && (
                  <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">
                    {t(
                      billing.cancelAtPeriodEnd
                        ? "billing.cancelsOn"
                        : "billing.renewsOn",
                      {
                        date: new Date(
                          billing.currentPeriodEnd,
                        ).toLocaleDateString(),
                      },
                    )}
                  </p>
                )}
              </div>
              <div className="mt-4 flex flex-wrap gap-3 sm:mt-0">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => run(openBillingPortal)}
                  className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-800 disabled:opacity-50 dark:bg-stone-100 dark:text-stone-900"
                >
                  {busy ? t("billing.opening") : t("billing.manageSubscription")}
                </button>
                <button
                  type="button"
                  onClick={() => void openUrl("https://wisper.chat")}
                  className="rounded-lg border border-stone-300 px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-100 dark:border-stone-700 dark:text-stone-200 dark:hover:bg-stone-800"
                >
                  {t("billing.exploreFeatures")}
                </button>
              </div>
            </Card>
          )}
        </div>

      {error && (
        <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>
      )}

      {confirmSignOut && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6"
          onClick={() => setConfirmSignOut(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm rounded-2xl border border-stone-200 bg-white p-6 shadow-xl dark:border-stone-800 dark:bg-stone-900"
          >
            <h2 className="text-lg font-semibold text-stone-900 dark:text-stone-100">
              {t("account.signOutConfirmTitle")}
            </h2>
            <p className="mt-2 text-sm text-stone-500 dark:text-stone-400">
              {t("account.signOutConfirmBody")}
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setConfirmSignOut(false)}
                className="rounded-lg border border-stone-300 px-4 py-2 text-sm text-stone-700 hover:bg-stone-100 dark:border-stone-700 dark:text-stone-200 dark:hover:bg-stone-800"
              >
                {t("account.cancel")}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setConfirmSignOut(false);
                  void run(signOut);
                }}
                className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-800 disabled:opacity-50 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-white"
              >
                {t("account.signOut")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// One value-prop row with a check.
function Benefit({ text }: { text: string }) {
  return (
    <li className="flex items-start gap-3">
      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900">
        <svg viewBox="0 0 20 20" className="h-3 w-3" fill="currentColor" aria-hidden="true">
          <path d="M16.7 5.3a1 1 0 0 1 0 1.4l-7.5 7.5a1 1 0 0 1-1.4 0L3.3 9.7a1 1 0 1 1 1.4-1.4l3.3 3.3 6.8-6.8a1 1 0 0 1 1.6 0z" />
        </svg>
      </span>
      <span className="text-sm text-stone-600 dark:text-stone-300">{text}</span>
    </li>
  );
}

function Card({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={
        "flex flex-col rounded-2xl border border-stone-200 bg-white p-5 dark:border-stone-800 dark:bg-stone-900/40 " +
        className
      }
    >
      {children}
    </div>
  );
}

function Avatar({ url, fallback }: { url: string; fallback: string }) {
  const [failed, setFailed] = useState(false);
  if (url && !failed) {
    return (
      <img
        src={url}
        alt=""
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className="h-12 w-12 shrink-0 rounded-full object-cover"
      />
    );
  }
  return (
    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-stone-900 text-lg font-semibold uppercase text-white dark:bg-stone-100 dark:text-stone-900">
      {(fallback || "?").charAt(0)}
    </div>
  );
}

function MetricCard({
  label,
  used,
  limit,
}: {
  label: string;
  used: number;
  limit: number;
}) {
  const pct = Math.min(100, Math.round((used / limit) * 100));
  // Reached (at/over the cap) → red; halfway-or-more but not yet at the cap →
  // amber; otherwise neutral (black/white per theme).
  const reached = used >= limit;
  const near = !reached && pct >= 50;
  const barColor = reached
    ? "bg-red-500"
    : near
      ? "bg-amber-500"
      : "bg-stone-900 dark:bg-stone-100";
  const pctColor = reached
    ? "text-red-500"
    : near
      ? "text-amber-500"
      : "text-stone-400";
  return (
    <Card>
      <div className="text-sm text-stone-500 dark:text-stone-400">{label}</div>
      <div className="mt-2 flex items-baseline gap-1.5">
        <span className="text-3xl font-semibold tabular-nums text-stone-900 dark:text-stone-100">
          {used.toLocaleString()}
        </span>
        <span className="text-sm text-stone-400">
          / {limit.toLocaleString()}
        </span>
      </div>
      <div className="mt-auto pt-4">
        <div className="h-2 w-full rounded-full bg-stone-200 dark:bg-stone-800">
          <div
            className={"h-2 rounded-full " + barColor}
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className={"mt-1.5 text-xs " + pctColor}>{pct}%</div>
      </div>
    </Card>
  );
}
