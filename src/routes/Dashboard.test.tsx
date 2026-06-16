import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../lib/i18n";
import Dashboard from "./Dashboard";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------
const {
  mockOnEvent,
  mockGetHistory,
  mockGetConfig,
  mockSaveConfig,
  mockListMicrophones,
  mockListModels,
  mockGetLaunchAtLogin,
  mockCheckForUpdate,
  mockGetVersion,
} = vi.hoisted(() => ({
  mockOnEvent: vi.fn(),
  mockGetHistory: vi.fn(),
  mockGetConfig: vi.fn(),
  mockSaveConfig: vi.fn(),
  mockListMicrophones: vi.fn(),
  mockListModels: vi.fn(),
  mockGetLaunchAtLogin: vi.fn(),
  mockCheckForUpdate: vi.fn(),
  mockGetVersion: vi.fn(),
}));

vi.mock("../lib/api", () => ({
  onEvent: mockOnEvent,
  getHistory: mockGetHistory,
  getConfig: mockGetConfig,
  saveConfig: mockSaveConfig,
  listMicrophones: mockListMicrophones,
  listModels: mockListModels,
  getLaunchAtLogin: mockGetLaunchAtLogin,
  downloadModel: vi.fn(),
  cancelDownload: vi.fn(),
  removeModel: vi.fn(),
  clearHistory: vi.fn(),
  setLaunchAtLogin: vi.fn(),
  resetApp: vi.fn(),
  getPermissions: vi.fn().mockResolvedValue({ accessibility: true }),
  promptAccessibility: vi.fn().mockResolvedValue(undefined),
  resetMicrophone: vi.fn().mockResolvedValue(undefined),
  openPrivacySettings: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/updater", () => ({
  checkForUpdate: mockCheckForUpdate,
  installUpdate: vi.fn(),
}));

vi.mock("@tauri-apps/api/app", () => ({
  getVersion: mockGetVersion,
}));

// ---------------------------------------------------------------------------
// Default config fixture
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

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------
function renderDashboard() {
  return render(
    <I18nProvider>
      <Dashboard />
    </I18nProvider>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("Dashboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOnEvent.mockResolvedValue(() => {});
    mockGetHistory.mockResolvedValue([]);
    mockGetConfig.mockResolvedValue({ ...DEFAULT_CONFIG });
    mockSaveConfig.mockResolvedValue(undefined);
    mockListMicrophones.mockResolvedValue([]);
    mockListModels.mockResolvedValue([]);
    mockGetLaunchAtLogin.mockResolvedValue(false);
    mockCheckForUpdate.mockResolvedValue(null);
    mockGetVersion.mockResolvedValue("0.1.0");
  });

  it("renders the sidebar brand name", async () => {
    renderDashboard();
    expect(await screen.findByText("OpenWispr")).toBeInTheDocument();
  });

  it("renders the Home view by default", async () => {
    renderDashboard();
    expect(await screen.findByText("Welcome back")).toBeInTheDocument();
  });

  it("shows Home nav button as active by default", async () => {
    renderDashboard();
    await screen.findByText("Welcome back");
    // Home button is the one with active styling
    const homeBtn = screen.getByRole("button", { name: /^home$/i });
    expect(homeBtn).toBeInTheDocument();
  });

  it("switches to Insights view when clicking the Insights nav button", async () => {
    renderDashboard();
    await screen.findByText("Welcome back");

    const insightsBtn = screen.getByRole("button", { name: /^insights$/i });
    await userEvent.click(insightsBtn);

    // The Insights page title "Insights" appears as an h1
    expect(
      await screen.findByRole("heading", { name: /^insights$/i }),
    ).toBeInTheDocument();
  });

  it("switches to Settings view when clicking the Settings nav button", async () => {
    renderDashboard();
    await screen.findByText("Welcome back");

    const settingsBtn = screen.getByRole("button", { name: /^settings$/i });
    await userEvent.click(settingsBtn);

    // The Settings page renders an h1 with "Settings"
    expect(
      await screen.findByRole("heading", { name: /^settings$/i }),
    ).toBeInTheDocument();
  });

  it("switches back to Home view from Settings via Home nav button", async () => {
    renderDashboard();
    await screen.findByText("Welcome back");

    // Go to Settings
    const settingsBtn = screen.getByRole("button", { name: /^settings$/i });
    await userEvent.click(settingsBtn);
    await screen.findByRole("heading", { name: /^settings$/i });

    // Go back to Home
    const homeBtn = screen.getByRole("button", { name: /^home$/i });
    await userEvent.click(homeBtn);

    expect(await screen.findByText("Welcome back")).toBeInTheDocument();
  });

  it("subscribes to tray_navigate event on mount", async () => {
    renderDashboard();
    await screen.findByText("Welcome back");

    const eventNames = (mockOnEvent.mock.calls as Array<[string, unknown]>).map(
      (c) => c[0],
    );
    expect(eventNames).toContain("tray_navigate");
  });

  it("navigates via tray_navigate event", async () => {
    type EventHandler = (payload: unknown) => void;
    const handlers: Record<string, EventHandler> = {};
    mockOnEvent.mockImplementation(
      (name: string, h: EventHandler): Promise<() => void> => {
        handlers[name] = h;
        return Promise.resolve(() => {});
      },
    );

    renderDashboard();
    await screen.findByText("Welcome back");

    await act(async () => {
      handlers["tray_navigate"]?.("settings");
    });

    expect(
      await screen.findByRole("heading", { name: /^settings$/i }),
    ).toBeInTheDocument();
  });

  it("navigates to insights via tray_navigate event", async () => {
    type EventHandler = (payload: unknown) => void;
    const handlers: Record<string, EventHandler> = {};
    mockOnEvent.mockImplementation(
      (name: string, h: EventHandler): Promise<() => void> => {
        handlers[name] = h;
        return Promise.resolve(() => {});
      },
    );

    renderDashboard();
    await screen.findByText("Welcome back");

    await act(async () => {
      handlers["tray_navigate"]?.("insights");
    });

    expect(
      await screen.findByRole("heading", { name: /^insights$/i }),
    ).toBeInTheDocument();
  });

  it("does not render Overlay-specific controls in dashboard mode", async () => {
    renderDashboard();
    await screen.findByText("Welcome back");
    expect(screen.queryByTitle("Click to record")).not.toBeInTheDocument();
  });

  it("renders the UpdateBanner area hidden when no update", async () => {
    mockCheckForUpdate.mockResolvedValue(null);
    renderDashboard();
    await screen.findByText("Welcome back");
    expect(screen.queryByText("Update available")).not.toBeInTheDocument();
  });
});
