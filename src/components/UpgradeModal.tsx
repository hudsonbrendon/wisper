import { useUsage } from "../lib/usageContext";
import { useAuth } from "../lib/authContext";
import { useI18n } from "../lib/i18n";

/// Shown when the Rust backend blocks an action. `quota` → upgrade prompt
/// (buttons inert until Phase 2 wires Stripe); `auth` → sign-in prompt.
export default function UpgradeModal() {
  const { blocked, clearBlocked } = useUsage();
  const { signIn } = useAuth();
  const { t } = useI18n();
  if (!blocked) return null;

  const isAuth = blocked.reason === "auth";

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-stone-950/50 p-6">
      <div className="w-full max-w-sm rounded-2xl border border-stone-200 bg-white p-6 dark:border-stone-800 dark:bg-stone-900">
        {isAuth ? (
          <>
            <h2 className="text-lg font-semibold text-stone-900 dark:text-stone-100">
              {t("upgrade.signInTitle")}
            </h2>
            <p className="mt-2 text-sm text-stone-500 dark:text-stone-400">
              {t("upgrade.signInBody")}
            </p>
            <button
              type="button"
              onClick={() => {
                clearBlocked();
                void signIn().catch(() => {});
              }}
              className="mt-5 w-full rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-800 dark:bg-stone-100 dark:text-stone-900"
            >
              {t("account.continueGoogle")}
            </button>
          </>
        ) : (
          <>
            <h2 className="text-lg font-semibold text-stone-900 dark:text-stone-100">
              {t("upgrade.limitTitle")}
            </h2>
            <p className="mt-2 text-sm text-stone-500 dark:text-stone-400">
              {t(
                blocked.metric === "meeting"
                  ? "upgrade.limitBodyMeeting"
                  : "upgrade.limitBodyDictation",
              )}
            </p>
            <div className="mt-5 flex gap-3">
              <button
                type="button"
                disabled
                title={t("upgrade.comingSoon")}
                className="flex-1 rounded-lg border border-stone-300 px-3 py-2 text-sm font-medium text-stone-500 disabled:opacity-60 dark:border-stone-700"
              >
                {t("upgrade.perMonth")}
              </button>
              <button
                type="button"
                disabled
                title={t("upgrade.comingSoon")}
                className="flex-1 rounded-lg border border-stone-300 px-3 py-2 text-sm font-medium text-stone-500 disabled:opacity-60 dark:border-stone-700"
              >
                {t("upgrade.perYear")}
              </button>
            </div>
            <p className="mt-2 text-center text-xs text-stone-400">
              {t("upgrade.comingSoon")}
            </p>
          </>
        )}
        <button
          type="button"
          onClick={clearBlocked}
          className="mt-4 w-full rounded-lg px-3 py-2 text-sm text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-800"
        >
          {t("upgrade.notNow")}
        </button>
      </div>
    </div>
  );
}
