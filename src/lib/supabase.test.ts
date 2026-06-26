import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn((url: string, key: string, opts: unknown) => ({
    url,
    key,
    opts,
  })),
}));

import { createClient } from "@supabase/supabase-js";
import { createSupabase } from "./supabase";

// When both supabase.ts and secureStorage.ts exist, loading supabase.ts triggers
// the module-level `createSupabase(secureStorage)` call which occupies calls[0].
// Clear the mock history before each test so the test's explicit call is calls[0].
beforeEach(() => vi.mocked(createClient).mockClear());

describe("createSupabase", () => {
  it("configures the client for desktop PKCE with the injected storage", () => {
    const storage = {
      getItem: vi.fn(),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    };
    createSupabase(storage);

    const opts = vi.mocked(createClient).mock.calls[0][2] as {
      auth: Record<string, unknown>;
    };
    expect(opts.auth.flowType).toBe("pkce");
    expect(opts.auth.storage).toBe(storage);
    expect(opts.auth.persistSession).toBe(true);
    expect(opts.auth.autoRefreshToken).toBe(true);
    // We capture the OAuth code ourselves from the loopback, so the client must
    // not try to parse a session out of the (nonexistent) page URL.
    expect(opts.auth.detectSessionInUrl).toBe(false);
  });
});
