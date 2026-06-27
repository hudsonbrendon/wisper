import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ once: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

// Mock client object used by all tests.  Lives outside vi.mock() so tests can
// reference it directly without going through vi.mocked() every time.
const mockClient = {
  auth: {
    signInWithOAuth: vi.fn(),
    exchangeCodeForSession: vi.fn(),
    signOut: vi.fn(),
    getSession: vi.fn(),
    onAuthStateChange: vi.fn(),
  },
  from: vi.fn(),
};

vi.mock("./supabase", () => ({
  getSupabase: vi.fn(() => mockClient),
  isSupabaseConfigured: vi.fn(() => true),
}));

import { invoke } from "@tauri-apps/api/core";
import { once } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { getSupabase, isSupabaseConfigured } from "./supabase";
import {
  extractCode,
  signInWithGoogle,
  signOut,
  getSession,
  fetchPlan,
  onAuthChange,
  subscribePlan,
} from "./auth";

const mockInvoke = vi.mocked(invoke);
const mockOnce = vi.mocked(once);
const mockOpenUrl = vi.mocked(openUrl);

beforeEach(() => {
  vi.clearAllMocks();
  // Restore defaults after each test that may override them.
  vi.mocked(isSupabaseConfigured).mockReturnValue(true);
  vi.mocked(getSupabase).mockReturnValue(mockClient as never);
});

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
    mockOnce.mockImplementationOnce(((
      _event: string,
      handler: (e: { payload: string }) => void,
    ) => {
      handler({ payload: "http://127.0.0.1:5123/?code=abc123" });
      return Promise.resolve(() => {});
    }) as never);
    mockClient.auth.signInWithOAuth.mockResolvedValueOnce({
      data: {
        url: "https://supabase.co/auth/v1/authorize?x=1",
        provider: "google",
      },
      error: null,
    });
    mockClient.auth.exchangeCodeForSession.mockResolvedValueOnce({
      data: { session: { user: { id: "u1" } } },
      error: null,
    });

    await signInWithGoogle();

    expect(mockInvoke).toHaveBeenCalledWith("start_oauth_server");
    expect(mockClient.auth.signInWithOAuth).toHaveBeenCalledWith({
      provider: "google",
      options: {
        redirectTo: "http://127.0.0.1:5123",
        skipBrowserRedirect: true,
      },
    });
    expect(mockOpenUrl).toHaveBeenCalledWith(
      "https://supabase.co/auth/v1/authorize?x=1",
    );
    expect(mockClient.auth.exchangeCodeForSession).toHaveBeenCalledWith(
      "abc123",
    );
  });

  it("rejects with timeout error when oauth://url event never fires", async () => {
    vi.useFakeTimers();

    mockInvoke.mockResolvedValueOnce(5123);
    // once() never calls the handler — simulates user closing the browser.
    mockOnce.mockImplementationOnce(((_event: string, _handler: unknown) =>
      Promise.resolve(() => {})) as never);
    mockClient.auth.signInWithOAuth.mockResolvedValueOnce({
      data: {
        url: "https://supabase.co/auth/v1/authorize?x=1",
        provider: "google",
      },
      error: null,
    });

    const promise = signInWithGoogle();
    // Attach an early no-op catch so Node.js doesn't emit an unhandled-rejection
    // warning while the timer is outstanding; the real assertion still runs.
    void promise.catch(() => {});
    await vi.runAllTimersAsync();

    await expect(promise).rejects.toThrow("Login timed out. Please try again.");

    vi.useRealTimers();
  });

  it("rejects with the signInWithOAuth error and cleans up the timer (no second rejection)", async () => {
    vi.useFakeTimers();

    mockInvoke.mockResolvedValueOnce(5123);
    // once() returns an unlisten fn but never fires the event.
    mockOnce.mockImplementationOnce(((_event: string, _handler: unknown) =>
      Promise.resolve(() => {})) as never);
    const oauthError = new Error("OAuth provider error");
    mockClient.auth.signInWithOAuth.mockResolvedValueOnce({
      data: null,
      error: oauthError,
    });

    await expect(signInWithGoogle()).rejects.toThrow("OAuth provider error");

    // If the timer were NOT cleared, vi.runAllTimersAsync() would fire it and
    // reject the callback Promise — an unhandled rejection that Vitest surfaces
    // as a test failure.  With the fix the timer is cleared in the catch block,
    // so advancing all timers must not produce any additional rejection.
    await vi.runAllTimersAsync();

    vi.useRealTimers();
  });

  it("rejects immediately and never calls getSupabase when not configured", async () => {
    vi.mocked(isSupabaseConfigured).mockReturnValueOnce(false);

    await expect(signInWithGoogle()).rejects.toThrow(
      "Sign-in is unavailable: Supabase is not configured.",
    );
    expect(getSupabase).not.toHaveBeenCalled();
  });
});

describe("signOut", () => {
  it("delegates to supabase signOut", async () => {
    mockClient.auth.signOut.mockResolvedValueOnce({ error: null });
    await signOut();
    expect(mockClient.auth.signOut).toHaveBeenCalledTimes(1);
  });
});

describe("getSession", () => {
  it("returns null without calling getSupabase when not configured", async () => {
    vi.mocked(isSupabaseConfigured).mockReturnValueOnce(false);

    expect(await getSession()).toBeNull();
    expect(getSupabase).not.toHaveBeenCalled();
  });

  it("returns the session from supabase when configured", async () => {
    mockClient.auth.getSession.mockResolvedValueOnce({
      data: { session: { user: { id: "u1" } } },
      error: null,
    });

    expect(await getSession()).toEqual({ user: { id: "u1" } });
    expect(mockClient.auth.getSession).toHaveBeenCalledTimes(1);
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
    mockClient.from.mockReturnValueOnce({ select });

    expect(await fetchPlan("u1")).toBe("pro");
    expect(mockClient.from).toHaveBeenCalledWith("profiles");
  });

  it("falls back to 'free' when the row or column is missing", async () => {
    const single = vi.fn().mockResolvedValueOnce({ data: null, error: null });
    const eq = vi.fn(() => ({ single }));
    const select = vi.fn(() => ({ eq }));
    mockClient.from.mockReturnValueOnce({ select });

    expect(await fetchPlan("u1")).toBe("free");
  });
});

describe("onAuthChange", () => {
  it("returns a no-op unsubscribe and never calls getSupabase when not configured", () => {
    vi.mocked(isSupabaseConfigured).mockReturnValueOnce(false);

    const cb = vi.fn();
    const off = onAuthChange(cb);

    expect(typeof off).toBe("function");
    off(); // must not throw
    expect(getSupabase).not.toHaveBeenCalled();
  });

  it("subscribes to auth state changes and returns an unsubscribe function", () => {
    const cb = vi.fn();
    const unsubscribe = vi.fn();
    mockClient.auth.onAuthStateChange.mockReturnValue({
      data: { subscription: { unsubscribe } },
    });

    const off = onAuthChange(cb);

    expect(mockClient.auth.onAuthStateChange).toHaveBeenCalledTimes(1);

    // Get the handler passed to onAuthStateChange and call it.
    const handler = mockClient.auth.onAuthStateChange.mock.calls[0][0];
    handler("SIGNED_IN", { user: { id: "u1" } } as never);

    // Verify the callback was invoked with the session.
    expect(cb).toHaveBeenCalledWith({ user: { id: "u1" } });

    // Verify the returned function is callable and invokes unsubscribe.
    expect(off).toBeInstanceOf(Function);
    off();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});

describe("subscribePlan", () => {
  it("subscribes to the user's profile row and forwards plan updates", () => {
    const cb = vi.fn();
    let handler: (p: { new: { plan: string } }) => void = () => {};
    const channel = {
      on: vi.fn((_evt: string, _cfg: unknown, h: typeof handler) => {
        handler = h;
        return channel;
      }),
      subscribe: vi.fn(() => channel),
    };
    const removeChannel = vi.fn();
    vi.mocked(getSupabase).mockReturnValue({
      channel: vi.fn(() => channel),
      removeChannel,
    } as never);

    const off = subscribePlan("u1", cb);
    // The realtime payload delivers the new row; only valid plans forward.
    handler({ new: { plan: "pro" } });
    expect(cb).toHaveBeenCalledWith("pro");
    handler({ new: { plan: "garbage" } });
    expect(cb).toHaveBeenCalledTimes(1); // unchanged

    off();
    expect(removeChannel).toHaveBeenCalledWith(channel);
  });
});
