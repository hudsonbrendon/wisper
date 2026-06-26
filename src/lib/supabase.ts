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

export const supabase = createSupabase(secureStorage);
