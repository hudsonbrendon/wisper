import { useEffect, useState } from "react";
import {
  getConfig,
  saveConfig,
  listMicrophones,
  listModels,
  downloadModel,
  onEvent,
  type Config,
  type ModelMeta,
  type DownloadProgressPayload,
} from "../lib/api";

export default function Settings() {
  const [config, setConfig] = useState<Config | null>(null);
  const [mics, setMics] = useState<string[]>([]);
  const [models, setModels] = useState<ModelMeta[]>([]);
  const [progress, setProgress] = useState<Record<string, number>>({});
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    getConfig().then(setConfig);
    listMicrophones().then(setMics);
    listModels().then(setModels);
    const un = onEvent<DownloadProgressPayload>("download_progress", (p) => {
      const pct = p.total > 0 ? Math.round((p.received / p.total) * 100) : 0;
      setProgress((prev) => ({ ...prev, [p.id]: pct }));
    });
    const unReady = onEvent<{ id: string }>("model_ready", () => {
      listModels().then(setModels);
    });
    return () => {
      un.then((f) => f());
      unReady.then((f) => f());
    };
  }, []);

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

      <label className="mb-4 block">
        <span className="mb-1 block text-sm text-zinc-400">Hotkey (hold to talk)</span>
        <input
          className="w-full rounded bg-zinc-800 px-3 py-2"
          value={config.hotkey}
          onChange={(e) => update({ hotkey: e.target.value })}
          placeholder="Alt+Space"
        />
      </label>

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
        <input
          className="w-full rounded bg-zinc-800 px-3 py-2"
          value={config.language}
          onChange={(e) => update({ language: e.target.value })}
          placeholder="en, pt, or auto"
        />
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
                {m.downloaded ? "downloaded" : "not downloaded"}
              </span>
            </div>
            <div className="flex items-center gap-3">
              {progress[m.id] !== undefined && progress[m.id] < 100 && (
                <span className="text-xs text-zinc-400">{progress[m.id]}%</span>
              )}
              <button
                className="rounded bg-indigo-600 px-3 py-1 text-sm hover:bg-indigo-500 disabled:opacity-50"
                disabled={m.downloaded}
                onClick={() => {
                  update({ model_id: m.id });
                  downloadModel(m.id);
                }}
              >
                {m.downloaded ? "Ready" : "Download"}
              </button>
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
