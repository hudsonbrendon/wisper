import { useEffect, useRef, useState } from "react";
import { getHistory, onEvent, type HistoryEntry } from "../lib/api";
import { compact, computeStats, groupByDay, timeLabel } from "../lib/insights";
import { useI18n } from "../lib/i18n";

/// Home: a reverse-chronological feed of past dictations, plus a right-rail
/// summary card. The welcome heading, the day label and the stats card stay
/// fixed; only the feed scrolls (scrollbar hidden). The day label tracks the
/// topmost visible group, so it changes from "Today" to "Yesterday" to older
/// dates as you scroll. All data comes from the local history file via
/// `get_history`; it refreshes live on the `history_changed` event.
export default function Home() {
  const { t, lang } = useI18n();
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [activeLabel, setActiveLabel] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const groupRefs = useRef(new Map<string, HTMLElement>());

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

  const firstLabel = groups[0] ? headerText(groups[0].kind, groups[0].ts) : "";

  // The day label reflects the topmost group scrolled to the top of the feed.
  const onScroll = () => {
    const sc = scrollRef.current;
    if (!sc) return;
    let label = firstLabel;
    for (const g of groups) {
      const el = groupRefs.current.get(g.key);
      if (el && el.offsetTop - sc.scrollTop <= 8) {
        label = headerText(g.kind, g.ts);
      }
    }
    setActiveLabel(label);
  };

  return (
    <div className="flex h-full gap-6">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="shrink-0">
          <h1 className="text-2xl font-semibold tracking-tight text-stone-900 dark:text-stone-100">
            {t("home.welcome")}
          </h1>
          {entries.length > 0 && (
            <h2 className="mt-1 mb-3 text-xs font-medium uppercase tracking-wider text-stone-400 dark:text-stone-500">
              {activeLabel || firstLabel}
            </h2>
          )}
        </div>

        {entries.length === 0 ? (
          <EmptyState />
        ) : (
          <div
            ref={scrollRef}
            onScroll={onScroll}
            className="no-scrollbar relative min-h-0 flex-1 space-y-6 overflow-y-auto pb-4"
          >
            {groups.map((g) => (
              <section
                key={g.key}
                ref={(el) => {
                  const m = groupRefs.current;
                  if (el) m.set(g.key, el);
                  else m.delete(g.key);
                }}
              >
                <div className="overflow-hidden rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900">
                  {g.items.map((e, i) => (
                    <div
                      key={e.ts_ms + "-" + i}
                      className="flex gap-4 px-5 py-4 [&:not(:last-child)]:border-b [&:not(:last-child)]:border-stone-100 dark:[&:not(:last-child)]:border-stone-800"
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

      {/* Right rail — stays fixed while the feed scrolls. */}
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
