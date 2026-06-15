import { useEffect, useRef, useState } from "react";
import {
  onEvent,
  getConfig,
  uiStartRecording,
  uiStopAndInsert,
  uiCancelRecording,
  setLanguage,
  type StatePayload,
  type LevelPayload,
} from "../lib/api";
import { LANGUAGES, langLabel } from "../lib/languages";
import { useI18n } from "../lib/i18n";

export default function Overlay() {
  const { t } = useI18n();
  const [state, setState] = useState("idle");
  const [level, setLevel] = useState(0);
  const [error, setError] = useState("");
  const [lang, setLang] = useState("auto");
  const [menuOpen, setMenuOpen] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const startedAt = useRef(0);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    getConfig().then((c) => setLang(c.language));

    const unState = onEvent<StatePayload>("state", (p) => {
      setState(p.state);
      if (p.state === "recording") {
        setError("");
        startedAt.current = Date.now();
        setElapsed(0);
      }
    });
    const unLevel = onEvent<LevelPayload>("audio_level", (p) => setLevel(p.level));
    const unError = onEvent<{ message: string }>("error", (p) => setError(p.message));
    const unCfg = onEvent<{ language: string }>("config_changed", (p) =>
      setLang(p.language),
    );
    return () => {
      unState.then((f) => f());
      unLevel.then((f) => f());
      unError.then((f) => f());
      unCfg.then((f) => f());
    };
  }, []);

  // Auto-clear errors back to idle so the persistent pill recovers on its own.
  useEffect(() => {
    if (!error) return;
    const id = setTimeout(() => setError(""), 4000);
    return () => clearTimeout(id);
  }, [error]);

  // Tick the elapsed timer while recording.
  useEffect(() => {
    if (state !== "recording") return;
    const id = setInterval(
      () => setElapsed(Math.floor((Date.now() - startedAt.current) / 1000)),
      250,
    );
    return () => clearInterval(id);
  }, [state]);

  const meterWidth = Math.min(100, Math.round(level * 400));
  const mmss = `${String(Math.floor(elapsed / 60)).padStart(2, "0")}:${String(
    elapsed % 60,
  ).padStart(2, "0")}`;

  const pickLang = (code: string) => {
    setLang(code);
    setMenuOpen(false);
    void setLanguage(code);
  };

  const shell =
    "flex items-center gap-3 rounded-full bg-zinc-900/90 px-4 py-2.5 text-zinc-100 shadow-xl backdrop-blur select-none";

  if (error) {
    return (
      <div className="flex h-full w-full items-center justify-center overflow-hidden bg-transparent">
        <div className={shell}>
          <span className="h-3 w-3 shrink-0 rounded-full bg-rose-500" />
          <span className="max-w-[260px] text-sm text-rose-300">{error}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full items-center justify-center overflow-hidden bg-transparent">
      <div className={shell}>
        {state === "idle" && (
          <>
            <button
              type="button"
              onClick={() => void uiStartRecording()}
              className="flex items-center gap-2 text-sm"
              title={t("overlay.clickToRecord")}
            >
              <span className="h-3 w-3 shrink-0 rounded-full bg-zinc-400" />
              <span aria-hidden>🎤</span>
            </button>
            <div className="relative">
              <button
                type="button"
                onClick={() => setMenuOpen((o) => !o)}
                className="rounded px-2 py-0.5 text-xs text-zinc-300 hover:bg-zinc-700"
              >
                {langLabel(lang)} ▾
              </button>
              {menuOpen && (
                <div className="absolute bottom-full left-0 mb-2 max-h-64 w-40 overflow-auto rounded-lg bg-zinc-800 p-1 text-sm shadow-xl">
                  {LANGUAGES.map((l) => (
                    <button
                      key={l.code}
                      type="button"
                      onClick={() => pickLang(l.code)}
                      className={
                        "block w-full rounded px-2 py-1 text-left hover:bg-zinc-700 " +
                        (l.code === lang ? "text-emerald-400" : "text-zinc-200")
                      }
                    >
                      {l.code === "auto" ? t("lang.auto") : `${l.name} (${l.code})`}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        {state === "recording" && (
          <>
            <button
              type="button"
              onClick={() => void uiCancelRecording()}
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-zinc-300 hover:bg-zinc-700"
              title={t("overlay.cancel")}
            >
              ✕
            </button>
            <div className="h-2 w-20 shrink-0 overflow-hidden rounded-full bg-zinc-700">
              <div
                className="h-full bg-emerald-400 transition-all"
                style={{ width: `${meterWidth}%` }}
              />
            </div>
            <span className="w-10 text-xs tabular-nums text-zinc-300">{mmss}</span>
            <button
              type="button"
              onClick={() => void uiStopAndInsert()}
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-red-500 text-white hover:bg-red-400"
              title={t("overlay.stop")}
            >
              ⏹
            </button>
          </>
        )}

        {state === "transcribing" && (
          <span className="min-w-[120px] text-sm">{t("overlay.transcribing")}</span>
        )}
        {state === "injecting" && (
          <span className="min-w-[120px] text-sm">{t("overlay.inserting")}</span>
        )}
      </div>
    </div>
  );
}
