import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { onEvent } from "../lib/api";
import { useI18n } from "../lib/i18n";

/// The floating recording indicator shown while a meeting is being captured.
/// A red dot, a running timer, a live level bar, and a Stop button. Lives in its
/// own always-on-top window (label "meeting-bubble").
export default function MeetingBubble() {
  const { t } = useI18n();
  const [level, setLevel] = useState(0);
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    const un = onEvent<{ level: number }>("meeting_level", (p) =>
      setLevel(p.level),
    );
    const tick = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => {
      un.then((f) => f());
      clearInterval(tick);
    };
  }, []);

  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");
  const barWidth = Math.min(100, Math.round(level * 600));

  return (
    <div className="flex h-screen w-screen items-center gap-3 rounded-full bg-stone-900/95 px-4 text-stone-100 shadow-lg">
      <span className="h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-red-500" />
      <span className="font-mono text-sm tabular-nums">{`${mm}:${ss}`}</span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-stone-700">
        <div
          className="h-full bg-emerald-400 transition-[width] duration-100"
          style={{ width: `${barWidth}%` }}
        />
      </div>
      <button
        type="button"
        onClick={() => invoke("stop_meeting")}
        className="shrink-0 rounded-full bg-red-500 px-3 py-1 text-xs font-medium hover:bg-red-400"
      >
        {t("meetings.stop")}
      </button>
    </div>
  );
}
