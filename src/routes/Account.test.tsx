import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nProvider } from "../lib/i18n";

const signIn = vi.fn();
const signOut = vi.fn();

vi.mock("../lib/authContext", () => ({
  useAuth: vi.fn(),
}));

vi.mock("../lib/usageContext", () => ({
  useUsage: vi.fn(),
}));

vi.mock("../lib/billing", () => ({
  startCheckout: vi.fn(),
  openBillingPortal: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

import { useAuth } from "../lib/authContext";
import { useUsage } from "../lib/usageContext";
import { startCheckout, openBillingPortal } from "../lib/billing";
import { openUrl } from "@tauri-apps/plugin-opener";
import Account from "./Account";

const mockUseAuth = vi.mocked(useAuth);
const mockUseUsage = vi.mocked(useUsage);

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.setItem("ui_lang", "en");
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
    render(<I18nProvider><Account /></I18nProvider>);
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
    render(<I18nProvider><Account /></I18nProvider>);
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
    render(<I18nProvider><Account /></I18nProvider>);
    expect(screen.getByText("Words this week")).toBeInTheDocument();
    expect(screen.getByText("Meetings this week")).toBeInTheDocument();
    // The metric card shows the used count and the limit in separate elements.
    // Locale-tolerant (toLocaleString may render 1200 / 1,200 / 1.200).
    expect(screen.getByText(/^1[.,]?200$/)).toBeInTheDocument();
    expect(screen.getByText(/\/\s*2[.,]?000/)).toBeInTheDocument();
  });

  it("pro plan shows Unlimited", () => {
    mockUseAuth.mockReturnValue({
      user: { id: "u1", email: "a@b.com" } as never,
      plan: "pro",
      loading: false,
      signIn,
      signOut,
    });
    render(<I18nProvider><Account /></I18nProvider>);
    expect(screen.getByText(/unlimited dictation and meetings/i)).toBeInTheDocument();
    expect(screen.queryByText("Words this week")).not.toBeInTheDocument();
  });

  it("free: annual is default and Upgrade starts an annual checkout", async () => {
    mockUseAuth.mockReturnValue({
      user: { id: "u1", email: "a@b.com" } as never,
      plan: "free",
      loading: false,
      signIn,
      signOut,
    });
    render(<I18nProvider><Account /></I18nProvider>);
    // Annual toggle is pre-selected → the upgrade button reflects the annual price.
    const upgrade = screen.getByRole("button", { name: /\$72\s*\/\s*yr/i });
    await userEvent.click(upgrade);
    expect(vi.mocked(startCheckout)).toHaveBeenCalledWith("year");
  });

  it("free: switching to monthly checks out monthly", async () => {
    mockUseAuth.mockReturnValue({
      user: { id: "u1", email: "a@b.com" } as never,
      plan: "free",
      loading: false,
      signIn,
      signOut,
    });
    render(<I18nProvider><Account /></I18nProvider>);
    await userEvent.click(screen.getByRole("button", { name: /^monthly$/i }));
    await userEvent.click(screen.getByRole("button", { name: /\$8\s*\/\s*mo/i }));
    expect(vi.mocked(startCheckout)).toHaveBeenCalledWith("month");
  });

  it("free: Explore features opens wisper.chat", async () => {
    mockUseAuth.mockReturnValue({
      user: { id: "u1", email: "a@b.com" } as never,
      plan: "free",
      loading: false,
      signIn,
      signOut,
    });
    render(<I18nProvider><Account /></I18nProvider>);
    await userEvent.click(screen.getByRole("button", { name: /explore features/i }));
    expect(vi.mocked(openUrl)).toHaveBeenCalledWith("https://wisper.chat");
  });

  it("pro: Manage subscription opens the billing portal", async () => {
    mockUseAuth.mockReturnValue({
      user: { id: "u1", email: "a@b.com" } as never,
      plan: "pro",
      loading: false,
      signIn,
      signOut,
    });
    render(<I18nProvider><Account /></I18nProvider>);
    await userEvent.click(
      screen.getByRole("button", { name: /manage subscription/i }),
    );
    expect(vi.mocked(openBillingPortal)).toHaveBeenCalledTimes(1);
  });
});
