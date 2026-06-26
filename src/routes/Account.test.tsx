import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const signIn = vi.fn();
const signOut = vi.fn();

vi.mock("../lib/authContext", () => ({
  useAuth: vi.fn(),
}));

vi.mock("../lib/usageContext", () => ({
  useUsage: vi.fn(),
}));

import { useAuth } from "../lib/authContext";
import { useUsage } from "../lib/usageContext";
import Account from "./Account";

const mockUseAuth = vi.mocked(useAuth);
const mockUseUsage = vi.mocked(useUsage);

beforeEach(() => {
  vi.clearAllMocks();
  mockUseUsage.mockReturnValue({
    usage: { dictation_words: 0, meetings: 0 },
    refresh: vi.fn(),
    blocked: null,
    clearBlocked: vi.fn(),
  } as never);
});

describe("Account", () => {
  it("shows a Google sign-in button when logged out", async () => {
    mockUseAuth.mockReturnValue({
      user: null,
      plan: "free",
      loading: false,
      signIn,
      signOut,
    });
    render(<Account />);
    const btn = screen.getByRole("button", { name: /continue with google/i });
    await userEvent.click(btn);
    expect(signIn).toHaveBeenCalledTimes(1);
  });

  it("shows the email, plan badge, and sign-out when logged in", async () => {
    mockUseAuth.mockReturnValue({
      user: { id: "u1", email: "a@b.com" } as never,
      plan: "free",
      loading: false,
      signIn,
      signOut,
    });
    render(<Account />);
    expect(screen.getByText("a@b.com")).toBeInTheDocument();
    expect(screen.getByText(/free/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /sign out/i }));
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it("free plan shows weekly usage rows", () => {
    mockUseAuth.mockReturnValue({
      user: { id: "u1", email: "a@b.com" } as never,
      plan: "free",
      loading: false,
      signIn,
      signOut,
    });
    mockUseUsage.mockReturnValue({
      usage: { dictation_words: 1200, meetings: 1 },
      refresh: vi.fn(),
      blocked: null,
      clearBlocked: vi.fn(),
    } as never);
    render(<Account />);
    expect(screen.getByText("Words this week")).toBeInTheDocument();
    expect(screen.getByText("Meetings this week")).toBeInTheDocument();
    expect(screen.getByText(/1[.,]?200\s*\/\s*2[.,]?000/)).toBeInTheDocument();
  });

  it("pro plan shows Unlimited", () => {
    mockUseAuth.mockReturnValue({
      user: { id: "u1", email: "a@b.com" } as never,
      plan: "pro",
      loading: false,
      signIn,
      signOut,
    });
    render(<Account />);
    expect(screen.getByText(/unlimited dictation and meetings/i)).toBeInTheDocument();
    expect(screen.queryByText("Words this week")).not.toBeInTheDocument();
  });
});
