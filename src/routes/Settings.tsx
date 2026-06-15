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
  onEvent,
  type Config,
  type ModelMeta,
  type DownloadProgressPayload,
} from "../lib/api";

/// Whisper language options. "auto" lets Whisper detect the spoken language.
/// Codes are Whisper's ISO 639-1 language codes.
const LANGUAGES: { code: string; name: string }[] = [
  { code: "auto", name: "Detect automatically" },
  { code: "pt", name: "Português" },
  { code: "en", name: "English" },
  { code: "es", name: "Español" },
  { code: "fr", name: "Français" },
  { code: "de", name: "Deutsch" },
  { code: "it", name: "Italiano" },
  { code: "nl", name: "Nederlands" },
  { code: "ru", name: "Русский" },
  { code: "pl", name: "Polski" },
  { code: "tr", name: "Türkçe" },
  { code: "ja", name: "日本語" },
  { code: "ko", name: "한국어" },
  { code: "zh", name: "中文" },
  { code: "ar", name: "العربية" },
  { code: "hi", name: "हिन्दी" },
];

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
}: {
  label: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
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

export default function Settings() {
  const [config, setConfig] = useState<Config | null>(null);
  const [mics, setMics] = useState<string[]>([]);
  const [models, setModels] = useState<ModelMeta[]>([]);
  const [progress, setProgress] = useState<Record<string, number>>({});
  const [saved, setSaved] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [captureHint, setCaptureHint] = useState("");
  const [hotkeyError, setHotkeyError] = useState("");
  const [historyCleared, setHistoryCleared] = useState(false);
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

  if (!config) return <div className="text-stone-500">Loading…</div>;

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

  return (
    <div className="max-w-3xl">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight text-stone-900">
          Settings
        </h1>
        {saved && (
          <span className="text-sm font-medium text-teal-600">Saved ✓</span>
        )}
      </div>

      <div className="overflow-hidden rounded-2xl border border-stone-200 bg-white">
        <Field
          label="Hotkey"
          hint={
            <>
              Click, then press your combo <em>including a normal key</em> — e.g.{" "}
              <span className="font-mono">Alt+Space</span>. Hold to talk;
              double-tap for hands-free. Saves immediately.
            </>
          }
        >
          <button
            type="button"
            onClick={() => {
              setCaptureHint("Press a key combo… (Esc to cancel)");
              setCapturing((c) => !c);
            }}
            className={
              "w-full rounded-lg px-3 py-2 text-left font-mono text-sm transition-colors " +
              (capturing
                ? "bg-teal-600 text-white ring-2 ring-teal-300"
                : "border border-stone-300 bg-white text-stone-800 hover:bg-stone-50")
            }
          >
            {capturing
              ? captureHint || "Press a key combo… (Esc to cancel)"
              : config.hotkey}
          </button>
          {hotkeyError && (
            <span className="mt-1 block text-xs text-rose-500">{hotkeyError}</span>
          )}
        </Field>

        <Field label="Microphone">
          <select
            className={selectClass}
            value={config.mic_device ?? ""}
            onChange={(e) => update({ mic_device: e.target.value || null })}
          >
            <option value="">System default</option>
            {mics.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Language">
          <select
            className={selectClass}
            value={config.language}
            onChange={(e) => update({ language: e.target.value })}
          >
            {LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.name} ({l.code})
              </option>
            ))}
          </select>
        </Field>

        <Field
          label="Insert method"
          hint="How transcribed text reaches the focused app."
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
            <option value="type">Type (synthetic keystrokes)</option>
            <option value="paste">Paste (clipboard + Cmd/Ctrl+V)</option>
          </select>
        </Field>

        <Field label="Models" hint="Download a Whisper model to transcribe with.">
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
                      active
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
                    {m.id.endsWith(".en") ? "English only" : "multilingual"}
                  </span>
                  <span className="ml-2 text-xs text-stone-500">
                    {downloading.has(m.id)
                      ? `baixando… ${progress[m.id] ?? 0}%`
                      : m.downloaded
                        ? "downloaded"
                        : "not downloaded"}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {downloading.has(m.id) ? (
                    <button
                      className="rounded-md bg-amber-400 px-3 py-1 text-sm font-medium text-stone-900 hover:bg-amber-300"
                      onClick={() => cancelDownload(m.id)}
                    >
                      Cancel
                    </button>
                  ) : m.downloaded ? (
                    <button
                      className="rounded-md border border-stone-300 px-3 py-1 text-sm text-stone-700 hover:bg-stone-100"
                      onClick={async () => {
                        await removeModel(m.id);
                        listModels().then(setModels);
                      }}
                    >
                      Remove
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
                      Download
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Field>

        <Field
          label="History"
          hint="Transcriptions are stored locally to power Home and Insights."
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
            {historyCleared ? "Cleared ✓" : "Clear history"}
          </button>
        </Field>
      </div>
    </div>
  );
}
