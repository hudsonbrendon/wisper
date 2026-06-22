import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { type MeetingLiveSegmentPayload } from "../lib/api";
import { useI18n } from "../lib/i18n";

/// Live transcript shown while a meeting is recording. The segments are owned by
/// Dashboard (always mounted, so it never misses an event) and passed in; this
/// view is replaced by MeetingDetail on meeting_saved.
export default function LiveMeeting({
  segments,
}: {
  segments: MeetingLiveSegmentPayload[];
}) {
  const { t } = useI18n();
  // Show only the most recent messages, pinned to the bottom: as new ones
  // arrive the oldest scroll off the top and are clipped (no scrollbar). The
  // floating "load more" button reveals 10 older at a time.
  const [visibleCount, setVisibleCount] = useState(10);

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
        <div className="relative min-h-0 flex-1 overflow-hidden">
          {segments.length > visibleCount && (
            <button
              type="button"
              onClick={() => setVisibleCount((c) => c + 10)}
              className="absolute left-1/2 top-0 z-10 -translate-x-1/2 rounded-full border border-stone-200 bg-stone-50/90 px-3 py-1 text-xs text-stone-600 shadow-sm backdrop-blur transition-colors hover:bg-stone-100 dark:border-stone-700 dark:bg-stone-900/90 dark:text-stone-300 dark:hover:bg-stone-800"
            >
              {t("meetings.loadMore")} ({segments.length - visibleCount})
            </button>
          )}
          <div className="flex h-full flex-col justify-end gap-1.5">
            {segments.slice(-visibleCount).map((s, i) => (
              <div
                key={segments.length - visibleCount + i}
                className="flex gap-2"
              >
                <span
                  className={
                    "shrink-0 text-xs font-medium " +
                    (s.speaker === "me" ? "text-emerald-600" : "text-sky-600")
                  }
                >
                  {label(s.speaker)}
                </span>
                <p className="min-w-0 text-sm leading-snug">{s.text}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
