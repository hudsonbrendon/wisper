import { useEffect, useState } from "react";
import { getHistory, onEvent, type HistoryEntry } from "../lib/api";
import { compact, computeStats, groupByDay, timeLabel } from "../lib/insights";

/// Home: a reverse-chronological feed of past dictations grouped by day, plus a
/// right-rail summary card. All data comes from the local history file via
/// `get_history`; it refreshes live on the `history_changed` event the backend
/// emits after each new transcription.
export default function Home() {
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

  return (
    <div className="flex gap-6">
      <div className="min-w-0 flex-1">
        <h1 className="mb-6 text-2xl font-semibold tracking-tight text-stone-900">
          Welcome back, Hudson
        </h1>

        {entries.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="space-y-6">
            {groups.map((g) => (
              <section key={g.key}>
                <h2 className="mb-2 text-xs font-medium uppercase tracking-wider text-stone-400">
                  {g.header}
                </h2>
                <div className="overflow-hidden rounded-2xl border border-stone-200 bg-white">
                  {g.items.map((e, i) => (
                    <div
                      key={e.ts_ms + "-" + i}
                      className="flex gap-4 px-5 py-4 [&:not(:last-child)]:border-b [&:not(:last-child)]:border-stone-100"
                    >
                      <span className="w-20 shrink-0 pt-0.5 text-sm tabular-nums text-stone-400">
                        {timeLabel(e.ts_ms)}
                      </span>
                      <p className="flex-1 text-[15px] leading-relaxed text-stone-700">
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
        <div className="rounded-2xl border border-stone-200 bg-white p-5">
          <Stat value={compact(stats.totalWords)} label="total words" />
          <Stat value={String(stats.wpm)} label="wpm" />
          <Stat value={String(stats.streak)} label="day streak" />
        </div>
      </aside>
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex items-baseline gap-2 py-1.5">
      <span className="text-2xl font-semibold tracking-tight text-stone-900">
        {value}
      </span>
      <span className="text-sm text-stone-500">{label}</span>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-2xl border border-dashed border-stone-300 bg-white px-6 py-16 text-center">
      <p className="text-[15px] font-medium text-stone-700">
        No dictations yet
      </p>
      <p className="mx-auto mt-1 max-w-sm text-sm text-stone-500">
        Hold your hotkey and speak — every transcription you insert shows up
        here, and powers the charts in Insights.
      </p>
    </div>
  );
}
