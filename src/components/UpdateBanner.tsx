import { useEffect, useState } from "react";
import { checkForUpdate, installUpdate, type Update } from "../lib/updater";
import { useI18n } from "../lib/i18n";

type Phase = "hidden" | "available" | "downloading" | "error";

export default function UpdateBanner() {
  const { t } = useI18n();
  const [phase, setPhase] = useState<Phase>("hidden");
  const [update, setUpdate] = useState<Update | null>(null);
  const [pct, setPct] = useState(0);

  useEffect(() => {
    // Silent check on mount; ignore failures (offline, no release yet).
    checkForUpdate()
      .then((u) => {
        if (u) {
          setUpdate(u);
          setPhase("available");
        }
      })
      .catch(() => {});
  }, []);

  if (phase === "hidden" || !update) return null;

  const onInstall = () => {
    setPhase("downloading");
    installUpdate(update, (d, total) =>
      setPct(total > 0 ? Math.round((d / total) * 100) : 0),
    ).catch(() => setPhase("error"));
  };

  return (
    <div className="flex items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900">
      <span className="font-medium">
        {phase === "error"
          ? t("update.failed")
          : `${t("update.available")} — v${update.version}`}
      </span>
      <div className="ml-auto flex items-center gap-2">
        {phase === "available" && (
          <>
            <button
              type="button"
              onClick={() => setPhase("hidden")}
              className="rounded px-2 py-1 text-amber-700 hover:bg-amber-100"
            >
              {t("update.dismiss")}
            </button>
            <button
              type="button"
              onClick={onInstall}
              className="rounded bg-amber-600 px-3 py-1 font-medium text-white hover:bg-amber-500"
            >
              {t("update.install")}
            </button>
          </>
        )}
        {phase === "downloading" && (
          <span className="tabular-nums text-amber-700">
            {t("update.downloading")} {pct}%
          </span>
        )}
        {phase === "error" && (
          <button
            type="button"
            onClick={onInstall}
            className="rounded bg-amber-600 px-3 py-1 font-medium text-white hover:bg-amber-500"
          >
            {t("update.install")}
          </button>
        )}
      </div>
    </div>
  );
}
