import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../lib/i18n";
import UpdateBanner from "./UpdateBanner";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------
const { mockCheckForUpdate, mockInstallUpdate } = vi.hoisted(() => ({
  mockCheckForUpdate: vi.fn(),
  mockInstallUpdate: vi.fn(),
}));

vi.mock("../lib/updater", () => ({
  checkForUpdate: mockCheckForUpdate,
  installUpdate: mockInstallUpdate,
}));

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------
function renderBanner() {
  return render(
    <I18nProvider>
      <UpdateBanner />
    </I18nProvider>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("UpdateBanner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInstallUpdate.mockResolvedValue(undefined);
  });

  it("renders nothing when no update is available", async () => {
    mockCheckForUpdate.mockResolvedValue(null);
    renderBanner();
    // Wait for the async check to complete
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(screen.queryByText(/update available/i)).not.toBeInTheDocument();
  });

  it("renders nothing when checkForUpdate throws", async () => {
    mockCheckForUpdate.mockRejectedValue(new Error("network error"));
    renderBanner();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(screen.queryByText(/update available/i)).not.toBeInTheDocument();
  });

  it("shows the update banner when an update is available", async () => {
    mockCheckForUpdate.mockResolvedValue({ version: "1.2.3" });
    renderBanner();
    expect(await screen.findByText(/update available/i)).toBeInTheDocument();
    expect(screen.getByText(/v1\.2\.3/)).toBeInTheDocument();
  });

  it("shows dismiss and install buttons when update is available", async () => {
    mockCheckForUpdate.mockResolvedValue({ version: "1.2.3" });
    renderBanner();
    await screen.findByText(/update available/i);

    expect(
      screen.getByRole("button", { name: /not now/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /update & restart/i }),
    ).toBeInTheDocument();
  });

  it("hides banner when dismiss button is clicked", async () => {
    mockCheckForUpdate.mockResolvedValue({ version: "1.2.3" });
    renderBanner();
    await screen.findByText(/update available/i);

    await userEvent.click(screen.getByRole("button", { name: /not now/i }));
    expect(screen.queryByText(/update available/i)).not.toBeInTheDocument();
  });

  it("starts installing when update & restart button is clicked", async () => {
    // installUpdate resolves without relaunching in tests
    mockInstallUpdate.mockResolvedValue(undefined);
    mockCheckForUpdate.mockResolvedValue({ version: "1.2.3" });
    renderBanner();
    await screen.findByText(/update available/i);

    await userEvent.click(
      screen.getByRole("button", { name: /update & restart/i }),
    );

    expect(await screen.findByText(/downloading…/i)).toBeInTheDocument();
    expect(mockInstallUpdate).toHaveBeenCalledOnce();
  });

  it("reports download progress via onProgress callback", async () => {
    let capturedOnProgress: ((d: number, t: number) => void) | null = null;
    mockInstallUpdate.mockImplementation(
      async (_update: unknown, onProgress: (d: number, t: number) => void) => {
        capturedOnProgress = onProgress;
      },
    );
    mockCheckForUpdate.mockResolvedValue({ version: "2.0.0" });
    renderBanner();
    await screen.findByText(/update available/i);

    await userEvent.click(
      screen.getByRole("button", { name: /update & restart/i }),
    );

    // Simulate progress
    await act(async () => {
      capturedOnProgress?.(50, 100);
    });

    expect(screen.getByText(/downloading…/i)).toBeInTheDocument();
  });

  it("shows error state when installUpdate throws", async () => {
    mockInstallUpdate.mockRejectedValue(new Error("install failed"));
    mockCheckForUpdate.mockResolvedValue({ version: "1.2.3" });
    renderBanner();
    await screen.findByText(/update available/i);

    await userEvent.click(
      screen.getByRole("button", { name: /update & restart/i }),
    );

    expect(await screen.findByText(/update failed/i)).toBeInTheDocument();
  });

  it("shows retry install button in error state", async () => {
    mockInstallUpdate.mockRejectedValue(new Error("install failed"));
    mockCheckForUpdate.mockResolvedValue({ version: "1.2.3" });
    renderBanner();
    await screen.findByText(/update available/i);

    await userEvent.click(
      screen.getByRole("button", { name: /update & restart/i }),
    );

    await screen.findByText(/update failed/i);
    // There should still be an install button for retry
    expect(
      screen.getByRole("button", { name: /update & restart/i }),
    ).toBeInTheDocument();
  });

  it("onProgress with total=0 sets pct to 0", async () => {
    let capturedOnProgress: ((d: number, t: number) => void) | null = null;
    mockInstallUpdate.mockImplementation(
      async (_update: unknown, onProgress: (d: number, t: number) => void) => {
        capturedOnProgress = onProgress;
      },
    );
    mockCheckForUpdate.mockResolvedValue({ version: "2.0.0" });
    renderBanner();
    await screen.findByText(/update available/i);

    await userEvent.click(
      screen.getByRole("button", { name: /update & restart/i }),
    );

    await act(async () => {
      capturedOnProgress?.(0, 0);
    });

    // Should show 0%
    expect(screen.getByText(/0%/)).toBeInTheDocument();
  });
});
