import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./supabase", () => ({
  getSupabase: vi.fn(),
  isSupabaseConfigured: vi.fn(() => true),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

import { getSupabase, isSupabaseConfigured } from "./supabase";
import { openUrl } from "@tauri-apps/plugin-opener";
import { startCheckout, openBillingPortal } from "./billing";

const mockOpen = vi.mocked(openUrl);

beforeEach(() => vi.clearAllMocks());

describe("startCheckout", () => {
  it("invokes the checkout function with the interval and opens the URL", async () => {
    const invoke = vi.fn().mockResolvedValue({
      data: { url: "https://stripe/checkout" },
      error: null,
    });
    vi.mocked(getSupabase).mockReturnValue({ functions: { invoke } } as never);
    await startCheckout("year");
    expect(invoke).toHaveBeenCalledWith("create-checkout-session", {
      body: { interval: "year" },
    });
    expect(mockOpen).toHaveBeenCalledWith("https://stripe/checkout");
  });

  it("throws when the function returns an error", async () => {
    const invoke = vi
      .fn()
      .mockResolvedValue({ data: null, error: { message: "x" } });
    vi.mocked(getSupabase).mockReturnValue({ functions: { invoke } } as never);
    await expect(startCheckout("month")).rejects.toBeTruthy();
    expect(mockOpen).not.toHaveBeenCalled();
  });
});

describe("openBillingPortal", () => {
  it("invokes the portal function and opens the URL", async () => {
    const invoke = vi.fn().mockResolvedValue({
      data: { url: "https://stripe/portal" },
      error: null,
    });
    vi.mocked(getSupabase).mockReturnValue({ functions: { invoke } } as never);
    await openBillingPortal();
    expect(invoke).toHaveBeenCalledWith("create-portal-session", {});
    expect(mockOpen).toHaveBeenCalledWith("https://stripe/portal");
  });
});

describe("not configured", () => {
  it("startCheckout throws and does not open a URL", async () => {
    vi.mocked(isSupabaseConfigured).mockReturnValueOnce(false);
    const invoke = vi.fn();
    vi.mocked(getSupabase).mockReturnValue({ functions: { invoke } } as never);
    await expect(startCheckout("year")).rejects.toBeTruthy();
    expect(invoke).not.toHaveBeenCalled();
    expect(mockOpen).not.toHaveBeenCalled();
  });

  it("openBillingPortal throws and does not open a URL", async () => {
    vi.mocked(isSupabaseConfigured).mockReturnValueOnce(false);
    const invoke = vi.fn();
    vi.mocked(getSupabase).mockReturnValue({ functions: { invoke } } as never);
    await expect(openBillingPortal()).rejects.toBeTruthy();
    expect(invoke).not.toHaveBeenCalled();
    expect(mockOpen).not.toHaveBeenCalled();
  });
});
