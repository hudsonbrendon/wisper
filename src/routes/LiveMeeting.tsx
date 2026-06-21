import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { onEvent, type MeetingLiveSegmentPayload } from "../lib/api";
import { useI18n } from "../lib/i18n";

type Seg = MeetingLiveSegmentPayload;

/// Live transcript shown while a meeting is recording. Appends each closed
/// segment as it arrives and auto-scrolls. The saved transcript comes later from
/// the batch re-pass; this view is replaced by MeetingDetail on meeting_saved.
export default function LiveMeeting() {
  const { t } = useI18n();
  const [segments, setSegments] = useState<Seg[]>([]);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const un = onEvent<Seg>("meeting_live_segment", (p) =>
      setSegments((prev) => [...prev, p]),
    );
    return () => {
      un.then((f) => f());
    };
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [segments]);

  const label = (s: "me" | "them") =>
    s === "me" ? t("meetings.you") : t("meetings.them");

  return (
    <div className="flex h-full flex-col">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-500" />
          {t("meetings.live")}
        </h1>
        <button
          type="button"
          onClick={() => invoke("stop_meeting").catch(() => {})}
          className="rounded-lg bg-red-500 px-4 py-2 text-sm font-medium text-white hover:bg-red-400"
        >
          {t("meetings.stop")}
        </button>
      </div>

      {segments.length === 0 ? (
        <p className="text-sm text-stone-500">{t("meetings.liveWaiting")}</p>
      ) : (
        <div className="flex flex-col gap-3">
          {segments.map((s, i) => (
            <div key={i} className="flex gap-3">
              <span
                className={
                  "shrink-0 text-xs font-medium " +
                  (s.speaker === "me" ? "text-emerald-600" : "text-sky-600")
                }
              >
                {label(s.speaker)}
              </span>
              <p className="min-w-0 text-sm">{s.text}</p>
            </div>
          ))}
          <div ref={endRef} />
        </div>
      )}
    </div>
  );
}
