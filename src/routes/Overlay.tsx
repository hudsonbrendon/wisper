import { useEffect, useState } from "react";
import { onEvent, type StatePayload, type LevelPayload } from "../lib/api";

export default function Overlay() {
  const [state, setState] = useState("idle");
  const [level, setLevel] = useState(0);

  useEffect(() => {
    const unState = onEvent<StatePayload>("state", (p) => setState(p.state));
    const unLevel = onEvent<LevelPayload>("audio_level", (p) => setLevel(p.level));
    return () => {
      unState.then((f) => f());
      unLevel.then((f) => f());
    };
  }, []);

  const labels: Record<string, string> = {
    idle: "",
    recording: "Listening…",
    transcribing: "Transcribing…",
    injecting: "Inserting…",
  };

  // Scale the meter bar width from RMS level (0..~0.3 typical speech).
  const meterWidth = Math.min(100, Math.round(level * 400));

  return (
    <div className="flex h-full w-full items-center justify-center bg-transparent">
      <div className="flex items-center gap-3 rounded-full bg-zinc-900/90 px-5 py-3 text-zinc-100 shadow-xl backdrop-blur">
        <span
          className={
            "h-3 w-3 rounded-full " +
            (state === "recording" ? "animate-pulse bg-red-500" : "bg-zinc-500")
          }
        />
        <span className="min-w-[90px] text-sm">{labels[state] ?? ""}</span>
        {state === "recording" && (
          <div className="h-2 w-24 overflow-hidden rounded-full bg-zinc-700">
            <div
              className="h-full bg-emerald-400 transition-all"
              style={{ width: `${meterWidth}%` }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
