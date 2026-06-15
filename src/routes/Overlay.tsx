import { useEffect, useState } from "react";
import { onEvent, type StatePayload, type LevelPayload } from "../lib/api";
import { useI18n } from "../lib/i18n";

export default function Overlay() {
  const { t } = useI18n();
  const [state, setState] = useState("idle");
  const [level, setLevel] = useState(0);
  const [error, setError] = useState("");

  useEffect(() => {
    // This window's content is wider than nothing else needs scrolling; kill the
    // overflow scrollbar that otherwise draws a stray line under the pill. Scoped
    // to the overlay's own document, so the main window keeps its scroll.
    document.body.style.overflow = "hidden";

    const unState = onEvent<StatePayload>("state", (p) => {
      setState(p.state);
      if (p.state === "recording") setError(""); // fresh take clears stale errors
    });
    const unLevel = onEvent<LevelPayload>("audio_level", (p) => setLevel(p.level));
    // Surface backend failures (no model, transcribe error, inject blocked by
    // macOS Accessibility permission) instead of silently swallowing them.
    const unError = onEvent<{ message: string }>("error", (p) => setError(p.message));
    return () => {
      unState.then((f) => f());
      unLevel.then((f) => f());
      unError.then((f) => f());
    };
  }, []);

  const labels: Record<string, string> = {
    idle: "",
    recording: t("overlay.listening"),
    transcribing: t("overlay.transcribing"),
    injecting: t("overlay.inserting"),
  };

  // Scale the meter bar width from RMS level (0..~0.3 typical speech).
  const meterWidth = Math.min(100, Math.round(level * 400));

  return (
    <div className="flex h-full w-full items-center justify-center overflow-hidden bg-transparent">
      <div className="flex items-center gap-3 rounded-full bg-zinc-900/90 px-5 py-3 text-zinc-100 shadow-xl backdrop-blur">
        <span
          className={
            "h-3 w-3 shrink-0 rounded-full " +
            (error
              ? "bg-rose-500"
              : state === "recording"
                ? "animate-pulse bg-red-500"
                : "bg-zinc-500")
          }
        />
        {error ? (
          <span className="max-w-[230px] text-sm text-rose-300">{error}</span>
        ) : (
          <>
            <span className="min-w-[90px] text-sm">{labels[state] ?? ""}</span>
            {state === "recording" && (
              <div className="h-2 w-24 shrink-0 overflow-hidden rounded-full bg-zinc-700">
                <div
                  className="h-full bg-emerald-400 transition-all"
                  style={{ width: `${meterWidth}%` }}
                />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
