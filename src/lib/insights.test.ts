import { describe, it, expect } from "vitest";
import {
  dayKey,
  compact,
  computeStats,
  dailyBuckets,
  heatmap,
  timeLabel,
  dayHeaderKind,
  groupByDay,
} from "./insights";
import type { HistoryEntry } from "./api";

const DAY = 24 * 60 * 60 * 1000;

function entry(ts: number, words: number, duration_ms = 60000): HistoryEntry {
  return { ts_ms: ts, text: "x".repeat(words), words, duration_ms };
}

describe("dayKey", () => {
  it("formats local date as YYYY-MM-DD", () => {
    const d = new Date(2026, 0, 5, 13, 0, 0); // Jan 5 2026 local
    expect(dayKey(d.getTime())).toBe("2026-01-05");
  });
});

describe("compact", () => {
  it("abbreviates thousands", () => {
    expect(compact(36400)).toBe("36.4K");
    expect(compact(1000)).toBe("1K");
    expect(compact(999)).toBe("999");
    expect(compact(0)).toBe("0");
  });
});

describe("computeStats", () => {
  it("totals words and entries", () => {
    const s = computeStats([entry(Date.now(), 10), entry(Date.now(), 5)]);
    expect(s.totalWords).toBe(15);
    expect(s.totalEntries).toBe(2);
  });

  it("computes words per minute from duration", () => {
    // 120 words over 60s (1 min) => 120 wpm.
    const s = computeStats([entry(Date.now(), 120, 60000)]);
    expect(s.wpm).toBe(120);
  });

  it("wpm is 0 with no audio duration", () => {
    expect(computeStats([entry(Date.now(), 10, 0)]).wpm).toBe(0);
    expect(computeStats([]).wpm).toBe(0);
  });

  it("counts a streak of consecutive days ending today", () => {
    const now = Date.now();
    const s = computeStats([
      entry(now, 1),
      entry(now - DAY, 1),
      entry(now - 2 * DAY, 1),
    ]);
    expect(s.streak).toBe(3);
  });

  it("breaks the streak on a gap", () => {
    const now = Date.now();
    const s = computeStats([entry(now, 1), entry(now - 3 * DAY, 1)]);
    expect(s.streak).toBe(1);
  });
});

describe("dailyBuckets", () => {
  it("returns one bucket per day, oldest first, filling gaps", () => {
    const now = Date.now();
    const b = dailyBuckets([entry(now, 4), entry(now, 6)], 7);
    expect(b).toHaveLength(7);
    // The last bucket is today and aggregates both entries.
    expect(b[6].words).toBe(10);
    expect(b[6].count).toBe(2);
    // An earlier (empty) day stays zeroed.
    expect(b[0].words).toBe(0);
  });
});

describe("heatmap", () => {
  it("is weeks columns of 7 weekday rows", () => {
    const grid = heatmap([entry(Date.now(), 5)], 4);
    expect(grid).toHaveLength(4);
    expect(grid.every((col) => col.length === 7)).toBe(true);
  });

  it("levels scale 0..4 and flags future cells", () => {
    const grid = heatmap([entry(Date.now(), 100)], 2);
    const cells = grid.flat();
    expect(cells.some((c) => c.level === 4)).toBe(true);
    expect(cells.every((c) => c.level >= 0 && c.level <= 4)).toBe(true);
    // Days with no activity are level 0.
    expect(cells.some((c) => c.words === 0 && c.level === 0)).toBe(true);
  });
});

describe("timeLabel", () => {
  it("renders a lowercase am/pm clock", () => {
    const noon = new Date(2026, 0, 1, 13, 5).getTime();
    const label = timeLabel(noon, "en-US");
    expect(label).toMatch(/\d{2}:\d{2}\s?(am|pm)/);
    expect(label).toBe(label.toLowerCase());
  });
});

describe("dayHeaderKind", () => {
  it("classifies today, yesterday, and older", () => {
    const now = Date.now();
    expect(dayHeaderKind(now)).toBe("today");
    expect(dayHeaderKind(now - DAY)).toBe("yesterday");
    expect(dayHeaderKind(now - 10 * DAY)).toBe("date");
  });
});

describe("groupByDay", () => {
  it("groups consecutive same-day entries and keeps order", () => {
    const now = Date.now();
    const groups = groupByDay([
      entry(now, 1),
      entry(now, 1),
      entry(now - DAY, 1),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0].kind).toBe("today");
    expect(groups[0].items).toHaveLength(2);
    expect(groups[1].kind).toBe("yesterday");
  });
});
