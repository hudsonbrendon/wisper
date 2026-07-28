import { useEffect, useState } from "react";
import {
  listMeetings,
  startMeeting,
  stopMeeting,
  meetingSupported,
  checkSystemAudioPermission,
  requestSystemAudioPermission,
  openSystemAudioSettings,
  getMeetingState,
  onEvent,
  type MeetingSummary,
} from "../lib/api";
import { useI18n } from "../lib/i18n";

export default function Meetings({
  transcribing,
  onOpen,
}: {
  transcribing: boolean;
  onOpen: (id: string) => void;
}) {
  const { t } = useI18n();
  const [items, setItems] = useState<MeetingSummary[]>([]);
  const [supported, setSupported] = useState(true);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Pagination over the saved meetings.
  const [page, setPage] = useState(0);
  const PER_PAGE = 10;

  const refresh = () => listMeetings().then(setItems);

  useEffect(() => {
    meetingSupported().then(setSupported);
    getMeetingState().then((s) => setRecording(s === "recording"));
    refresh();
    const saved = onEvent<{ id: string }>("meeting_saved", () => refresh());
    const state = onEvent<{ state: string }>("meeting_state", (p) =>
      setRecording(p.state === "recording"),
    );
    return () => {
      saved.then((f) => f());
      state.then((f) => f());
    };
  }, []);

  const start = async () => {
    setError(null);
    setBusy(true);
    try {
      const ok = await checkSystemAudioPermission();
      if (!ok) {
        await requestSystemAudioPermission();
        openSystemAudioSettings();
        setError(t("meetings.permissionNeeded"));
        return;
      }
      await startMeeting();
    } catch (e) {
      const msg = String(e);
      // The sign-in prompt is already surfaced by SignInModal (driven by the
      // signin_required event); don't also show the raw error string.
      if (msg === "auth_required") return;
      setError(msg === "no_model" ? t("meetings.noModel") : msg);
    } finally {
      setBusy(false);
    }
  };

  const fmtDate = (ms: number) => new Date(ms).toLocaleString();
  const fmtDur = (ms: number) => {
    const s = Math.round(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  };

  const totalPages = Math.max(1, Math.ceil(items.length / PER_PAGE));
  const pageClamped = Math.min(page, totalPages - 1);
  const pageItems = items.slice(
    pageClamped * PER_PAGE,
    pageClamped * PER_PAGE + PER_PAGE,
  );

  return (
    <div className="flex h-full flex-col">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t("meetings.title")}</h1>
        {recording ? (
          <button
            type="button"
            onClick={() => stopMeeting()}
            className="rounded-lg bg-red-500 px-4 py-2 text-sm font-medium text-white hover:bg-red-400"
          >
            {t("meetings.stop")}
          </button>
        ) : (
          <button
            type="button"
            disabled={!supported || busy || transcribing}
            onClick={start}
            className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-700 disabled:opacity-40 dark:bg-stone-100 dark:text-stone-900"
          >
            {t("meetings.start")}
          </button>
        )}
      </div>

      {!supported && (
        <p className="mb-4 rounded-lg bg-amber-100 px-4 py-3 text-sm text-amber-900">
          {t("meetings.unsupported")}
        </p>
      )}
      {error && (
        <p className="mb-4 rounded-lg bg-amber-100 px-4 py-3 text-sm text-amber-900">
          {error}
        </p>
      )}
      <p className="mb-6 text-sm text-stone-500">{t("meetings.consentNote")}</p>

      {transcribing && (
        <div className="mb-2 flex items-center gap-3 rounded-lg border border-stone-200 px-4 py-3 dark:border-stone-800">
          <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-stone-300 border-t-stone-700 dark:border-stone-700 dark:border-t-stone-200" />
          <span className="text-sm text-stone-600 dark:text-stone-400">
            {t("meetings.transcribing")}
          </span>
        </div>
      )}

      {items.length === 0 && !transcribing ? (
        <p className="text-sm text-stone-500">{t("meetings.empty")}</p>
      ) : (
        <>
          <ul className="no-scrollbar flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
            {pageItems.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  onClick={() => onOpen(m.id)}
                  className="flex w-full items-center justify-between rounded-lg border border-stone-200 px-4 py-3 text-left hover:bg-stone-100 dark:border-stone-800 dark:hover:bg-stone-800"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">
                      {m.title}
                    </span>
                    <span className="block text-xs text-stone-500">
                      {fmtDate(m.started_ms)}
                    </span>
                  </span>
                  <span className="ml-3 shrink-0 text-xs text-stone-500">
                    {fmtDur(m.duration_ms)}
                    {m.partial ? ` · ${t("meetings.partial")}` : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>

          {totalPages > 1 && (
            <div className="mt-4 flex shrink-0 items-center justify-center gap-4 border-t border-stone-200 pt-4 text-sm dark:border-stone-800">
              <button
                type="button"
                disabled={pageClamped === 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                className="rounded-lg border border-stone-200 px-3 py-1.5 hover:bg-stone-100 disabled:opacity-40 dark:border-stone-800 dark:hover:bg-stone-800"
              >
                ‹ {t("meetings.prev")}
              </button>
              <span className="tabular-nums text-stone-500">
                {pageClamped + 1} / {totalPages}
              </span>
              <button
                type="button"
                disabled={pageClamped >= totalPages - 1}
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                className="rounded-lg border border-stone-200 px-3 py-1.5 hover:bg-stone-100 disabled:opacity-40 dark:border-stone-800 dark:hover:bg-stone-800"
              >
                {t("meetings.next")} ›
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
