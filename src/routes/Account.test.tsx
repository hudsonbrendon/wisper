import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const signIn = vi.fn();
const signOut = vi.fn();

vi.mock("../lib/authContext", () => ({
  useAuth: vi.fn(),
}));

vi.mock("../lib/usageContext", () => ({
  useUsage: () => ({
    usage: { dictation_words: 0, meetings: 0 },
    refresh: vi.fn(),
    blocked: null,
    clearBlocked: vi.fn(),
  }),
}));

import { useAuth } from "../lib/authContext";
import Account from "./Account";

const mockUseAuth = vi.mocked(useAuth);

beforeEach(() => {
  vi.clearAllMocks();
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
});
