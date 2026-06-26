import { invoke } from "@tauri-apps/api/core";
import { once } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import { DEFAULT_PLAN, type Plan } from "./entitlements";

export type { Session };

/// Parse the OAuth `code` out of the loopback callback URL.
export function extractCode(callbackUrl: string): string | null {
  return new URL(callbackUrl).searchParams.get("code");
}

/// Full desktop PKCE login: start the loopback, open the system browser at the
/// Supabase Google URL, wait for the redirect, then exchange the code.
export async function signInWithGoogle(): Promise<void> {
  const port = await invoke<number>("start_oauth_server");
  const redirectTo = `http://127.0.0.1:${port}`;

  // Subscribe BEFORE opening the browser so we never miss the redirect.
  const callback = new Promise<string>((resolve, reject) => {
    once<string>("oauth://url", (event) => resolve(event.payload)).catch(
      reject,
    );
  });

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo, skipBrowserRedirect: true },
  });
  if (error) throw error;

  await openUrl(data.url);

  const callbackUrl = await callback;
  const code = extractCode(callbackUrl);
  if (!code) throw new Error("OAuth callback returned no authorization code");

  const { error: exchangeError } =
    await supabase.auth.exchangeCodeForSession(code);
  if (exchangeError) throw exchangeError;
}

export async function signOut(): Promise<void> {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function getSession(): Promise<Session | null> {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

/// Subscribe to login/logout. Returns an unsubscribe function.
export function onAuthChange(
  cb: (session: Session | null) => void,
): () => void {
  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    cb(session);
  });
  return () => data.subscription.unsubscribe();
}

/// Read the signed-in user's plan from `profiles`. Any miss → free.
export async function fetchPlan(userId: string): Promise<Plan> {
  const { data, error } = await supabase
    .from("profiles")
    .select("plan")
    .eq("id", userId)
    .single();
  if (error || !data?.plan) return DEFAULT_PLAN;
  return data.plan as Plan;
}
