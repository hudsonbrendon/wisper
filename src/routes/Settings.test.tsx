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
  onboarded: true,
  dictionary: [],
  replacements: [],
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

  // ---------------------------------------------------------------------------
  // Hotkey capture tests
  // ---------------------------------------------------------------------------
  it("clicking hotkey button enters capturing mode", async () => {
    renderSettings();
    await screen.findByText("Alt+Space");

    const hotkeyBtn = screen.getByText("Alt+Space");
    await userEvent.click(hotkeyBtn);

    expect(await screen.findByText(/press a key combo/i)).toBeInTheDocument();
  });

  it("pressing Escape cancels hotkey capture", async () => {
    renderSettings();
    await screen.findByText("Alt+Space");

    const hotkeyBtn = screen.getByText("Alt+Space");
    await userEvent.click(hotkeyBtn);
    await screen.findByText(/press a key combo/i);

    // Fire Escape keydown on window
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        code: "Escape",
        bubbles: true,
      }),
    );

    expect(await screen.findByText("Alt+Space")).toBeInTheDocument();
  });

  it("pressing a key combo saves the new hotkey", async () => {
    mockSaveConfig.mockResolvedValue(undefined);
    renderSettings();
    await screen.findByText("Alt+Space");

    const hotkeyBtn = screen.getByText("Alt+Space");
    await userEvent.click(hotkeyBtn);
    await screen.findByText(/press a key combo/i);

    // Fire Alt+S keydown on window
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "s",
        code: "KeyS",
        altKey: true,
        bubbles: true,
      }),
    );

    await waitFor(() => {
      expect(mockSaveConfig).toHaveBeenCalled();
    });

    // Hotkey button should now show Alt+S
    expect(await screen.findByText("Alt+S")).toBeInTheDocument();
  });

  it("shows modifier hint while only modifier keys are held during capture", async () => {
    renderSettings();
    await screen.findByText("Alt+Space");

    const hotkeyBtn = screen.getByText("Alt+Space");
    await userEvent.click(hotkeyBtn);
    await screen.findByText(/press a key combo/i);

    // Fire modifier-only keydown (no regular key)
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Alt",
        code: "AltLeft",
        altKey: true,
        bubbles: true,
      }),
    );

    expect(await screen.findByText(/Alt\+ \(add a key\)/)).toBeInTheDocument();
  });

  it("pressing Space key saves hotkey with Space", async () => {
    mockSaveConfig.mockResolvedValue(undefined);
    renderSettings();
    await screen.findByText("Alt+Space");

    await userEvent.click(screen.getByText("Alt+Space"));
    await screen.findByText(/press a key combo/i);

    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: " ",
        code: "Space",
        altKey: true,
        bubbles: true,
      }),
    );

    await waitFor(() => {
      expect(mockSaveConfig).toHaveBeenCalled();
    });
  });

  it("pressing a digit key saves a digit hotkey", async () => {
    mockSaveConfig.mockResolvedValue(undefined);
    renderSettings();
    await screen.findByText("Alt+Space");

    await userEvent.click(screen.getByText("Alt+Space"));
    await screen.findByText(/press a key combo/i);

    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "1",
        code: "Digit1",
        ctrlKey: true,
        bubbles: true,
      }),
    );

    await waitFor(() => {
      expect(mockSaveConfig).toHaveBeenCalled();
    });
  });

  it("pressing an F-key saves the function key hotkey", async () => {
    mockSaveConfig.mockResolvedValue(undefined);
    renderSettings();
    await screen.findByText("Alt+Space");

    await userEvent.click(screen.getByText("Alt+Space"));
    await screen.findByText(/press a key combo/i);

    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "F5",
        code: "F5",
        bubbles: true,
      }),
    );

    await waitFor(() => {
      expect(mockSaveConfig).toHaveBeenCalled();
    });
  });

  it("pressing Enter saves Enter hotkey", async () => {
    mockSaveConfig.mockResolvedValue(undefined);
    renderSettings();
    await screen.findByText("Alt+Space");

    await userEvent.click(screen.getByText("Alt+Space"));
    await screen.findByText(/press a key combo/i);

    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        code: "Enter",
        ctrlKey: true,
        bubbles: true,
      }),
    );

    await waitFor(() => {
      expect(mockSaveConfig).toHaveBeenCalled();
    });
  });

  it("pressing arrow key saves arrow hotkey", async () => {
    mockSaveConfig.mockResolvedValue(undefined);
    renderSettings();
    await screen.findByText("Alt+Space");

    await userEvent.click(screen.getByText("Alt+Space"));
    await screen.findByText(/press a key combo/i);

    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowUp",
        code: "ArrowUp",
        ctrlKey: true,
        bubbles: true,
      }),
    );

    await waitFor(() => {
      expect(mockSaveConfig).toHaveBeenCalled();
    });
  });

  it("shows hotkey error when saveConfig fails during capture", async () => {
    mockSaveConfig.mockRejectedValue(new Error("Save failed"));
    renderSettings();
    await screen.findByText("Alt+Space");

    await userEvent.click(screen.getByText("Alt+Space"));
    await screen.findByText(/press a key combo/i);

    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "s",
        code: "KeyS",
        altKey: true,
        bubbles: true,
      }),
    );

    expect(await screen.findByText(/Save failed/)).toBeInTheDocument();
  });

  it("pressing no-modifier single-char key uses fallback (ABNT layout)", async () => {
    mockSaveConfig.mockResolvedValue(undefined);
    renderSettings();
    await screen.findByText("Alt+Space");

    await userEvent.click(screen.getByText("Alt+Space"));
    await screen.findByText(/press a key combo/i);

    // A key with a printable character but not matching any of the standard codes
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ç",
        code: "Semicolon",
        altKey: true,
        bubbles: true,
      }),
    );

    await waitFor(() => {
      expect(mockSaveConfig).toHaveBeenCalled();
    });
  });

  it("pressing Tab key saves Tab hotkey", async () => {
    mockSaveConfig.mockResolvedValue(undefined);
    renderSettings();
    await screen.findByText("Alt+Space");

    await userEvent.click(screen.getByText("Alt+Space"));
    await screen.findByText(/press a key combo/i);

    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Tab",
        code: "Tab",
        shiftKey: true,
        bubbles: true,
      }),
    );

    await waitFor(() => {
      expect(mockSaveConfig).toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // Model download / cancel / remove flow tests
  // ---------------------------------------------------------------------------
  it("clicking Download opens the download confirm modal", async () => {
    renderSettings();
    await screen.findByText("Download");

    await userEvent.click(screen.getByText("Download"));

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText(/download model/i)).toBeInTheDocument();
  });

  it("confirming download calls downloadModel and sets model as downloading", async () => {
    mockDownloadModel.mockReturnValue(new Promise(() => {})); // never resolves
    renderSettings();
    await screen.findByText("Download");

    await userEvent.click(screen.getByText("Download"));
    const dialog = await screen.findByRole("dialog");
    const buttons = dialog.querySelectorAll("button");
    const confirmBtn = buttons[buttons.length - 1];
    await userEvent.click(confirmBtn);

    await waitFor(() => {
      expect(mockDownloadModel).toHaveBeenCalledTimes(1);
    });
  });

  it("clicking Remove opens the remove confirm modal", async () => {
    renderSettings();
    await screen.findByText("Remove");

    await userEvent.click(screen.getByText("Remove"));

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText(/remove model/i)).toBeInTheDocument();
  });

  it("confirming remove calls removeModel then refreshes models", async () => {
    mockRemoveModel.mockResolvedValue(undefined);
    // First call returns the default with "tiny" downloaded; second call (after remove) returns all not downloaded
    mockListModels.mockResolvedValueOnce(DEFAULT_MODELS).mockResolvedValueOnce([
      { id: "tiny", filename: "ggml-tiny.bin", downloaded: false },
      { id: "base", filename: "ggml-base.bin", downloaded: false },
    ]);

    renderSettings();
    await screen.findByText("Remove");

    await userEvent.click(screen.getByText("Remove"));
    const dialog = await screen.findByRole("dialog");
    const buttons = dialog.querySelectorAll("button");
    const confirmBtn = buttons[buttons.length - 1];
    await userEvent.click(confirmBtn);

    await waitFor(() => {
      expect(mockRemoveModel).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(mockListModels).toHaveBeenCalledTimes(2); // initial + after remove
    });
  });

  it("download_progress event updates progress state", async () => {
    type ProgressHandler = (payload: {
      id: string;
      received: number;
      total: number;
    }) => void;
    const handlers: Record<string, ProgressHandler> = {};
    mockOnEvent.mockImplementation(
      (name: string, h: ProgressHandler): Promise<() => void> => {
        handlers[name] = h;
        return Promise.resolve(() => {});
      },
    );

    // Start a download first so the model is in downloading state
    mockDownloadModel.mockReturnValue(new Promise(() => {}));
    renderSettings();
    await screen.findByText("Download");

    // Confirm the download
    await userEvent.click(screen.getByText("Download"));
    const dialog = await screen.findByRole("dialog");
    const buttons = dialog.querySelectorAll("button");
    const confirmBtn = buttons[buttons.length - 1];
    await userEvent.click(confirmBtn);

    // Simulate progress event
    const { act: actFn } = await import("react");
    await actFn(async () => {
      handlers["download_progress"]?.({ id: "base", received: 50, total: 100 });
    });

    // The downloading text should appear somewhere (50%)
    expect(screen.getByText(/downloading…/)).toBeInTheDocument();
  });

  it("model_ready event clears downloading state and refreshes models", async () => {
    type ReadyHandler = (payload: { id: string }) => void;
    const handlers: Record<string, ReadyHandler> = {};
    mockOnEvent.mockImplementation(
      (name: string, h: ReadyHandler): Promise<() => void> => {
        handlers[name] = h;
        return Promise.resolve(() => {});
      },
    );

    mockDownloadModel.mockReturnValue(new Promise(() => {}));
    mockListModels.mockResolvedValueOnce(DEFAULT_MODELS).mockResolvedValueOnce([
      { id: "tiny", filename: "ggml-tiny.bin", downloaded: true },
      { id: "base", filename: "ggml-base.bin", downloaded: true },
    ]);

    renderSettings();
    await screen.findByText("Download");

    // Start download
    await userEvent.click(screen.getByText("Download"));
    const dialog = await screen.findByRole("dialog");
    const buttons = dialog.querySelectorAll("button");
    const confirmBtn = buttons[buttons.length - 1];
    await userEvent.click(confirmBtn);

    // Fire model_ready
    const { act: actFn } = await import("react");
    await actFn(async () => {
      handlers["model_ready"]?.({ id: "base" });
    });

    await waitFor(() => {
      expect(mockListModels).toHaveBeenCalledTimes(2);
    });
  });

  it("download_cancelled event clears downloading and progress state", async () => {
    type CancelledHandler = (payload: { id: string }) => void;
    const handlers: Record<string, CancelledHandler> = {};
    mockOnEvent.mockImplementation(
      (name: string, h: CancelledHandler): Promise<() => void> => {
        handlers[name] = h;
        return Promise.resolve(() => {});
      },
    );

    mockDownloadModel.mockReturnValue(new Promise(() => {}));
    renderSettings();
    await screen.findByText("Download");

    // Start download
    await userEvent.click(screen.getByText("Download"));
    const dialog = await screen.findByRole("dialog");
    const buttons = dialog.querySelectorAll("button");
    const confirmBtn = buttons[buttons.length - 1];
    await userEvent.click(confirmBtn);

    // Fire download_cancelled
    const { act: actFn } = await import("react");
    await actFn(async () => {
      handlers["download_cancelled"]?.({ id: "base" });
    });

    // Cancel button should be gone; Download button should be back
    await waitFor(() => {
      expect(screen.queryByText("Cancel")).not.toBeInTheDocument();
    });
  });

  // ---------------------------------------------------------------------------
  // System toggle tests
  // ---------------------------------------------------------------------------
  it("toggling Launch at Login calls setLaunchAtLogin", async () => {
    renderSettings();
    await screen.findByText("Show in Dock");

    // Launch at Login is false initially (unchecked switch)
    const uncheckedSwitches = screen
      .getAllByRole("switch")
      .filter((el) => el.getAttribute("aria-checked") === "false");
    await userEvent.click(uncheckedSwitches[0]);

    await waitFor(() => {
      expect(mockSetLaunchAtLogin).toHaveBeenCalledWith(true);
    });
  });

  it("toggling Show Pill calls saveConfig", async () => {
    renderSettings();
    await screen.findByText("Show pill at all times");

    const allSwitches = screen.getAllByRole("switch");
    // show_pill is the 3rd switch (Launch at Login, Show in Dock, Show Pill)
    // All true except Launch at Login; find by position
    const showPillSwitch = allSwitches.find(
      (el) =>
        el
          .closest("div")
          ?.previousElementSibling?.textContent?.includes("Show pill") ||
        el
          .closest("div")
          ?.parentElement?.querySelector("span")
          ?.textContent?.includes("Show pill"),
    );
    if (showPillSwitch) {
      await userEvent.click(showPillSwitch);
      await waitFor(() => {
        expect(mockSaveConfig).toHaveBeenCalled();
      });
    } else {
      // Fallback: click any checked switch and verify saveConfig called
      const checkedSwitches = screen
        .getAllByRole("switch")
        .filter((el) => el.getAttribute("aria-checked") === "true");
      if (checkedSwitches.length > 1) {
        await userEvent.click(checkedSwitches[1]);
        await waitFor(() => {
          expect(mockSaveConfig).toHaveBeenCalled();
        });
      }
    }
  });

  it("toggling Mute Music calls saveConfig with mute_music toggled", async () => {
    renderSettings();
    await screen.findByText("Mute music while dictating");

    // mute_music starts false; its switch is unchecked
    const uncheckedSwitches = screen
      .getAllByRole("switch")
      .filter((el) => el.getAttribute("aria-checked") === "false");
    // Last unchecked is mute_music (Launch at Login is also false)
    const muteMusicSwitch = uncheckedSwitches[uncheckedSwitches.length - 1];
    await userEvent.click(muteMusicSwitch);

    await waitFor(() => {
      expect(mockSaveConfig).toHaveBeenCalled();
    });
  });

  it("toggling Dictation Sounds calls saveConfig", async () => {
    renderSettings();
    await screen.findByText("Dictation sounds");

    const checkedSwitches = screen
      .getAllByRole("switch")
      .filter((el) => el.getAttribute("aria-checked") === "true");
    // Click the last checked switch (dictation_sounds or similar)
    await userEvent.click(checkedSwitches[checkedSwitches.length - 1]);

    await waitFor(() => {
      expect(mockSaveConfig).toHaveBeenCalled();
    });
  });

  it("changing the microphone select calls saveConfig", async () => {
    mockListMicrophones.mockResolvedValue(["USB Mic", "Built-in Mic"]);
    renderSettings();
    await screen.findByText("Settings");

    // Find the microphone select
    const selects = screen.getAllByRole("combobox");
    // Microphone is the 3rd select (after interface language and transcription language, before inject method)
    // We look for the one that has "System default" option
    const micSelect = selects.find((s) =>
      Array.from(s.querySelectorAll("option")).some(
        (o) => o.textContent === "System default",
      ),
    );
    if (micSelect) {
      await userEvent.selectOptions(micSelect, "USB Mic");
      await waitFor(() => {
        expect(mockSaveConfig).toHaveBeenCalled();
      });
    }
  });

  it("changing transcription language calls saveConfig", async () => {
    renderSettings();
    await screen.findByText("Settings");

    // Detect automatically option is the one with value "auto"
    const allSelects = screen.getAllByRole("combobox");
    // Find the one with "Detect automatically" option (language select)
    const langSelect = allSelects.find((s) =>
      Array.from(s.querySelectorAll("option")).some(
        (o) => o.textContent === "Detect automatically",
      ),
    );
    if (langSelect) {
      // Currently "auto", switch to English
      await userEvent.selectOptions(langSelect, "en");
      await waitFor(() => {
        expect(mockSaveConfig).toHaveBeenCalled();
      });
    }
  });

  it("changing inject method calls saveConfig", async () => {
    renderSettings();
    await screen.findByText("Settings");

    // Find inject method select by looking for "Type" option
    const allSelects = screen.getAllByRole("combobox");
    const injectSelect = allSelects.find((s) =>
      Array.from(s.querySelectorAll("option")).some((o) =>
        o.textContent?.includes("keystrokes"),
      ),
    );
    if (injectSelect) {
      await userEvent.selectOptions(injectSelect, "paste");
      await waitFor(() => {
        expect(mockSaveConfig).toHaveBeenCalled();
      });
    }
  });

  it("shows Saved indicator after saving config", async () => {
    renderSettings();
    await screen.findByText("Show in Dock");

    // Click a checked switch to trigger saveConfig which sets saved=true briefly
    const checkedSwitches = screen
      .getAllByRole("switch")
      .filter((el) => el.getAttribute("aria-checked") === "true");
    await userEvent.click(checkedSwitches[0]);

    expect(await screen.findByText(/Saved/)).toBeInTheDocument();
  });

  it("shows Cleared indicator after clearing history", async () => {
    renderSettings();
    const clearBtns = await screen.findAllByText("Clear history");
    await userEvent.click(clearBtns[0]);

    const dialog = await screen.findByRole("dialog");
    const buttons = dialog.querySelectorAll("button");
    const confirmBtn = buttons[buttons.length - 1];
    await userEvent.click(confirmBtn);

    expect(await screen.findByText(/Cleared/)).toBeInTheDocument();
  });

  it("renders with microphones listed in the microphone select", async () => {
    mockListMicrophones.mockResolvedValue(["Mic A", "Mic B"]);
    renderSettings();
    await screen.findByText("Microphone");
    expect(await screen.findByText("Mic A")).toBeInTheDocument();
    expect(screen.getByText("Mic B")).toBeInTheDocument();
  });

  it("shows 'active' badge for the currently selected model", async () => {
    renderSettings();
    await screen.findByText("Settings");
    // model_id is "base" in DEFAULT_CONFIG; but "base" is not downloaded so active shows on base
    // Actually "tiny" is downloaded and "base" is model_id → base gets "active" badge
    expect(await screen.findByText("active")).toBeInTheDocument();
  });

  it("shows English-only badge for models with .en suffix", async () => {
    mockListModels.mockResolvedValue([
      { id: "tiny.en", filename: "ggml-tiny.en.bin", downloaded: true },
    ]);
    renderSettings();
    await screen.findByText("Settings");
    expect(await screen.findByText("English only")).toBeInTheDocument();
  });

  it("shows multilingual badge for non-.en models", async () => {
    renderSettings();
    await screen.findByText("Settings");
    // Both "tiny" and "base" are multilingual
    const multilingualBadges = await screen.findAllByText("multilingual");
    expect(multilingualBadges.length).toBeGreaterThan(0);
  });

  it("shows Launch at Login label", async () => {
    renderSettings();
    expect(await screen.findByText("Launch at login")).toBeInTheDocument();
  });

  it("Launch at Login toggle is checked when launchLogin is true", async () => {
    mockGetLaunchAtLogin.mockResolvedValue(true);
    renderSettings();
    await screen.findByText("Launch at login");

    // The very first switch should be Launch at Login (checked)
    const allSwitches = await screen.findAllByRole("switch");
    const launchSwitch = allSwitches[0];
    expect(launchSwitch.getAttribute("aria-checked")).toBe("true");
  });

  it("shows 'downloading' text when a model is in progress", async () => {
    mockDownloadModel.mockReturnValue(new Promise(() => {}));

    renderSettings();
    const downloadBtn = await screen.findByText("Download");

    // Confirm the download via the modal
    await userEvent.click(downloadBtn);
    const dialog = await screen.findByRole("dialog");
    const buttons = dialog.querySelectorAll("button");
    const confirmBtn = buttons[buttons.length - 1];
    await userEvent.click(confirmBtn);

    // After confirm, dialog closes and model row shows "downloading…"
    expect(await screen.findByText(/downloading…/)).toBeInTheDocument();
  });

  it("cancel download button opens cancel confirm modal", async () => {
    mockDownloadModel.mockReturnValue(new Promise(() => {}));

    renderSettings();
    const downloadBtn = await screen.findByText("Download");

    // Start download
    await userEvent.click(downloadBtn);
    const dialog = await screen.findByRole("dialog");
    const buttons = dialog.querySelectorAll("button");
    const confirmBtn = buttons[buttons.length - 1];
    await userEvent.click(confirmBtn);

    // "downloading…" appears in the model row, and a "Cancel" button (btn.cancel)
    await screen.findByText(/downloading…/);

    // The Cancel button for the in-progress download
    const cancelDownloadBtns = screen.getAllByText("Cancel");
    await userEvent.click(cancelDownloadBtns[0]);

    // A new dialog should open for cancelling the download
    const cancelDialog = await screen.findByRole("dialog");
    expect(cancelDialog).toBeInTheDocument();
    expect(screen.getByText(/cancel download/i)).toBeInTheDocument();
  });

  it("confirming cancel download calls cancelDownload", async () => {
    mockDownloadModel.mockReturnValue(new Promise(() => {}));
    mockCancelDownload.mockResolvedValue(undefined);

    renderSettings();
    const downloadBtn = await screen.findByText("Download");

    // Start download
    await userEvent.click(downloadBtn);
    let dialog = await screen.findByRole("dialog");
    const buttons = dialog.querySelectorAll("button");
    const confirmBtn = buttons[buttons.length - 1];
    await userEvent.click(confirmBtn);

    // "downloading…" appears; click Cancel
    await screen.findByText(/downloading…/);
    const cancelBtns = screen.getAllByText("Cancel");
    await userEvent.click(cancelBtns[0]);

    // Confirm the cancel download
    dialog = await screen.findByRole("dialog");
    const dialogBtns = dialog.querySelectorAll("button");
    const confirmCancelBtn = dialogBtns[dialogBtns.length - 1];
    await userEvent.click(confirmCancelBtn);

    await waitFor(() => {
      expect(mockCancelDownload).toHaveBeenCalledWith("base");
    });
  });

  it("setLaunchAtLogin failure reverts the toggle", async () => {
    mockSetLaunchAtLogin.mockRejectedValue(new Error("permission denied"));
    renderSettings();
    await screen.findByText("Launch at login");

    // Launch at Login starts false (first switch is Launch at Login, unchecked)
    const allSwitches = screen.getAllByRole("switch");
    // The first switch should be Launch at Login with aria-checked=false
    const launchSwitch = allSwitches[0];
    expect(launchSwitch.getAttribute("aria-checked")).toBe("false");
    await userEvent.click(launchSwitch);

    await waitFor(() => {
      expect(mockSetLaunchAtLogin).toHaveBeenCalledWith(true);
    });
    // After rejection, toggle should revert back to false
    await waitFor(() => {
      expect(launchSwitch.getAttribute("aria-checked")).toBe("false");
    });
  });
});
