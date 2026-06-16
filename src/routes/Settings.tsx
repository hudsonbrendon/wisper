import { useEffect, useState } from "react";
import {
  getConfig,
  saveConfig,
  listMicrophones,
  listModels,
  downloadModel,
  cancelDownload,
  removeModel,
  clearHistory,
  getLaunchAtLogin,
  setLaunchAtLogin,
  resetApp,
  onEvent,
  type Config,
  type ModelMeta,
  type DownloadProgressPayload,
} from "../lib/api";
import { useI18n, UI_LANGUAGES } from "../lib/i18n";
import { LANGUAGES } from "../lib/languages";

/// Build a Tauri global-shortcut accelerator string from a keydown event.
/// Returns null while only modifier keys are held (combo not complete yet).
function eventToAccelerator(e: KeyboardEvent): string | null {
  const mods: string[] = [];
  if (e.ctrlKey) mods.push("Control");
  if (e.altKey) mods.push("Alt");
  if (e.shiftKey) mods.push("Shift");
  if (e.metaKey) mods.push("Super");

  const code = e.code;
  let key: string | null = null;
  if (/^Key[A-Z]$/.test(code)) key = code.slice(3);
  else if (/^Digit[0-9]$/.test(code)) key = code.slice(5);
  else if (/^Numpad[0-9]$/.test(code)) key = code.slice(6);
  else if (/^F\d{1,2}$/.test(code)) key = code;
  else if (code === "Space") key = "Space";
  else if (code === "Enter" || code === "NumpadEnter") key = "Enter";
  else if (code === "Tab") key = "Tab";
  else if (code === "ArrowUp") key = "Up";
  else if (code === "ArrowDown") key = "Down";
  else if (code === "ArrowLeft") key = "Left";
  else if (code === "ArrowRight") key = "Right";
  // Fallback for other layouts (e.g. ABNT): use the printable character.
  else if (e.key.length === 1 && e.key !== " ") key = e.key.toUpperCase();

  if (!key) return null; // only modifiers down so far
  return [...mods, key].join("+");
}

/// One labelled settings block. Stacked vertically so the page shows *all*
/// current settings at a glance, rather than hiding them behind sub-tabs.
function Field({
  label,
  hint,
  children,
  align = "fill",
}: {
  label: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
  /** "fill": control gets a wide column (selects). "right": label/hint take the
   *  row, control sits compact on the right (toggles, buttons). */
  align?: "fill" | "right";
}) {
  if (align === "right") {
    return (
      <div className="border-b border-stone-100 px-6 py-5 last:border-b-0">
        <div className="flex items-center justify-between gap-6">
          <div className="min-w-0">
            <span className="text-sm font-medium text-stone-800">{label}</span>
            {hint && <p className="mt-1 text-xs text-stone-500">{hint}</p>}
          </div>
          <div className="shrink-0">{children}</div>
        </div>
      </div>
    );
  }
  return (
    <div className="border-b border-stone-100 px-6 py-5 last:border-b-0">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-[200px_1fr] md:items-start">
        <div>
          <span className="text-sm font-medium text-stone-800">{label}</span>
          {hint && <p className="mt-1 text-xs text-stone-500">{hint}</p>}
        </div>
        <div>{children}</div>
      </div>
    </div>
  );
}

const selectClass =
  "w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-800 focus:border-stone-400 focus:outline-none focus:ring-2 focus:ring-stone-200";

function Toggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors " +
        (checked ? "bg-teal-600" : "bg-stone-300")
      }
    >
      <span
        className={
          "inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform " +
          (checked ? "translate-x-5" : "translate-x-0.5")
        }
      />
    </button>
  );
}

export default function Settings() {
  const { t, lang, setLang } = useI18n();
  const [config, setConfig] = useState<Config | null>(null);
  const [mics, setMics] = useState<string[]>([]);
  const [models, setModels] = useState<ModelMeta[]>([]);
  const [progress, setProgress] = useState<Record<string, number>>({});
  const [saved, setSaved] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [captureHint, setCaptureHint] = useState("");
  const [hotkeyError, setHotkeyError] = useState("");
  const [historyCleared, setHistoryCleared] = useState(false);
  const [launchLogin, setLaunchLogin] = useState(false);
  // Model ids with an in-flight download (button shows Cancel + "baixando").
  const [downloading, setDownloading] = useState<Set<string>>(new Set());
  const clearDownloading = (id: string) =>
    setDownloading((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });

  useEffect(() => {
    getConfig().then(setConfig);
    listMicrophones().then(setMics);
    listModels().then(setModels);
    getLaunchAtLogin().then(setLaunchLogin);
    const un = onEvent<DownloadProgressPayload>("download_progress", (p) => {
      const pct = p.total > 0 ? Math.round((p.received / p.total) * 100) : 0;
      setProgress((prev) => ({ ...prev, [p.id]: pct }));
    });
    const unReady = onEvent<{ id: string }>("model_ready", (p) => {
      clearDownloading(p.id);
      setProgress((prev) => ({ ...prev, [p.id]: 100 }));
      listModels().then(setModels);
    });
    const unCancelled = onEvent<{ id: string }>("download_cancelled", (p) => {
      clearDownloading(p.id);
      setProgress((prev) => {
        const next = { ...prev };
        delete next[p.id];
        return next;
      });
    });
    return () => {
      un.then((f) => f());
      unReady.then((f) => f());
      unCancelled.then((f) => f());
    };
  }, []);

  // Capture the hotkey at the window level. WKWebView (macOS) does not give a
  // <button> keyboard focus on click, so element-level onKeyDown never fires —
  // listen on window instead while capturing.
  useEffect(() => {
    if (!capturing) return;
    const handler = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") {
        setCapturing(false);
        setCaptureHint("");
        return;
      }
      const accel = eventToAccelerator(e);
      if (accel) {
        setCapturing(false);
        setCaptureHint("");
        setHotkeyError("");
        setConfig((prev) => {
          if (!prev) return prev;
          const next = { ...prev, hotkey: accel };
          saveConfig(next)
            .then(() => {
              setSaved(true);
              setTimeout(() => setSaved(false), 1500);
            })
            .catch((err) => {
              setHotkeyError(String(err));
              setConfig((p) => (p ? { ...p, hotkey: prev.hotkey } : p));
            });
          return next;
        });
      } else {
        const mods: string[] = [];
        if (e.ctrlKey) mods.push("Control");
        if (e.altKey) mods.push("Alt");
        if (e.shiftKey) mods.push("Shift");
        if (e.metaKey) mods.push("Super");
        setCaptureHint(
          mods.length ? mods.join("+") + "+ (add a key)" : "Press a key…",
        );
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [capturing]);

  if (!config) return <div className="text-stone-500">{t("settings.loading")}</div>;

  const update = (patch: Partial<Config>) => {
    const next = { ...config, ...patch };
    setConfig(next);
    // Persist immediately so the page always reflects the current settings.
    saveConfig(next)
      .then(() => {
        setSaved(true);
        setTimeout(() => setSaved(false), 1200);
      })
      .catch(() => {});
  };

  const onToggleLaunch = (v: boolean) => {
    setLaunchLogin(v);
    setLaunchAtLogin(v).catch(() => setLaunchLogin(!v));
  };

  const onReset = () => {
    if (window.confirm(t("settings.resetConfirm"))) {
      resetApp().catch(() => {});
    }
  };

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight text-stone-900">
          {t("settings.title")}
        </h1>
        {saved && (
          <span className="text-sm font-medium text-teal-600">
            {t("settings.saved")}
          </span>
        )}
      </div>

      <div className="overflow-hidden rounded-2xl border border-stone-200 bg-white">
        <Field label={t("settings.uiLanguage")} hint={t("settings.uiLanguageHint")}>
          <select
            className={selectClass}
            value={lang}
            onChange={(e) => setLang(e.target.value)}
          >
            {UI_LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label={t("settings.hotkey")} hint={t("settings.hotkeyHint")}>
          <button
            type="button"
            onClick={() => {
              setCaptureHint(t("settings.hotkeyPress"));
              setCapturing((c) => !c);
            }}
            className={
              "w-full rounded-lg px-3 py-2 text-left font-mono text-sm transition-colors " +
              (capturing
                ? "bg-teal-600 text-white ring-2 ring-teal-300"
                : "border border-stone-300 bg-white text-stone-800 hover:bg-stone-50")
            }
          >
            {capturing ? captureHint || t("settings.hotkeyPress") : config.hotkey}
          </button>
          {hotkeyError && (
            <span className="mt-1 block text-xs text-rose-500">{hotkeyError}</span>
          )}
        </Field>

        <Field label={t("settings.microphone")}>
          <select
            className={selectClass}
            value={config.mic_device ?? ""}
            onChange={(e) => update({ mic_device: e.target.value || null })}
          >
            <option value="">{t("settings.systemDefault")}</option>
            {mics.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </Field>

        <Field label={t("settings.language")} hint={t("settings.languageHint")}>
          <select
            className={selectClass}
            value={config.language}
            onChange={(e) => update({ language: e.target.value })}
          >
            {LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.code === "auto" ? t("lang.auto") : `${l.name} (${l.code})`}
              </option>
            ))}
          </select>
        </Field>

        <Field
          label={t("settings.insert")}
          hint={t("settings.insertHint")}
        >
          <select
            className={selectClass}
            value={config.inject_method}
            onChange={(e) =>
              update({
                inject_method: e.target.value as Config["inject_method"],
              })
            }
          >
            <option value="type">{t("settings.insertType")}</option>
            <option value="paste">{t("settings.insertPaste")}</option>
          </select>
        </Field>

        <Field label={t("settings.models")} hint={t("settings.modelsHint")}>
          <div className="space-y-2">
            {models.map((m) => (
              <div
                key={m.id}
                className="flex items-center justify-between rounded-lg border border-stone-200 bg-stone-50 px-3 py-2"
              >
                <div className="min-w-0">
                  <span className="text-sm font-medium text-stone-800">
                    {m.id}
                  </span>
                  {config.model_id === m.id && (
                    <span className="ml-2 rounded-full bg-teal-100 px-2 py-0.5 text-xs font-medium text-teal-700">
                      {t("settings.active")}
                    </span>
                  )}
                  <span
                    className={
                      "ml-2 rounded-full px-2 py-0.5 text-xs font-medium " +
                      (m.id.endsWith(".en")
                        ? "bg-amber-100 text-amber-700"
                        : "bg-stone-200 text-stone-600")
                    }
                  >
                    {m.id.endsWith(".en")
                      ? t("settings.englishOnly")
                      : t("settings.multilingual")}
                  </span>
                  <span className="ml-2 text-xs text-stone-500">
                    {downloading.has(m.id)
                      ? t("settings.downloading", { pct: progress[m.id] ?? 0 })
                      : m.downloaded
                        ? t("settings.downloaded")
                        : t("settings.notDownloaded")}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {downloading.has(m.id) ? (
                    <button
                      className="rounded-md bg-amber-400 px-3 py-1 text-sm font-medium text-stone-900 hover:bg-amber-300"
                      onClick={() => cancelDownload(m.id)}
                    >
                      {t("btn.cancel")}
                    </button>
                  ) : m.downloaded ? (
                    <button
                      className="rounded-md border border-stone-300 px-3 py-1 text-sm text-stone-700 hover:bg-stone-100"
                      onClick={async () => {
                        await removeModel(m.id);
                        listModels().then(setModels);
                      }}
                    >
                      {t("btn.remove")}
                    </button>
                  ) : (
                    <button
                      className="rounded-md bg-stone-900 px-3 py-1 text-sm font-medium text-white hover:bg-stone-800"
                      onClick={() => {
                        update({ model_id: m.id });
                        setDownloading((prev) => new Set(prev).add(m.id));
                        setProgress((prev) => ({ ...prev, [m.id]: 0 }));
                        downloadModel(m.id).catch(() => clearDownloading(m.id));
                      }}
                    >
                      {t("btn.download")}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Field>

        <Field
          align="right"
          label={t("settings.history")}
          hint={t("settings.historyHint")}
        >
          <button
            type="button"
            onClick={async () => {
              await clearHistory();
              setHistoryCleared(true);
              setTimeout(() => setHistoryCleared(false), 1500);
            }}
            className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-600 hover:bg-rose-100"
          >
            {historyCleared ? t("settings.cleared") : t("settings.clearHistory")}
          </button>
        </Field>
      </div>

      {config && (
        <>
          <h2 className="mb-3 mt-8 text-lg font-semibold text-stone-900">
            {t("settings.system")}
          </h2>
          <div className="overflow-hidden rounded-2xl border border-stone-200 bg-white">
            <Field
              align="right"
              label={t("settings.launchAtLogin")}
              hint={t("settings.launchAtLoginHint")}
            >
              <Toggle checked={launchLogin} onChange={onToggleLaunch} />
            </Field>
            <Field
              align="right"
              label={t("settings.showInDock")}
              hint={t("settings.showInDockHint")}
            >
              <Toggle
                checked={config.show_in_dock}
                onChange={(v) => update({ show_in_dock: v })}
              />
            </Field>
            <Field
              align="right"
              label={t("settings.showPill")}
              hint={t("settings.showPillHint")}
            >
              <Toggle
                checked={config.show_pill}
                onChange={(v) => update({ show_pill: v })}
              />
            </Field>
            <Field
              align="right"
              label={t("settings.dictationSounds")}
              hint={t("settings.dictationSoundsHint")}
            >
              <Toggle
                checked={config.dictation_sounds}
                onChange={(v) => update({ dictation_sounds: v })}
              />
            </Field>
            <Field
              align="right"
              label={t("settings.muteMusic")}
              hint={t("settings.muteMusicHint")}
            >
              <Toggle
                checked={config.mute_music}
                onChange={(v) => update({ mute_music: v })}
              />
            </Field>
            <Field
              align="right"
              label={t("settings.resetApp")}
              hint={t("settings.resetAppHint")}
            >
              <button
                type="button"
                onClick={onReset}
                className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-600 hover:bg-rose-100"
              >
                {t("settings.resetAppAction")}
              </button>
            </Field>
          </div>
        </>
      )}
    </div>
  );
}
