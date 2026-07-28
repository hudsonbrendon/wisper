import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------
const {
  mockGetCurrentWindow,
  mockOnEvent,
  mockGetHistory,
  mockGetConfig,
  mockListMicrophones,
  mockListModels,
  mockGetLaunchAtLogin,
  mockCheckForUpdate,
  mockGetVersion,
} = vi.hoisted(() => ({
  mockGetCurrentWindow: vi.fn(),
  mockOnEvent: vi.fn(),
  mockGetHistory: vi.fn(),
  mockGetConfig: vi.fn(),
  mockListMicrophones: vi.fn(),
  mockListModels: vi.fn(),
  mockGetLaunchAtLogin: vi.fn(),
  mockCheckForUpdate: vi.fn(),
  mockGetVersion: vi.fn(),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: mockGetCurrentWindow,
}));

vi.mock("./lib/authContext", () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  AuthProvider: ({ children }: { children: any }) => children,
  useAuth: vi.fn(() => ({
    user: null,
    loading: false,
    signIn: vi.fn(),
    signOut: vi.fn(),
  })),
}));

vi.mock("./lib/api", () => ({
  onEvent: mockOnEvent,
  getHistory: mockGetHistory,
  getConfig: mockGetConfig,
  saveConfig: vi.fn(),
  listMicrophones: mockListMicrophones,
  listModels: mockListModels,
  getLaunchAtLogin: mockGetLaunchAtLogin,
  downloadModel: vi.fn(),
  cancelDownload: vi.fn(),
  removeModel: vi.fn(),
  clearHistory: vi.fn(),
  setLaunchAtLogin: vi.fn(),
  resetApp: vi.fn(),
  uiStartRecording: vi.fn(),
  uiStopAndInsert: vi.fn(),
  uiCancelRecording: vi.fn(),
  setLanguage: vi.fn(),
  setPillExpanded: vi.fn(),
}));

vi.mock("./lib/updater", () => ({
  checkForUpdate: mockCheckForUpdate,
  installUpdate: vi.fn(),
}));

vi.mock("@tauri-apps/api/app", () => ({
  getVersion: mockGetVersion,
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("App", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOnEvent.mockResolvedValue(() => {});
    mockGetHistory.mockResolvedValue([]);
    mockGetConfig.mockResolvedValue({ ...DEFAULT_CONFIG });
    mockListMicrophones.mockResolvedValue([]);
    mockListModels.mockResolvedValue([]);
    mockGetLaunchAtLogin.mockResolvedValue(false);
    mockCheckForUpdate.mockResolvedValue(null);
    mockGetVersion.mockResolvedValue("0.1.0");
  });

  it("renders Dashboard when window label is not 'overlay'", async () => {
    mockGetCurrentWindow.mockReturnValue({ label: "main" });
    const { default: App } = await import("./App");
    render(<App />);
    expect(await screen.findByText("Welcome back")).toBeInTheDocument();
  });

  it("renders Overlay when window label is 'overlay'", async () => {
    mockGetCurrentWindow.mockReturnValue({ label: "overlay" });
    const { default: App } = await import("./App");
    render(<App />);
    expect(await screen.findByTitle("Click to record")).toBeInTheDocument();
  });
});
