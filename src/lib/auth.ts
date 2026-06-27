import { invoke } from "@tauri-apps/api/core";
import { once } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { Session } from "@supabase/supabase-js";
import { getSupabase, isSupabaseConfigured } from "./supabase";
import { DEFAULT_PLAN, type Plan } from "./entitlements";

export type { Session };

/// Abandoned logins time out after 3 minutes so the loopback port is freed.
const OAUTH_TIMEOUT_MS = 180_000;

/// Parse the OAuth `code` out of the loopback callback URL.
export function extractCode(callbackUrl: string): string | null {
  return new URL(callbackUrl).searchParams.get("code");
}

/// Full desktop PKCE login: start the loopback, open the system browser at the
/// Supabase Google URL, wait for the redirect, then exchange the code.
export async function signInWithGoogle(): Promise<void> {
  if (!isSupabaseConfigured()) {
    throw new Error("Sign-in is unavailable: Supabase is not configured.");
  }

  const port = await invoke<number>("start_oauth_server");
  const redirectTo = `http://127.0.0.1:${port}`;

  // Hoisted so the init-failure catch block can cancel them if the steps
  // between subscribing and `await callback` throw before we get there.
  let timer: ReturnType<typeof setTimeout> | undefined;
  let unlisten: (() => void) | undefined;

  // Subscribe BEFORE opening the browser so we never miss the redirect.
  // Race the Tauri event against a timeout so an abandoned login doesn't hang
  // the UI forever and leak the Rust loopback thread.
  const callback = new Promise<string>((resolve, reject) => {
    timer = setTimeout(() => {
      unlisten?.();
      reject(new Error("Login timed out. Please try again."));
    }, OAUTH_TIMEOUT_MS);

    once<string>("oauth://url", (event) => {
      clearTimeout(timer);
      resolve(event.payload);
    })
      .then((fn) => {
        unlisten = fn;
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });

  try {
    const { data, error } = await getSupabase().auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo, skipBrowserRedirect: true },
    });
    if (error) throw error;
    if (!data?.url) throw new Error("OAuth provider returned no URL.");

    await openUrl(data.url);
  } catch (e) {
    clearTimeout(timer);
    unlisten?.();
    throw e;
  }

  const callbackUrl = await callback;
  const code = extractCode(callbackUrl);
  if (!code) throw new Error("OAuth callback returned no authorization code");

  const { error: exchangeError } =
    await getSupabase().auth.exchangeCodeForSession(code);
  if (exchangeError) throw exchangeError;
}

export async function signOut(): Promise<void> {
  const { error } = await getSupabase().auth.signOut();
  if (error) throw error;
}

export async function getSession(): Promise<Session | null> {
  if (!isSupabaseConfigured()) return null;
  const { data } = await getSupabase().auth.getSession();
  return data.session;
}

/// Subscribe to login/logout. Returns an unsubscribe function.
export function onAuthChange(
  cb: (session: Session | null) => void,
): () => void {
  if (!isSupabaseConfigured()) return () => {};
  const { data } = getSupabase().auth.onAuthStateChange((_event, session) => {
    cb(session);
  });
  return () => data.subscription.unsubscribe();
}

/// Subscribe to the signed-in user's plan via Realtime. The webhook writes
/// `profiles.plan`; this delivers the new value so the UI updates instantly.
/// Returns an unsubscribe function (no-op when Supabase is unconfigured).
export function subscribePlan(
  userId: string,
  cb: (plan: Plan) => void,
): () => void {
  if (!isSupabaseConfigured()) return () => {};
  const client = getSupabase();
  const channel = client
    .channel(`profile-plan-${userId}`)
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "profiles",
        filter: `id=eq.${userId}`,
      },
      (payload: { new: { plan?: string } }) => {
        const p = payload.new?.plan;
        if (p === "pro" || p === "free") cb(p);
      },
    )
    .subscribe();
  return () => {
    client.removeChannel(channel);
  };
}

/// Read the signed-in user's plan from `profiles`. Any miss → free.
export async function fetchPlan(userId: string): Promise<Plan> {
  const { data, error } = await getSupabase()
    .from("profiles")
    .select("plan")
    .eq("id", userId)
    .single();
  if (error || !data?.plan) return DEFAULT_PLAN;
  return data.plan as Plan;
}
