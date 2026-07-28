import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type { Session } from "@supabase/supabase-js";

vi.mock("./auth", () => ({
  getSession: vi.fn(),
  onAuthChange: vi.fn(() => () => {}),
  signInWithGoogle: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock("./api", () => ({
  setActiveUser: vi.fn(() => Promise.resolve()),
  setSignedIn: vi.fn(() => Promise.resolve()),
}));

vi.mock("./supabase", () => ({
  isSupabaseConfigured: vi.fn(() => true),
}));

import { getSession } from "./auth";
import { setSignedIn } from "./api";
import { isSupabaseConfigured } from "./supabase";
import { AuthProvider, useAuth } from "./authContext";

function Probe() {
  const { user, loading } = useAuth();
  return (
    <div>
      <span data-testid="loading">{String(loading)}</span>
      <span data-testid="user">{user?.id ?? "none"}</span>
    </div>
  );
}

beforeEach(() => vi.clearAllMocks());

describe("AuthProvider", () => {
  it("exposes the logged-out default state (no user)", async () => {
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
  });

  it("pushes the signed-in state to the backend on auth changes", async () => {
    vi.mocked(getSession).mockResolvedValue({
      user: { id: "u1" },
    } as unknown as Session);

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    await waitFor(() => expect(setSignedIn).toHaveBeenCalledWith(true));
  });

  it("keeps dictation/meetings unlocked when Supabase is unconfigured, even with no user", async () => {
    vi.mocked(isSupabaseConfigured).mockReturnValueOnce(false);
    vi.mocked(getSession).mockResolvedValueOnce(null);

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    // A fork with no .env has nobody to sign in as, so the gate must stay
    // open regardless of `u` — this pins the `||` in
    // `!isSupabaseConfigured() || !!u` against being flipped to `&&`.
    await waitFor(() => expect(setSignedIn).toHaveBeenCalledWith(true));
  });
});
