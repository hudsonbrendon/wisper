import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../lib/i18n";
import Sidebar, { type View } from "./Sidebar";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------
const { mockOnEvent, mockCheckForUpdate, mockGetVersion } = vi.hoisted(() => ({
  mockOnEvent: vi.fn(),
  mockCheckForUpdate: vi.fn(),
  mockGetVersion: vi.fn(),
}));

vi.mock("../lib/api", () => ({
  onEvent: mockOnEvent,
}));

vi.mock("../lib/updater", () => ({
  checkForUpdate: mockCheckForUpdate,
  installUpdate: vi.fn(),
}));

vi.mock("@tauri-apps/api/app", () => ({
  getVersion: mockGetVersion,
}));

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------
function renderSidebar(
  view: View = "home",
  onNavigate: (v: View) => void = vi.fn(),
) {
  return render(
    <I18nProvider>
      <Sidebar view={view} onNavigate={onNavigate} />
    </I18nProvider>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("Sidebar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOnEvent.mockResolvedValue(() => {});
    mockCheckForUpdate.mockResolvedValue(null);
    mockGetVersion.mockResolvedValue("0.1.0");
  });

  it("renders the Wisper brand name", () => {
    renderSidebar();
    expect(screen.getByText("Wisper")).toBeInTheDocument();
  });

  it("renders all primary navigation buttons", () => {
    renderSidebar();
    expect(screen.getByRole("button", { name: /^home$/i })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^insights$/i }),
    ).toBeInTheDocument();
  });

  it("renders Settings and Help in the bottom group", () => {
    renderSidebar();
    expect(
      screen.getByRole("button", { name: /^settings$/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /^help$/i })).toBeInTheDocument();
  });

  it("calls onNavigate with 'home' when Home button is clicked", async () => {
    const onNavigate = vi.fn();
    renderSidebar("insights", onNavigate);
    await userEvent.click(screen.getByRole("button", { name: /^home$/i }));
    expect(onNavigate).toHaveBeenCalledWith("home");
  });

  it("calls onNavigate with 'insights' when Insights button is clicked", async () => {
    const onNavigate = vi.fn();
    renderSidebar("home", onNavigate);
    await userEvent.click(screen.getByRole("button", { name: /^insights$/i }));
    expect(onNavigate).toHaveBeenCalledWith("insights");
  });

  it("calls onNavigate with 'settings' when Settings button is clicked", async () => {
    const onNavigate = vi.fn();
    renderSidebar("home", onNavigate);
    await userEvent.click(screen.getByRole("button", { name: /^settings$/i }));
    expect(onNavigate).toHaveBeenCalledWith("settings");
  });

  it("applies active styling to the currently active view button", () => {
    renderSidebar("home");
    const homeBtn = screen.getByRole("button", { name: /^home$/i });
    // Active button has font-medium class
    expect(homeBtn.className).toContain("font-medium");
  });

  it("does not apply active styling to inactive buttons", () => {
    renderSidebar("home");
    const insightsBtn = screen.getByRole("button", { name: /^insights$/i });
    expect(insightsBtn.className).not.toContain("font-medium");
  });

  it("renders the Help link pointing to the GitHub repo", () => {
    renderSidebar();
    const helpLink = screen.getByRole("link", { name: /^help$/i });
    expect(helpLink).toHaveAttribute(
      "href",
      "https://github.com/hudsonbrendon/wisper",
    );
    expect(helpLink).toHaveAttribute("target", "_blank");
  });

  it("renders UpdateControl version info area", async () => {
    mockGetVersion.mockResolvedValue("1.2.3");
    renderSidebar();
    // UpdateControl shows "Current version: v1.2.3" after resolving
    expect(await screen.findByText(/v1\.2\.3/)).toBeInTheDocument();
  });

  it("shows settings view as active when view='settings'", () => {
    renderSidebar("settings");
    const settingsBtn = screen.getByRole("button", { name: /^settings$/i });
    expect(settingsBtn.className).toContain("font-medium");
  });

  it("shows insights view as active when view='insights'", () => {
    renderSidebar("insights");
    const insightsBtn = screen.getByRole("button", { name: /^insights$/i });
    expect(insightsBtn.className).toContain("font-medium");
  });

  it("renders the Meetings nav item and navigates to it", async () => {
    const onNavigate = vi.fn();
    renderSidebar("home", onNavigate);
    const btn = await screen.findByRole("button", { name: /^meetings$/i });
    await userEvent.click(btn);
    expect(onNavigate).toHaveBeenCalledWith("meetings");
  });
});
