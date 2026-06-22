import { useEffect, useState } from "react";
import {
  getMeeting,
  renameMeeting,
  deleteMeeting,
  generateSummary,
  llmModelDownloaded,
  downloadLlmModel,
  onEvent,
  type Meeting,
  type LlmDownloadProgressPayload,
} from "../lib/api";
import { useI18n } from "../lib/i18n";

/// Tiny renderer for the LLM summary markdown: ## headings, "-"/"- [ ]" bullets,
/// and paragraphs. Not a general markdown parser — just what build_prompt emits.
function renderSummary(md: string) {
  return md.split("\n").map((raw, i) => {
    const line = raw.trimEnd();
    if (line.startsWith("## ")) {
      return (
        <h3 key={i} className="mt-4 mb-1 text-sm font-semibold">
          {line.slice(3)}
        </h3>
      );
    }
    if (line.startsWith("- [ ] ") || line.startsWith("- [x] ")) {
      return (
        <label key={i} className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            readOnly
            checked={line.startsWith("- [x]")}
            className="mt-1"
          />
          <span>{line.slice(6)}</span>
        </label>
      );
    }
    if (line.startsWith("- ")) {
      return (
        <li key={i} className="ml-5 list-disc text-sm">
          {line.slice(2)}
        </li>
      );
    }
    if (line.trim() === "") return <div key={i} className="h-2" />;
    return (
      <p key={i} className="text-sm">
        {line}
      </p>
    );
  });
}

export default function MeetingDetail({
  id,
  onBack,
}: {
  id: string;
  onBack: () => void;
}) {
  const { t } = useI18n();
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [title, setTitle] = useState("");

  useEffect(() => {
    getMeeting(id).then((m) => {
      setMeeting(m);
      setTitle(m?.title ?? "");
    });
  }, [id]);

  const [hasModel, setHasModel] = useState<boolean | null>(null);
  const [summaryBusy, setSummaryBusy] = useState(false);
  const [dlPct, setDlPct] = useState<number | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  useEffect(() => {
    llmModelDownloaded().then(setHasModel);
    const un = onEvent<LlmDownloadProgressPayload>(
      "llm_download_progress",
      (p) => setDlPct(p.total ? Math.round((p.received / p.total) * 100) : 0),
    );
    return () => {
      un.then((f) => f());
    };
  }, []);

  const downloadModel = async () => {
    setSummaryError(null);
    setDlPct(0);
    try {
      await downloadLlmModel();
      setHasModel(true);
    } catch (e) {
      setSummaryError(String(e));
    } finally {
      setDlPct(null);
    }
  };

  const genSummary = async () => {
    setSummaryError(null);
    setSummaryBusy(true);
    try {
      const md = await generateSummary(id);
      setMeeting((m) => (m ? { ...m, summary: md } : m));
    } catch (e) {
      const msg = String(e);
      setSummaryError(
        msg.includes("no_llm_model")
          ? t("meetings.summaryNoModel")
          : msg.includes("empty_transcript")
            ? t("meetings.summaryEmpty")
            : msg.includes("summary_unavailable")
              ? t("meetings.summaryUnavailable")
              : msg,
      );
    } finally {
      setSummaryBusy(false);
    }
  };

  if (!meeting) return <p className="text-sm text-stone-500">…</p>;

  const speakerLabel = (s: "me" | "them") =>
    s === "me" ? t("meetings.you") : t("meetings.them");

  const asText = () =>
    meeting.segments
      .map((s) => `${speakerLabel(s.speaker)}: ${s.text}`)
      .join("\n");

  const copy = () => navigator.clipboard.writeText(asText());

  const exportMd = () => {
    const md = `# ${meeting.title}\n\n` + asText();
    const blob = new Blob([md], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${meeting.title}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const saveTitle = () => {
    if (title.trim() && title !== meeting.title) {
      renameMeeting(id, title.trim());
      setMeeting({ ...meeting, title: title.trim() });
    }
  };

  const remove = async () => {
    await deleteMeeting(id);
    onBack();
  };

  return (
    <div>
      <div className="mb-4 flex items-center gap-2">
        <button
          type="button"
          onClick={onBack}
          className="text-sm text-stone-500 hover:text-stone-900"
        >
          ← {t("meetings.back")}
        </button>
      </div>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={saveTitle}
        className="mb-1 w-full bg-transparent text-2xl font-semibold outline-none"
      />
      <p className="mb-4 text-xs text-stone-500">
        {new Date(meeting.started_ms).toLocaleString()}
      </p>
      {meeting.partial && (
        <p className="mb-4 rounded-lg bg-amber-100 px-4 py-2 text-sm text-amber-900">
          {t("meetings.partialNote")}
        </p>
      )}

      <div className="mb-4 flex gap-2">
        <button
          type="button"
          onClick={copy}
          className="rounded-lg border border-stone-200 px-3 py-1.5 text-sm hover:bg-stone-100 dark:border-stone-800 dark:hover:bg-stone-800"
        >
          {t("meetings.copy")}
        </button>
        <button
          type="button"
          onClick={exportMd}
          className="rounded-lg border border-stone-200 px-3 py-1.5 text-sm hover:bg-stone-100 dark:border-stone-800 dark:hover:bg-stone-800"
        >
          {t("meetings.export")}
        </button>
        <button
          type="button"
          onClick={remove}
          className="rounded-lg border border-red-200 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50"
        >
          {t("meetings.delete")}
        </button>
      </div>

      <section className="mb-6">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-lg font-semibold">
            {t("meetings.summaryTitle")}
          </h2>
          {hasModel === false ? (
            dlPct === null ? (
              <button
                type="button"
                onClick={downloadModel}
                className="rounded-lg border border-stone-200 px-3 py-1.5 text-sm hover:bg-stone-100 dark:border-stone-800 dark:hover:bg-stone-800"
              >
                {t("meetings.summaryDownloadModel")}
              </button>
            ) : (
              <span className="text-sm text-stone-500">{`${t("meetings.summaryDownloading")} ${dlPct}%`}</span>
            )
          ) : (
            <button
              type="button"
              disabled={summaryBusy}
              onClick={genSummary}
              className="rounded-lg border border-stone-200 px-3 py-1.5 text-sm hover:bg-stone-100 disabled:opacity-40 dark:border-stone-800 dark:hover:bg-stone-800"
            >
              {summaryBusy
                ? t("meetings.summaryGenerating")
                : meeting.summary
                  ? t("meetings.summaryRegenerate")
                  : t("meetings.summaryGenerate")}
            </button>
          )}
        </div>
        {summaryError && (
          <p className="mb-2 rounded-lg bg-amber-100 px-3 py-2 text-sm text-amber-900">
            {summaryError}
          </p>
        )}
        {meeting.summary ? (
          <div className="rounded-lg border border-stone-200 px-4 py-3 dark:border-stone-800">
            {renderSummary(meeting.summary)}
          </div>
        ) : (
          !summaryBusy && (
            <p className="text-sm text-stone-500">
              {t("meetings.summaryHint")}
            </p>
          )
        )}
      </section>

      <div className="flex flex-col gap-3">
        {meeting.segments.map((s, i) => (
          <div key={i} className="flex gap-3">
            <span
              className={
                "shrink-0 text-xs font-medium " +
                (s.speaker === "me" ? "text-emerald-600" : "text-sky-600")
              }
            >
              {speakerLabel(s.speaker)}
            </span>
            <p className="min-w-0 text-sm">{s.text}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
