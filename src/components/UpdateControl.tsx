import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { checkForUpdate, installUpdate } from "../lib/updater";
import { useI18n } from "../lib/i18n";

type State = "idle" | "checking" | "uptodate" | "downloading" | "error";

/// Sidebar footer: current app version + a manual "check for updates" action.
/// Lives here (not in Settings) so the version is always visible. The startup
/// banner handles automatic prompts; this is the on-demand path.
export default function UpdateControl() {
  const { t } = useI18n();
  const [version, setVersion] = useState("");
  const [state, setState] = useState<State>("idle");
  const [pct, setPct] = useState(0);

  useEffect(() => {
    getVersion().then(setVersion);
  }, []);

  const onCheck = async () => {
    setState("checking");
    try {
      const update = await checkForUpdate();
      if (!update) {
        setState("uptodate");
        return;
      }
      setState("downloading");
      await installUpdate(update, (d, total) =>
        setPct(total > 0 ? Math.round((d / total) * 100) : 0),
      );
    } catch {
      // No published release yet / offline — treat as a soft failure.
      setState("error");
    }
  };

  const buttonLabel =
    state === "checking"
      ? t("update.checking")
      : state === "downloading"
        ? `${t("update.downloading")} ${pct}%`
        : t("update.check");

  return (
    <div className="mt-1 flex flex-col gap-0.5 px-3">
      <button
        type="button"
        onClick={onCheck}
        disabled={state === "checking" || state === "downloading"}
        className="text-left text-xs text-stone-500 transition-colors hover:text-stone-900 disabled:opacity-50"
      >
        {buttonLabel}
      </button>
      <span className="text-[11px] text-stone-400">
        {state === "uptodate"
          ? t("update.upToDate")
          : state === "error"
            ? t("update.failed")
            : `${t("settings.currentVersion")}: v${version}`}
      </span>
    </div>
  );
}
