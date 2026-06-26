import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const clearBlocked = vi.fn();
const signIn = vi.fn(() => Promise.resolve());
vi.mock("../lib/usageContext", () => ({ useUsage: vi.fn() }));
vi.mock("../lib/authContext", () => ({ useAuth: vi.fn(() => ({ signIn })) }));

import { useUsage } from "../lib/usageContext";
import UpgradeModal from "./UpgradeModal";

beforeEach(() => vi.clearAllMocks());

describe("UpgradeModal", () => {
  it("renders nothing when not blocked", () => {
    vi.mocked(useUsage).mockReturnValue({ blocked: null, clearBlocked } as never);
    const { container } = render(<UpgradeModal />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the upgrade prompt with inert plan buttons on a quota block", () => {
    vi.mocked(useUsage).mockReturnValue({
      blocked: { reason: "quota", metric: "dictation" },
      clearBlocked,
    } as never);
    render(<UpgradeModal />);
    expect(screen.getByText(/weekly limit reached/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /\$8\s*\/\s*month/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /\$72\s*\/\s*year/i })).toBeDisabled();
  });

  it("shows a sign-in prompt on an auth block and wires the button", async () => {
    vi.mocked(useUsage).mockReturnValue({
      blocked: { reason: "auth", metric: "dictation" },
      clearBlocked,
    } as never);
    render(<UpgradeModal />);
    await userEvent.click(screen.getByRole("button", { name: /continue with google/i }));
    expect(signIn).toHaveBeenCalledTimes(1);
  });
});
