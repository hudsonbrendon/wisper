import { useEffect, useState } from "react";
import {
  getMeeting,
  renameMeeting,
  deleteMeeting,
  type Meeting,
} from "../lib/api";
import { useI18n } from "../lib/i18n";

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
