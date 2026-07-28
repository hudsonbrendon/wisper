import { useEffect, useState } from "react";
import { useAuth } from "../lib/authContext";
import { useI18n } from "../lib/i18n";
import { onEvent } from "../lib/api";
import { GoogleG } from "./BrandLogos";

/// Shown when the backend blocked a dictation or meeting because nobody is
/// signed in. Wisper is free — signing in is the only requirement.
export default function SignInModal() {
  const [open, setOpen] = useState(false);
  const { signIn } = useAuth();
  const { t } = useI18n();

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    onEvent("signin_required", () => setOpen(true)).then((f) => {
      unlisten = f;
    });
    return () => unlisten?.();
  }, []);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-stone-950/50 p-6">
      <div className="w-full max-w-sm rounded-2xl border border-stone-200 bg-white p-6 dark:border-stone-800 dark:bg-stone-900">
        <h2 className="text-lg font-semibold text-stone-900 dark:text-stone-100">
          {t("signin.title")}
        </h2>
        <p className="mt-2 text-sm text-stone-500 dark:text-stone-400">
          {t("signin.body")}
        </p>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            void signIn().catch(() => {});
          }}
          className="mt-5 inline-flex w-full items-center justify-center gap-3 rounded-lg bg-stone-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-stone-800 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-stone-200"
        >
          <GoogleG className="h-5 w-5" />
          {t("account.continueGoogle")}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="mt-4 w-full rounded-lg px-3 py-2 text-sm text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-800"
        >
          {t("signin.notNow")}
        </button>
      </div>
    </div>
  );
}
