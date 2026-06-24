import { useEffect, useRef, useState } from "react";
import {
  onEvent,
  getConfig,
  uiStartRecording,
  uiStopAndInsert,
  uiCancelRecording,
  setLanguage,
  setPillExpanded,
  type StatePayload,
  type LevelPayload,
} from "../lib/api";
import { LANGUAGES, langLabel } from "../lib/languages";
import { useI18n } from "../lib/i18n";

// Sober line icons matching the app's Feather-style set (stroke="currentColor").
function MicIcon() {
  return (
    <svg
      className="h-[18px] w-[18px] shrink-0"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="23" />
      <line x1="8" y1="23" x2="16" y2="23" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg
      className="h-4 w-4 shrink-0"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg className="h-3 w-3 shrink-0" viewBox="0 0 24 24" fill="currentColor">
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
  );
}

// Six-dot grip: the dedicated "drag me" handle at the pill's left edge. It's
// `pointer-events-none` so a mousedown falls through to the drag-region shell.
function GripIcon() {
  return (
    <svg
      className="pointer-events-none h-4 w-4 shrink-0 text-zinc-500"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
    >
      <circle cx="9" cy="6" r="1.4" />
      <circle cx="15" cy="6" r="1.4" />
      <circle cx="9" cy="12" r="1.4" />
      <circle cx="15" cy="12" r="1.4" />
      <circle cx="9" cy="18" r="1.4" />
      <circle cx="15" cy="18" r="1.4" />
    </svg>
  );
}

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
    const unLevel = onEvent<LevelPayload>("audio_level", (p) =>
      setLevel(p.level),
    );
    const unError = onEvent<{ message: string }>("error", (p) =>
      setError(p.message),
    );
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

  // The dropdown is HTML inside a tiny native window, so the backend grows the
  // window while the menu is open (else the OS clips the list) and shrinks it
  // back on close.
  const closeMenu = () => {
    setMenuOpen(false);
    void setPillExpanded(false);
  };
  const toggleMenu = () => {
    const next = !menuOpen;
    setMenuOpen(next);
    void setPillExpanded(next);
  };
  const pickLang = (code: string) => {
    setLang(code);
    closeMenu();
    void setLanguage(code);
  };

  const shell =
    "relative flex cursor-grab items-center gap-2.5 rounded-full bg-zinc-900/90 py-2.5 pl-2.5 pr-4 text-zinc-100 shadow-xl backdrop-blur select-none active:cursor-grabbing";

  // Pill sits at the window's bottom edge; the window grows upward for the menu.
  const wrapper =
    "relative flex h-full w-full items-end justify-center overflow-hidden bg-transparent pb-4";

  if (error) {
    return (
      <div className={wrapper}>
        <div className={shell} data-tauri-drag-region>
          <GripIcon />
          <span className="pointer-events-none h-3 w-3 shrink-0 rounded-full bg-rose-500" />
          <span className="pointer-events-none max-w-[260px] text-sm text-rose-300">
            {error}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className={wrapper}>
      {menuOpen && (
        <div className="absolute inset-0" onClick={closeMenu} aria-hidden />
      )}
      <div className={shell} data-tauri-drag-region>
        <GripIcon />
        {state === "idle" && (
          <>
            <button
              type="button"
              onClick={() => void uiStartRecording()}
              className="flex items-center gap-2 text-sm text-zinc-200 hover:text-white"
              title={t("overlay.clickToRecord")}
            >
              <MicIcon />
            </button>
            <div>
              <button
                type="button"
                onClick={toggleMenu}
                className="rounded px-2 py-0.5 text-xs text-zinc-300 hover:bg-zinc-700"
              >
                {langLabel(lang)} ▾
              </button>
              {menuOpen && (
                <div className="no-scrollbar absolute bottom-full left-1/2 mb-2 max-h-64 w-40 -translate-x-1/2 overflow-auto rounded-lg bg-zinc-800 p-1 text-sm shadow-xl">
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
                      {l.code === "auto"
                        ? t("lang.auto")
                        : `${l.name} (${l.code})`}
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
              <XIcon />
            </button>
            <div className="pointer-events-none h-2 w-20 shrink-0 overflow-hidden rounded-full bg-zinc-700">
              <div
                className="h-full bg-emerald-400 transition-all"
                style={{ width: `${meterWidth}%` }}
              />
            </div>
            <span className="pointer-events-none w-10 text-xs tabular-nums text-zinc-300">
              {mmss}
            </span>
            <button
              type="button"
              onClick={() => void uiStopAndInsert()}
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-red-500 text-white hover:bg-red-400"
              title={t("overlay.stop")}
            >
              <StopIcon />
            </button>
          </>
        )}

        {state === "transcribing" && (
          <span className="min-w-[120px] text-sm">
            {t("overlay.transcribing")}
          </span>
        )}
        {state === "injecting" && (
          <span className="min-w-[120px] text-sm">
            {t("overlay.inserting")}
          </span>
        )}
      </div>
    </div>
  );
}
