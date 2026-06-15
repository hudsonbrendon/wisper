import type { HistoryEntry } from "./api";

/// All stats shown across Home and Insights are derived here, on the frontend,
/// from the raw history entries — the backend only stores; it never aggregates.
/// Keeping the math in one pure module makes it testable and keeps the two
/// screens consistent (they read the same numbers).

const DAY_MS = 24 * 60 * 60 * 1000;

/// Local date key "YYYY-MM-DD" for a timestamp, so day grouping respects the
/// user's timezone rather than UTC.
export function dayKey(ts: number): string {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export interface Stats {
  totalWords: number;
  totalEntries: number;
  /// Average words per minute across all dictation. 0 when no audio recorded.
  wpm: number;
  /// Consecutive days (ending today, with a one-day grace) that have activity.
  streak: number;
}

export function computeStats(entries: HistoryEntry[]): Stats {
  const totalWords = entries.reduce((s, e) => s + e.words, 0);
  const totalMs = entries.reduce((s, e) => s + e.duration_ms, 0);
  const minutes = totalMs / 60000;
  const wpm = minutes > 0 ? Math.round(totalWords / minutes) : 0;

  const days = new Set(entries.map((e) => dayKey(e.ts_ms)));
  let streak = 0;
  // Start at today; if nothing today yet, give a one-day grace and start at
  // yesterday so the streak doesn't read 0 just because today isn't done.
  let cursor = Date.now();
  if (!days.has(dayKey(cursor))) cursor -= DAY_MS;
  while (days.has(dayKey(cursor))) {
    streak++;
    cursor -= DAY_MS;
  }

  return { totalWords, totalEntries: entries.length, wpm, streak };
}

export interface DayBucket {
  key: string;
  /// Date at local midnight, for labelling.
  date: Date;
  words: number;
  count: number;
}

/// Words/count per day for the last `days` days, oldest → newest, with empty
/// days filled in so a bar chart has a continuous axis.
export function dailyBuckets(entries: HistoryEntry[], days: number): DayBucket[] {
  const byDay = new Map<string, { words: number; count: number }>();
  for (const e of entries) {
    const k = dayKey(e.ts_ms);
    const cur = byDay.get(k) ?? { words: 0, count: 0 };
    cur.words += e.words;
    cur.count += 1;
    byDay.set(k, cur);
  }

  const out: DayBucket[] = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(today.getTime() - i * DAY_MS);
    const k = dayKey(date.getTime());
    const v = byDay.get(k) ?? { words: 0, count: 0 };
    out.push({ key: k, date, words: v.words, count: v.count });
  }
  return out;
}

/// A GitHub-style contribution grid: columns are weeks (oldest left), rows are
/// weekdays (Sun..Sat). `level` 0..4 buckets the day's word count for shading.
export interface HeatCell {
  key: string;
  date: Date;
  words: number;
  level: 0 | 1 | 2 | 3 | 4;
  /// True for days beyond today (the current week's trailing cells) — rendered
  /// blank so the grid stays rectangular without faking future activity.
  future: boolean;
}

export function heatmap(entries: HistoryEntry[], weeks: number): HeatCell[][] {
  const byDay = new Map<string, number>();
  for (const e of entries) {
    const k = dayKey(e.ts_ms);
    byDay.set(k, (byDay.get(k) ?? 0) + e.words);
  }
  const max = Math.max(1, ...byDay.values());

  const level = (w: number): HeatCell["level"] => {
    if (w === 0) return 0;
    const r = w / max;
    if (r > 0.66) return 4;
    if (r > 0.33) return 3;
    if (r > 0.1) return 2;
    return 1;
  };

  // End on the Saturday of the current week; walk back `weeks` columns.
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const end = new Date(today.getTime() + (6 - today.getDay()) * DAY_MS);
  const start = new Date(end.getTime() - (weeks * 7 - 1) * DAY_MS);

  const cols: HeatCell[][] = [];
  for (let w = 0; w < weeks; w++) {
    const col: HeatCell[] = [];
    for (let d = 0; d < 7; d++) {
      const date = new Date(start.getTime() + (w * 7 + d) * DAY_MS);
      const k = dayKey(date.getTime());
      const words = byDay.get(k) ?? 0;
      col.push({
        key: k,
        date,
        words,
        level: level(words),
        future: date.getTime() > today.getTime(),
      });
    }
    cols.push(col);
  }
  return cols;
}

/// "01:05 pm" style clock label used in the Home history list. `locale` lets
/// the time format follow the chosen UI language.
export function timeLabel(ts: number, locale: string = "en-US"): string {
  return new Date(ts)
    .toLocaleTimeString(locale, {
      hour: "2-digit",
      minute: "2-digit",
    })
    .toLowerCase();
}

/// Whether a day section header is Today, Yesterday, or a plain date — the
/// caller translates the first two and formats the date in its own locale.
export type DayHeaderKind = "today" | "yesterday" | "date";

export function dayHeaderKind(ts: number): DayHeaderKind {
  const k = dayKey(ts);
  const now = Date.now();
  if (k === dayKey(now)) return "today";
  if (k === dayKey(now - DAY_MS)) return "yesterday";
  return "date";
}

/// Group entries (already newest-first) into ordered day sections for the list.
/// Header text is left to the component (it needs the active language), so each
/// group exposes the header kind plus the first timestamp to format from.
export function groupByDay(
  entries: HistoryEntry[],
): { kind: DayHeaderKind; ts: number; key: string; items: HistoryEntry[] }[] {
  const groups: {
    kind: DayHeaderKind;
    ts: number;
    key: string;
    items: HistoryEntry[];
  }[] = [];
  for (const e of entries) {
    const k = dayKey(e.ts_ms);
    const last = groups[groups.length - 1];
    if (last && last.key === k) {
      last.items.push(e);
    } else {
      groups.push({
        kind: dayHeaderKind(e.ts_ms),
        ts: e.ts_ms,
        key: k,
        items: [e],
      });
    }
  }
  return groups;
}

/// Compact number: 36400 → "36.4K".
export function compact(n: number): string {
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "K";
  return String(n);
}
