import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ once: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
vi.mock("./supabase", () => ({
  supabase: {
    auth: {
      signInWithOAuth: vi.fn(),
      exchangeCodeForSession: vi.fn(),
      signOut: vi.fn(),
      getSession: vi.fn(),
      onAuthStateChange: vi.fn(),
    },
    from: vi.fn(),
  },
}));

import { invoke } from "@tauri-apps/api/core";
import { once } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { supabase } from "./supabase";
import {
  extractCode,
  signInWithGoogle,
  signOut,
  fetchPlan,
  onAuthChange,
} from "./auth";

const mockInvoke = vi.mocked(invoke);
const mockOnce = vi.mocked(once);
const mockOpenUrl = vi.mocked(openUrl);

beforeEach(() => vi.clearAllMocks());

describe("extractCode", () => {
  it("pulls the code query param from a callback URL", () => {
    expect(extractCode("http://127.0.0.1:5123/?code=abc123&x=1")).toBe(
      "abc123",
    );
  });
  it("returns null when there is no code", () => {
    expect(extractCode("http://127.0.0.1:5123/?error=denied")).toBeNull();
  });
});

describe("signInWithGoogle", () => {
  it("runs the loopback PKCE flow and exchanges the code for a session", async () => {
    mockInvoke.mockResolvedValueOnce(5123); // start_oauth_server -> port
    // once() resolves with the callback URL when the browser redirects.
    mockOnce.mockImplementationOnce(
      ((_event: string, handler: (e: { payload: string }) => void) => {
        handler({ payload: "http://127.0.0.1:5123/?code=abc123" });
        return Promise.resolve(() => {});
      }) as never,
    );
    vi.mocked(supabase.auth.signInWithOAuth).mockResolvedValueOnce({
      data: { url: "https://supabase.co/auth/v1/authorize?x=1", provider: "google" },
      error: null,
    } as never);
    vi.mocked(supabase.auth.exchangeCodeForSession).mockResolvedValueOnce({
      data: { session: { user: { id: "u1" } } },
      error: null,
    } as never);

    await signInWithGoogle();

    expect(mockInvoke).toHaveBeenCalledWith("start_oauth_server");
    expect(supabase.auth.signInWithOAuth).toHaveBeenCalledWith({
      provider: "google",
      options: {
        redirectTo: "http://127.0.0.1:5123",
        skipBrowserRedirect: true,
      },
    });
    expect(mockOpenUrl).toHaveBeenCalledWith(
      "https://supabase.co/auth/v1/authorize?x=1",
    );
    expect(supabase.auth.exchangeCodeForSession).toHaveBeenCalledWith("abc123");
  });
});

describe("signOut", () => {
  it("delegates to supabase signOut", async () => {
    vi.mocked(supabase.auth.signOut).mockResolvedValueOnce({ error: null } as never);
    await signOut();
    expect(supabase.auth.signOut).toHaveBeenCalledTimes(1);
  });
});

describe("fetchPlan", () => {
  it("returns the plan from the profiles row", async () => {
    const single = vi.fn().mockResolvedValueOnce({
      data: { plan: "pro" },
      error: null,
    });
    const eq = vi.fn(() => ({ single }));
    const select = vi.fn(() => ({ eq }));
    vi.mocked(supabase.from).mockReturnValueOnce({ select } as never);

    expect(await fetchPlan("u1")).toBe("pro");
    expect(supabase.from).toHaveBeenCalledWith("profiles");
  });

  it("falls back to 'free' when the row or column is missing", async () => {
    const single = vi.fn().mockResolvedValueOnce({ data: null, error: null });
    const eq = vi.fn(() => ({ single }));
    const select = vi.fn(() => ({ eq }));
    vi.mocked(supabase.from).mockReturnValueOnce({ select } as never);

    expect(await fetchPlan("u1")).toBe("free");
  });
});

describe("onAuthChange", () => {
  it("subscribes to auth state changes and returns an unsubscribe function", () => {
    const cb = vi.fn();
    const unsubscribe = vi.fn();
    vi.mocked(supabase.auth.onAuthStateChange).mockReturnValue({
      data: { subscription: { unsubscribe } },
    } as never);

    const off = onAuthChange(cb);

    expect(supabase.auth.onAuthStateChange).toHaveBeenCalledTimes(1);

    // Get the handler passed to onAuthStateChange and call it
    const handler = vi.mocked(supabase.auth.onAuthStateChange).mock.calls[0][0];
    handler("SIGNED_IN", { user: { id: "u1" } } as never);

    // Verify the callback was invoked with the session
    expect(cb).toHaveBeenCalledWith({ user: { id: "u1" } });

    // Verify the returned function is callable and invokes unsubscribe
    expect(off).toBeInstanceOf(Function);
    off();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});
