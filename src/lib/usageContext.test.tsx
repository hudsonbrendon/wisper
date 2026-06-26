import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

vi.mock("./authContext", () => ({ useAuth: vi.fn() }));
vi.mock("./usage", () => ({ loadUsage: vi.fn(), recordUsage: vi.fn() }));
vi.mock("./supabase", () => ({ isSupabaseConfigured: vi.fn(() => true) }));
vi.mock("./api", () => ({ setEntitlements: vi.fn(), onEvent: vi.fn(() => Promise.resolve(() => {})) }));

import { useAuth } from "./authContext";
import { loadUsage } from "./usage";
import { setEntitlements } from "./api";
import { UsageProvider, useUsage } from "./usageContext";

function Probe() {
  const { usage } = useUsage();
  return <span data-testid="words">{usage.dictation_words}</span>;
}

beforeEach(() => vi.clearAllMocks());

describe("UsageProvider", () => {
  it("loads usage for a free user and pushes remaining to Rust", async () => {
    vi.mocked(useAuth).mockReturnValue({ user: { id: "u1" }, plan: "free", loading: false } as never);
    vi.mocked(loadUsage).mockResolvedValue({ dictation_words: 500, meetings: 1 });

    render(<UsageProvider><Probe /></UsageProvider>);

    await waitFor(() => expect(screen.getByTestId("words").textContent).toBe("500"));
    expect(setEntitlements).toHaveBeenCalledWith({
      loggedIn: true,
      pro: false,
      remainingWords: 1500, // 2000 - 500
      remainingMeetings: 1, // 2 - 1
    });
  });

  it("pushes a logged-out snapshot when there is no user", async () => {
    vi.mocked(useAuth).mockReturnValue({ user: null, plan: "free", loading: false } as never);

    render(<UsageProvider><Probe /></UsageProvider>);

    await waitFor(() =>
      expect(setEntitlements).toHaveBeenCalledWith({
        loggedIn: false,
        pro: false,
        remainingWords: 0,
        remainingMeetings: 0,
      }),
    );
  });
});
