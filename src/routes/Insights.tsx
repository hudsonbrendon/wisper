import { useEffect, useMemo, useState } from "react";
import { getHistory, onEvent, type HistoryEntry } from "../lib/api";
import {
  computeStats,
  dailyBuckets,
  heatmap,
  type HeatCell,
} from "../lib/insights";
import { useI18n } from "../lib/i18n";

/// Insights: visual summary of dictation activity. Every number and chart is
/// derived from the local history (see lib/insights), so nothing here is
/// fabricated — empty history yields honest zeros and a flat grid.
export default function Insights() {
  const { t, lang } = useI18n();
  const [entries, setEntries] = useState<HistoryEntry[]>([]);

  useEffect(() => {
    getHistory().then(setEntries);
    const un = onEvent("history_changed", () => getHistory().then(setEntries));
    return () => {
      un.then((f) => f());
    };
  }, []);

  const stats = useMemo(() => computeStats(entries), [entries]);
  const daily = useMemo(() => dailyBuckets(entries, 14), [entries]);
  const grid = useMemo(() => heatmap(entries, 20), [entries]);
  const maxDay = Math.max(1, ...daily.map((d) => d.words));

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold tracking-tight text-stone-900">
        {t("insights.title")}
      </h1>

      {/* Top stat cards */}
      <div className="mb-5 grid grid-cols-1 gap-5 md:grid-cols-3">
        <Card>
          <BigNumber value={String(stats.wpm)} />
          <Caption>{t("insights.wpm")}</Caption>
        </Card>
        <Card>
          <BigNumber value={stats.totalWords.toLocaleString(lang)} />
          <Caption>{t("insights.totalWords")}</Caption>
          <p className="mt-3 text-sm text-stone-500">{wordsContext(stats.totalWords, t)}</p>
        </Card>
        <Card>
          <BigNumber value={String(stats.totalEntries)} />
          <Caption>{t("insights.transcriptions")}</Caption>
          <p className="mt-3 flex items-center gap-2 text-sm text-stone-500">
            <span className="inline-flex items-center rounded-full bg-teal-50 px-2 py-0.5 text-xs font-medium text-teal-700">
              {t("insights.streakBadge", { n: stats.streak })}
            </span>
          </p>
        </Card>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card>
          <h2 className="text-lg font-semibold text-stone-900">
            {t("insights.dailyActivity")}
          </h2>
          <p className="mb-6 text-xs uppercase tracking-wider text-stone-400">
            {t("insights.dailySub")}
          </p>
          <div className="flex h-40 items-end gap-1.5">
            {daily.map((d) => (
              <div
                key={d.key}
                className="group relative flex flex-1 flex-col items-center justify-end"
                title={`${d.date.toLocaleDateString(lang, {
                  month: "short",
                  day: "numeric",
                })}: ${d.words}`}
              >
                <div
                  className="w-full rounded-t bg-teal-700/85 transition-colors group-hover:bg-teal-600"
                  style={{
                    height: `${Math.max(2, (d.words / maxDay) * 100)}%`,
                  }}
                />
              </div>
            ))}
          </div>
          <div className="mt-2 flex justify-between text-xs text-stone-400">
            <span>
              {daily[0]?.date.toLocaleDateString(lang, {
                month: "short",
                day: "numeric",
              })}
            </span>
            <span>{t("insights.today")}</span>
          </div>
        </Card>

        <Card>
          <div className="mb-1 flex items-baseline justify-between">
            <h2 className="text-lg font-semibold text-stone-900">
              {t("insights.streakBadge", { n: stats.streak })}
            </h2>
            <span className="text-xs uppercase tracking-wider text-stone-400">
              {t("insights.last20w")}
            </span>
          </div>
          <Heatmap grid={grid} locale={lang} />
          <Legend t={t} />
        </Card>
      </div>
    </div>
  );
}

const HEAT_CLASSES: Record<HeatCell["level"], string> = {
  0: "bg-stone-100",
  1: "bg-teal-200",
  2: "bg-teal-400",
  3: "bg-teal-600",
  4: "bg-teal-800",
};

function Heatmap({ grid, locale }: { grid: HeatCell[][]; locale: string }) {
  return (
    <div className="mt-4 flex gap-[3px] overflow-x-auto pb-1">
      {grid.map((col, ci) => (
        <div key={ci} className="flex flex-col gap-[3px]">
          {col.map((cell) => (
            <div
              key={cell.key}
              title={
                cell.future
                  ? ""
                  : `${cell.date.toLocaleDateString(locale, {
                      month: "short",
                      day: "numeric",
                    })}: ${cell.words}`
              }
              className={
                "h-[13px] w-[13px] rounded-sm " +
                (cell.future ? "bg-transparent" : HEAT_CLASSES[cell.level])
              }
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function Legend({ t }: { t: (k: string) => string }) {
  return (
    <div className="mt-3 flex items-center justify-end gap-1.5 text-xs text-stone-400">
      <span>{t("insights.less")}</span>
      {([0, 1, 2, 3, 4] as const).map((l) => (
        <span key={l} className={"h-[11px] w-[11px] rounded-sm " + HEAT_CLASSES[l]} />
      ))}
      <span>{t("insights.more")}</span>
    </div>
  );
}

/// A light, honest gloss on the total — no fabricated comparisons.
function wordsContext(
  total: number,
  t: (k: string, v?: Record<string, string | number>) => string,
): string {
  if (total === 0) return t("insights.start");
  const pages = Math.max(1, Math.round(total / 500));
  return pages === 1 ? t("insights.pagesOne") : t("insights.pages", { n: pages });
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-6">
      {children}
    </div>
  );
}

function BigNumber({ value }: { value: string }) {
  return (
    <div className="text-4xl font-semibold tracking-tight text-stone-900">
      {value}
    </div>
  );
}

function Caption({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-1 text-xs font-medium uppercase tracking-wider text-stone-400">
      {children}
    </div>
  );
}
