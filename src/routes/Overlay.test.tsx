import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../lib/i18n";
import Overlay from "./Overlay";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------
const {
  mockOnEvent,
  mockGetConfig,
  mockUiStartRecording,
  mockUiStopAndInsert,
  mockUiCancelRecording,
  mockSetLanguage,
  mockSetPillExpanded,
} = vi.hoisted(() => ({
  mockOnEvent: vi.fn(),
  mockGetConfig: vi.fn(),
  mockUiStartRecording: vi.fn(),
  mockUiStopAndInsert: vi.fn(),
  mockUiCancelRecording: vi.fn(),
  mockSetLanguage: vi.fn(),
  mockSetPillExpanded: vi.fn(),
}));

vi.mock("../lib/api", () => ({
  onEvent: mockOnEvent,
  getConfig: mockGetConfig,
  uiStartRecording: mockUiStartRecording,
  uiStopAndInsert: mockUiStopAndInsert,
  uiCancelRecording: mockUiCancelRecording,
  setLanguage: mockSetLanguage,
  setPillExpanded: mockSetPillExpanded,
}));

// ---------------------------------------------------------------------------
// Default config
// ---------------------------------------------------------------------------
const DEFAULT_CONFIG = {
  hotkey: "Alt+Space",
  model_id: "base",
  mic_device: null,
  language: "auto",
  inject_method: "type",
  show_in_dock: true,
  show_pill: true,
  dictation_sounds: true,
  mute_music: false,
  onboarded: true,
  dictionary: [],
  replacements: [],
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type EventHandler = (payload: unknown) => void;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function renderOverlay() {
  return render(
    <I18nProvider>
      <Overlay />
    </I18nProvider>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("Overlay", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetConfig.mockResolvedValue(DEFAULT_CONFIG);
    mockUiStartRecording.mockResolvedValue(undefined);
    mockUiStopAndInsert.mockResolvedValue(undefined);
    mockUiCancelRecording.mockResolvedValue(undefined);
    mockSetLanguage.mockResolvedValue(undefined);
    mockSetPillExpanded.mockResolvedValue(undefined);
    mockOnEvent.mockResolvedValue(() => {});
  });

  it("renders in idle state with a mic button", async () => {
    renderOverlay();
    expect(await screen.findByTitle("Click to record")).toBeInTheDocument();
  });

  it("renders the language label button in idle state", async () => {
    renderOverlay();
    // langLabel("auto") === "AUTO"
    expect(await screen.findByText(/AUTO/)).toBeInTheDocument();
  });

  it("transitions to recording state when state event fires", async () => {
    const handlers: Record<string, EventHandler> = {};
    mockOnEvent.mockImplementation(
      (name: string, h: EventHandler): Promise<() => void> => {
        handlers[name] = h;
        return Promise.resolve(() => {});
      },
    );

    renderOverlay();
    await screen.findByTitle("Click to record");

    await act(async () => {
      handlers["state"]?.({ state: "recording" });
    });

    expect(await screen.findByTitle("Cancel")).toBeInTheDocument();
    expect(screen.getByTitle("Stop & insert")).toBeInTheDocument();
  });

  it("shows transcribing label when state is transcribing", async () => {
    const handlers: Record<string, EventHandler> = {};
    mockOnEvent.mockImplementation(
      (name: string, h: EventHandler): Promise<() => void> => {
        handlers[name] = h;
        return Promise.resolve(() => {});
      },
    );

    renderOverlay();
    await screen.findByTitle("Click to record");

    await act(async () => {
      handlers["state"]?.({ state: "transcribing" });
    });

    expect(await screen.findByText("Transcribing…")).toBeInTheDocument();
  });

  it("shows inserting label when state is injecting", async () => {
    const handlers: Record<string, EventHandler> = {};
    mockOnEvent.mockImplementation(
      (name: string, h: EventHandler): Promise<() => void> => {
        handlers[name] = h;
        return Promise.resolve(() => {});
      },
    );

    renderOverlay();
    await screen.findByTitle("Click to record");

    await act(async () => {
      handlers["state"]?.({ state: "injecting" });
    });

    expect(await screen.findByText("Inserting…")).toBeInTheDocument();
  });

  it("shows error pill when error event fires", async () => {
    const handlers: Record<string, EventHandler> = {};
    mockOnEvent.mockImplementation(
      (name: string, h: EventHandler): Promise<() => void> => {
        handlers[name] = h;
        return Promise.resolve(() => {});
      },
    );

    renderOverlay();
    await screen.findByTitle("Click to record");

    await act(async () => {
      handlers["error"]?.({ message: "Something went wrong" });
    });

    expect(await screen.findByText("Something went wrong")).toBeInTheDocument();
  });

  it("calls uiStartRecording when mic button is clicked", async () => {
    renderOverlay();
    const micBtn = await screen.findByTitle("Click to record");
    await userEvent.click(micBtn);
    expect(mockUiStartRecording).toHaveBeenCalledTimes(1);
  });

  it("calls uiCancelRecording when cancel button is clicked in recording state", async () => {
    const handlers: Record<string, EventHandler> = {};
    mockOnEvent.mockImplementation(
      (name: string, h: EventHandler): Promise<() => void> => {
        handlers[name] = h;
        return Promise.resolve(() => {});
      },
    );

    renderOverlay();
    await screen.findByTitle("Click to record");

    await act(async () => {
      handlers["state"]?.({ state: "recording" });
    });

    const cancelBtn = await screen.findByTitle("Cancel");
    await userEvent.click(cancelBtn);
    expect(mockUiCancelRecording).toHaveBeenCalledTimes(1);
  });

  it("calls uiStopAndInsert when stop button is clicked in recording state", async () => {
    const handlers: Record<string, EventHandler> = {};
    mockOnEvent.mockImplementation(
      (name: string, h: EventHandler): Promise<() => void> => {
        handlers[name] = h;
        return Promise.resolve(() => {});
      },
    );

    renderOverlay();
    await screen.findByTitle("Click to record");

    await act(async () => {
      handlers["state"]?.({ state: "recording" });
    });

    const stopBtn = await screen.findByTitle("Stop & insert");
    await userEvent.click(stopBtn);
    expect(mockUiStopAndInsert).toHaveBeenCalledTimes(1);
  });

  it("opens language menu on button click and picks a language", async () => {
    renderOverlay();
    const langBtn = await screen.findByText(/AUTO/);
    await userEvent.click(langBtn);

    expect(await screen.findByText("English (en)")).toBeInTheDocument();

    await userEvent.click(screen.getByText("English (en)"));
    expect(mockSetLanguage).toHaveBeenCalledWith("en");
  });

  it("subscribes to all expected events on mount", async () => {
    renderOverlay();
    await screen.findByTitle("Click to record");

    const names = (mockOnEvent.mock.calls as Array<[string, EventHandler]>).map(
      (c) => c[0],
    );
    expect(names).toContain("state");
    expect(names).toContain("audio_level");
    expect(names).toContain("error");
    expect(names).toContain("config_changed");
  });
});
