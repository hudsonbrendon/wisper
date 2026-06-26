import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./supabase", () => ({
  getSupabase: vi.fn(),
  isSupabaseConfigured: vi.fn(() => true),
}));

import { getSupabase, isSupabaseConfigured } from "./supabase";
import { loadUsage, recordUsage, flushQueue } from "./usage";

const QUEUE_KEY = "wisper.usage.queue";

function mockClient(over: Record<string, unknown> = {}) {
  return {
    rpc: vi.fn().mockResolvedValue({ data: { dictation_words: 12, meetings: 1 }, error: null }),
    from: vi.fn(() => ({ insert: vi.fn().mockResolvedValue({ error: null }) })),
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

describe("loadUsage", () => {
  it("returns the current_usage RPC result", async () => {
    vi.mocked(isSupabaseConfigured).mockReturnValue(true);
    const c = mockClient();
    vi.mocked(getSupabase).mockReturnValue(c as never);
    const u = await loadUsage();
    expect(c.rpc).toHaveBeenCalledWith("current_usage");
    expect(u).toEqual({ dictation_words: 12, meetings: 1 });
  });

  it("returns zeros when Supabase is not configured", async () => {
    vi.mocked(isSupabaseConfigured).mockReturnValue(false);
    const u = await loadUsage();
    expect(u).toEqual({ dictation_words: 0, meetings: 0 });
    expect(getSupabase).not.toHaveBeenCalled();
  });

  it("returns zeros when the RPC errors", async () => {
    vi.mocked(isSupabaseConfigured).mockReturnValue(true);
    const c = mockClient({ rpc: vi.fn().mockResolvedValue({ data: null, error: { message: "rpc fail" } }) });
    vi.mocked(getSupabase).mockReturnValue(c as never);
    const u = await loadUsage();
    expect(u).toEqual({ dictation_words: 0, meetings: 0 });
  });
});

describe("recordUsage", () => {
  it("inserts an event with the user's id", async () => {
    vi.mocked(isSupabaseConfigured).mockReturnValue(true);
    const insert = vi.fn().mockResolvedValue({ error: null });
    vi.mocked(getSupabase).mockReturnValue(mockClient({ from: vi.fn(() => ({ insert })) }) as never);
    await recordUsage("u1", "dictation_words", 42);
    expect(insert).toHaveBeenCalledWith({ user_id: "u1", metric: "dictation_words", amount: 42 });
    expect(JSON.parse(localStorage.getItem(QUEUE_KEY) ?? "[]")).toEqual([]);
  });

  it("enqueues to localStorage when the insert fails", async () => {
    vi.mocked(isSupabaseConfigured).mockReturnValue(true);
    const insert = vi.fn().mockResolvedValue({ error: { message: "offline" } });
    vi.mocked(getSupabase).mockReturnValue(mockClient({ from: vi.fn(() => ({ insert })) }) as never);
    await recordUsage("u1", "meeting", 1);
    expect(JSON.parse(localStorage.getItem(QUEUE_KEY) ?? "[]")).toEqual([
      { user_id: "u1", metric: "meeting", amount: 1 },
    ]);
  });

  it("enqueues when Supabase is not configured", async () => {
    vi.mocked(isSupabaseConfigured).mockReturnValue(false);
    await recordUsage("u1", "dictation_words", 5);
    expect(JSON.parse(localStorage.getItem(QUEUE_KEY) ?? "[]")).toEqual([
      { user_id: "u1", metric: "dictation_words", amount: 5 },
    ]);
    expect(getSupabase).not.toHaveBeenCalled();
  });
});

describe("flushQueue", () => {
  it("replays queued events and clears the queue on success", async () => {
    vi.mocked(isSupabaseConfigured).mockReturnValue(true);
    localStorage.setItem(
      QUEUE_KEY,
      JSON.stringify([{ user_id: "u1", metric: "meeting", amount: 1 }]),
    );
    const insert = vi.fn().mockResolvedValue({ error: null });
    vi.mocked(getSupabase).mockReturnValue(mockClient({ from: vi.fn(() => ({ insert })) }) as never);
    await flushQueue();
    expect(insert).toHaveBeenCalledWith({ user_id: "u1", metric: "meeting", amount: 1 });
    expect(JSON.parse(localStorage.getItem(QUEUE_KEY) ?? "[]")).toEqual([]);
  });

  it("keeps unsent events when an insert fails", async () => {
    vi.mocked(isSupabaseConfigured).mockReturnValue(true);
    localStorage.setItem(
      QUEUE_KEY,
      JSON.stringify([{ user_id: "u1", metric: "meeting", amount: 1 }]),
    );
    const insert = vi.fn().mockResolvedValue({ error: { message: "offline" } });
    vi.mocked(getSupabase).mockReturnValue(mockClient({ from: vi.fn(() => ({ insert })) }) as never);
    await flushQueue();
    expect(JSON.parse(localStorage.getItem(QUEUE_KEY) ?? "[]")).toEqual([
      { user_id: "u1", metric: "meeting", amount: 1 },
    ]);
  });

  it("tolerates malformed localStorage", async () => {
    vi.mocked(isSupabaseConfigured).mockReturnValue(true);
    localStorage.setItem(QUEUE_KEY, "not-json");
    await expect(flushQueue()).resolves.toBeUndefined();
  });
});
