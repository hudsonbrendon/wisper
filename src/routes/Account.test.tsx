import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nProvider } from "../lib/i18n";

const signIn = vi.fn();
const signOut = vi.fn();

vi.mock("../lib/authContext", () => ({
  useAuth: vi.fn(),
}));

import { useAuth } from "../lib/authContext";
import Account from "./Account";

const mockUseAuth = vi.mocked(useAuth);

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.setItem("ui_lang", "en");
});

describe("Account", () => {
  it("shows a Google sign-in button when logged out", async () => {
    mockUseAuth.mockReturnValue({
      user: null,
      loading: false,
      signIn,
      signOut,
    });
    render(
      <I18nProvider>
        <Account />
      </I18nProvider>,
    );
    const btn = screen.getByRole("button", { name: /continue with google/i });
    await userEvent.click(btn);
    expect(signIn).toHaveBeenCalledTimes(1);
  });

  it("shows the email and sign-out when logged in", async () => {
    mockUseAuth.mockReturnValue({
      user: { id: "u1", email: "a@b.com" } as never,
      loading: false,
      signIn,
      signOut,
    });
    render(
      <I18nProvider>
        <Account />
      </I18nProvider>,
    );
    expect(screen.getByText("a@b.com")).toBeInTheDocument();
    // Sign out asks for confirmation before signing out.
    await userEvent.click(screen.getByRole("button", { name: /sign out/i }));
    expect(signOut).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    const signOutButtons = screen.getAllByRole("button", { name: /sign out/i });
    await userEvent.click(signOutButtons[signOutButtons.length - 1]);
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it("sign out can be cancelled from the confirmation dialog", async () => {
    mockUseAuth.mockReturnValue({
      user: { id: "u1", email: "a@b.com" } as never,
      loading: false,
      signIn,
      signOut,
    });
    render(
      <I18nProvider>
        <Account />
      </I18nProvider>,
    );
    await userEvent.click(screen.getByRole("button", { name: /sign out/i }));
    await userEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(signOut).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
