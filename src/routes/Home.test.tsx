import { render, screen } from "@testing-library/react";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../lib/i18n";
import Home from "./Home";

// ---------------------------------------------------------------------------
// Hoisted mocks — must be defined before vi.mock factories run
// ---------------------------------------------------------------------------
const { mockOnEvent, mockGetHistory } = vi.hoisted(() => ({
  mockOnEvent: vi.fn(),
  mockGetHistory: vi.fn(),
}));

vi.mock("../lib/api", () => ({
  getHistory: mockGetHistory,
  onEvent: mockOnEvent,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function renderHome() {
  return render(
    <I18nProvider>
      <Home />
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
  words: 2,
  duration_ms: 60_000,
  ...overrides,
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("Home", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOnEvent.mockResolvedValue(() => {});
  });

  it("renders the welcome heading", async () => {
    mockGetHistory.mockResolvedValue([]);
    renderHome();
    expect(await screen.findByText("Welcome back")).toBeInTheDocument();
  });

  it("shows empty state when there is no history", async () => {
    mockGetHistory.mockResolvedValue([]);
    renderHome();
    expect(await screen.findByText("No dictations yet")).toBeInTheDocument();
  });

  it("does not show empty-state text when entries exist", async () => {
    mockGetHistory.mockResolvedValue([makeEntry()]);
    renderHome();
    expect(await screen.findByText("hello world")).toBeInTheDocument();
    expect(screen.queryByText("No dictations yet")).not.toBeInTheDocument();
  });

  it("renders transcribed text for each history entry", async () => {
    mockGetHistory.mockResolvedValue([
      makeEntry({ text: "first dictation", words: 2 }),
      makeEntry({ text: "second dictation", words: 2 }),
    ]);
    renderHome();
    expect(await screen.findByText("first dictation")).toBeInTheDocument();
    expect(screen.getByText("second dictation")).toBeInTheDocument();
  });

  it("shows stats in the right rail (total words)", async () => {
    mockGetHistory.mockResolvedValue([
      makeEntry({ words: 100 }),
      makeEntry({ words: 200 }),
    ]);
    renderHome();
    // computeStats totals 300 words; compact(300) === "300"
    expect(await screen.findByText("300")).toBeInTheDocument();
  });

  it("refreshes when history_changed event fires", async () => {
    let handler: (() => void) | null = null;
    mockOnEvent.mockImplementation(
      (_name: string, h: () => void): Promise<() => void> => {
        handler = h;
        return Promise.resolve(() => {});
      },
    );
    mockGetHistory
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([makeEntry({ text: "new entry" })]);

    renderHome();
    expect(await screen.findByText("No dictations yet")).toBeInTheDocument();

    await act(async () => {
      handler?.();
    });
    expect(await screen.findByText("new entry")).toBeInTheDocument();
  });

  it("subscribes to history_changed on mount", async () => {
    mockGetHistory.mockResolvedValue([]);
    renderHome();
    await screen.findByText("No dictations yet");
    expect(mockOnEvent).toHaveBeenCalledWith(
      "history_changed",
      expect.any(Function),
    );
  });
});
