import { useEffect, useState } from "react";
import { getHistory, onEvent, type HistoryEntry } from "../lib/api";
import { compact, computeStats, groupByDay, timeLabel } from "../lib/insights";
import { useI18n } from "../lib/i18n";

/// Home: a reverse-chronological feed of past dictations grouped by day, plus a
/// right-rail summary card. All data comes from the local history file via
/// `get_history`; it refreshes live on the `history_changed` event the backend
/// emits after each new transcription.
export default function Home() {
  const { t, lang } = useI18n();
  const [entries, setEntries] = useState<HistoryEntry[]>([]);

  useEffect(() => {
    getHistory().then(setEntries);
    const un = onEvent("history_changed", () => getHistory().then(setEntries));
    return () => {
      un.then((f) => f());
    };
  }, []);

  const stats = computeStats(entries);
  const groups = groupByDay(entries);

  const headerText = (kind: string, ts: number) =>
    kind === "date"
      ? new Date(ts).toLocaleDateString(lang, {
          weekday: "short",
          month: "short",
          day: "numeric",
        })
      : t(`date.${kind}`);

  return (
    <div className="flex gap-6">
      <div className="min-w-0 flex-1">
        <h1 className="mb-6 text-2xl font-semibold tracking-tight text-stone-900 dark:text-stone-100">
          {t("home.welcome")}
        </h1>

        {entries.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="space-y-6">
            {groups.map((g) => (
              <section key={g.key}>
                <h2 className="mb-2 text-xs font-medium uppercase tracking-wider text-stone-400 dark:text-stone-500">
                  {headerText(g.kind, g.ts)}
                </h2>
                <div className="overflow-hidden rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900">
                  {g.items.map((e, i) => (
                    <div
                      key={e.ts_ms + "-" + i}
                      className="flex gap-4 px-5 py-4 [&:not(:last-child)]:border-b [&:not(:last-child)]:border-stone-100"
                    >
                      <span className="w-20 shrink-0 pt-0.5 text-sm tabular-nums text-stone-400 dark:text-stone-500">
                        {timeLabel(e.ts_ms, lang)}
                      </span>
                      <p className="flex-1 text-[15px] leading-relaxed text-stone-700 dark:text-stone-300">
                        {e.text}
                      </p>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>

      {/* Right rail */}
      <aside className="hidden w-64 shrink-0 lg:block">
        <div className="rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 p-5">
          <Stat
            value={compact(stats.totalWords)}
            label={t("stat.totalWords")}
          />
          <Stat value={String(stats.wpm)} label={t("stat.wpm")} />
          <Stat value={String(stats.streak)} label={t("stat.dayStreak")} />
        </div>
      </aside>
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex items-baseline gap-2 py-1.5">
      <span className="text-2xl font-semibold tracking-tight text-stone-900 dark:text-stone-100">
        {value}
      </span>
      <span className="text-sm text-stone-500 dark:text-stone-400">
        {label}
      </span>
    </div>
  );
}

function EmptyState() {
  const { t } = useI18n();
  return (
    <div className="rounded-2xl border border-dashed border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 px-6 py-16 text-center">
      <p className="text-[15px] font-medium text-stone-700 dark:text-stone-300">
        {t("home.empty.title")}
      </p>
      <p className="mx-auto mt-1 max-w-sm text-sm text-stone-500 dark:text-stone-400">
        {t("home.empty.body")}
      </p>
    </div>
  );
}
