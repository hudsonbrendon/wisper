import { useEffect, useState } from "react";
import { getConfig, saveConfig, type Config } from "../lib/api";
import { useI18n } from "../lib/i18n";

/// Manage the custom vocabulary fed to Whisper as a recognition prompt.
export default function Dictionary() {
  const { t } = useI18n();
  const [config, setConfig] = useState<Config | null>(null);
  const [word, setWord] = useState("");

  useEffect(() => {
    getConfig().then(setConfig);
  }, []);

  if (!config)
    return <div className="text-stone-500">{t("settings.loading")}</div>;

  const save = (dictionary: string[]) => {
    const next = { ...config, dictionary };
    setConfig(next);
    saveConfig(next).catch(() => {});
  };
  const add = () => {
    const w = word.trim();
    if (!w) return;
    save([...config.dictionary, w]);
    setWord("");
  };

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-semibold tracking-tight text-stone-900">
        {t("nav.dictionary")}
      </h1>
      <p className="mt-1 text-sm text-stone-500">
        {t("settings.dictionaryHint")}
      </p>

      <div className="mt-6 overflow-hidden rounded-2xl border border-stone-200 bg-white">
        <div className="flex gap-2 border-b border-stone-100 p-4">
          <input
            value={word}
            onChange={(e) => setWord(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") add();
            }}
            placeholder={t("settings.dictionaryPlaceholder")}
            className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-800 focus:border-stone-400 focus:outline-none focus:ring-2 focus:ring-stone-200"
          />
          <button
            type="button"
            disabled={!word.trim()}
            onClick={add}
            className="shrink-0 rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-800 disabled:opacity-40"
          >
            {t("settings.add")}
          </button>
        </div>

        {config.dictionary.length > 0 ? (
          <div className="flex flex-wrap gap-2 p-4">
            {config.dictionary.map((w, i) => (
              <span
                key={`${w}-${i}`}
                className="inline-flex items-center gap-1 rounded-full bg-stone-100 py-1 pl-3 pr-1 text-sm text-stone-700"
              >
                {w}
                <button
                  type="button"
                  aria-label={t("btn.remove")}
                  onClick={() =>
                    save(config.dictionary.filter((_, j) => j !== i))
                  }
                  className="flex h-5 w-5 items-center justify-center rounded-full text-stone-400 hover:bg-stone-200 hover:text-stone-700"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        ) : (
          <div className="p-6 text-center text-sm text-stone-400">
            {t("dictionary.empty")}
          </div>
        )}
      </div>
    </div>
  );
}
