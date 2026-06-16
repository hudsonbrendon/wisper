import { render, screen } from "@testing-library/react";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../lib/i18n";
import Insights from "./Insights";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------
const { mockGetHistory, mockOnEvent } = vi.hoisted(() => ({
  mockGetHistory: vi.fn(),
  mockOnEvent: vi.fn(),
}));

vi.mock("../lib/api", () => ({
  getHistory: mockGetHistory,
  onEvent: mockOnEvent,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function renderInsights() {
  return render(
    <I18nProvider>
      <Insights />
    </I18nProvider>,
  );
}

const makeEntry = (
  overrides: Partial<{
    ts_ms: number;
    text: string;
    words: number;
    duration_ms: number;
  }> = {},
) => ({
  ts_ms: Date.now(),
  text: "hello world",
  words: 50,
  duration_ms: 30_000,
  ...overrides,
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("Insights", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOnEvent.mockResolvedValue(() => {});
  });

  it("renders the page title", async () => {
    mockGetHistory.mockResolvedValue([]);
    renderInsights();
    expect(await screen.findByText("Insights")).toBeInTheDocument();
  });

  it("shows zero wpm stat on empty history", async () => {
    mockGetHistory.mockResolvedValue([]);
    renderInsights();
    await screen.findByText("Insights");
    // wpm is 0, totalWords is 0, totalEntries is 0 — at least one "0" should appear
    const zeros = screen.getAllByText("0");
    expect(zeros.length).toBeGreaterThanOrEqual(1);
  });

  it("renders stat cards without crashing when entries exist", async () => {
    mockGetHistory.mockResolvedValue([
      makeEntry({ words: 100, duration_ms: 60_000 }),
      makeEntry({ words: 200, duration_ms: 120_000 }),
    ]);
    renderInsights();
    expect(await screen.findByText("Insights")).toBeInTheDocument();
    // totalEntries = 2
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("renders daily activity section header", async () => {
    mockGetHistory.mockResolvedValue([makeEntry()]);
    renderInsights();
    // i18n key "insights.dailyActivity" → "Daily activity" (lowercase a)
    expect(await screen.findByText("Daily activity")).toBeInTheDocument();
  });

  it("shows 'Today' label in the bar chart axis", async () => {
    mockGetHistory.mockResolvedValue([]);
    renderInsights();
    expect(await screen.findByText("Today")).toBeInTheDocument();
  });

  it("shows Less / More legend labels", async () => {
    mockGetHistory.mockResolvedValue([]);
    renderInsights();
    expect(await screen.findByText("Less")).toBeInTheDocument();
    expect(screen.getByText("More")).toBeInTheDocument();
  });

  it("subscribes to history_changed on mount", async () => {
    mockGetHistory.mockResolvedValue([]);
    renderInsights();
    await screen.findByText("Insights");
    expect(mockOnEvent).toHaveBeenCalledWith(
      "history_changed",
      expect.any(Function),
    );
  });

  it("refreshes data when history_changed fires", async () => {
    let handler: (() => void) | null = null;
    mockOnEvent.mockImplementation(
      (_name: string, h: () => void): Promise<() => void> => {
        handler = h;
        return Promise.resolve(() => {});
      },
    );
    mockGetHistory
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([makeEntry({ words: 500, duration_ms: 300_000 })]);

    renderInsights();
    await screen.findByText("Insights");

    await act(async () => {
      handler?.();
    });
    // After refresh, totalEntries becomes 1
    expect(await screen.findByText("1")).toBeInTheDocument();
  });
});
