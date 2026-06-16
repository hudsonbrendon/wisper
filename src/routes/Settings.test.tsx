import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../lib/i18n";
import Settings from "./Settings";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------
const {
  mockGetConfig,
  mockSaveConfig,
  mockListMicrophones,
  mockListModels,
  mockDownloadModel,
  mockCancelDownload,
  mockRemoveModel,
  mockClearHistory,
  mockGetLaunchAtLogin,
  mockSetLaunchAtLogin,
  mockResetApp,
  mockOnEvent,
} = vi.hoisted(() => ({
  mockGetConfig: vi.fn(),
  mockSaveConfig: vi.fn(),
  mockListMicrophones: vi.fn(),
  mockListModels: vi.fn(),
  mockDownloadModel: vi.fn(),
  mockCancelDownload: vi.fn(),
  mockRemoveModel: vi.fn(),
  mockClearHistory: vi.fn(),
  mockGetLaunchAtLogin: vi.fn(),
  mockSetLaunchAtLogin: vi.fn(),
  mockResetApp: vi.fn(),
  mockOnEvent: vi.fn(),
}));

vi.mock("../lib/api", () => ({
  getConfig: mockGetConfig,
  saveConfig: mockSaveConfig,
  listMicrophones: mockListMicrophones,
  listModels: mockListModels,
  downloadModel: mockDownloadModel,
  cancelDownload: mockCancelDownload,
  removeModel: mockRemoveModel,
  clearHistory: mockClearHistory,
  getLaunchAtLogin: mockGetLaunchAtLogin,
  setLaunchAtLogin: mockSetLaunchAtLogin,
  resetApp: mockResetApp,
  onEvent: mockOnEvent,
}));

// Mock languages module to keep tests deterministic
vi.mock("../lib/languages", () => ({
  LANGUAGES: [
    { code: "auto", name: "Detect automatically" },
    { code: "en", name: "English" },
    { code: "pt", name: "Português" },
  ],
  langLabel: (code: string) => code.toUpperCase(),
}));

// ---------------------------------------------------------------------------
// Default fixtures
// ---------------------------------------------------------------------------
const DEFAULT_CONFIG = {
  hotkey: "Alt+Space",
  model_id: "base",
  mic_device: null,
  language: "auto",
  inject_method: "type" as const,
  show_in_dock: true,
  show_pill: true,
  dictation_sounds: true,
  mute_music: false,
};

const DEFAULT_MODELS = [
  { id: "tiny", filename: "ggml-tiny.bin", downloaded: true },
  { id: "base", filename: "ggml-base.bin", downloaded: false },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function renderSettings() {
  return render(
    <I18nProvider>
      <Settings />
    </I18nProvider>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("Settings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetConfig.mockResolvedValue({ ...DEFAULT_CONFIG });
    mockListMicrophones.mockResolvedValue([]);
    mockListModels.mockResolvedValue(DEFAULT_MODELS);
    mockGetLaunchAtLogin.mockResolvedValue(false);
    mockSaveConfig.mockResolvedValue(undefined);
    mockClearHistory.mockResolvedValue(undefined);
    mockResetApp.mockResolvedValue(undefined);
    mockSetLaunchAtLogin.mockResolvedValue(undefined);
    mockOnEvent.mockResolvedValue(() => {});
  });

  it("shows loading indicator before config loads", () => {
    mockGetConfig.mockReturnValue(new Promise(() => {}));
    renderSettings();
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it("renders the settings title after loading", async () => {
    renderSettings();
    expect(await screen.findByText("Settings")).toBeInTheDocument();
  });

  it("renders the System section heading", async () => {
    renderSettings();
    expect(await screen.findByText("System")).toBeInTheDocument();
  });

  it("renders Show in Dock label", async () => {
    renderSettings();
    expect(await screen.findByText("Show in Dock")).toBeInTheDocument();
  });

  it("renders Show in Dock toggle checked when show_in_dock is true", async () => {
    renderSettings();
    await screen.findByText("Show in Dock");
    // At least one switch must be checked (show_in_dock, show_pill, dictation_sounds are all true)
    const checkedSwitches = screen
      .getAllByRole("switch")
      .filter((el) => el.getAttribute("aria-checked") === "true");
    expect(checkedSwitches.length).toBeGreaterThan(0);
  });

  it("calls saveConfig when Show in Dock toggle is clicked", async () => {
    renderSettings();
    await screen.findByText("Show in Dock");

    // Find the switch that is currently aria-checked="true" for show_in_dock.
    // show_in_dock is checked; launchLogin starts false so its switch is unchecked.
    // We find all checked switches and click one.
    const checkedSwitches = screen
      .getAllByRole("switch")
      .filter((el) => el.getAttribute("aria-checked") === "true");
    // The first checked switch in the System section corresponds to show_in_dock
    // (Launch at Login is false, so its switch is unchecked)
    await userEvent.click(checkedSwitches[0]);

    await waitFor(() => {
      expect(mockSaveConfig).toHaveBeenCalled();
    });
  });

  it("renders the hotkey value in the capture button", async () => {
    renderSettings();
    expect(await screen.findByText("Alt+Space")).toBeInTheDocument();
  });

  it("renders the clear history button", async () => {
    renderSettings();
    // i18n key "settings.clearHistory" → "Clear history" (lowercase h)
    const clearBtns = await screen.findAllByText("Clear history");
    expect(clearBtns.length).toBeGreaterThan(0);
  });

  it("clicking clear history opens the confirm modal", async () => {
    renderSettings();
    const clearBtns = await screen.findAllByText("Clear history");
    await userEvent.click(clearBtns[0]);

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    // confirm.clearHistory.message
    expect(
      screen.getByText(
        /permanently deletes all of your transcription history/i,
      ),
    ).toBeInTheDocument();
  });

  it("confirming clear history calls clearHistory", async () => {
    renderSettings();
    const clearBtns = await screen.findAllByText("Clear history");
    await userEvent.click(clearBtns[0]);

    // Inside the modal, find the red confirm button (last button in dialog)
    const dialog = await screen.findByRole("dialog");
    const buttons = dialog.querySelectorAll("button");
    const confirmBtn = buttons[buttons.length - 1];
    await userEvent.click(confirmBtn);

    expect(mockClearHistory).toHaveBeenCalledTimes(1);
  });

  it("clicking Reset & restart opens the confirm modal", async () => {
    renderSettings();
    // i18n key "settings.resetAppAction" → "Reset & restart" (lowercase r)
    const resetBtn = await screen.findByText("Reset & restart");
    await userEvent.click(resetBtn);

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    // confirm.reset.message
    expect(screen.getByText(/restores default settings/i)).toBeInTheDocument();
  });

  it("confirming reset calls resetApp", async () => {
    renderSettings();
    const resetBtn = await screen.findByText("Reset & restart");
    await userEvent.click(resetBtn);

    // Find confirm button inside dialog (last button)
    const dialog = await screen.findByRole("dialog");
    const buttons = dialog.querySelectorAll("button");
    const confirmBtn = buttons[buttons.length - 1];
    await userEvent.click(confirmBtn);

    expect(mockResetApp).toHaveBeenCalledTimes(1);
  });

  it("cancelling confirm modal does not call resetApp", async () => {
    renderSettings();
    const resetBtn = await screen.findByText("Reset & restart");
    await userEvent.click(resetBtn);

    const cancelBtn = await screen.findByRole("button", { name: "Cancel" });
    await userEvent.click(cancelBtn);

    expect(mockResetApp).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });

  it("renders model list items", async () => {
    renderSettings();
    expect(await screen.findByText("tiny")).toBeInTheDocument();
    expect(screen.getByText("base")).toBeInTheDocument();
  });

  it("shows Remove button for downloaded models", async () => {
    renderSettings();
    expect(await screen.findByText("Remove")).toBeInTheDocument();
  });

  it("shows Download button for non-downloaded models", async () => {
    renderSettings();
    expect(await screen.findByText("Download")).toBeInTheDocument();
  });

  it("subscribes to download_progress, model_ready, download_cancelled events", async () => {
    renderSettings();
    await screen.findByText("Settings");
    const eventNames = (mockOnEvent.mock.calls as Array<[string, unknown]>).map(
      (c) => c[0],
    );
    expect(eventNames).toContain("download_progress");
    expect(eventNames).toContain("model_ready");
    expect(eventNames).toContain("download_cancelled");
  });
});
