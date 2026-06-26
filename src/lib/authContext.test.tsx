import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";

vi.mock("./auth", () => ({
  getSession: vi.fn(),
  onAuthChange: vi.fn(() => () => {}),
  fetchPlan: vi.fn(),
  signInWithGoogle: vi.fn(),
  signOut: vi.fn(),
}));

import { getSession, onAuthChange, fetchPlan } from "./auth";
import { AuthProvider, useAuth, useEntitlements } from "./authContext";

function Probe() {
  const { user, plan, loading } = useAuth();
  const { can } = useEntitlements();
  return (
    <div>
      <span data-testid="loading">{String(loading)}</span>
      <span data-testid="user">{user?.id ?? "none"}</span>
      <span data-testid="plan">{plan}</span>
      <span data-testid="meetings">{String(can("meetings"))}</span>
    </div>
  );
}

beforeEach(() => vi.clearAllMocks());

describe("AuthProvider", () => {
  it("exposes the logged-out default state (free plan, no user)", async () => {
    vi.mocked(getSession).mockResolvedValueOnce(null);
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("loading").textContent).toBe("false"),
    );
    expect(screen.getByTestId("user").textContent).toBe("none");
    expect(screen.getByTestId("plan").textContent).toBe("free");
    expect(screen.getByTestId("meetings").textContent).toBe("true");
  });

  it("loads the user and their plan when a session exists", async () => {
    vi.mocked(getSession).mockResolvedValueOnce({
      user: { id: "u1" },
    } as never);
    vi.mocked(fetchPlan).mockResolvedValueOnce("pro");
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("user").textContent).toBe("u1"),
    );
    expect(screen.getByTestId("plan").textContent).toBe("pro");
  });

  it("stale signed-in fetchPlan does not clobber a subsequent logged-out state", async () => {
    // Deferred promise simulating a slow fetchPlan for user "u1"
    let resolveSlowPlan!: (plan: string) => void;
    const slowPlan = new Promise<string>((resolve) => {
      resolveSlowPlan = resolve;
    });

    vi.mocked(getSession).mockResolvedValueOnce({
      user: { id: "u1" },
    } as never);
    vi.mocked(fetchPlan).mockReturnValueOnce(slowPlan as never);

    // Capture the onAuthChange callback so we can fire it manually
    let authChangeHandler!: (session: { user: { id: string } } | null) => void;
    vi.mocked(onAuthChange).mockImplementationOnce((handler) => {
      authChangeHandler = handler as typeof authChangeHandler;
      return () => {};
    });

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    // Wait for the AuthProvider to register the onAuthChange callback
    await waitFor(() => expect(authChangeHandler).toBeDefined());

    // Fire a logout event — this is the second (winning) apply call
    await act(async () => {
      authChangeHandler(null);
    });

    // Now resolve the slow fetchPlan for the stale signed-in call
    await act(async () => {
      resolveSlowPlan("pro");
    });

    // The stale "pro" plan must not land; final state must reflect the logout
    await waitFor(() =>
      expect(screen.getByTestId("user").textContent).toBe("none"),
    );
    expect(screen.getByTestId("plan").textContent).toBe("free");
  });
});
