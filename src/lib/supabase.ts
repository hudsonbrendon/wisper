import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { secureStorage } from "./secureStorage";

/// Async key/value store Supabase uses to persist the session. We back it with
/// the OS keychain (see secureStorage) instead of webview localStorage so the
/// refresh token never sits in plaintext in the WebView storage.
export interface SupabaseAuthStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export function createSupabase(
  storage: SupabaseAuthStorage,
): SupabaseClient {
  return createClient(
    import.meta.env.VITE_SUPABASE_URL,
    import.meta.env.VITE_SUPABASE_ANON_KEY,
    {
      auth: {
        flowType: "pkce",
        storage,
        persistSession: true,
        autoRefreshToken: true,
        // The desktop loopback hands us the OAuth `code` directly; we never load
        // a redirect URL into this webview, so disable URL session detection.
        detectSessionInUrl: false,
      },
    },
  );
}

export function isSupabaseConfigured(): boolean {
  return Boolean(
    import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY,
  );
}

// Lazily constructed and cached; never created at import time so windows that
// don't need auth (and fresh clones with no .env) don't crash on module load.
let client: SupabaseClient | null = null;
export function getSupabase(): SupabaseClient {
  if (!client) {
    if (!isSupabaseConfigured()) {
      throw new Error(
        "Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.",
      );
    }
    client = createSupabase(secureStorage);
  }
  return client;
}
