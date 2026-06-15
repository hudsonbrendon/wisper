import { useEffect, useState } from "react";
import {
  getConfig,
  saveConfig,
  listMicrophones,
  listModels,
  downloadModel,
  cancelDownload,
  removeModel,
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

export default function Settings() {
  const [config, setConfig] = useState<Config | null>(null);
  const [mics, setMics] = useState<string[]>([]);
  const [models, setModels] = useState<ModelMeta[]>([]);
  const [progress, setProgress] = useState<Record<string, number>>({});
  const [saved, setSaved] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [captureHint, setCaptureHint] = useState("");
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
        setConfig((prev) => (prev ? { ...prev, hotkey: accel } : prev));
        setCapturing(false);
        setCaptureHint("");
      } else {
        // Only modifiers held so far — show them building live.
        const mods: string[] = [];
        if (e.ctrlKey) mods.push("Control");
        if (e.altKey) mods.push("Alt");
        if (e.shiftKey) mods.push("Shift");
        if (e.metaKey) mods.push("Super");
        setCaptureHint(mods.length ? mods.join("+") + "+…" : "Press a key…");
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [capturing]);

  if (!config) return <div className="p-6 text-zinc-100">Loading…</div>;

  const update = (patch: Partial<Config>) =>
    setConfig({ ...config, ...patch });

  const onSave = async () => {
    await saveConfig(config);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  return (
    <div className="min-h-full bg-zinc-900 p-8 text-zinc-100">
      <h1 className="mb-6 text-2xl font-semibold">OpenWispr</h1>

      <div className="mb-4 block">
        <span className="mb-1 block text-sm text-zinc-400">Hotkey (hold to talk)</span>
        <button
          type="button"
          onClick={() => {
            setCaptureHint("Press a key combo… (Esc to cancel)");
            setCapturing((c) => !c);
          }}
          className={
            "w-full rounded px-3 py-2 text-left font-mono " +
            (capturing
              ? "bg-indigo-700 ring-2 ring-indigo-400"
              : "bg-zinc-800 hover:bg-zinc-700")
          }
        >
          {capturing ? captureHint || "Press a key combo… (Esc to cancel)" : config.hotkey}
        </button>
        <span className="mt-1 block text-xs text-zinc-500">
          Click, then hold your modifiers and press a key. Takes effect after
          restarting the app.
        </span>
      </div>

      <label className="mb-4 block">
        <span className="mb-1 block text-sm text-zinc-400">Microphone</span>
        <select
          className="w-full rounded bg-zinc-800 px-3 py-2"
          value={config.mic_device ?? ""}
          onChange={(e) => update({ mic_device: e.target.value || null })}
        >
          <option value="">System default</option>
          {mics.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
      </label>

      <label className="mb-4 block">
        <span className="mb-1 block text-sm text-zinc-400">Language</span>
        <select
          className="w-full rounded bg-zinc-800 px-3 py-2"
          value={config.language}
          onChange={(e) => update({ language: e.target.value })}
        >
          {LANGUAGES.map((l) => (
            <option key={l.code} value={l.code}>
              {l.name} ({l.code})
            </option>
          ))}
        </select>
      </label>

      <label className="mb-4 block">
        <span className="mb-1 block text-sm text-zinc-400">Insert method</span>
        <select
          className="w-full rounded bg-zinc-800 px-3 py-2"
          value={config.inject_method}
          onChange={(e) =>
            update({ inject_method: e.target.value as Config["inject_method"] })
          }
        >
          <option value="type">Type (synthetic keystrokes)</option>
          <option value="paste">Paste (clipboard + Cmd/Ctrl+V)</option>
        </select>
      </label>

      <div className="mb-6">
        <span className="mb-2 block text-sm text-zinc-400">Models</span>
        {models.map((m) => (
          <div key={m.id} className="mb-2 flex items-center justify-between rounded bg-zinc-800 px-3 py-2">
            <div>
              <span className="font-medium">{m.id}</span>
              <span className="ml-2 text-xs text-zinc-500">
                {downloading.has(m.id)
                  ? `baixando… ${progress[m.id] ?? 0}%`
                  : m.downloaded
                    ? "downloaded"
                    : "not downloaded"}
              </span>
            </div>
            <div className="flex items-center gap-3">
              {downloading.has(m.id) ? (
                <button
                  className="rounded bg-amber-600 px-3 py-1 text-sm hover:bg-amber-500"
                  onClick={() => cancelDownload(m.id)}
                >
                  Cancel
                </button>
              ) : m.downloaded ? (
                <button
                  className="rounded bg-rose-700 px-3 py-1 text-sm hover:bg-rose-600"
                  onClick={async () => {
                    await removeModel(m.id);
                    listModels().then(setModels);
                  }}
                >
                  Remove
                </button>
              ) : (
                <button
                  className="rounded bg-indigo-600 px-3 py-1 text-sm hover:bg-indigo-500"
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

      <button
        className="rounded bg-emerald-600 px-4 py-2 font-medium hover:bg-emerald-500"
        onClick={onSave}
      >
        {saved ? "Saved ✓" : "Save settings"}
      </button>
    </div>
  );
}
