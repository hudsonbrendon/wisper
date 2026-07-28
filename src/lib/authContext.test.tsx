import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";

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

import { getSession, onAuthChange } from "./auth";
import { setActiveUser, setSignedIn } from "./api";
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
    vi.mocked(getSession).mockResolvedValueOnce({
      session: null,
      error: null,
    });
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

  it("locks the gate when Supabase is configured and there is no account", async () => {
    vi.mocked(getSession).mockResolvedValueOnce({
      session: null,
      error: null,
    });

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    // No session AND no error = we positively know nobody is signed in.
    await waitFor(() => expect(setSignedIn).toHaveBeenCalledWith(false));
    // Knowing that, scoping the data dir to _guest is correct.
    expect(setActiveUser).toHaveBeenCalledWith(null);
  });

  it("keeps the gate open when the session could not be refreshed (offline)", async () => {
    vi.mocked(getSession).mockResolvedValueOnce({
      session: null,
      error: new Error("Failed to fetch"),
    });

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("loading").textContent).toBe("false"),
    );
    // A stored-but-unverifiable session must never read as "signed out": the
    // backend flag stays at its last known-good value, so dictation and
    // meetings keep working on a plane.
    expect(setSignedIn).not.toHaveBeenCalled();
    // ...and the data dir must not be demoted to _guest either, or History and
    // Meetings render empty and everything recorded offline is filed under the
    // guest account, vanishing from the UI once the session refreshes.
    expect(setActiveUser).not.toHaveBeenCalled();
  });

  it("locks the gate on an explicit SIGNED_OUT event", async () => {
    vi.mocked(getSession).mockResolvedValueOnce({
      session: null,
      error: new Error("Failed to fetch"),
    });
    let emit: ((e: AuthChangeEvent, s: Session | null) => void) | undefined;
    vi.mocked(onAuthChange).mockImplementationOnce((cb) => {
      emit = cb;
      return () => {};
    });

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    await waitFor(() => expect(emit).toBeDefined());
    emit!("SIGNED_OUT", null);
    await waitFor(() => expect(setSignedIn).toHaveBeenCalledWith(false));
  });

  it("pushes the signed-in state to the backend on auth changes", async () => {
    vi.mocked(getSession).mockResolvedValue({
      session: { user: { id: "u1" } } as unknown as Session,
      error: null,
    });

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    await waitFor(() => expect(setSignedIn).toHaveBeenCalledWith(true));
  });

  it("keeps dictation/meetings unlocked when Supabase is unconfigured, even with no user", async () => {
    vi.mocked(isSupabaseConfigured).mockReturnValueOnce(false);
    vi.mocked(getSession).mockResolvedValueOnce({
      session: null,
      error: null,
    });

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
