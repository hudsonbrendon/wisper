import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../lib/i18n";
import UpdateControl from "./UpdateControl";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------
const { mockCheckForUpdate, mockInstallUpdate, mockGetVersion, mockOnEvent } =
  vi.hoisted(() => ({
    mockCheckForUpdate: vi.fn(),
    mockInstallUpdate: vi.fn(),
    mockGetVersion: vi.fn(),
    mockOnEvent: vi.fn(),
  }));

vi.mock("../lib/updater", () => ({
  checkForUpdate: mockCheckForUpdate,
  installUpdate: mockInstallUpdate,
}));

vi.mock("@tauri-apps/api/app", () => ({
  getVersion: mockGetVersion,
}));

vi.mock("../lib/api", () => ({
  onEvent: mockOnEvent,
}));

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------
function renderControl() {
  return render(
    <I18nProvider>
      <UpdateControl />
    </I18nProvider>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("UpdateControl", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetVersion.mockResolvedValue("0.2.0");
    mockOnEvent.mockResolvedValue(() => {});
    mockInstallUpdate.mockResolvedValue(undefined);
  });

  it("renders current version after loading", async () => {
    renderControl();
    expect(await screen.findByText(/v0\.2\.0/)).toBeInTheDocument();
  });

  it("renders the 'Check for updates' button in idle state", async () => {
    renderControl();
    expect(
      await screen.findByRole("button", { name: /check for updates/i }),
    ).toBeInTheDocument();
  });

  it("shows checking state while checking for updates", async () => {
    // Never resolves so we can observe interim state
    mockCheckForUpdate.mockReturnValue(new Promise(() => {}));
    renderControl();
    await screen.findByRole("button", { name: /check for updates/i });

    const btn = screen.getByRole("button", { name: /check for updates/i });
    await userEvent.click(btn);

    expect(await screen.findByText(/checking…/i)).toBeInTheDocument();
  });

  it("shows 'up to date' when no update is available", async () => {
    mockCheckForUpdate.mockResolvedValue(null);
    renderControl();
    await screen.findByRole("button", { name: /check for updates/i });

    await userEvent.click(
      screen.getByRole("button", { name: /check for updates/i }),
    );

    expect(await screen.findByText(/you're up to date/i)).toBeInTheDocument();
  });

  it("shows downloading state when update is available", async () => {
    // installUpdate never resolves so we stay in downloading state
    mockInstallUpdate.mockReturnValue(new Promise(() => {}));
    mockCheckForUpdate.mockResolvedValue({ version: "2.0.0" });
    renderControl();
    await screen.findByRole("button", { name: /check for updates/i });

    await userEvent.click(
      screen.getByRole("button", { name: /check for updates/i }),
    );

    expect(await screen.findByText(/downloading…/i)).toBeInTheDocument();
  });

  it("disables button while checking", async () => {
    mockCheckForUpdate.mockReturnValue(new Promise(() => {}));
    renderControl();
    await screen.findByRole("button", { name: /check for updates/i });

    await userEvent.click(
      screen.getByRole("button", { name: /check for updates/i }),
    );

    await screen.findByText(/checking…/i);
    const btn = screen.getByRole("button", { name: /checking…/i });
    expect(btn).toBeDisabled();
  });

  it("shows error state when check throws", async () => {
    mockCheckForUpdate.mockRejectedValue(new Error("offline"));
    renderControl();
    await screen.findByRole("button", { name: /check for updates/i });

    await userEvent.click(
      screen.getByRole("button", { name: /check for updates/i }),
    );

    expect(await screen.findByText(/update failed/i)).toBeInTheDocument();
  });

  it("subscribes to tray_check_updates event on mount", async () => {
    renderControl();
    await screen.findByRole("button", { name: /check for updates/i });

    const eventNames = (mockOnEvent.mock.calls as Array<[string, unknown]>).map(
      (c) => c[0],
    );
    expect(eventNames).toContain("tray_check_updates");
  });

  it("triggers check when tray_check_updates event fires", async () => {
    type EventHandler = () => void;
    const handlers: Record<string, EventHandler> = {};
    mockOnEvent.mockImplementation(
      (name: string, h: EventHandler): Promise<() => void> => {
        handlers[name] = h;
        return Promise.resolve(() => {});
      },
    );
    mockCheckForUpdate.mockResolvedValue(null);
    renderControl();
    await screen.findByRole("button", { name: /check for updates/i });

    await act(async () => {
      handlers["tray_check_updates"]?.();
    });

    await waitFor(() => {
      expect(mockCheckForUpdate).toHaveBeenCalledTimes(1);
    });
  });

  it("reports download progress percentage", async () => {
    let capturedOnProgress: ((d: number, t: number) => void) | null = null;
    mockInstallUpdate.mockImplementation(
      async (_update: unknown, onProgress: (d: number, t: number) => void) => {
        capturedOnProgress = onProgress;
        // stay pending
        return new Promise(() => {});
      },
    );
    mockCheckForUpdate.mockResolvedValue({ version: "3.0.0" });
    renderControl();
    await screen.findByRole("button", { name: /check for updates/i });

    await userEvent.click(
      screen.getByRole("button", { name: /check for updates/i }),
    );

    // Wait for the downloading state
    await screen.findByText(/downloading…/i);

    await act(async () => {
      capturedOnProgress?.(75, 100);
    });

    expect(screen.getByText(/75%/)).toBeInTheDocument();
  });
});
