import { useEffect, useState } from "react";
import {
  getConfig,
  saveConfig,
  type Config,
  type Replacement,
} from "../lib/api";
import { useI18n } from "../lib/i18n";

/// Manage snippets / replacements applied to every transcript.
export default function Snippets() {
  const { t } = useI18n();
  const [config, setConfig] = useState<Config | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  useEffect(() => {
    getConfig().then(setConfig);
  }, []);

  if (!config)
    return (
      <div className="text-stone-500 dark:text-stone-400">
        {t("settings.loading")}
      </div>
    );

  const save = (replacements: Replacement[]) => {
    const next = { ...config, replacements };
    setConfig(next);
    saveConfig(next).catch(() => {});
  };
  const add = () => {
    const f = from.trim();
    if (!f) return;
    save([...config.replacements, { from: f, to }]);
    setFrom("");
    setTo("");
  };

  const inputClass =
    "min-w-0 flex-1 rounded-lg border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 px-3 py-2 text-sm text-stone-800 dark:text-stone-200 focus:border-stone-400 focus:outline-none focus:ring-2 focus:ring-stone-200";

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-semibold tracking-tight text-stone-900 dark:text-stone-100">
        {t("nav.snippets")}
      </h1>
      <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">
        {t("settings.replacementsHint")}
      </p>

      <div className="mt-6 overflow-hidden rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900">
        <div className="flex flex-wrap items-center gap-2 border-b border-stone-100 dark:border-stone-800 p-4">
          <input
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            placeholder={t("settings.replacementsFrom")}
            className={inputClass}
          />
          <span className="text-stone-400 dark:text-stone-500">→</span>
          <input
            value={to}
            onChange={(e) => setTo(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") add();
            }}
            placeholder={t("settings.replacementsTo")}
            className={inputClass}
          />
          <button
            type="button"
            disabled={!from.trim()}
            onClick={add}
            className="shrink-0 rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-800 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-stone-200 disabled:opacity-40"
          >
            {t("settings.add")}
          </button>
        </div>

        {config.replacements.length > 0 ? (
          <div className="divide-y divide-stone-100 dark:divide-stone-800">
            {config.replacements.map((rp, i) => (
              <div
                key={`${rp.from}-${i}`}
                className="flex items-center gap-2 px-4 py-3 text-sm text-stone-700 dark:text-stone-300"
              >
                <span className="rounded bg-stone-100 dark:bg-stone-950 px-2 py-0.5 font-mono">
                  {rp.from}
                </span>
                <span className="text-stone-400 dark:text-stone-500">→</span>
                <span className="flex-1 truncate">{rp.to}</span>
                <button
                  type="button"
                  aria-label={t("btn.remove")}
                  onClick={() =>
                    save(config.replacements.filter((_, j) => j !== i))
                  }
                  className="flex h-5 w-5 items-center justify-center rounded-full text-stone-400 dark:text-stone-500 hover:bg-stone-200 dark:hover:bg-stone-700 hover:text-stone-700"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="p-6 text-center text-sm text-stone-400 dark:text-stone-500">
            {t("snippets.empty")}
          </div>
        )}
      </div>
    </div>
  );
}
