import { invoke } from "@tauri-apps/api/core";
import type { SupabaseAuthStorage } from "./supabase";

/// Supabase auth storage backed by the OS keychain (Rust `secure_*` commands).
/// Keeps the refresh token out of webview localStorage.
export const secureStorage: SupabaseAuthStorage = {
  getItem: (key) => invoke<string | null>("secure_get", { key }),
  setItem: (key, value) => invoke<void>("secure_set", { key, value }),
  removeItem: (key) => invoke<void>("secure_delete", { key }),
};
