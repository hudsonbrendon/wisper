import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { LogicalSize } from "@tauri-apps/api/dpi";
import { onEvent, type MeetingLiveSegmentPayload } from "../lib/api";
import { useI18n } from "../lib/i18n";

// The window grows downward to reveal the transcript panel; the pill keeps its
// height and stays anchored at the top.
const WIDTH = 280;
const COLLAPSED_H = 64;
const PANEL_H = 320;
const GAP = 8;
const EXPANDED_H = COLLAPSED_H + GAP + PANEL_H;

/// The floating recording indicator shown while a meeting is being captured.
/// A red dot, a running timer, a live level bar, an eye toggle, and a Stop
/// button. The eye expands the window into a live-transcript panel below the
/// pill. Lives in its own always-on-top window (label "meeting-bubble").
export default function MeetingBubble() {
  const { t } = useI18n();
  const [level, setLevel] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [segments, setSegments] = useState<MeetingLiveSegmentPayload[]>([]);
  // Render the most recent messages; the floating "load more" reveals 10 older
  // at a time. The list scrolls (so you can navigate) but the scrollbar is
  // hidden via `no-scrollbar`.
  const [visibleCount, setVisibleCount] = useState(10);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Stick to the bottom for new messages, but don't yank the user down while
  // they're scrolled up reading history.
  const stick = useRef(true);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [segments, expanded]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (el)
      stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  };

  useEffect(() => {
    const un = onEvent<{ level: number }>("meeting_level", (p) =>
      setLevel(p.level),
    );
    const live = onEvent<MeetingLiveSegmentPayload>(
      "meeting_live_segment",
      (p) => setSegments((prev) => [...prev, p]),
    );
    // The window persists across meetings (hidden/shown, not reloaded), so a new
    // recording must reset the timer and transcript.
    const state = onEvent<{ state: string }>("meeting_state", (p) => {
      if (p.state === "recording") {
        setSeconds(0);
        setSegments([]);
        setVisibleCount(10);
      }
    });
    const tick = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => {
      un.then((f) => f());
      live.then((f) => f());
      state.then((f) => f());
      clearInterval(tick);
    };
  }, []);

  // Reveal/hide the transcript panel by resizing the window.
  useEffect(() => {
    getCurrentWindow()
      .setSize(new LogicalSize(WIDTH, expanded ? EXPANDED_H : COLLAPSED_H))
      .catch(() => {});
  }, [expanded]);

  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");
  // Perceptual scaling with a noise floor. Mic RMS is often quiet (measured
  // ~0.003–0.025 for normal speech on low-gain mics), so a plain linear meter
  // barely moves. Take sqrt to expand the low end, subtract a small floor so
  // room tone reads as empty, then apply gain so quiet speech fills a visible
  // chunk and louder speech saturates. Clamped to [0, 100].
  const FLOOR = 0.025; // sqrt-space; ≈ RMS 0.0006, below typical speech
  const barWidth = Math.min(
    100,
    Math.max(0, Math.round((Math.sqrt(level) - FLOOR) * 700)),
  );

  const label = (s: "me" | "them") =>
    s === "me" ? t("meetings.you") : t("meetings.them");

  // `data-tauri-drag-region` makes the pill draggable (needs
  // core:window:allow-start-dragging). The non-interactive children are
  // `pointer-events-none` so a mousedown lands on the drag region; the eye and
  // Stop buttons keep pointer events so they stay clickable.
  return (
    <div className="flex h-screen w-screen flex-col gap-2">
      <div
        data-tauri-drag-region
        className="flex h-16 shrink-0 cursor-grab select-none items-center gap-3 rounded-full bg-stone-900/95 px-4 text-stone-100 shadow-lg active:cursor-grabbing"
      >
        <span className="pointer-events-none h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-red-500" />
        <span className="pointer-events-none font-mono text-sm tabular-nums">{`${mm}:${ss}`}</span>
        <div className="pointer-events-none h-1.5 flex-1 overflow-hidden rounded-full bg-stone-700">
          <div
            className="h-full bg-emerald-400 transition-[width] duration-100"
            style={{ width: `${barWidth}%` }}
          />
        </div>
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          title={t("meetings.liveToggle")}
          aria-label={t("meetings.liveToggle")}
          className="shrink-0 rounded-full p-1 text-stone-300 hover:bg-stone-700 hover:text-stone-100"
        >
          {expanded ? <EyeOpenIcon /> : <EyeClosedIcon />}
        </button>
        <button
          type="button"
          onClick={() => invoke("stop_meeting")}
          className="shrink-0 rounded-full bg-red-500 px-3 py-1 text-xs font-medium hover:bg-red-400"
        >
          {t("meetings.stop")}
        </button>
      </div>

      {expanded && (
        <div className="flex min-h-0 flex-1 select-text flex-col overflow-hidden rounded-2xl bg-stone-50/95 p-3 text-stone-900 shadow-lg dark:bg-stone-900/95 dark:text-stone-100">
          <div className="mb-2 flex shrink-0 items-center gap-2">
            <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
            <span className="text-sm font-semibold">{t("meetings.live")}</span>
          </div>
          {segments.length === 0 ? (
            <p className="text-xs text-stone-500">
              {t("meetings.liveWaiting")}
            </p>
          ) : (
            <div className="relative min-h-0 flex-1">
              {segments.length > visibleCount && (
                <button
                  type="button"
                  onClick={() => setVisibleCount((c) => c + 10)}
                  className="absolute left-1/2 top-0 z-10 -translate-x-1/2 rounded-full border border-stone-200 bg-stone-50/90 px-2 py-0.5 text-[10px] text-stone-600 shadow-sm backdrop-blur hover:bg-stone-100 dark:border-stone-700 dark:bg-stone-900/90 dark:text-stone-300 dark:hover:bg-stone-800"
                >
                  {t("meetings.loadMore")} ({segments.length - visibleCount})
                </button>
              )}
              <div
                ref={scrollRef}
                onScroll={onScroll}
                className="no-scrollbar flex h-full flex-col gap-1.5 overflow-y-auto"
              >
                {segments.slice(-visibleCount).map((s, i) => (
                  <div
                    key={segments.length - visibleCount + i}
                    className="flex gap-2"
                  >
                    <span
                      className={
                        "shrink-0 text-[10px] font-medium " +
                        (s.speaker === "me"
                          ? "text-emerald-600"
                          : "text-sky-600")
                      }
                    >
                      {label(s.speaker)}
                    </span>
                    <p className="min-w-0 text-xs leading-snug">{s.text}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function EyeOpenIcon() {
  return (
    <svg
      className="h-4 w-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeClosedIcon() {
  return (
    <svg
      className="h-4 w-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M9.9 4.24A9.1 9.1 0 0 1 12 4c6.5 0 10 7 10 7a13.2 13.2 0 0 1-1.67 2.42" />
      <path d="M6.6 6.6C4 8.1 2 12 2 12s3.5 7 10 7a9.3 9.3 0 0 0 5.4-1.6" />
      <path d="M14.1 14.1A3 3 0 0 1 9.9 9.9" />
      <line x1="2" y1="2" x2="22" y2="22" />
    </svg>
  );
}
