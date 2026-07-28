import { useState } from "react";
import { useAuth } from "../lib/authContext";
import { useI18n } from "../lib/i18n";
import { WisperLogoStack, GoogleG } from "../components/BrandLogos";

/// Account screen: Google sign-in when signed out, and the signed-in identity
/// card with a sign-out button. Wisper is free — there is no plan or billing.
export default function Account() {
  const { user, loading, signIn, signOut } = useAuth();
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
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

  if (loading) {
    return <div className="text-sm text-stone-500">{t("account.loading")}</div>;
  }

  // Signed out: a centered hero that fills the screen — app glyph, headline,
  // what an account gives you, and a Google button with the white "G" logo.
  if (!user) {
    return (
      <div className="flex min-h-[78vh] flex-col items-center justify-center px-6 text-center">
        <WisperLogoStack className="mb-7" />
        <h1 className="text-3xl font-semibold tracking-tight text-stone-900 dark:text-stone-100">
          {t("account.signInHeadline")}
        </h1>
        <p className="mt-3 max-w-md text-base text-stone-500 dark:text-stone-400">
          {t("account.signInSubtitle")}
        </p>

        <ul className="mt-9 w-full max-w-sm space-y-4 text-left">
          <Benefit text={t("account.benefit.local")} />
        </ul>

        <button
          type="button"
          disabled={busy}
          onClick={() => run(signIn)}
          className="mt-10 inline-flex w-full max-w-sm items-center justify-center gap-3 rounded-xl border border-white/10 bg-stone-900 px-5 py-3.5 text-sm font-medium text-white shadow-sm transition hover:bg-stone-800 disabled:opacity-50 dark:border-black/10 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-stone-200"
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

  // Google populates the Supabase session's user_metadata with the profile
  // name and photo; fall back to the email/initial when absent.
  const meta = (user?.user_metadata ?? {}) as Record<string, unknown>;
  const fullName = (meta.full_name as string) || (meta.name as string) || "";
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
        {/* Identity — full width */}
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
        <svg
          viewBox="0 0 20 20"
          className="h-3 w-3"
          fill="currentColor"
          aria-hidden="true"
        >
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
